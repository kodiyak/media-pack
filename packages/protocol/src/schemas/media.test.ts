import { describe, expect, it } from "vitest";
import { mediaItemSchema, streamInfoSchema } from "./media";

function baseItem(partial: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: crypto.randomUUID(),
    url: "https://cdn.test/master.m3u8",
    kind: "video",
    createdAt: new Date().toISOString(),
    ...partial,
  };
}

describe("mediaItemSchema (stream)", () => {
  it("aceita metadados de manifesto resolvido", () => {
    const item = mediaItemSchema.parse(
      baseItem({
        streamType: "hls",
        stream: {
          container: "fmp4",
          encryption: "aes-128",
          segmentCount: 10,
          durationSeconds: 600,
          estimatedBytes: 123,
          variants: [{ url: "https://cdn.test/720.m3u8", bandwidth: 2_000_000, height: 720 }],
        },
        conversionStatus: "pending",
      }),
    );

    expect(item.stream?.variants?.[0]?.height).toBe(720);
    expect(item.conversionStatus).toBe("pending");
  });

  it("rejeita container inválido", () => {
    expect(streamInfoSchema.safeParse({ container: "webm" }).success).toBe(false);
  });

  it("aceita variante sem url (DASH)", () => {
    const info = streamInfoSchema.parse({ variants: [{ bandwidth: 1000 }] });

    expect(info.variants?.[0]?.url).toBeUndefined();
  });
});
