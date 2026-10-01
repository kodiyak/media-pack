import { describe, expect, it } from "vitest";
import { formatDuration } from "./format";

describe("formatDuration", () => {
  it("formata minutos e segundos", () => {
    expect(formatDuration(65)).toBe("1:05");
  });

  it("formata horas", () => {
    expect(formatDuration(3661)).toBe("1:01:01");
  });

  it("retorna undefined para valores inválidos", () => {
    expect(formatDuration(undefined)).toBeUndefined();
    expect(formatDuration(Number.NaN)).toBeUndefined();
    expect(formatDuration(-1)).toBeUndefined();
  });
});
