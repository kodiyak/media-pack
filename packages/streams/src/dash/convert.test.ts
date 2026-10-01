import { describe, expect, it } from "vitest";
import { openDashTrack, resolveDashTracks } from "./convert";

const encode = (text: string) => new TextEncoder().encode(text);

const MPD = `<MPD type="static" mediaPresentationDuration="PT12S">
  <Period>
    <AdaptationSet contentType="video" mimeType="video/mp4">
      <SegmentTemplate timescale="1" duration="6" initialization="v/init.mp4" media="v/seg-$Number$.m4s"/>
      <Representation id="v" bandwidth="2000000" height="720"/>
    </AdaptationSet>
    <AdaptationSet contentType="audio" mimeType="audio/mp4">
      <SegmentTemplate timescale="1" duration="6" initialization="a/init.mp4" media="a/seg-$Number$.m4s"/>
      <Representation id="a" bandwidth="128000"/>
    </AdaptationSet>
  </Period>
</MPD>`;

const DRM = `<MPD type="static">
  <Period>
    <AdaptationSet contentType="video" mimeType="video/mp4">
      <ContentProtection schemeIdUri="urn:mpeg:dash:mp4protection:2011" value="cenc"/>
      <Representation id="v" bandwidth="1000000"/>
    </AdaptationSet>
  </Period>
</MPD>`;

function fakeFetch(pages: Record<string, string | Uint8Array>): typeof globalThis.fetch {
  return (async (input: Parameters<typeof globalThis.fetch>[0]) => {
    const url = input instanceof URL ? input.href : typeof input === "string" ? input : input.url;
    const page = pages[url];
    if (page === undefined) return new Response("missing", { status: 404 });
    return new Response(page, { status: 200 });
  }) as typeof globalThis.fetch;
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

describe("resolveDashTracks + openDashTrack", () => {
  it("resolve vídeo e áudio e concatena o fMP4 do vídeo", async () => {
    const fetch = fakeFetch({
      "https://cdn.test/manifest.mpd": MPD,
      "https://cdn.test/v/init.mp4": encode("VI"),
      "https://cdn.test/v/seg-1.m4s": encode("A"),
      "https://cdn.test/v/seg-2.m4s": encode("B"),
    });

    const { tracks } = await resolveDashTracks({ url: "https://cdn.test/manifest.mpd" }, { fetch });

    expect(tracks.map((track) => track.kind)).toEqual(["video", "audio"]);

    const video = tracks.find((track) => track.kind === "video");
    const opened = await openDashTrack(video?.plan as never, {}, { fetch });

    expect(new TextDecoder().decode(await readAll(opened.body))).toBe("VIAB");
  });

  it("recusa DRM", async () => {
    const fetch = fakeFetch({ "https://cdn.test/drm.mpd": DRM });

    await expect(resolveDashTracks({ url: "https://cdn.test/drm.mpd" }, { fetch })).rejects.toThrow(
      /DRM/,
    );
  });
});
