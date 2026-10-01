import { describe, expect, it } from "vitest";
import { buildDashPlan } from "./plan";

const TEMPLATE_NUMBER = `<MPD type="static" mediaPresentationDuration="PT30S">
  <Period>
    <AdaptationSet contentType="video" mimeType="video/mp4">
      <SegmentTemplate timescale="1" duration="6" startNumber="1"
        initialization="$RepresentationID$/init.mp4" media="$RepresentationID$/seg-$Number$.m4s"/>
      <Representation id="720" bandwidth="3000000" width="1280" height="720"/>
    </AdaptationSet>
  </Period>
</MPD>`;

const TEMPLATE_TIMELINE = `<MPD type="static">
  <Period>
    <AdaptationSet contentType="video" mimeType="video/mp4">
      <Representation id="v" bandwidth="1000000" height="480">
        <SegmentTemplate timescale="1000" media="s-$Time$.m4s" initialization="init.mp4">
          <SegmentTimeline><S t="0" d="2000" r="2"/></SegmentTimeline>
        </SegmentTemplate>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`;

const AUDIO_VIDEO = `<MPD type="static" mediaPresentationDuration="PT10S">
  <Period>
    <AdaptationSet contentType="video" mimeType="video/mp4">
      <Representation id="v0" bandwidth="1000000" height="360"/>
      <Representation id="v1" bandwidth="5000000" height="1080"/>
    </AdaptationSet>
    <AdaptationSet contentType="audio" mimeType="audio/mp4">
      <Representation id="a0" bandwidth="128000"/>
    </AdaptationSet>
  </Period>
</MPD>`;

const SEGMENT_LIST = `<MPD type="static">
  <Period>
    <AdaptationSet contentType="video" mimeType="video/mp4">
      <Representation id="v" bandwidth="1000000">
        <SegmentList>
          <Initialization sourceURL="init.mp4"/>
          <SegmentURL media="seg-1.m4s"/>
          <SegmentURL media="seg-2.m4s" mediaRange="0-499"/>
        </SegmentList>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`;

const SEGMENT_BASE = `<MPD type="static">
  <Period>
    <AdaptationSet contentType="video" mimeType="video/mp4">
      <Representation id="v" bandwidth="1000000">
        <BaseURL>video.mp4</BaseURL>
        <SegmentBase indexRange="0-999"/>
      </Representation>
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

describe("buildDashPlan", () => {
  it("monta segmentos por $Number$ com duração conhecida", () => {
    const plan = buildDashPlan(TEMPLATE_NUMBER, "https://cdn.test/manifest.mpd");

    expect(plan.video?.segments).toHaveLength(5);
    expect(plan.video?.initUrl).toBe("https://cdn.test/720/init.mp4");
    expect(plan.video?.segments[0]?.url).toBe("https://cdn.test/720/seg-1.m4s");
    expect(plan.video?.height).toBe(720);
  });

  it("monta segmentos por $Time$ via SegmentTimeline", () => {
    const plan = buildDashPlan(TEMPLATE_TIMELINE, "https://cdn.test/manifest.mpd");

    expect(plan.video?.segments.map((segment) => segment.url)).toEqual([
      "https://cdn.test/s-0.m4s",
      "https://cdn.test/s-2000.m4s",
      "https://cdn.test/s-4000.m4s",
    ]);
  });

  it("escolhe a melhor variante e separa áudio", () => {
    const plan = buildDashPlan(AUDIO_VIDEO, "https://cdn.test/manifest.mpd", "best");

    expect(plan.video?.bandwidth).toBe(5_000_000);
    expect(plan.audio?.bandwidth).toBe(128_000);
  });

  it("respeita a política de qualidade", () => {
    const plan = buildDashPlan(AUDIO_VIDEO, "https://cdn.test/manifest.mpd", "smallest");

    expect(plan.video?.bandwidth).toBe(1_000_000);
  });

  it("lê SegmentList com byte range", () => {
    const plan = buildDashPlan(SEGMENT_LIST, "https://cdn.test/manifest.mpd");

    expect(plan.video?.initUrl).toBe("https://cdn.test/init.mp4");
    expect(plan.video?.segments[1]?.byteRange).toEqual({ offset: 0, length: 500 });
  });

  it("usa a BaseURL como arquivo único em SegmentBase", () => {
    const plan = buildDashPlan(SEGMENT_BASE, "https://cdn.test/manifest.mpd");

    expect(plan.video?.singleUrl).toBe("https://cdn.test/video.mp4");
  });

  it("detecta DRM e live", () => {
    expect(buildDashPlan(DRM, "https://cdn.test/manifest.mpd").drm).toBe(true);
    expect(
      buildDashPlan(TEMPLATE_NUMBER.replace("static", "dynamic"), "https://cdn.test/m.mpd").live,
    ).toBe(true);
  });
});
