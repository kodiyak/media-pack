import { describe, expect, it } from "vitest";
import { parseHlsManifest } from "./manifest";

const MASTER = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,CODECS="avc1.4d401e,mp4a.40.2"
360/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720
720/index.m3u8
`;

const MEDIA_TS = `#EXTM3U
#EXT-X-TARGETDURATION:10
#EXTINF:9.0,
seg0.ts
#EXTINF:9.0,
seg1.ts
#EXT-X-ENDLIST
`;

const MEDIA_FMP4_AES = `#EXTM3U
#EXT-X-MAP:URI="init.mp4"
#EXT-X-KEY:METHOD=AES-128,URI="key.bin"
#EXTINF:6.0,
seg0.m4s
#EXT-X-ENDLIST
`;

const MASTER_WITH_AUDIO = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English",URI="audio/en.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,AUDIO="aud"
720/index.m3u8
`;

describe("parseHlsManifest", () => {
  it("lê variantes de uma master playlist", () => {
    const info = parseHlsManifest(MASTER, "https://cdn.test/master.m3u8");

    expect(info.variants).toHaveLength(2);
    expect(info.variants?.[1]?.url).toBe("https://cdn.test/720/index.m3u8");
    expect(info.variants?.[1]?.height).toBe(720);
    expect(info.variants?.[1]?.bandwidth).toBe(3_000_000);
  });

  it("coleta as rendições de vídeo e áudio do master", () => {
    const info = parseHlsManifest(MASTER_WITH_AUDIO, "https://cdn.test/master.m3u8");

    expect(info.renditionUrls).toEqual([
      "https://cdn.test/720/index.m3u8",
      "https://cdn.test/audio/en.m3u8",
    ]);
  });

  it("lê uma media playlist TS (VOD)", () => {
    const info = parseHlsManifest(MEDIA_TS, "https://cdn.test/index.m3u8");

    expect(info.container).toBe("ts");
    expect(info.encryption).toBe("none");
    expect(info.live).toBe(false);
    expect(info.segmentCount).toBe(2);
    expect(info.durationSeconds).toBe(18);
  });

  it("detecta fMP4 e AES-128", () => {
    const info = parseHlsManifest(MEDIA_FMP4_AES, "https://cdn.test/index.m3u8");

    expect(info.container).toBe("fmp4");
    expect(info.encryption).toBe("aes-128");
  });

  it("marca playlist sem ENDLIST como ao vivo", () => {
    const live = MEDIA_TS.replace("#EXT-X-ENDLIST\n", "");
    const info = parseHlsManifest(live, "https://cdn.test/index.m3u8");

    expect(info.live).toBe(true);
  });
});
