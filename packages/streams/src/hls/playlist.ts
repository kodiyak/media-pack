import type { StreamEncryption } from "@repo/protocol";
import { Parser } from "m3u8-parser";
import { ivFromAttribute } from "../aes128";
import { resolveUrl } from "../util";

export type HlsSegmentPlan = {
  url: string;
  byteRange?: { offset: number; length: number };
  durationSeconds?: number;
  key?: { url: string; iv: Uint8Array };
};

export type HlsPlan = {
  segments: HlsSegmentPlan[];
  mapUrl?: string;
  container: "ts" | "fmp4";
  encryption: StreamEncryption;
  live: boolean;
  durationSeconds?: number;
};

type RawKey = { method?: string; uri?: string; iv?: unknown };
type RawSegment = {
  uri?: string;
  duration?: number;
  key?: RawKey;
  map?: { uri?: string };
  byterange?: { length?: number; offset?: number };
};
type RawManifest = {
  mediaSequence?: number;
  endList?: boolean;
  segments?: RawSegment[];
};

/** Constrói o plano de download/transmux a partir de uma media playlist. */
export function buildHlsPlan(text: string, baseUrl: string): HlsPlan {
  const parser = new Parser();
  parser.push(text);
  parser.end();
  const manifest = parser.manifest as unknown as RawManifest;

  const rawSegments = manifest.segments ?? [];
  const mediaSequence = manifest.mediaSequence ?? 0;
  const segments: HlsSegmentPlan[] = [];
  let previousEnd = 0;

  rawSegments.forEach((segment, index) => {
    if (!segment.uri) return;
    const url = resolveUrl(segment.uri, baseUrl);
    if (!url) return;

    const byteRange = toByteRange(segment.byterange, previousEnd);
    if (byteRange) previousEnd = byteRange.offset + byteRange.length;

    segments.push({
      url,
      byteRange,
      durationSeconds: segment.duration,
      key: toKey(segment.key, baseUrl, mediaSequence + index),
    });
  });

  const mapUri = rawSegments
    .map((segment) => segment.map?.uri)
    .find((uri): uri is string => Boolean(uri));

  return {
    segments,
    mapUrl: mapUri ? resolveUrl(mapUri, baseUrl) : undefined,
    container: detectContainer(rawSegments, segments),
    encryption: detectEncryption(rawSegments),
    live: manifest.endList !== true,
    durationSeconds: sumDuration(segments),
  };
}

function toByteRange(
  range: RawSegment["byterange"],
  previousEnd: number,
): { offset: number; length: number } | undefined {
  if (!range?.length) return undefined;
  return { offset: range.offset ?? previousEnd, length: range.length };
}

function toKey(key: RawKey | undefined, baseUrl: string, sequence: number): HlsSegmentPlan["key"] {
  if (key?.method?.toUpperCase() !== "AES-128" || !key.uri) return undefined;

  const url = resolveUrl(key.uri, baseUrl);
  if (!url) return undefined;

  return { url, iv: ivFromAttribute(key.iv, sequence) };
}

function detectContainer(rawSegments: RawSegment[], segments: HlsSegmentPlan[]): "ts" | "fmp4" {
  const hasMap = rawSegments.some((segment) => Boolean(segment.map?.uri));
  const looksFragmented = segments.some((segment) =>
    /\.(?:m4s|mp4|cmfv|cmfa)(?:\?|$)/i.test(segment.url),
  );
  return hasMap || looksFragmented ? "fmp4" : "ts";
}

function detectEncryption(segments: RawSegment[]): StreamEncryption {
  for (const segment of segments) {
    const method = segment.key?.method?.toUpperCase();
    if (!method || method === "NONE") continue;
    if (method.includes("SAMPLE-AES")) return "sample-aes";
    if (method === "AES-128") return "aes-128";
  }
  return "none";
}

function sumDuration(segments: HlsSegmentPlan[]): number | undefined {
  const total = segments.reduce((sum, segment) => sum + (segment.durationSeconds ?? 0), 0);
  return total > 0 ? total : undefined;
}
