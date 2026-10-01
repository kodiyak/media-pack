import { describe, expect, it } from "vitest";
import { streamPrepareRequestSchema } from "./messages";

describe("streamPrepareRequestSchema", () => {
  it("aceita um pedido DASH com plano serializável", () => {
    const result = streamPrepareRequestSchema.safeParse({
      type: "streams.prepare",
      requestId: "00000000-0000-4000-8000-000000000001",
      url: "https://cdn.test/video.mpd",
      streamType: "dash",
      policy: "best",
      filename: "video.mp4",
      track: {
        container: "fmp4",
        initUrl: "https://cdn.test/init.mp4",
        segments: [
          {
            url: "https://cdn.test/segment.m4s",
            byteRange: { offset: 0, length: 100 },
          },
        ],
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejeita plano com URL insegura", () => {
    const result = streamPrepareRequestSchema.safeParse({
      type: "streams.prepare",
      requestId: "00000000-0000-4000-8000-000000000001",
      url: "https://cdn.test/video.mpd",
      streamType: "dash",
      policy: "best",
      filename: "video.mp4",
      track: {
        container: "fmp4",
        segments: [{ url: "not-a-url" }],
      },
    });

    expect(result.success).toBe(false);
  });
});
