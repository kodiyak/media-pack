import type { DownloadJobState } from "@repo/protocol";

/** Teto global de downloads simultâneos. Cada job processa um arquivo por vez. */
export const MAX_CONCURRENT_DOWNLOADS = 10;

const TERMINAL_STATUSES: ReadonlySet<DownloadJobState["status"]> = new Set([
  "ready",
  "done",
  "error",
  "cancelled",
]);

export function isTerminalDownload(status: DownloadJobState["status"]): boolean {
  return TERMINAL_STATUSES.has(status);
}

/**
 * Estado de todos os jobs de download. O service worker guarda um mapa
 * `jobId → estado` (e não um único job), permitindo vários downloads de abas
 * diferentes ao mesmo tempo. A persistência é feita pelo chamador.
 */
export class DownloadJobRegistry {
  private readonly jobs = new Map<string, DownloadJobState>();
  /** Abas com um `downloads.start` em voo (antes do primeiro estado chegar). */
  private readonly startingTabs = new Set<number>();

  all(): DownloadJobState[] {
    return [...this.jobs.values()];
  }

  toRecord(): Record<string, DownloadJobState> {
    return Object.fromEntries(this.jobs);
  }

  runningCount(): number {
    let count = 0;
    for (const job of this.jobs.values()) {
      if (job.status === "running") count += 1;
    }
    return count;
  }

  /** `true` quando a aba já tem (ou está iniciando) um download. */
  isBusy(tabId: number): boolean {
    if (this.startingTabs.has(tabId)) return true;
    for (const job of this.jobs.values()) {
      if (job.tabId === tabId && job.status === "running") return true;
    }
    return false;
  }

  canStart(): boolean {
    return this.runningCount() + this.startingTabs.size < MAX_CONCURRENT_DOWNLOADS;
  }

  beginStart(tabId: number): void {
    this.startingTabs.add(tabId);
  }

  endStart(tabId: number): void {
    this.startingTabs.delete(tabId);
  }

  upsert(state: DownloadJobState): void {
    this.jobs.set(state.jobId, state);
  }

  /** Remove um job específico (ex.: o painel dispensou um ZIP já salvo). */
  remove(jobId: string): boolean {
    return this.jobs.delete(jobId);
  }

  /** Remove jobs já finalizados de uma aba (evita acúmulo de estados terminais). */
  clearTerminalForTab(tabId: number): boolean {
    let changed = false;
    for (const [jobId, job] of this.jobs) {
      if (job.tabId === tabId && isTerminalDownload(job.status)) {
        this.jobs.delete(jobId);
        changed = true;
      }
    }
    return changed;
  }
}
