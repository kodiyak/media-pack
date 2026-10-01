import { type DownloadSource, toErrorMessage, urlSource } from "@repo/downloader";
import type { MediaItem, StreamVariantPolicy } from "@repo/protocol";
import {
  hlsOutputFilename,
  openDashTrack,
  openHlsStream,
  resolveDashTracks,
  streamBaseName,
} from "@repo/streams";

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
          const opened = await openHlsStream({
            url: item.url,
            policy,
            signal: openSignal ?? signal,
            onProgress,
          });
          return { body: opened.body };
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
        const opened = await openDashTrack(track.plan, {
          signal: openSignal ?? signal,
          onProgress,
        });
        return { body: opened.body };
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
