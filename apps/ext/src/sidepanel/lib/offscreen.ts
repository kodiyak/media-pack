import type { SourceProgress } from "@repo/downloader";
import {
  type PreparedFile,
  type PreparedTrackPlan,
  type StreamCancelRequest,
  type StreamVariantPolicy,
  streamPrepareResponseSchema,
  streamProgressMessageSchema,
} from "@repo/protocol";
import { hasExtensionApi } from "./chrome";

export type PrepareStreamFileInput = {
  url: string;
  streamType: "hls" | "dash";
  policy: StreamVariantPolicy;
  filename: string;
  track?: PreparedTrackPlan;
};

/** Pede uma conversão lazy ao service worker/offscreen. */
export async function prepareStreamFile(
  input: PrepareStreamFileInput,
  signal: AbortSignal,
  onProgress?: (progress: SourceProgress) => void,
): Promise<PreparedFile> {
  if (!hasExtensionApi()) throw new Error("A API da extensão não está disponível.");

  const requestId = crypto.randomUUID();
  const request = {
    type: "streams.prepare" as const,
    requestId,
    ...input,
  };

  let settled = false;
  const onAbort = (): void => {
    if (settled) return;
    void chrome.runtime.sendMessage({
      type: "streams.cancel",
      requestId,
    } satisfies StreamCancelRequest);
  };
  const onMessage = (message: unknown): void => {
    const progress = streamProgressMessageSchema.safeParse(message);
    if (progress.success && progress.data.requestId === requestId) {
      onProgress?.({ subIndex: progress.data.subIndex, subTotal: progress.data.subTotal });
    }
  };
  chrome.runtime.onMessage.addListener(onMessage);
  signal.addEventListener("abort", onAbort, { once: true });

  try {
    if (signal.aborted) throw abortError();
    const raw = await chrome.runtime.sendMessage(request);
    if (signal.aborted) throw abortError();

    const response = streamPrepareResponseSchema.safeParse(raw);
    if (!response.success) throw new Error("Resposta inválida do conversor offscreen.");
    if (!response.data.ok || !response.data.file) {
      throw new Error(response.data.error ?? "Falha ao preparar o stream.");
    }
    return response.data.file;
  } finally {
    settled = true;
    signal.removeEventListener("abort", onAbort);
    chrome.runtime.onMessage.removeListener(onMessage);
  }
}

function abortError(): DOMException {
  return new DOMException("Operação cancelada.", "AbortError");
}

/** Fecha o documento offscreen ao final do download (sem erro se já estiver fechado). */
export function closeOffscreenDocument(): void {
  if (!hasExtensionApi()) return;
  chrome.runtime.sendMessage({ type: "streams.close" }, () => {
    void chrome.runtime.lastError;
  });
}
