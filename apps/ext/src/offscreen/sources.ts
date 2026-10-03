import {
  createSemaphore,
  type DownloadSource,
  releaseOnEnd,
  toErrorMessage,
  urlSource,
} from "@repo/downloader";
import type { MediaItem, StreamVariantPolicy } from "@repo/protocol";
import {
  hlsOutputFilename,
  openDashTrack,
  openHlsStream,
  resolveDashTracks,
  streamBaseName,
} from "@repo/streams";

/**
 * Teto de conversões HLS/DASH simultâneas. Downloads concorrentes repartem essas
 * vagas; os que excedem esperam a fila, sem nunca tocar no limite global de jobs.
 */
export const MAX_CONCURRENT_CONVERSIONS = 3;

const conversionSlots = createSemaphore(MAX_CONCURRENT_CONVERSIONS);

/**
 * Monta as fontes do ZIP a partir dos itens selecionados. Roda no offscreen, então
 * pode converter HLS/DASH e entregar os streams direto ao client-zip (sem OPFS).
 */
export async function buildDownloadSources(
  items: MediaItem[],
  policy: StreamVariantPolicy,
  signal: AbortSignal,
): Promise<DownloadSource[]> {
  const sources: DownloadSource[] = [];

  for (const item of items) {
    if (isConvertibleHls(item)) {
      sources.push({
        filename: hlsOutputFilename(item),
        async open(openSignal, onProgress) {
          return openWithSlot(openSignal ?? signal, async () => {
            const opened = await openHlsStream({
              url: item.url,
              policy,
              signal: openSignal ?? signal,
              onProgress,
            });
            return opened.body;
          });
        },
      });
      continue;
    }

    if (item.streamType === "dash") {
      sources.push(...(await buildDashSources(item, policy, signal)));
      continue;
    }

    sources.push(urlSource(item.url, item.filename ?? `media-${item.id}`));
  }

  return sources;
}

/** Reserva uma vaga de conversão e devolve o stream que a libera ao terminar. */
async function openWithSlot(
  signal: AbortSignal,
  open: () => Promise<ReadableStream<Uint8Array>>,
): Promise<{ body: ReadableStream<Uint8Array> }> {
  const release = await conversionSlots.acquire(signal);
  const onAbort = (): void => release();
  signal.addEventListener("abort", onAbort, { once: true });

  const cleanup = (): void => {
    signal.removeEventListener("abort", onAbort);
    release();
  };

  try {
    return { body: releaseOnEnd(await open(), cleanup) };
  } catch (error) {
    cleanup();
    throw error;
  }
}

async function buildDashSources(
  item: MediaItem,
  policy: StreamVariantPolicy,
  signal: AbortSignal,
): Promise<DownloadSource[]> {
  const base = streamBaseName(item);

  try {
    // Baixa só o MPD para descobrir as faixas; os segmentos ficam adiados
    // até o client-zip abrir cada entrada.
    const { tracks } = await resolveDashTracks({ url: item.url, policy, signal });
    return tracks.map((track) => ({
      filename: track.kind === "video" ? `${base}.mp4` : `${base}.audio.m4a`,
      async open(openSignal, onProgress) {
        return openWithSlot(openSignal ?? signal, async () => {
          const opened = await openDashTrack(track.plan, {
            signal: openSignal ?? signal,
            onProgress,
          });
          return opened.body;
        });
      },
    }));
  } catch (error) {
    const message = toErrorMessage(error);
    return [
      {
        filename: `${base}.mp4`,
        open: async () => {
          throw new Error(message);
        },
      },
    ];
  }
}

/** Só converte HLS VOD sem DRM; o resto cai no download direto. */
function isConvertibleHls(item: MediaItem): boolean {
  if (item.streamType !== "hls") return false;

  const { stream } = item;
  if (!stream) return true;
  return !stream.live && stream.encryption !== "sample-aes";
}
