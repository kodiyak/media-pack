import {
  downloadCancelOffscreenRequestSchema,
  downloadStartOffscreenRequestSchema,
} from "@repo/protocol";
import { cancelDownload, runDownload } from "./downloads";

chrome.runtime.onMessage.addListener((message: unknown) => {
  const cancel = downloadCancelOffscreenRequestSchema.safeParse(message);
  if (cancel.success) {
    cancelDownload(cancel.data.jobId);
    return false;
  }

  const start = downloadStartOffscreenRequestSchema.safeParse(message);
  if (!start.success) return false;

  void runDownload(start.data, sendWithoutResponse);
  return false;
});

function sendWithoutResponse(message: unknown): void {
  chrome.runtime.sendMessage(message, () => {
    void chrome.runtime.lastError;
  });
}

console.log("[media-pack] offscreen pronto");
sendWithoutResponse({ type: "streams.ready" });
