import { describe, expect, it } from "vitest";
import { uniqueEntryName } from "./names";

describe("uniqueEntryName", () => {
  it("desambigua nomes repetidos", () => {
    const used = new Set<string>();
    expect(uniqueEntryName(used, "a.mp4")).toBe("a.mp4");
    expect(uniqueEntryName(used, "a.mp4")).toBe("a (2).mp4");
    expect(uniqueEntryName(used, "a.mp4")).toBe("a (3).mp4");
  });

  it("sanitiza separadores de caminho", () => {
    const used = new Set<string>();
    expect(uniqueEntryName(used, "../etc/passwd")).toBe(".._etc_passwd");
  });
});
