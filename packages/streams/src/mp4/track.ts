import { decryptAes128 } from "../aes128";
import { type CreateTransmuxer, createMuxTransmuxer, type TransmuxedSegment } from "../transmux";

/** Trecho de bytes dentro de um recurso (usado por `EXT-X-BYTERANGE`/DASH). */
export type ByteRange = { offset: number; length: number };

export type TrackSegment = {
  url: string;
  byteRange?: ByteRange;
  key?: { url: string; iv: Uint8Array };
};

/** Plano de uma faixa (vídeo ou áudio) para montar um MP4 em streaming. */
export type TrackPlan = {
  container: "ts" | "fmp4";
  segments: TrackSegment[];
  /** Segmento de inicialização (EXT-X-MAP / Initialization). */
  initUrl?: string;
  /** SegmentBase: um único arquivo MP4 completo (baixado inteiro). */
  singleUrl?: string;
};

export type TrackProgress = {
  subIndex?: number;
  subTotal?: number;
};

export type TrackDeps = {
  fetch?: typeof globalThis.fetch;
  createTransmuxer?: CreateTransmuxer;
};

export type TrackOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: TrackProgress) => void;
};

/**
 * Monta o MP4 de uma faixa em streaming: fMP4 é concatenado (init + segmentos);
 * TS é transmuxado com mux.js; `singleUrl` é repassado direto.
 */
export async function openTrackStream(
  plan: TrackPlan,
  options: TrackOptions = {},
  deps: TrackDeps = {},
): Promise<ReadableStream<Uint8Array>> {
  const fetcher = deps.fetch ?? globalThis.fetch.bind(globalThis);

  if (plan.singleUrl) {
    return singleFileStream(fetcher, plan.singleUrl, options.signal);
  }

  const createTransmuxer = deps.createTransmuxer ?? createMuxTransmuxer;
  const segmentFetcher = createSegmentFetcher(fetcher, options.signal);
  const iterator =
    plan.container === "fmp4"
      ? concatIterator(plan, segmentFetcher, options.onProgress)
      : transmuxIterator(plan, createTransmuxer, segmentFetcher, options.onProgress);

  return toStream(iterator);
}

async function singleFileStream(
  fetcher: typeof globalThis.fetch,
  url: string,
  signal?: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  const response = await fetcher(url, { credentials: "include", redirect: "follow", signal });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
  if (response.body) return response.body;

  const stream = new Response(new Uint8Array(await response.arrayBuffer())).body;
  if (!stream) throw new Error("Falha ao abrir o stream do arquivo.");
  return stream;
}

type SegmentFetcher = (segment: TrackSegment) => Promise<Uint8Array>;

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
  plan: TrackPlan,
  segmentFetcher: SegmentFetcher,
  onProgress?: TrackOptions["onProgress"],
): AsyncGenerator<Uint8Array> {
  if (plan.initUrl) {
    yield await segmentFetcher({ url: plan.initUrl });
  }

  let index = 0;
  for (const segment of plan.segments) {
    yield await segmentFetcher(segment);
    index += 1;
    onProgress?.({ subIndex: index, subTotal: plan.segments.length });
  }
}

async function* transmuxIterator(
  plan: TrackPlan,
  createTransmuxer: CreateTransmuxer,
  segmentFetcher: SegmentFetcher,
  onProgress?: TrackOptions["onProgress"],
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

async function fetchBytes(
  fetcher: typeof globalThis.fetch,
  url: string,
  byteRange: ByteRange | undefined,
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
