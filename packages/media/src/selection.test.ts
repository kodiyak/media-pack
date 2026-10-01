import { DEFAULT_MEDIA_PREFS, type MediaItem, mediaItemSchema } from "@repo/protocol";
import { describe, expect, it } from "vitest";
import { formatBytes } from "./format";
import { matchesQuery, matchesTab, shouldAutoSelect } from "./selection";

function makeItem(partial: Partial<MediaItem>): MediaItem {
  return mediaItemSchema.parse({
    id: crypto.randomUUID(),
    url: "https://cdn.test/a.mp4",
    kind: "video",
    filename: "a.mp4",
    createdAt: new Date().toISOString(),
    ...partial,
  });
}

describe("shouldAutoSelect", () => {
  it("seleciona vídeo por padrão", () => {
    expect(shouldAutoSelect(makeItem({}), DEFAULT_MEDIA_PREFS)).toBe(true);
  });

  it("não seleciona imagem por padrão", () => {
    expect(shouldAutoSelect(makeItem({ kind: "image" }), DEFAULT_MEDIA_PREFS)).toBe(false);
  });

  it("respeita o tamanho mínimo", () => {
    const prefs = { ...DEFAULT_MEDIA_PREFS, minSizeInBytes: 1000 };
    expect(shouldAutoSelect(makeItem({ sizeInBytes: 10 }), prefs)).toBe(false);
    expect(shouldAutoSelect(makeItem({ sizeInBytes: 2000 }), prefs)).toBe(true);
  });
});

describe("matchesTab", () => {
  it("mantém itens sem tabId", () => {
    expect(matchesTab(makeItem({}), 99, true)).toBe(true);
  });

  it("filtra pela aba atual", () => {
    expect(matchesTab(makeItem({ tabId: 1 }), 2, true)).toBe(false);
    expect(matchesTab(makeItem({ tabId: 2 }), 2, true)).toBe(true);
  });
});

describe("matchesQuery e formatBytes", () => {
  it("busca por nome e formata bytes", () => {
    expect(matchesQuery(makeItem({ filename: "Clipe Final.mp4" }), "final")).toBe(true);
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(undefined)).toBe("—");
  });
});
