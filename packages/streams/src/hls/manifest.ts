import type { StreamEncryption, StreamVariant } from "@repo/protocol";
import { Parser } from "m3u8-parser";
import { positiveInt, resolveUrl } from "../util";

/** Metadados extraídos de um manifesto HLS (master ou media playlist). */
export type HlsManifestInfo = {
  variants?: StreamVariant[];
  /** URLs de todas as rendições (vídeo/áudio/legenda) — somente em master. */
  renditionUrls?: string[];
  container?: "ts" | "fmp4";
  encryption?: StreamEncryption;
  live?: boolean;
  segmentCount?: number;
  durationSeconds?: number;
};

type HlsPlaylist = {
  uri?: string;
  attributes?: {
    BANDWIDTH?: number;
    CODECS?: string;
    NAME?: string;
    RESOLUTION?: { width?: number; height?: number };
  };
};

type HlsSegment = {
  uri?: string;
  duration?: number;
  key?: { method?: string };
  map?: { uri?: string };
};

type HlsRendering = { uri?: string };

type HlsManifest = {
  playlists?: HlsPlaylist[];
  segments?: HlsSegment[];
  endList?: boolean;
  mediaGroups?: Record<string, Record<string, Record<string, HlsRendering>>>;
};

/** Lê um `.m3u8` e devolve variantes (master) ou metadados da playlist. */
export function parseHlsManifest(text: string, baseUrl: string): HlsManifestInfo {
  const parser = new Parser();
  parser.push(text);
  parser.end();
  const manifest = parser.manifest as unknown as HlsManifest;

  const playlists = manifest.playlists ?? [];
  if (playlists.length > 0) {
    return {
      variants: playlists.map((playlist) => toVariant(playlist, baseUrl)),
      renditionUrls: collectRenditionUrls(manifest, baseUrl),
    };
  }

  return parseMediaPlaylist(manifest);
}

function collectRenditionUrls(manifest: HlsManifest, baseUrl: string): string[] | undefined {
  const urls: string[] = [];

  for (const playlist of manifest.playlists ?? []) {
    if (!playlist.uri) continue;
    const resolved = resolveUrl(playlist.uri, baseUrl);
    if (resolved) urls.push(resolved);
  }

  for (const group of Object.values(manifest.mediaGroups ?? {})) {
    for (const renderings of Object.values(group ?? {})) {
      for (const rendering of Object.values(renderings ?? {})) {
        if (!rendering.uri) continue;
        const resolved = resolveUrl(rendering.uri, baseUrl);
        if (resolved) urls.push(resolved);
      }
    }
  }

  return [...new Set(urls)];
}

function toVariant(playlist: HlsPlaylist, baseUrl: string): StreamVariant {
  const attributes = playlist.attributes ?? {};
  const resolution = attributes.RESOLUTION;

  return {
    url: playlist.uri ? resolveUrl(playlist.uri, baseUrl) : undefined,
    bandwidth: positiveInt(attributes.BANDWIDTH),
    width: positiveInt(resolution?.width),
    height: positiveInt(resolution?.height),
    codecs: attributes.CODECS,
    label: resolution?.height ? `${resolution.height}p` : attributes.NAME,
  };
}

function parseMediaPlaylist(manifest: HlsManifest): HlsManifestInfo {
  const segments = manifest.segments ?? [];
  const hasMap = segments.some((segment) => Boolean(segment.map?.uri));
  const looksFragmented = segments.some((segment) =>
    segment.uri ? /\.(?:m4s|mp4|cmfv|cmfa)(?:\?|$)/i.test(segment.uri) : false,
  );
  const duration = segments.reduce((sum, segment) => sum + (segment.duration ?? 0), 0);

  return {
    container: hasMap || looksFragmented ? "fmp4" : "ts",
    encryption: detectEncryption(segments),
    live: manifest.endList !== true,
    segmentCount: segments.length || undefined,
    durationSeconds: duration > 0 ? duration : undefined,
  };
}

function detectEncryption(segments: HlsSegment[]): StreamEncryption {
  for (const segment of segments) {
    const method = segment.key?.method?.toUpperCase();
    if (!method || method === "NONE") continue;
    if (method.includes("SAMPLE-AES")) return "sample-aes";
    if (method === "AES-128") return "aes-128";
  }
  return "none";
}
