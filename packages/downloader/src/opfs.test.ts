import { describe, expect, it } from "vitest";
import { selectOpfsEntriesForDeletion } from "./opfs";

describe("selectOpfsEntriesForDeletion", () => {
  it("remove lixo expirado e preserva arquivos protegidos", () => {
    const now = 1_000_000;
    const entries = [
      { name: "old.mp4", sizeBytes: 10, lastModified: now - 31 * 60 * 1000 },
      { name: "active.mp4", sizeBytes: 10, lastModified: now - 31 * 60 * 1000 },
      { name: "recent.mp4", sizeBytes: 10, lastModified: now - 1_000 },
    ];

    expect(
      selectOpfsEntriesForDeletion(
        entries,
        now,
        { maxAgeMs: 30 * 60 * 1000 },
        new Set(["active.mp4"]),
      ),
    ).toEqual(["old.mp4"]);
  });

  it("aplica limite de arquivos removendo os mais antigos", () => {
    const entries = [
      { name: "one", sizeBytes: 10, lastModified: 1 },
      { name: "two", sizeBytes: 10, lastModified: 2 },
      { name: "three", sizeBytes: 10, lastModified: 3 },
    ];

    expect(selectOpfsEntriesForDeletion(entries, 4, { maxAgeMs: 1_000, maxFiles: 2 })).toEqual([
      "one",
    ]);
  });

  it("aplica limite de bytes sem apagar arquivo protegido", () => {
    const entries = [
      { name: "old", sizeBytes: 80, lastModified: 1 },
      { name: "protected", sizeBytes: 80, lastModified: 2 },
      { name: "new", sizeBytes: 80, lastModified: 3 },
    ];

    expect(
      selectOpfsEntriesForDeletion(
        entries,
        4,
        { maxAgeMs: 1_000, maxBytes: 100 },
        new Set(["protected"]),
      ),
    ).toEqual(["old"]);
  });
});
