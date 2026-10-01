import {
  cleanupOpfs,
  createOpfsFileName,
  createZipStream,
  deleteOpfsFile,
  sinkFromFileHandle,
  toErrorMessage,
  writeOpfsFile,
  type ZipProgressEvent,
  type ZipSink,
} from "@repo/downloader";
import type { DownloadJobState, DownloadStartOffscreenRequest } from "@repo/protocol";
import { deleteFileHandle, hasHandleStore, loadFileHandle } from "../lib/handle-store";
import { buildDownloadSources } from "./sources";

type DownloadSink = ZipSink & { stagedName?: string };

type SendMessage = (message: unknown) => void;

const activeJobs = new Map<string, AbortController>();

/** Cancela o job em andamento (o offscreen permanece vivo para o próximo). */
export function cancelDownload(jobId: string): void {
  activeJobs.get(jobId)?.abort();
}

/**
 * Baixa + compacta um lote inteiro no offscreen. Isso desacopla o download do
 * side panel: fechar o painel não interrompe nada. O estado é emitido a cada
 * progresso para o service worker persistir e o painel se reconectar.
 */
export async function runDownload(
  request: DownloadStartOffscreenRequest,
  send: SendMessage,
): Promise<void> {
  const controller = new AbortController();
  activeJobs.set(request.jobId, controller);

  let state: DownloadJobState = {
    jobId: request.jobId,
    status: "running",
    zipName: request.zipName,
    total: 0,
    index: 0,
    filename: "",
    loadedBytes: 0,
    filePercent: 0,
    overallPercent: 0,
    updatedAt: new Date().toISOString(),
  };

  const emit = (patch: Partial<DownloadJobState>): void => {
    state = { ...state, ...patch, updatedAt: new Date().toISOString() };
    send({ type: "downloads.state", state });
  };

  try {
    await cleanupOpfs();
    const sources = await buildDownloadSources(request.items, request.policy, controller.signal);
    emit({ total: sources.length });

    const sink = await createSink(request, controller.signal);
    await sink.write(
      createZipStream(sources, {
        signal: controller.signal,
        onProgress: (event) => emit(progressPatch(event)),
      }),
    );

    emit({
      status: sink.stagedName ? "ready" : "done",
      overallPercent: 100,
      stagedName: sink.stagedName,
    });
  } catch (error) {
    if (controller.signal.aborted) emit({ status: "cancelled" });
    else emit({ status: "error", error: toErrorMessage(error) });
  } finally {
    activeJobs.delete(request.jobId);
    await deleteFileHandle(request.jobId).catch(() => {});
  }
}

/**
 * Tenta gravar direto no arquivo escolhido no painel (handle no IndexedDB).
 * Se não der (sem handle, sem IndexedDB ou permissão expirada), monta o ZIP
 * no OPFS e deixa o painel salvar depois.
 */
async function createSink(
  request: DownloadStartOffscreenRequest,
  signal: AbortSignal,
): Promise<DownloadSink> {
  const handle = hasHandleStore() ? await loadFileHandle(request.jobId).catch(() => null) : null;

  if (handle) {
    try {
      return await sinkFromFileHandle(handle);
    } catch (error) {
      console.warn("[media-pack] não foi possível gravar direto no disco:", error);
    }
  }

  const stagedName = createOpfsFileName(".zip");
  return {
    name: request.zipName,
    stagedName,
    async write(stream) {
      await writeOpfsFile(stagedName, stream, signal);
    },
    async abort() {
      await deleteOpfsFile(stagedName).catch(() => {});
    },
  };
}

function progressPatch(event: ZipProgressEvent): Partial<DownloadJobState> {
  return {
    status: "running",
    index: event.index,
    total: event.total,
    filename: event.filename,
    loadedBytes: event.loadedBytes,
    totalBytes: event.totalBytes,
    filePercent: event.filePercent,
    overallPercent: event.overallPercent,
    subIndex: event.subIndex,
    subTotal: event.subTotal,
  };
}
