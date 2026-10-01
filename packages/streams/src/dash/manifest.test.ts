import { describe, expect, it } from "vitest";
import { parseDashManifest } from "./manifest";

const MPD = `<?xml version="1.0" encoding="UTF-8"?>
<MPD type="static" mediaPresentationDuration="PT1M30S" xmlns="urn:mpeg:dash:schema:mpd:2011">
  <Period>
    <AdaptationSet contentType="video" mimeType="video/mp4">
      <Representation id="v0" bandwidth="800000" width="640" height="360" codecs="avc1.4d401e"/>
      <Representation id="v1" bandwidth="3000000" width="1280" height="720" codecs="avc1.64001f"/>
    </AdaptationSet>
    <AdaptationSet contentType="audio" mimeType="audio/mp4">
      <Representation id="a0" bandwidth="128000"/>
    </AdaptationSet>
  </Period>
</MPD>
`;

describe("parseDashManifest", () => {
  it("lê representações de vídeo e a duração", () => {
    const info = parseDashManifest(MPD, "https://cdn.test/manifest.mpd");

    expect(info.variants).toHaveLength(2);
    expect(info.durationSeconds).toBe(90);
    expect(info.live).toBe(false);
    expect(info.container).toBe("fmp4");
    expect(info.variants?.[1]?.height).toBe(720);
  });

  it("marca MPD dinâmico como ao vivo", () => {
    const info = parseDashManifest(
      MPD.replace('type="static"', 'type="dynamic"'),
      "https://cdn.test/manifest.mpd",
    );

    expect(info.live).toBe(true);
  });

  it("retorna vazio para XML sem MPD", () => {
    expect(parseDashManifest("<foo/>", "https://cdn.test/manifest.mpd")).toEqual({});
  });
});
