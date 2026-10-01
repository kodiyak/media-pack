import { describe, expect, it } from "vitest";
import type { TransmuxedSegment, TransmuxerLike } from "../transmux";
import { hlsOutputFilename, openHlsStream } from "./convert";

const encode = (text: string) => new TextEncoder().encode(text);

const MEDIA_FMP4 = `#EXTM3U
#EXT-X-MAP:URI="init.mp4"
#EXTINF:6.0,
seg0.m4s
#EXTINF:6.0,
seg1.m4s
#EXT-X-ENDLIST
`;

const MEDIA_TS = `#EXTM3U
#EXTINF:6.0,
seg0.ts
#EXTINF:6.0,
seg1.ts
#EXT-X-ENDLIST
`;

const MASTER = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360
360/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720
720/index.m3u8
`;

const LIVE = MEDIA_TS.replace("#EXT-X-ENDLIST\n", "");
const SAMPLE_AES = `#EXTM3U
#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://key"
#EXTINF:6.0,
seg0.ts
#EXT-X-ENDLIST
`;

function fakeFetch(pages: Record<string, string | Uint8Array>, requests: string[] = []) {
  const fetch = async (input: Parameters<typeof globalThis.fetch>[0]) => {
    const url = input instanceof URL ? input.href : typeof input === "string" ? input : input.url;
    requests.push(url);
    const page = pages[url];
    if (page === undefined) return new Response("missing", { status: 404 });
    return new Response(page, { status: 200 });
  };
  return { fetch: fetch as typeof globalThis.fetch, requests };
}

/** Transmuxer falso: emite um init de 1 byte e um trailer de 1 byte. */
function fakeTransmuxer(init: number, trailer: number): TransmuxerLike {
  const handlers: ((segment: TransmuxedSegment) => void)[] = [];
  let first = true;
  const emit = (segment: TransmuxedSegment) => {
    for (const handler of handlers) handler(segment);
  };

  return {
    on(_event, handler) {
      handlers.push(handler);
    },
    push(bytes) {
      if (first) {
        emit({ initSegment: new Uint8Array([init]) });
        first = false;
      }
      emit({ data: bytes });
    },
    flush() {
      emit({ data: new Uint8Array([trailer]) });
    },
  };
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

describe("openHlsStream", () => {
  it("concatena fMP4 (init + segmentos)", async () => {
    const progress: number[] = [];
    const { fetch } = fakeFetch({
      "https://cdn.test/index.m3u8": MEDIA_FMP4,
      "https://cdn.test/init.mp4": encode("I"),
      "https://cdn.test/seg0.m4s": encode("A"),
      "https://cdn.test/seg1.m4s": encode("B"),
    });

    const opened = await openHlsStream(
      {
        url: "https://cdn.test/index.m3u8",
        onProgress: (p) => p.subIndex !== undefined && progress.push(p.subIndex),
      },
      { fetch },
    );

    expect(new TextDecoder().decode(await readAll(opened.body))).toBe("IAB");
    expect(progress).toEqual([1, 2]);
  });

  it("transmuxa TS via mux.js (fábrica injetada)", async () => {
    const { fetch } = fakeFetch({
      "https://cdn.test/index.m3u8": MEDIA_TS,
      "https://cdn.test/seg0.ts": encode("A"),
      "https://cdn.test/seg1.ts": encode("B"),
    });

    const opened = await openHlsStream(
      { url: "https://cdn.test/index.m3u8" },
      { fetch, createTransmuxer: () => fakeTransmuxer(0xaa, 0xbb) },
    );

    expect(Array.from(await readAll(opened.body))).toEqual([0xaa, 0x41, 0x42, 0xbb]);
  });

  it("escolhe a variante conforme a política (master)", async () => {
    const { fetch, requests } = fakeFetch({
      "https://cdn.test/master.m3u8": MASTER,
      "https://cdn.test/360/index.m3u8": MEDIA_FMP4,
      "https://cdn.test/360/init.mp4": encode("I"),
      "https://cdn.test/360/seg0.m4s": encode("A"),
      "https://cdn.test/360/seg1.m4s": encode("B"),
      "https://cdn.test/720/index.m3u8": MEDIA_FMP4,
      "https://cdn.test/720/init.mp4": encode("I"),
      "https://cdn.test/720/seg0.m4s": encode("A"),
      "https://cdn.test/720/seg1.m4s": encode("B"),
    });

    const opened = await openHlsStream(
      { url: "https://cdn.test/master.m3u8", policy: "smallest" },
      { fetch },
    );
    await readAll(opened.body);

    expect(requests).toContain("https://cdn.test/360/index.m3u8");
    expect(requests).not.toContain("https://cdn.test/720/index.m3u8");
  });

  it("recusa playlists ao vivo", async () => {
    const { fetch } = fakeFetch({ "https://cdn.test/live.m3u8": LIVE });

    await expect(openHlsStream({ url: "https://cdn.test/live.m3u8" }, { fetch })).rejects.toThrow(
      /ao vivo/,
    );
  });

  it("recusa SAMPLE-AES", async () => {
    const { fetch } = fakeFetch({ "https://cdn.test/drm.m3u8": SAMPLE_AES });

    await expect(openHlsStream({ url: "https://cdn.test/drm.m3u8" }, { fetch })).rejects.toThrow(
      /SAMPLE-AES/,
    );
  });
});

describe("hlsOutputFilename", () => {
  it("troca a extensão para .mp4", () => {
    expect(hlsOutputFilename({ filename: "filme.m3u8" })).toBe("filme.mp4");
    expect(hlsOutputFilename({ title: "Serie EP1" })).toBe("Serie EP1.mp4");
  });
});
