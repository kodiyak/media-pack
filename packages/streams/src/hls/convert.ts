import { selectVariant } from "@repo/media";
import type { StreamVariantPolicy } from "@repo/protocol";
import { openTrackStream, type TrackDeps, type TrackPlan, type TrackProgress } from "../mp4/track";
import { streamBaseName } from "../names";
import { parseHlsManifest } from "./manifest";
import { buildHlsPlan } from "./playlist";

export type HlsStreamProgress = TrackProgress;
export type HlsStreamDeps = TrackDeps;

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
};

/** Nome de saída `.mp4` a partir do item/arquivo. */
export function hlsOutputFilename(item: { filename?: string; title?: string }): string {
  return `${streamBaseName(item)}.mp4`;
}

/**
 * Baixa e converte um HLS VOD em um MP4 fragmentado, em streaming:
 * fMP4 é concatenado (init + segmentos); TS é transmuxado com mux.js.
 */
export async function openHlsStream(
  input: HlsStreamInput,
  deps: HlsStreamDeps = {},
): Promise<OpenedStream> {
  const fetcher = deps.fetch ?? globalThis.fetch.bind(globalThis);

  const media = await resolveMediaPlaylist(fetcher, input);
  const plan = buildHlsPlan(media.text, media.url);

  if (plan.live) throw new Error("Playlists HLS ao vivo ainda não são suportadas.");
  if (plan.encryption === "sample-aes") {
    throw new Error("HLS com SAMPLE-AES (DRM) não é suportado.");
  }
  if (plan.segments.length === 0) throw new Error("Playlist HLS sem segmentos.");

  const track: TrackPlan = {
    container: plan.container,
    segments: plan.segments,
    initUrl: plan.mapUrl,
  };

  const body = await openTrackStream(
    track,
    { signal: input.signal, onProgress: input.onProgress },
    { fetch: deps.fetch, createTransmuxer: deps.createTransmuxer },
  );

  return { body };
}

async function resolveMediaPlaylist(
  fetcher: typeof globalThis.fetch,
  input: HlsStreamInput,
): Promise<{ text: string; url: string }> {
  const text = await fetchText(fetcher, input.url, input.signal);
  const master = parseHlsManifest(text, input.url);

  if (!master.variants || master.variants.length === 0) {
    return { text, url: input.url };
  }

  const variant = selectVariant(master.variants, input.policy ?? "best");
  if (!variant?.url) throw new Error("Master playlist sem variante utilizável.");

  return { text: await fetchText(fetcher, variant.url, input.signal), url: variant.url };
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
