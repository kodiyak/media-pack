import type { DownloadJobState } from "@repo/protocol";
import { describe, expect, it } from "vitest";
import { DownloadJobRegistry, MAX_CONCURRENT_DOWNLOADS } from "./job-registry";

function makeJob(partial: Partial<DownloadJobState> & { jobId: string }): DownloadJobState {
  return {
    tabId: 1,
    status: "running",
    zipName: "media-pack.zip",
    total: 1,
    index: 0,
    filename: "",
    loadedBytes: 0,
    filePercent: 0,
    overallPercent: 0,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("DownloadJobRegistry", () => {
  it("conta apenas jobs em andamento", () => {
    const registry = new DownloadJobRegistry();
    registry.upsert(makeJob({ jobId: "a", tabId: 1 }));
    registry.upsert(makeJob({ jobId: "b", tabId: 2, status: "done" }));
    registry.upsert(makeJob({ jobId: "c", tabId: 3, status: "running" }));

    expect(registry.runningCount()).toBe(2);
    expect(registry.toRecord()).toHaveProperty("a");
  });

  it("bloqueia uma segunda partida na mesma aba, mesmo antes do primeiro estado", () => {
    const registry = new DownloadJobRegistry();
    expect(registry.isBusy(7)).toBe(false);

    registry.beginStart(7);
    expect(registry.isBusy(7)).toBe(true);

    registry.endStart(7);
    registry.upsert(makeJob({ jobId: "a", tabId: 7 }));
    expect(registry.isBusy(7)).toBe(true);

    registry.upsert(makeJob({ jobId: "a", tabId: 7, status: "done" }));
    expect(registry.isBusy(7)).toBe(false);
  });

  it("respeita o teto global somando jobs rodando e partidas em voo", () => {
    const registry = new DownloadJobRegistry();
    for (let index = 0; index < MAX_CONCURRENT_DOWNLOADS; index += 1) {
      registry.upsert(makeJob({ jobId: `job-${index}`, tabId: index }));
    }

    expect(registry.canStart()).toBe(false);

    registry.upsert(makeJob({ jobId: "job-0", tabId: 0, status: "done" }));
    expect(registry.canStart()).toBe(true);

    registry.beginStart(999);
    expect(registry.runningCount()).toBe(MAX_CONCURRENT_DOWNLOADS - 1);
  });

  it("remove apenas jobs finalizados de uma aba", () => {
    const registry = new DownloadJobRegistry();
    registry.upsert(makeJob({ jobId: "running", tabId: 5 }));
    registry.upsert(makeJob({ jobId: "done", tabId: 5, status: "done" }));
    registry.upsert(makeJob({ jobId: "other", tabId: 6, status: "done" }));

    expect(registry.clearTerminalForTab(5)).toBe(true);
    expect(
      registry
        .all()
        .map((job) => job.jobId)
        .sort(),
    ).toEqual(["other", "running"]);
    expect(registry.clearTerminalForTab(5)).toBe(false);
  });

  it("remove um job específico ao ser dispensado", () => {
    const registry = new DownloadJobRegistry();
    registry.upsert(makeJob({ jobId: "a", tabId: 5, status: "ready" }));

    expect(registry.remove("a")).toBe(true);
    expect(registry.remove("a")).toBe(false);
    expect(registry.all()).toEqual([]);
  });
});
