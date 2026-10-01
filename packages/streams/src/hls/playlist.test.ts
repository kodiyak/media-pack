import { describe, expect, it } from "vitest";
import { buildHlsPlan } from "./playlist";

const MEDIA_TS = `#EXTM3U
#EXT-X-TARGETDURATION:10
#EXTINF:9.0,
seg0.ts
#EXTINF:9.0,
seg1.ts
#EXT-X-ENDLIST
`;

const MEDIA_FMP4 = `#EXTM3U
#EXT-X-MAP:URI="init.mp4"
#EXTINF:6.0,
seg0.m4s
#EXT-X-ENDLIST
`;

const MEDIA_AES = `#EXTM3U
#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x00000000000000000000000000000001
#EXTINF:9.0,
seg0.ts
#EXT-X-ENDLIST
`;

const MEDIA_BYTERANGE = `#EXTM3U
#EXT-X-TARGETDURATION:6
#EXTINF:6.0,
#EXT-X-BYTERANGE:1000@0
seg.ts
#EXTINF:6.0,
#EXT-X-BYTERANGE:500
seg.ts
#EXT-X-ENDLIST
`;

describe("buildHlsPlan", () => {
  it("planeja segmentos TS resolvidos", () => {
    const plan = buildHlsPlan(MEDIA_TS, "https://cdn.test/index.m3u8");

    expect(plan.container).toBe("ts");
    expect(plan.live).toBe(false);
    expect(plan.segments).toHaveLength(2);
    expect(plan.segments[0]?.url).toBe("https://cdn.test/seg0.ts");
    expect(plan.durationSeconds).toBe(18);
  });

  it("detecta fMP4 + init segment", () => {
    const plan = buildHlsPlan(MEDIA_FMP4, "https://cdn.test/index.m3u8");

    expect(plan.container).toBe("fmp4");
    expect(plan.mapUrl).toBe("https://cdn.test/init.mp4");
  });

  it("planeja a chave AES-128 com IV do manifesto", () => {
    const plan = buildHlsPlan(MEDIA_AES, "https://cdn.test/index.m3u8");

    expect(plan.encryption).toBe("aes-128");
    const key = plan.segments[0]?.key;
    expect(key?.url).toBe("https://cdn.test/key.bin");
    expect(Array.from(key?.iv.slice(12) ?? [])).toEqual([0, 0, 0, 1]);
  });

  it("calcula byte ranges acumulados", () => {
    const plan = buildHlsPlan(MEDIA_BYTERANGE, "https://cdn.test/index.m3u8");

    expect(plan.segments[0]?.byteRange).toEqual({ offset: 0, length: 1000 });
    expect(plan.segments[1]?.byteRange).toEqual({ offset: 1000, length: 500 });
  });
});
