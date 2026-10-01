import type { StreamVariantPolicy } from "@repo/protocol";
import { openTrackStream, type TrackDeps, type TrackPlan, type TrackProgress } from "../mp4/track";
import { buildDashPlan, type DashTrackPlan } from "./plan";

export type DashStreamDeps = TrackDeps;

export type DashStreamOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: TrackProgress) => void;
};

export type DashTrackRef = {
  kind: "video" | "audio";
  plan: TrackPlan;
};

export type DashTracksInput = {
  url: string;
  policy?: StreamVariantPolicy;
  signal?: AbortSignal;
};

/**
 * Resolve as faixas de um DASH VOD (vídeo + áudio) em planos de segmento.
 * Não baixa os segmentos ainda — apenas o `.mpd`.
 */
export async function resolveDashTracks(
  input: DashTracksInput,
  deps: DashStreamDeps = {},
): Promise<{ tracks: DashTrackRef[] }> {
  const fetcher = deps.fetch ?? globalThis.fetch.bind(globalThis);
  const text = await fetchText(fetcher, input.url, input.signal);
  const plan = buildDashPlan(text, input.url, input.policy ?? "best");

  if (plan.live) throw new Error("Manifestos DASH ao vivo ainda não são suportados.");
  if (plan.drm) throw new Error("DASH com DRM (ContentProtection) não é suportado.");

  const tracks: DashTrackRef[] = [];
  if (plan.video) tracks.push({ kind: "video", plan: toTrackPlan(plan.video) });
  if (plan.audio) tracks.push({ kind: "audio", plan: toTrackPlan(plan.audio) });
  if (tracks.length === 0) throw new Error("Nenhuma faixa DASH utilizável.");

  return { tracks };
}

/** Abre uma faixa DASH como stream MP4 (concat fMP4 ou transmux TS). */
export async function openDashTrack(
  track: TrackPlan,
  options: DashStreamOptions = {},
  deps: DashStreamDeps = {},
): Promise<{ body: ReadableStream<Uint8Array> }> {
  return { body: await openTrackStream(track, options, deps) };
}

function toTrackPlan(track: DashTrackPlan): TrackPlan {
  return {
    container: track.container,
    segments: track.segments,
    initUrl: track.initUrl,
    singleUrl: track.singleUrl,
  };
}

async function fetchText(
  fetcher: typeof globalThis.fetch,
  url: string,
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetcher(url, { credentials: "include", redirect: "follow", signal });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
  return response.text();
}
