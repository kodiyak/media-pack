import type { ClassifiedMedia } from "@repo/protocol";
import { deriveFilename } from "./filename";
import { baseContentType, contentTypeToKind, detectStreamType, extensionToKind } from "./kinds";

/** Dados normalizados de uma resposta HTTP (vindos do `webRequest`). */
export type ClassifyInput = {
  url: string;
  contentType?: string;
  contentDisposition?: string;
  contentLength?: number;
  tabId?: number;
  pageUrl?: string;
  pageTitle?: string;
};

const IGNORED_HOST_SUFFIXES = ["googlevideo.com"];

/** Hosts que geram ruído (ex.: segmentos do YouTube) e não interessam. */
export function isIgnoredUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return IGNORED_HOST_SUFFIXES.some(
      (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`),
    );
  } catch {
    return true;
  }
}

/** Remove hash e o parâmetro `range` (requisições parciais viram duplicatas). */
export function normalizeMediaUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    url.hash = "";
    url.searchParams.delete("range");
    return url.href;
  } catch {
    return null;
  }
}

/** Decide se uma resposta é mídia e devolve o item (sem `id`/`createdAt`). */
export function classifyResponse(input: ClassifyInput): ClassifiedMedia | null {
  const url = normalizeMediaUrl(input.url);
  if (!url || isIgnoredUrl(url)) return null;

  const streamType = detectStreamType(input.contentType, url);
  const kind =
    contentTypeToKind(input.contentType) ?? extensionToKind(url) ?? (streamType ? "video" : null);
  if (!kind) return null;

  return {
    url,
    kind,
    mimeType: baseContentType(input.contentType) || undefined,
    filename: deriveFilename({
      url,
      contentType: input.contentType,
      contentDisposition: input.contentDisposition,
      kind,
      streamType,
    }),
    sizeInBytes: toNonNegativeInt(input.contentLength),
    streamType: streamType ?? undefined,
    tabId: input.tabId,
    sourceUrl: validUrlOrUndefined(input.pageUrl),
    pageTitle: input.pageTitle?.trim() || undefined,
  };
}

function toNonNegativeInt(value?: number): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value < 0) return undefined;
  return Math.trunc(value);
}

/** Total de bytes a partir de `Content-Range: bytes 0-1023/5000000`. */
export function parseContentRangeTotal(value?: string): number | undefined {
  if (!value) return undefined;
  const match = /\/(\d+)\s*$/.exec(value.trim());
  if (!match?.[1]) return undefined;
  const total = Number(match[1]);
  return Number.isFinite(total) && total >= 0 ? total : undefined;
}

function validUrlOrUndefined(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).href;
  } catch {
    return undefined;
  }
}
