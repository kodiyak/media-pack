import type { MediaKind, StreamType } from "@repo/protocol";
import { defaultExtension } from "./kinds";

const INVALID_CHARS = /[\\/:*?"<>|]/g;
const CONTROL_CHARS = /\p{Cc}/gu;

/** Remove caracteres problemáticos e limita o tamanho do nome. */
export function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(INVALID_CHARS, "_")
    .replace(CONTROL_CHARS, "_")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, 180) || "arquivo";
}

/** Extrai `filename` (inclusive `filename*=`) de um Content-Disposition. */
export function filenameFromContentDisposition(value?: string): string | null {
  if (!value) return null;

  const extended = /filename\*\s*=\s*([^;]+)/i.exec(value);
  if (extended?.[1]) {
    const raw = extended[1].trim().replace(/^["']|["']$/g, "");
    const [, encoded = raw] = raw.split("''");
    try {
      return decodeURIComponent(encoded) || null;
    } catch {
      return encoded || null;
    }
  }

  const plain = /filename\s*=\s*("[^"]*"|[^;]+)/i.exec(value);
  if (plain?.[1]) {
    const raw = plain[1].trim().replace(/^["']|["']$/g, "");
    return raw || null;
  }

  return null;
}

/** Usa o último segmento do caminho da URL como nome. */
export function filenameFromUrl(url: string): string | null {
  try {
    const { pathname } = new URL(url);
    const last = pathname.split("/").filter(Boolean).pop();
    if (!last) return null;
    return decodeURIComponent(last) || null;
  } catch {
    return null;
  }
}

export function hasExtension(name: string): boolean {
  return /\.[a-z0-9]{1,8}$/i.test(name);
}

export type FilenameInput = {
  url: string;
  contentType?: string;
  contentDisposition?: string;
  kind: MediaKind;
  streamType?: StreamType | null;
};

/** Deriva um nome de arquivo seguro e com extensão. */
export function deriveFilename(input: FilenameInput): string {
  const fromDisposition = filenameFromContentDisposition(input.contentDisposition);
  const fromUrl = filenameFromUrl(input.url);
  const base = stripDirectory(fromDisposition ?? fromUrl ?? "arquivo");
  const sanitized = sanitizeFilename(base);

  if (hasExtension(sanitized)) return sanitized;

  const extension = defaultExtension(input.kind, input.contentType, input.streamType);
  return `${sanitized}.${extension}`;
}

function stripDirectory(name: string): string {
  return name.replace(/\\/g, "/").split("/").pop() ?? name;
}
