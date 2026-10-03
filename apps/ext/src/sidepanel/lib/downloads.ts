import { opfsSource, prepareZipSink } from "@repo/downloader";
import {
  type DownloadCancelRequest,
  type DownloadJobState,
  type DownloadStartRequest,
  downloadStateMessageSchema,
  z,
} from "@repo/protocol";
import { saveFileHandle } from "../../lib/handle-store";
import { hasExtensionApi } from "./chrome";

const startResponseSchema = z.object({ ok: z.boolean(), error: z.string().optional() });

type SaveFilePicker = (options?: {
  suggestedName?: string;
  types?: { description?: string; accept: Record<string, string[]> }[];
}) => Promise<FileSystemFileHandle>;

/**
 * Abre o seletor de arquivo (precisa do gesto do usuário) e guarda o handle no
 * IndexedDB para o offscreen gravar direto no disco mesmo se o painel fechar.
 * Retorna `false` quando o navegador não tem File System Access.
 */
export async function pickAndStoreFileHandle(jobId: string, zipName: string): Promise<boolean> {
  const picker = (globalThis as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  if (typeof picker !== "function") return false;

  const handle = await picker({
    suggestedName: zipName,
    types: [{ description: "Arquivo ZIP", accept: { "application/zip": [".zip"] } }],
  });
  await saveFileHandle(jobId, handle);
  return true;
}

export async function startDownload(
  input: Omit<DownloadStartRequest, "type">,
): Promise<{ ok: boolean; error?: string }> {
  if (!hasExtensionApi()) throw new Error("A API da extensão não está disponível.");

  const response = await chrome.runtime.sendMessage({ type: "downloads.start", ...input });
  const parsed = startResponseSchema.safeParse(response);
  return parsed.success ? parsed.data : { ok: false, error: "Resposta inválida do serviço." };
}

export function cancelDownload(jobId: string): void {
  if (!hasExtensionApi()) return;
  const request: DownloadCancelRequest = { type: "downloads.cancel", jobId };
  chrome.runtime.sendMessage(request, () => {
    void chrome.runtime.lastError;
  });
}

/** Pede ao service worker para remover um job finalizado do estado persistido. */
export function dismissDownload(jobId: string): void {
  if (!hasExtensionApi()) return;
  chrome.runtime.sendMessage({ type: "downloads.dismiss", jobId }, () => {
    void chrome.runtime.lastError;
  });
}

/** Escuta as atualizações de estado emitidas pelo offscreen (tempo real). */
export function subscribeToDownloadState(listener: (state: DownloadJobState) => void): () => void {
  if (!hasExtensionApi()) return () => {};

  const onMessage = (message: unknown): void => {
    const parsed = downloadStateMessageSchema.safeParse(message);
    if (parsed.success) listener(parsed.data.state);
  };
  chrome.runtime.onMessage.addListener(onMessage);
  return () => {
    if (hasExtensionApi()) chrome.runtime.onMessage.removeListener(onMessage);
  };
}

/** Salva o ZIP deixado no OPFS (fallback) no local escolhido pelo usuário. */
export async function saveStagedZip(stagedName: string, zipName: string): Promise<string> {
  const sink = await prepareZipSink(zipName);
  const { body } = await opfsSource(stagedName, zipName).open();
  await sink.write(body as ReadableStream<Uint8Array>);
  return sink.name;
}
