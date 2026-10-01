import { selectVariant } from "@repo/media";
import type { StreamVariantPolicy } from "@repo/protocol";
import { openTrackStream, type TrackDeps, type TrackPlan, type TrackProgress } from "../mp4/track";
import { muxFmp4 } from "../mux/mp4box";
import { streamBaseName } from "../names";
import { type HlsManifestInfo, parseHlsManifest, selectAudioRendition } from "./manifest";
import { buildHlsPlan, type HlsPlan } from "./playlist";

export type HlsStreamProgress = TrackProgress;
export type HlsStreamDeps = TrackDeps & {
  /** Injeta o mux para testes; por padrão usa o mp4box real. */
  mux?: typeof muxFmp4;
};

export type HlsStreamInput = {
  /** Master ou media playlist. */
  url: string;
  /** Política de escolha da variante quando for master. */
  policy?: StreamVariantPolicy;
  signal?: AbortSignal;
  onProgress?: (progress: HlsStreamProgress) => void;
};

/** Stream MP4 (fMP4) pronto para entrar no ZIP. */
export type OpenedStream = {
  body: ReadableStream<Uint8Array>;
  /** `true` quando vídeo e áudio foram remuxados em um único arquivo. */
  muxed?: boolean;
};

/** Nome de saída `.mp4` a partir do item/arquivo. */
export function hlsOutputFilename(item: { filename?: string; title?: string }): string {
  return `${streamBaseName(item)}.mp4`;
}

/**
 * Baixa e converte um HLS VOD em um MP4 fragmentado, em streaming.
 *
 * Quando a master playlist separa o áudio (EXT-X-MEDIA TYPE=AUDIO), o áudio é
 * baixado junto e remuxado com mp4box.js; se o mux falhar, cai no vídeo sem
 * áudio em vez de quebrar o ZIP.
 */
export async function openHlsStream(
  input: HlsStreamInput,
  deps: HlsStreamDeps = {},
): Promise<OpenedStream> {
  const fetcher = deps.fetch ?? globalThis.fetch.bind(globalThis);
  const mux = deps.mux ?? muxFmp4;
  const trackDeps = { fetch: deps.fetch, createTransmuxer: deps.createTransmuxer };

  const resolved = await resolveMediaPlaylist(fetcher, input);
  const plan = buildHlsPlan(resolved.text, resolved.url);
  assertPlayable(plan);

  const videoTrack = toTrackPlan(plan);

  const audio = selectAudioRendition(
    resolved.master?.audioRenditions,
    resolved.variantAudioGroupId,
  );
  if (!audio?.url) {
    return {
      body: await openTrackStream(
        videoTrack,
        { signal: input.signal, onProgress: input.onProgress },
        trackDeps,
      ),
    };
  }

  return openMuxedStream(
    videoTrack,
    audio.url,
    plan.segments.length,
    input,
    trackDeps,
    fetcher,
    mux,
  );
}

/** Resolve master → media playlist, guardando o master para detectar áudio separado. */
async function resolveMediaPlaylist(
  fetcher: typeof globalThis.fetch,
  input: HlsStreamInput,
): Promise<{ text: string; url: string; master?: HlsManifestInfo; variantAudioGroupId?: string }> {
  const text = await fetchText(fetcher, input.url, input.signal);
  const master = parseHlsManifest(text, input.url);

  if (!master.variants || master.variants.length === 0) {
    return { text, url: input.url };
  }

  const variant = selectVariant(master.variants, input.policy ?? "best");
  if (!variant?.url) throw new Error("Master playlist sem variante utilizável.");

  return {
    text: await fetchText(fetcher, variant.url, input.signal),
    url: variant.url,
    master,
    variantAudioGroupId: variant.audioGroupId,
  };
}

/** Baixa vídeo e áudio e remuxa; falha do mux nunca interrompe o download. */
async function openMuxedStream(
  videoTrack: TrackPlan,
  audioUrl: string,
  videoSegments: number,
  input: HlsStreamInput,
  trackDeps: TrackDeps,
  fetcher: typeof globalThis.fetch,
  mux: typeof muxFmp4,
): Promise<OpenedStream> {
  const streamVideo = () =>
    openTrackStream(videoTrack, { signal: input.signal, onProgress: input.onProgress }, trackDeps);

  let audioPlan: HlsPlan;
  try {
    const audioText = await fetchText(fetcher, audioUrl, input.signal);
    audioPlan = buildHlsPlan(audioText, audioUrl);
  } catch (error) {
    console.warn("[media-pack] não foi possível baixar o áudio HLS:", error);
    return { body: await streamVideo(), muxed: false };
  }

  if (audioPlan.live || audioPlan.encryption === "sample-aes" || audioPlan.segments.length === 0) {
    return { body: await streamVideo(), muxed: false };
  }

  const total = videoSegments + audioPlan.segments.length;
  const videoProgress = (progress: TrackProgress) =>
    input.onProgress?.(combineProgress(progress, 0, total));
  const audioProgress = (progress: TrackProgress) =>
    input.onProgress?.(combineProgress(progress, videoSegments, total));

  const videoBytes = await collectStream(
    await openTrackStream(
      videoTrack,
      { signal: input.signal, onProgress: videoProgress },
      trackDeps,
    ),
  );

  try {
    const audioBytes = await collectStream(
      await openTrackStream(
        toTrackPlan(audioPlan),
        { signal: input.signal, onProgress: audioProgress },
        trackDeps,
      ),
    );
    const muxed = await mux(videoBytes, audioBytes);
    return { body: bytesToStream(muxed), muxed: true };
  } catch (error) {
    console.warn("[media-pack] remux HLS falhou, usando vídeo sem áudio:", error);
    return { body: bytesToStream(videoBytes), muxed: false };
  }
}

function toTrackPlan(plan: HlsPlan): TrackPlan {
  return {
    container: plan.container,
    segments: plan.segments,
    initUrl: plan.mapUrl,
  };
}

function assertPlayable(plan: HlsPlan): void {
  if (plan.live) throw new Error("Playlists HLS ao vivo ainda não são suportadas.");
  if (plan.encryption === "sample-aes") {
    throw new Error("HLS com SAMPLE-AES (DRM) não é suportado.");
  }
  if (plan.segments.length === 0) throw new Error("Playlist HLS sem segmentos.");
}

function combineProgress(progress: TrackProgress, offset: number, total: number): TrackProgress {
  if (progress.subIndex === undefined || progress.subTotal === undefined) {
    return { subIndex: offset, subTotal: total };
  }
  return { subIndex: offset + progress.subIndex, subTotal: total };
}

async function collectStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    total += value.byteLength;
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

function bytesToStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  const stream = new Response(new Uint8Array(bytes)).body;
  if (!stream) throw new Error("Falha ao criar o stream do arquivo remuxado.");
  return stream;
}

async function fetchText(
  fetcher: typeof globalThis.fetch,
  url: string,
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetcher(url, { credentials: "include", redirect: "follow", signal });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
  return response.text();
}
