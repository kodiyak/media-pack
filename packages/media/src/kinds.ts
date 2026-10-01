import type { MediaKind, StreamType } from "@repo/protocol";

/** Rótulos em pt-BR usados na UI. */
export const KIND_LABELS: Record<MediaKind, string> = {
  image: "Imagem",
  video: "Vídeo",
  audio: "Áudio",
  document: "Documento",
  archive: "Arquivo",
  other: "Outro",
};

/** Ordem exibida nos filtros. */
export const MEDIA_KINDS: MediaKind[] = ["video", "audio", "image", "document", "archive", "other"];

const VIDEO_EXTENSIONS = new Set([
  "3g2",
  "3gp",
  "avi",
  "flv",
  "m2ts",
  "m4v",
  "mkv",
  "mov",
  "mp4",
  "mpeg",
  "mpg",
  "mts",
  "ogv",
  "ts",
  "webm",
  "wmv",
]);

const AUDIO_EXTENSIONS = new Set([
  "aac",
  "amr",
  "flac",
  "m4a",
  "mid",
  "midi",
  "mp3",
  "oga",
  "ogg",
  "opus",
  "wav",
  "weba",
  "wma",
]);

const IMAGE_EXTENSIONS = new Set([
  "avif",
  "bmp",
  "gif",
  "heic",
  "heif",
  "ico",
  "jpeg",
  "jpg",
  "jxl",
  "png",
  "svg",
  "tif",
  "tiff",
  "webp",
]);

const ARCHIVE_EXTENSIONS = new Set([
  "7z",
  "apk",
  "bz2",
  "crx",
  "gz",
  "jar",
  "rar",
  "tar",
  "xz",
  "zip",
]);

const DOCUMENT_EXTENSIONS = new Set([
  "csv",
  "doc",
  "docx",
  "epub",
  "md",
  "odp",
  "ods",
  "odt",
  "pdf",
  "ppt",
  "pptx",
  "rtf",
  "txt",
  "xls",
  "xlsx",
]);

const DOCUMENT_TYPES = new Set([
  "application/epub+zip",
  "application/msword",
  "application/pdf",
  "application/rtf",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.oasis.opendocument.presentation",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const ARCHIVE_TYPES = new Set([
  "application/gzip",
  "application/java-archive",
  "application/vnd.android.package-archive",
  "application/x-7z-compressed",
  "application/x-rar-compressed",
  "application/x-tar",
  "application/zip",
]);

const CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  "application/pdf": "pdf",
  "application/zip": "zip",
  "audio/aac": "aac",
  "audio/flac": "flac",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/webm": "weba",
  "audio/x-wav": "wav",
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/webp": "webp",
  "image/x-icon": "ico",
  "video/mp2t": "ts",
  "video/mp4": "mp4",
  "video/mpeg": "mpg",
  "video/ogg": "ogv",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-matroska": "mkv",
  "video/x-msvideo": "avi",
};

const KIND_DEFAULT_EXTENSION: Record<MediaKind, string> = {
  image: "jpg",
  video: "mp4",
  audio: "mp3",
  document: "bin",
  archive: "zip",
  other: "bin",
};

/** Remove parâmetros do content-type (`; charset=...`) e normaliza. */
export function baseContentType(value?: string): string {
  if (!value) return "";
  return (value.split(";")[0] ?? "").trim().toLowerCase();
}

/** Extensão (sem ponto) extraída do caminho da URL. */
export function extensionFromUrl(url: string): string | null {
  try {
    const { pathname } = new URL(url);
    const last = pathname.split("/").filter(Boolean).pop() ?? "";
    const match = /\.([a-z0-9]{1,8})$/i.exec(last);
    return match?.[1]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

/** Converte um content-type conhecido em `MediaKind`. */
export function contentTypeToKind(contentType?: string): MediaKind | null {
  const type = baseContentType(contentType);
  if (!type) return null;
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("text/")) return "document";
  if (DOCUMENT_TYPES.has(type)) return "document";
  if (ARCHIVE_TYPES.has(type)) return "archive";
  return null;
}

/** Fallback por extensão (útil para `application/octet-stream`). */
export function extensionToKind(url: string): MediaKind | null {
  const extension = extensionFromUrl(url);
  if (!extension) return null;
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  if (AUDIO_EXTENSIONS.has(extension)) return "audio";
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (ARCHIVE_EXTENSIONS.has(extension)) return "archive";
  if (DOCUMENT_EXTENSIONS.has(extension)) return "document";
  return null;
}

/** Identifica manifestos HLS/DASH. */
export function detectStreamType(contentType: string | undefined, url: string): StreamType | null {
  const type = baseContentType(contentType);
  if (
    type === "application/vnd.apple.mpegurl" ||
    type === "application/x-mpegurl" ||
    type === "audio/mpegurl"
  ) {
    return "hls";
  }
  if (type === "application/dash+xml") return "dash";

  if (/\.m3u8($|\?)/i.test(url)) return "hls";
  if (/\.mpd($|\?)/i.test(url)) return "dash";
  return null;
}

/** Extensão padrão para quando a URL/arquivo não tem uma. */
export function defaultExtension(
  kind: MediaKind,
  contentType?: string,
  streamType?: StreamType | null,
): string {
  if (streamType === "hls") return "m3u8";
  if (streamType === "dash") return "mpd";
  return CONTENT_TYPE_EXTENSIONS[baseContentType(contentType)] ?? KIND_DEFAULT_EXTENSION[kind];
}
