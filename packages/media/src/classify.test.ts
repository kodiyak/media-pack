import { describe, expect, it } from "vitest";
import { classifyResponse, isIgnoredUrl, normalizeMediaUrl } from "./classify";

describe("classifyResponse", () => {
  it("classifica imagem por content-type", () => {
    const item = classifyResponse({
      url: "https://cdn.test/a",
      contentType: "image/png",
      contentLength: 2048,
    });

    expect(item?.kind).toBe("image");
    expect(item?.filename).toBe("a.png");
    expect(item?.sizeInBytes).toBe(2048);
  });

  it("cai para a extensão quando o content-type é octet-stream", () => {
    const item = classifyResponse({
      url: "https://cdn.test/clip.mp4?token=1",
      contentType: "application/octet-stream",
    });

    expect(item?.kind).toBe("video");
    expect(item?.filename).toBe("clip.mp4");
  });

  it("detecta manifesto HLS como stream", () => {
    const item = classifyResponse({
      url: "https://cdn.test/hls/index.m3u8",
      contentType: "application/vnd.apple.mpegurl",
    });

    expect(item?.streamType).toBe("hls");
    expect(item?.kind).toBe("video");
    expect(item?.filename).toBe("index.m3u8");
  });

  it("normaliza o parâmetro range", () => {
    expect(normalizeMediaUrl("https://cdn.test/a.mp4?range=0-100&x=1")).toBe(
      "https://cdn.test/a.mp4?x=1",
    );
  });

  it("ignora googlevideo", () => {
    expect(isIgnoredUrl("https://rr1---sn-x.googlevideo.com/videoplayback?x=1")).toBe(true);
    expect(
      classifyResponse({
        url: "https://rr1---sn-x.googlevideo.com/videoplayback",
        contentType: "video/mp4",
      }),
    ).toBeNull();
  });

  it("ignora tipos que não são mídia", () => {
    expect(
      classifyResponse({ url: "https://cdn.test/app.js", contentType: "application/javascript" }),
    ).toBeNull();
  });
});
