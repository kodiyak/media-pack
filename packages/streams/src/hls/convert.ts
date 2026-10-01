import { selectVariant } from "@repo/media";
import type { StreamVariantPolicy } from "@repo/protocol";
import { decryptAes128 } from "../aes128";
import { type CreateTransmuxer, createMuxTransmuxer, type TransmuxedSegment } from "../transmux";
import { parseHlsManifest } from "./manifest";
import { buildHlsPlan, type HlsPlan, type HlsSegmentPlan } from "./playlist";

export type HlsStreamProgress = {
  subIndex?: number;
  subTotal?: number;
};

export type HlsStreamInput = {
  /** Master ou media playlist. */
  url: string;
  /** Política de escolha da variante quando for master. */
  policy?: StreamVariantPolicy;
  signal?: AbortSignal;
  onProgress?: (progress: HlsStreamProgress) => void;
};

export type HlsStreamDeps = {
  fetch?: typeof globalThis.fetch;
  createTransmuxer?: CreateTransmuxer;
};

/** Stream MP4 (fMP4) pronto para entrar no ZIP. */
export type OpenedStream = {
  body: ReadableStream<Uint8Array>;
};

/** Nome de saída `.mp4` a partir do item/arquivo. */
export function hlsOutputFilename(item: { filename?: string; title?: string }): string {
  const source = item.filename ?? item.title ?? "video";
  const withoutExtension = source.replace(/\.[^./\\]+$/, "");
  return `${withoutExtension || "video"}.mp4`;
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
  const createTransmuxer = deps.createTransmuxer ?? createMuxTransmuxer;

  const media = await resolveMediaPlaylist(fetcher, input);
  const plan = buildHlsPlan(media.text, media.url);

  if (plan.live) throw new Error("Playlists HLS ao vivo ainda não são suportadas.");
  if (plan.encryption === "sample-aes") {
    throw new Error("HLS com SAMPLE-AES (DRM) não é suportado.");
  }
  if (plan.segments.length === 0) throw new Error("Playlist HLS sem segmentos.");

  const segmentFetcher = createSegmentFetcher(fetcher, input.signal);

  const body =
    plan.container === "fmp4"
      ? toStream(concatIterator(plan, segmentFetcher, input.onProgress))
      : toStream(transmuxIterator(plan, createTransmuxer, segmentFetcher, input.onProgress));

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

type SegmentFetcher = (segment: HlsSegmentPlan) => Promise<Uint8Array>;

function createSegmentFetcher(
  fetcher: typeof globalThis.fetch,
  signal?: AbortSignal,
): SegmentFetcher {
  const keyCache = new Map<string, Uint8Array>();

  return async (segment) => {
    let bytes = await fetchBytes(fetcher, segment.url, segment.byteRange, signal);

    if (segment.key) {
      let key = keyCache.get(segment.key.url);
      if (!key) {
        key = await fetchBytes(fetcher, segment.key.url, undefined, signal);
        keyCache.set(segment.key.url, key);
      }
      bytes = await decryptAes128(bytes, key, segment.key.iv);
    }

    return bytes;
  };
}

function toStream(iterator: AsyncGenerator<Uint8Array>): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await iterator.next();
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return(undefined);
    },
  });
}

async function* concatIterator(
  plan: HlsPlan,
  segmentFetcher: SegmentFetcher,
  onProgress?: HlsStreamInput["onProgress"],
): AsyncGenerator<Uint8Array> {
  if (plan.mapUrl) {
    yield await segmentFetcher({ url: plan.mapUrl });
  }

  let index = 0;
  for (const segment of plan.segments) {
    yield await segmentFetcher(segment);
    index += 1;
    onProgress?.({ subIndex: index, subTotal: plan.segments.length });
  }
}

async function* transmuxIterator(
  plan: HlsPlan,
  createTransmuxer: CreateTransmuxer,
  segmentFetcher: SegmentFetcher,
  onProgress?: HlsStreamInput["onProgress"],
): AsyncGenerator<Uint8Array> {
  const transmuxer = await createTransmuxer();
  const pending: Uint8Array[] = [];
  let initEmitted = false;

  transmuxer.on("data", (segment: TransmuxedSegment) => {
    if (segment.initSegment && !initEmitted) {
      pending.push(segment.initSegment);
      initEmitted = true;
    }
    if (segment.data) pending.push(segment.data);
  });

  let index = 0;
  for (const segment of plan.segments) {
    transmuxer.push(await segmentFetcher(segment));
    while (pending.length > 0) {
      const chunk = pending.shift();
      if (chunk) yield chunk;
    }
    index += 1;
    onProgress?.({ subIndex: index, subTotal: plan.segments.length });
  }

  transmuxer.flush();
  while (pending.length > 0) {
    const chunk = pending.shift();
    if (chunk) yield chunk;
  }
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

async function fetchBytes(
  fetcher: typeof globalThis.fetch,
  url: string,
  byteRange: { offset: number; length: number } | undefined,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const headers = byteRange
    ? { Range: `bytes=${byteRange.offset}-${byteRange.offset + byteRange.length - 1}` }
    : undefined;

  const response = await fetcher(url, {
    credentials: "include",
    redirect: "follow",
    signal,
    headers,
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
  return new Uint8Array(await response.arrayBuffer());
}
