import { describe, expect, it } from "vitest";
import { downloadJobStateSchema, downloadJobsSchema, downloadStartRequestSchema } from "./messages";

const ITEM = {
  id: "00000000-0000-4000-8000-000000000001",
  url: "https://cdn.test/clipe.mp4",
  kind: "video" as const,
  filename: "clipe.mp4",
  sizeInBytes: 1024,
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("downloadStartRequestSchema", () => {
  it("aceita um pedido com itens serializáveis", () => {
    const result = downloadStartRequestSchema.safeParse({
      type: "downloads.start",
      jobId: "00000000-0000-4000-8000-000000000002",
      tabId: 7,
      zipName: "media-pack.zip",
      policy: "best",
      items: [ITEM],
    });

    expect(result.success).toBe(true);
  });

  it("rejeita pedido sem aba de origem", () => {
    const result = downloadStartRequestSchema.safeParse({
      type: "downloads.start",
      jobId: "00000000-0000-4000-8000-000000000002",
      zipName: "media-pack.zip",
      policy: "best",
      items: [ITEM],
    });

    expect(result.success).toBe(false);
  });

  it("rejeita item com URL insegura", () => {
    const result = downloadStartRequestSchema.safeParse({
      type: "downloads.start",
      jobId: "00000000-0000-4000-8000-000000000002",
      tabId: 7,
      zipName: "media-pack.zip",
      policy: "best",
      items: [{ ...ITEM, url: "not-a-url" }],
    });

    expect(result.success).toBe(false);
  });
});

describe("downloadJobStateSchema", () => {
  it("aceita um estado em andamento", () => {
    const result = downloadJobStateSchema.safeParse({
      jobId: "00000000-0000-4000-8000-000000000003",
      tabId: 7,
      status: "running",
      zipName: "media-pack.zip",
      total: 3,
      index: 1,
      filename: "clipe.mp4",
      loadedBytes: 512,
      filePercent: 50,
      overallPercent: 33,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(result.success).toBe(true);
  });

  it("rejeita percentual fora de 0–100", () => {
    const result = downloadJobStateSchema.safeParse({
      jobId: "00000000-0000-4000-8000-000000000003",
      tabId: 7,
      status: "running",
      zipName: "media-pack.zip",
      total: 3,
      index: 1,
      filename: "clipe.mp4",
      loadedBytes: 512,
      filePercent: 150,
      overallPercent: 33,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(result.success).toBe(false);
  });
});

describe("downloadJobsSchema", () => {
  it("aceita um mapa vazio e um mapa com jobs", () => {
    expect(downloadJobsSchema.safeParse({}).success).toBe(true);

    const result = downloadJobsSchema.safeParse({
      "00000000-0000-4000-8000-000000000003": {
        jobId: "00000000-0000-4000-8000-000000000003",
        tabId: 7,
        status: "running",
        zipName: "media-pack.zip",
        total: 3,
        index: 1,
        filename: "clipe.mp4",
        loadedBytes: 512,
        filePercent: 50,
        overallPercent: 33,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });

    expect(result.success).toBe(true);
  });
});
