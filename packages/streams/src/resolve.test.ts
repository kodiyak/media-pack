import { describe, expect, it } from "vitest";
import { resolveStreamInfo } from "./resolve";

const MASTER = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360
360/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720
720/index.m3u8
`;

const MEDIA = `#EXTM3U
#EXT-X-TARGETDURATION:10
#EXT-X-MAP:URI="init.mp4"
#EXTINF:9.0,
seg0.m4s
#EXTINF:9.0,
seg1.m4s
#EXT-X-ENDLIST
`;

const MPD = `<MPD type="static" mediaPresentationDuration="PT30S">
  <Period>
    <AdaptationSet contentType="video" mimeType="video/mp4">
      <Representation id="v1" bandwidth="2000000" width="1280" height="720"/>
    </AdaptationSet>
  </Period>
</MPD>`;

function fakeFetch(pages: Record<string, string>): typeof globalThis.fetch {
  return (async (input: Parameters<typeof globalThis.fetch>[0]) => {
    const url = input instanceof URL ? input.href : typeof input === "string" ? input : input.url;
    const body = pages[url];
    if (body === undefined) return new Response("not found", { status: 404 });
    return new Response(body, { status: 200 });
  }) as typeof globalThis.fetch;
}

describe("resolveStreamInfo", () => {
  it("resolve master HLS + melhor variante", async () => {
    const fetch = fakeFetch({
      "https://cdn.test/master.m3u8": MASTER,
      "https://cdn.test/720/index.m3u8": MEDIA,
    });

    const info = await resolveStreamInfo(
      { url: "https://cdn.test/master.m3u8", streamType: "hls" },
      { fetch },
    );

    expect(info.variants).toHaveLength(2);
    expect(info.selectedVariantUrl).toBe("https://cdn.test/720/index.m3u8");
    expect(info.container).toBe("fmp4");
    expect(info.durationSeconds).toBe(18);
    expect(info.estimatedBytes).toBe((3_000_000 / 8) * 18);
  });

  it("resolve media playlist HLS", async () => {
    const info = await resolveStreamInfo(
      { url: "https://cdn.test/index.m3u8", streamType: "hls" },
      { fetch: fakeFetch({ "https://cdn.test/index.m3u8": MEDIA }) },
    );

    expect(info.segmentCount).toBe(2);
    expect(info.live).toBe(false);
  });

  it("resolve DASH", async () => {
    const info = await resolveStreamInfo(
      { url: "https://cdn.test/manifest.mpd", streamType: "dash" },
      { fetch: fakeFetch({ "https://cdn.test/manifest.mpd": MPD }) },
    );

    expect(info.durationSeconds).toBe(30);
    expect(info.estimatedBytes).toBe((2_000_000 / 8) * 30);
    expect(info.variants?.[0]?.height).toBe(720);
  });

  it("propaga erro de HTTP", async () => {
    await expect(
      resolveStreamInfo(
        { url: "https://cdn.test/missing.m3u8", streamType: "hls" },
        { fetch: fakeFetch({}) },
      ),
    ).rejects.toThrow(/HTTP 404/);
  });
});
