import {
  cleanupOpfs,
  createOpfsFileName,
  deleteOpfsFile,
  type SourceProgress,
  writeOpfsFile,
} from "@repo/downloader";
import {
  preparedTrackPlanSchema,
  type StreamPrepareOffscreenRequest,
  type StreamPrepareResponse,
  streamCancelOffscreenRequestSchema,
  streamPrepareOffscreenRequestSchema,
} from "@repo/protocol";
import { openDashTrack, openHlsStream } from "@repo/streams";

const activeJobs = new Map<string, AbortController>();

chrome.runtime.onMessage.addListener((message: unknown) => {
  const cancel = streamCancelOffscreenRequestSchema.safeParse(message);
  if (cancel.success) {
    activeJobs.get(cancel.data.requestId)?.abort();
    return false;
  }

  const request = streamPrepareOffscreenRequestSchema.safeParse(message);
  if (!request.success) return false;

  void prepare(request.data)
    .then((response) => sendWithoutResponse({ type: "streams.result", ...response }))
    .catch((error: unknown) =>
      sendWithoutResponse({
        type: "streams.result",
        requestId: request.data.requestId,
        ok: false,
        error: toErrorMessage(error),
      } satisfies StreamPrepareResponse & { type: "streams.result" }),
    );
  return false;
});

function sendWithoutResponse(message: unknown): void {
  chrome.runtime.sendMessage(message, () => {
    void chrome.runtime.lastError;
  });
}

async function prepare(request: StreamPrepareOffscreenRequest): Promise<StreamPrepareResponse> {
  const controller = new AbortController();
  activeJobs.set(request.requestId, controller);
  let name: string | undefined;

  try {
    // Limpeza oportunística: só abre o OPFS depois de o usuário iniciar o download.
    await cleanupOpfs();
    name = createOpfsFileName(extensionFor(request.filename));

    const body = await openSource(request, controller.signal, (progress) => {
      if (progress.subIndex === undefined || progress.subTotal === undefined) return;
      sendWithoutResponse({
        type: "streams.progress",
        requestId: request.requestId,
        subIndex: progress.subIndex,
        subTotal: progress.subTotal,
      });
    });
    const file = await writeOpfsFile(name, body, controller.signal);

    return {
      requestId: request.requestId,
      ok: true,
      file: { name: file.name, filename: request.filename, sizeBytes: file.sizeBytes },
    };
  } catch (error) {
    if (name) await deleteOpfsFile(name).catch(() => {});
    return {
      requestId: request.requestId,
      ok: false,
      error: toErrorMessage(error),
    };
  } finally {
    activeJobs.delete(request.requestId);
  }
}

async function openSource(
  request: StreamPrepareOffscreenRequest,
  signal: AbortSignal,
  onProgress: (progress: SourceProgress) => void,
): Promise<ReadableStream<Uint8Array>> {
  if (request.streamType === "hls") {
    const opened = await openHlsStream({
      url: request.url,
      policy: request.policy,
      signal,
      onProgress,
    });
    return opened.body;
  }

  const track = preparedTrackPlanSchema.parse(request.track);
  const opened = await openDashTrack(track, { signal, onProgress });
  return opened.body;
}

function extensionFor(filename: string): string {
  const match = /\.[a-z0-9]+$/i.exec(filename);
  return match?.[0] ?? ".mp4";
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

console.log("[media-pack] offscreen pronto");
