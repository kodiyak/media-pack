import type { StreamVariant } from "@repo/protocol";
import { describe, expect, it } from "vitest";
import { selectVariant, variantLabel } from "./streams";

const VARIANTS: StreamVariant[] = [
  { bandwidth: 1_000_000, height: 360 },
  { bandwidth: 3_000_000, height: 720 },
  { bandwidth: 8_000_000, height: 1080 },
];

describe("selectVariant", () => {
  it("best → maior banda", () => {
    expect(selectVariant(VARIANTS, "best")?.height).toBe(1080);
  });

  it("smallest → menor banda", () => {
    expect(selectVariant(VARIANTS, "smallest")?.height).toBe(360);
  });

  it("balanced → mais próxima de 720p", () => {
    expect(selectVariant(VARIANTS, "balanced")?.height).toBe(720);
  });

  it("retorna null sem variantes", () => {
    expect(selectVariant([], "best")).toBeNull();
  });

  it("empate de resolução desempata pela maior banda", () => {
    const variants: StreamVariant[] = [
      { bandwidth: 2_000_000, height: 720 },
      { bandwidth: 5_000_000, height: 720 },
    ];
    expect(selectVariant(variants, "balanced")?.bandwidth).toBe(5_000_000);
  });
});

describe("variantLabel", () => {
  it("usa o label explícito quando existe", () => {
    expect(variantLabel({ label: "Full HD" })).toBe("Full HD");
  });

  it("monta resolução e bitrate", () => {
    expect(variantLabel({ bandwidth: 4_000_000, height: 1080 })).toBe("1080p · 4.0 Mb/s");
  });

  it("tem fallback sem dados", () => {
    expect(variantLabel({})).toBe("Qualidade padrão");
  });
});
