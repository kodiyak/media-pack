import { selectVariant } from "@repo/media";
import type { StreamVariant, StreamVariantPolicy } from "@repo/protocol";
import { XMLParser } from "fast-xml-parser";
import type { TrackSegment } from "../mp4/track";
import { asArray, asString, parseIsoDuration, positiveInt, resolveUrl } from "../util";

export type DashTrackPlan = {
  kind: "video" | "audio";
  container: "ts" | "fmp4";
  segments: TrackSegment[];
  initUrl?: string;
  singleUrl?: string;
  mimeType?: string;
  bandwidth?: number;
  height?: number;
};

export type DashPlan = {
  video?: DashTrackPlan;
  audio?: DashTrackPlan;
  live: boolean;
  drm: boolean;
};

type XmlNode = Record<string, unknown>;

type Candidate = {
  kind: "video" | "audio";
  rep: XmlNode;
  adaptation: XmlNode;
  period: XmlNode;
  baseUrl: string;
  periodDuration?: number;
};

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

/** Resolve o plano de faixas (vídeo/áudio) de um MPD para um MP4 em streaming. */
export function buildDashPlan(
  xml: string,
  mpdUrl: string,
  policy: StreamVariantPolicy = "best",
): DashPlan {
  const document = parser.parse(xml) as { MPD?: XmlNode };
  const mpd = document.MPD;
  if (!mpd) throw new Error("MPD inválido.");

  const mpdDuration = parseIsoDuration(attr(mpd, "mediaPresentationDuration"));
  const mpdBase = chainBase(mpdUrl, mpd);
  const plan: DashPlan = { live: attr(mpd, "type") === "dynamic", drm: false };
  const candidates: Candidate[] = [];

  for (const period of asArray(mpd.Period as XmlNode | XmlNode[] | undefined)) {
    const periodBase = chainBase(mpdBase, period);
    const periodDuration = parseIsoDuration(attr(period, "duration")) ?? mpdDuration;

    for (const adaptation of asArray(period.AdaptationSet as XmlNode | XmlNode[] | undefined)) {
      const kind = classifyAdaptation(adaptation);
      if (!kind) continue;
      if (hasProtection(adaptation)) plan.drm = true;

      const adaptationBase = chainBase(periodBase, adaptation);
      for (const rep of asArray(adaptation.Representation as XmlNode | XmlNode[] | undefined)) {
        if (hasProtection(rep)) plan.drm = true;
        candidates.push({
          kind,
          rep,
          adaptation,
          period,
          baseUrl: chainBase(adaptationBase, rep),
          periodDuration,
        });
      }
    }
  }

  plan.video = buildBest(candidates, "video", policy);
  plan.audio = buildBest(candidates, "audio", policy);
  return plan;
}

function buildBest(
  candidates: Candidate[],
  kind: "video" | "audio",
  policy: StreamVariantPolicy,
): DashTrackPlan | undefined {
  const pool = candidates.filter((candidate) => candidate.kind === kind);
  if (pool.length === 0) return undefined;

  const variants: StreamVariant[] = pool.map((candidate) => ({
    bandwidth: positiveInt(attr(candidate.rep, "bandwidth")),
    width: positiveInt(attr(candidate.rep, "width")),
    height: positiveInt(attr(candidate.rep, "height")),
  }));

  const chosen = selectVariant(variants, policy);
  const index = chosen ? variants.indexOf(chosen) : 0;
  const candidate = pool[index] ?? pool[0];
  return candidate ? buildTrack(candidate) : undefined;
}

function buildTrack(candidate: Candidate): DashTrackPlan {
  return {
    ...buildTrackInner(candidate),
    bandwidth: positiveInt(attr(candidate.rep, "bandwidth")),
    height: positiveInt(attr(candidate.rep, "height")),
  };
}

function buildTrackInner(candidate: Candidate): DashTrackPlan {
  const { rep, adaptation, period, baseUrl } = candidate;
  const mimeType = attr(rep, "mimeType") ?? attr(adaptation, "mimeType");

  const template = pick(rep, adaptation, period, "SegmentTemplate");
  if (template) return templateTrack(candidate, template, mimeType);

  const list = pick(rep, adaptation, period, "SegmentList");
  if (list) return listTrack(candidate, list, mimeType);

  const segmentBase = pick(rep, adaptation, period, "SegmentBase");
  if (segmentBase) return baseTrack(candidate, mimeType);

  // Sem segmentação declarada: trata a BaseURL como arquivo único.
  return {
    kind: candidate.kind,
    container: detectContainer(mimeType),
    segments: [],
    singleUrl: baseUrl,
    mimeType,
  };
}

function templateTrack(candidate: Candidate, template: XmlNode, mimeType?: string): DashTrackPlan {
  const { rep, baseUrl, periodDuration } = candidate;
  const timescale = positiveInt(attr(template, "timescale")) ?? 1;
  const startNumber = positiveInt(attr(template, "startNumber")) ?? 1;
  const mediaTemplate = attr(template, "media");
  const initTemplate = attr(template, "initialization");
  const repId = attr(rep, "id") ?? "";
  const bandwidth = positiveInt(attr(rep, "bandwidth"));
  const common = { RepresentationID: repId, Bandwidth: bandwidth ?? 0 };

  const container = detectContainer(mimeType, mediaTemplate);
  const initUrl = initTemplate
    ? resolveUrl(fillTemplate(initTemplate, common), baseUrl)
    : undefined;

  const times = timelineTimes(template);
  const segments: TrackSegment[] = [];

  if (times.length > 0) {
    times.forEach((time, index) => {
      if (!mediaTemplate) return;
      const url = resolveUrl(
        fillTemplate(mediaTemplate, { ...common, Time: time, Number: startNumber + index }),
        baseUrl,
      );
      if (url) segments.push({ url });
    });
  } else {
    if (!mediaTemplate) return { kind: candidate.kind, container, segments: [], initUrl, mimeType };

    const durationAttr = positiveInt(attr(template, "duration"));
    if (!durationAttr || !periodDuration) {
      return { kind: candidate.kind, container, segments: [], initUrl, mimeType };
    }

    const count = Math.max(1, Math.ceil(periodDuration / (durationAttr / timescale)));
    for (let index = 0; index < count; index += 1) {
      const url = resolveUrl(
        fillTemplate(mediaTemplate, {
          ...common,
          Number: startNumber + index,
          Time: index * durationAttr,
        }),
        baseUrl,
      );
      if (url) segments.push({ url });
    }
  }

  return { kind: candidate.kind, container, segments, initUrl, mimeType };
}

function listTrack(candidate: Candidate, list: XmlNode, mimeType?: string): DashTrackPlan {
  const { baseUrl } = candidate;
  const init = asArray(list.Initialization as XmlNode | XmlNode[] | undefined)[0];
  const initUri = init ? (attr(init, "sourceURL") ?? attr(init, "uri")) : undefined;
  const initUrl = initUri ? resolveUrl(initUri, baseUrl) : undefined;

  const segments: TrackSegment[] = [];
  for (const entry of asArray(list.SegmentURL as XmlNode | XmlNode[] | undefined)) {
    const media = attr(entry, "media");
    if (!media) continue;
    const url = resolveUrl(media, baseUrl);
    if (!url) continue;
    segments.push({ url, byteRange: parseByteRange(attr(entry, "mediaRange")) });
  }

  return {
    kind: candidate.kind,
    container: detectContainer(mimeType),
    segments,
    initUrl,
    mimeType,
  };
}

function baseTrack(candidate: Candidate, mimeType?: string): DashTrackPlan {
  return {
    kind: candidate.kind,
    container: detectContainer(mimeType),
    segments: [],
    singleUrl: candidate.baseUrl,
    mimeType,
  };
}

/** Tempos (`$Time$`) de um `SegmentTimeline`. */
function timelineTimes(template: XmlNode): number[] {
  const timeline = pick(template, {}, {}, "SegmentTimeline");
  if (!timeline) return [];

  const result: number[] = [];
  let current = 0;

  for (const entry of asArray(timeline.S as XmlNode | XmlNode[] | undefined)) {
    const rawT = attr(entry, "t");
    const start = rawT !== undefined ? Number(rawT) : current;
    const duration = Number(attr(entry, "d"));
    const repeatRaw = attr(entry, "r");
    const repeat = repeatRaw !== undefined ? Number(repeatRaw) : 0;
    if (!Number.isFinite(duration) || duration <= 0) continue;

    let time = Number.isFinite(start) ? start : current;
    for (let index = 0; index <= (Number.isFinite(repeat) && repeat > 0 ? repeat : 0); index += 1) {
      result.push(time);
      time += duration;
    }
    current = time;
  }

  return result;
}

/** Substitui `$Name$` / `$Name%0Nd$` / `$$` em templates DASH. */
function fillTemplate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\$\$|\$(\w+)(?:%0(\d+)d)?\$/g, (match, name: string, width?: string) => {
    if (match === "$$") return "$";
    const value = values[name];
    if (value === undefined) return match;
    return width ? String(value).padStart(Number(width), "0") : String(value);
  });
}

function classifyAdaptation(node: XmlNode): "video" | "audio" | undefined {
  const contentType = attr(node, "contentType") ?? "";
  const mimeType = attr(node, "mimeType") ?? "";
  if (contentType === "video" || mimeType.startsWith("video/")) return "video";
  if (contentType === "audio" || mimeType.startsWith("audio/")) return "audio";
  return undefined;
}

function detectContainer(mimeType?: string, media?: string): "ts" | "fmp4" {
  if (mimeType?.includes("mp2t") || media?.endsWith(".ts")) return "ts";
  return "fmp4";
}

function parseByteRange(value?: string): { offset: number; length: number } | undefined {
  if (!value) return undefined;
  const match = /^(\d+)-(\d+)$/.exec(value.trim());
  if (!match?.[1] || !match[2]) return undefined;
  const offset = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isFinite(offset) || !Number.isFinite(end) || end < offset) return undefined;
  return { offset, length: end - offset + 1 };
}

function hasProtection(node: XmlNode): boolean {
  return node.ContentProtection !== undefined;
}

function chainBase(parent: string, node: XmlNode): string {
  const base = asString(node.BaseURL);
  if (!base) return parent;
  return resolveUrl(base, parent) ?? parent;
}

function pick(
  from: XmlNode,
  fallbackA: XmlNode,
  fallbackB: XmlNode,
  key: string,
): XmlNode | undefined {
  for (const node of [from, fallbackA, fallbackB]) {
    const value = asArray(node[key] as XmlNode | XmlNode[] | undefined)[0];
    if (value) return value;
  }
  return undefined;
}

function attr(node: XmlNode | undefined, name: string): string | undefined {
  if (!node) return undefined;
  return asString(node[`@_${name}`]);
}
