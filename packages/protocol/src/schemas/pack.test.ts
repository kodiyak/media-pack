import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createPackInputSchema, packSchema, z } from "../index";

const now = new Date().toISOString();

describe("packSchema", () => {
  it("aplica defaults de status e items", () => {
    const pack = packSchema.parse({
      id: randomUUID(),
      name: "Meu pack",
      createdAt: now,
      updatedAt: now,
    });

    expect(pack.status).toBe("draft");
    expect(pack.items).toEqual([]);
  });

  it("rejeita nome vazio", () => {
    const result = packSchema.safeParse({
      id: randomUUID(),
      name: "",
      createdAt: now,
      updatedAt: now,
    });

    expect(result.success).toBe(false);
  });
});

describe("createPackInputSchema", () => {
  it("expõe apenas name e description", () => {
    const input = createPackInputSchema.parse({ name: "Pack A" });
    expect(input).toEqual({ name: "Pack A" });
  });

  it("integra com o helper `z` reexportado", () => {
    expect(z.string().safeParse("ok").success).toBe(true);
  });
});
