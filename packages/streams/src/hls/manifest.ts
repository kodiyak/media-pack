import type { StreamEncryption, StreamVariant } from "@repo/protocol";
import { Parser } from "m3u8-parser";
import { positiveInt, resolveUrl } from "../util";

/** Rendição de áudio separada (EXT-X-MEDIA TYPE=AUDIO) em uma master playlist. */
export type HlsAudioRendition = {
  url?: string;
  groupId?: string;
  name?: string;
  language?: string;
  isDefault?: boolean;
  autoSelect?: boolean;
};

/** Metadados extraídos de um manifesto HLS (master ou media playlist). */
export type HlsManifestInfo = {
  variants?: StreamVariant[];
  /** URLs de todas as rendições (vídeo/áudio/legenda) — somente em master. */
  renditionUrls?: string[];
  /** Rendições de áudio separadas (EXT-X-MEDIA TYPE=AUDIO). */
  audioRenditions?: HlsAudioRendition[];
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
    AUDIO?: string;
  };
};

type HlsSegment = {
  uri?: string;
  duration?: number;
  key?: { method?: string };
  map?: { uri?: string };
};

type HlsRendering = {
  uri?: string;
  language?: string;
  default?: boolean;
  autoselect?: boolean;
};

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
      audioRenditions: collectAudioRenditions(manifest, baseUrl),
    };
  }

  return parseMediaPlaylist(manifest);
}

/** Escolhe a rendição de áudio de um grupo (padrão/autoselecionada, senão a primeira). */
export function selectAudioRendition(
  renditions: HlsAudioRendition[] | undefined,
  groupId?: string,
): HlsAudioRendition | undefined {
  const pool = renditions?.filter((entry) => !groupId || entry.groupId === groupId) ?? [];
  if (pool.length === 0) return undefined;
  return (
    pool.find((entry) => entry.isDefault && entry.autoSelect) ??
    pool.find((entry) => entry.isDefault) ??
    pool[0]
  );
}

function collectAudioRenditions(
  manifest: HlsManifest,
  baseUrl: string,
): HlsAudioRendition[] | undefined {
  const result: HlsAudioRendition[] = [];

  for (const [groupId, renderings] of Object.entries(manifest.mediaGroups?.AUDIO ?? {})) {
    for (const [name, rendering] of Object.entries(renderings ?? {})) {
      if (!rendering.uri) continue;
      const url = resolveUrl(rendering.uri, baseUrl);
      if (!url) continue;
      result.push({
        url,
        groupId,
        name,
        language: rendering.language,
        isDefault: rendering.default === true,
        autoSelect: rendering.autoselect === true,
      });
    }
  }

  return result.length > 0 ? result : undefined;
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
    audioGroupId: attributes.AUDIO,
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
