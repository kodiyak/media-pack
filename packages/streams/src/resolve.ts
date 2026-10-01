import { selectVariant } from "@repo/media";
import type { StreamInfo, StreamType, StreamVariant } from "@repo/protocol";
import { parseDashManifest } from "./dash/manifest";
import { parseHlsManifest } from "./hls/manifest";
import { estimateBytes } from "./util";

export type ResolveStreamInput = {
  url: string;
  streamType: StreamType;
};

export type ResolveDeps = {
  fetch?: typeof globalThis.fetch;
};

/**
 * Etapa S1: resolve metadados de um manifesto (sem baixar segmentos).
 * Para master playlists HLS, também lê a melhor variante para obter a duração.
 */
export async function resolveStreamInfo(
  input: ResolveStreamInput,
  deps: ResolveDeps = {},
): Promise<Partial<StreamInfo>> {
  const fetcher = deps.fetch ?? globalThis.fetch.bind(globalThis);
  const resolvedAt = new Date().toISOString();
  const text = await fetchText(fetcher, input.url);

  if (input.streamType === "dash") {
    const info = parseDashManifest(text, input.url);
    return {
      ...info,
      estimatedBytes: estimateBytes(bestBandwidth(info.variants), info.durationSeconds),
      resolvedAt,
    };
  }

  const info = parseHlsManifest(text, input.url);
  const best = selectVariant(info.variants ?? [], "best");

  if (best?.url && info.variants && info.variants.length > 0) {
    try {
      const mediaText = await fetchText(fetcher, best.url);
      const media = parseHlsManifest(mediaText, best.url);
      return {
        ...info,
        container: media.container,
        encryption: media.encryption,
        live: media.live,
        segmentCount: media.segmentCount,
        durationSeconds: media.durationSeconds,
        selectedVariantUrl: best.url,
        estimatedBytes: estimateBytes(best.bandwidth, media.durationSeconds),
        resolvedAt,
      };
    } catch {
      // segue apenas com as variantes quando a playlist da variante falha
    }
  }

  return {
    ...info,
    selectedVariantUrl: best?.url,
    estimatedBytes: estimateBytes(best?.bandwidth, info.durationSeconds),
    resolvedAt,
  };
}

async function fetchText(fetcher: typeof globalThis.fetch, url: string): Promise<string> {
  const response = await fetcher(url, { credentials: "include", redirect: "follow" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
  }
  return response.text();
}

function bestBandwidth(variants?: StreamVariant[]): number | undefined {
  return selectVariant(variants ?? [], "best")?.bandwidth;
}
