import { type ClassifyInput, classifyResponse, parseContentRangeTotal } from "@repo/media";
import {
  type ClassifiedMedia,
  type DownloadJobState,
  type DownloadStartRequest,
  downloadCancelRequestSchema,
  downloadStartRequestSchema,
  downloadStateMessageSchema,
  type MediaItem,
  mediaItemSchema,
  offscreenCloseMessageSchema,
  offscreenReadyMessageSchema,
  z,
} from "@repo/protocol";
import { resolveStreamInfo } from "@repo/streams";
import { startAutoReload } from "./auto-reload";

const MEDIA_KEY = "media";
const DOWNLOAD_KEY = "downloadJob";
const MAX_ITEMS = 2000;

const mediaListSchema = z.array(mediaItemSchema);

const TERMINAL_DOWNLOAD_STATUS = new Set<DownloadJobState["status"]>([
  "ready",
  "done",
  "error",
  "cancelled",
]);

/** URLs de rendições (variantes/áudio/legenda) já cobertas por uma master playlist. */
const knownRenditionUrls = new Set<string>();

type TabInfo = { url?: string; title?: string };

type OffscreenApi = {
  createDocument(options: {
    url: string;
    reasons: ["WORKERS"];
    justification: string;
  }): Promise<void>;
  closeDocument(): Promise<void>;
};

const offscreenApi = (chrome as unknown as { offscreen?: OffscreenApi }).offscreen;
let offscreenReady = false;
let resolveOffscreenReady: (() => void) | null = null;

// Estado do download guardado no service worker para o side panel se reconectar
// depois de ser fechado e reaberto.
let latestDownload: DownloadJobState | null = null;
let persistTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Garante um documento offscreen pronto. Se ele já existir (ex.: o service
 * worker reiniciou), reaproveita — recriar mataria um download em andamento.
 */
async function ensureOffscreen(): Promise<void> {
  if (offscreenReady) return;
  if (!offscreenApi) throw new Error("A API offscreen não está disponível.");

  if (await hasOffscreenDocument()) {
    offscreenReady = true;
    return;
  }

  const ready = new Promise<void>((resolve) => {
    resolveOffscreenReady = resolve;
  });

  // Fecha qualquer documento antigo e cria um novo para o handshake ser confiável.
  await offscreenApi.closeDocument().catch(() => {});
  await offscreenApi.createDocument({
    url: "offscreen.html",
    reasons: ["WORKERS"],
    justification: "Converter e baixar streams durante um download iniciado pelo usuário.",
  });

  await withTimeout(ready, 8_000, "O conversor offscreen não iniciou.");
  offscreenReady = true;
  resolveOffscreenReady = null;
}

async function hasOffscreenDocument(): Promise<boolean> {
  const getContexts = (
    chrome.runtime as unknown as {
      getContexts?: (filter: { contextTypes?: string[] }) => Promise<unknown[]>;
    }
  ).getContexts;
  if (typeof getContexts !== "function") return false;

  try {
    const contexts = await getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
    return contexts.length > 0;
  } catch {
    return false;
  }
}

async function closeOffscreen(): Promise<void> {
  if (!offscreenApi) return;
  offscreenReady = false;
  await offscreenApi.closeDocument().catch(() => {});
}

/** Persiste o estado (com throttle) e fecha o offscreen quando o job termina. */
function persistDownloadState(state: DownloadJobState): void {
  latestDownload = state;

  if (TERMINAL_DOWNLOAD_STATUS.has(state.status)) {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = undefined;
    }
    void chrome.storage.session.set({ [DOWNLOAD_KEY]: state });
    void closeOffscreen();
    return;
  }

  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = undefined;
    void chrome.storage.session.set({ [DOWNLOAD_KEY]: latestDownload });
  }, 300);
}

async function startDownload(request: DownloadStartRequest): Promise<{ ok: true }> {
  await ensureOffscreen();
  sendWithoutResponse({ ...request, type: "downloads.start.offscreen" });
  return { ok: true };
}

async function cancelDownload(jobId: string): Promise<{ ok: true }> {
  await ensureOffscreen().catch(() => {});
  sendWithoutResponse({ type: "downloads.cancel.offscreen", jobId });
  return { ok: true };
}

function sendWithoutResponse(message: unknown): void {
  chrome.runtime.sendMessage(message, () => {
    void chrome.runtime.lastError;
  });
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function withTimeout<T>(
  promise: Promise<T>,
  milliseconds: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), milliseconds);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const ready = offscreenReadyMessageSchema.safeParse(message);
  if (ready.success) {
    resolveOffscreenReady?.();
    return false;
  }

  const close = offscreenCloseMessageSchema.safeParse(message);
  if (close.success) {
    void closeOffscreen();
    return false;
  }

  const state = downloadStateMessageSchema.safeParse(message);
  if (state.success) {
    persistDownloadState(state.data.state);
    return false;
  }

  const start = downloadStartRequestSchema.safeParse(message);
  if (start.success) {
    void startDownload(start.data)
      .then(sendResponse)
      .catch((error: unknown) => sendResponse({ ok: false, error: toErrorMessage(error) }));
    return true;
  }

  const cancel = downloadCancelRequestSchema.safeParse(message);
  if (cancel.success) {
    void cancelDownload(cancel.data.jobId)
      .then(sendResponse)
      .catch(() => sendResponse({ ok: true }));
    return true;
  }

  return false;
});

/** Cache de URL/título por aba, usado para enriquecer o item capturado. */
const tabInfo = new Map<number, TabInfo>();

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const info = tabInfo.get(tabId) ?? {};
  if (changeInfo.url) info.url = changeInfo.url;
  if (tab.url) info.url = tab.url;
  if (tab.title) info.title = tab.title;
  tabInfo.set(tabId, info);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabInfo.delete(tabId);
});

async function resolveTabInfo(tabId: number): Promise<TabInfo> {
  const cached = tabInfo.get(tabId);
  if (cached?.url) return cached;

  try {
    const tab = await chrome.tabs.get(tabId);
    const info: TabInfo = { url: tab.url, title: tab.title };
    tabInfo.set(tabId, info);
    return info;
  } catch {
    return cached ?? {};
  }
}

function headersToRecord(headers?: chrome.webRequest.HttpHeader[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (const header of headers ?? []) {
    if (header.name) record[header.name.toLowerCase()] = header.value ?? "";
  }
  return record;
}

async function handleResponse(details: chrome.webRequest.OnHeadersReceivedDetails): Promise<void> {
  if (details.tabId < 0) return;

  const headers = headersToRecord(details.responseHeaders);
  const length = headers["content-length"];
  const rangeTotal = parseContentRangeTotal(headers["content-range"]);
  const info = await resolveTabInfo(details.tabId);

  const input: ClassifyInput = {
    url: details.url,
    contentType: headers["content-type"],
    contentDisposition: headers["content-disposition"],
    contentLength: rangeTotal ?? (length ? Number(length) : undefined),
    tabId: details.tabId,
    pageUrl: info.url,
    pageTitle: info.title,
  };

  const classified = classifyResponse(input);
  if (classified) await saveMedia(classified);
}

// Registrar no topo garante que o listener sobreviva aos reinícios do worker.
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    void handleResponse(details);
  },
  { urls: ["http://*/*", "https://*/*"] },
  ["responseHeaders"],
);

// Serializa as escritas para não perder itens em requisições concorrentes.
let writeQueue: Promise<void> = Promise.resolve();

function enqueueWrite(task: () => Promise<void>): Promise<void> {
  writeQueue = writeQueue.then(task).catch((error: unknown) => {
    console.error("[media-pack] falha ao gravar mídia", error);
  });
  return writeQueue;
}

async function readList(): Promise<MediaItem[]> {
  const stored = await chrome.storage.session.get(MEDIA_KEY);
  const parsed = mediaListSchema.safeParse(stored[MEDIA_KEY]);
  return parsed.success ? parsed.data : [];
}

/** Remove itens cuja URL é uma rendição já coberta por um master HLS. */
function removeItemsByUrls(urls: string[]): Promise<void> {
  const toRemove = new Set(urls);
  if (toRemove.size === 0) return Promise.resolve();

  return enqueueWrite(async () => {
    const current = await readList();
    const next = current.filter((item) => !toRemove.has(item.url));
    if (next.length === current.length) return;
    await chrome.storage.session.set({ [MEDIA_KEY]: next });
  });
}

function saveMedia(classified: ClassifiedMedia): Promise<void> {
  return enqueueWrite(async () => {
    const current = await readList();
    if (current.some((item) => item.url === classified.url)) return;

    const candidate: MediaItem = {
      ...classified,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
    const item = mediaItemSchema.safeParse(candidate);
    if (!item.success) return;

    await chrome.storage.session.set({
      [MEDIA_KEY]: [item.data, ...current].slice(0, MAX_ITEMS),
    });

    // S1: manifestos são resolvidos em seguida (fora da fila de escrita).
    if (item.data.streamType) void enrichStream(item.data);
  });
}

/** S1: resolve os metadados do manifesto e mescla no item já salvo. */
async function enrichStream(item: MediaItem): Promise<void> {
  if (!item.streamType) return;

  try {
    const info = await resolveStreamInfo({ url: item.url, streamType: item.streamType });

    // HLS: o master "vence" — suas rendições (vídeo/áudio/legenda) não viram downloads.
    if (item.streamType === "hls") {
      const renditionUrls = info.renditionUrls ?? [];
      if (renditionUrls.length > 0) {
        for (const url of renditionUrls) knownRenditionUrls.add(url);
        await removeItemsByUrls(renditionUrls);
      } else if (knownRenditionUrls.has(item.url)) {
        await removeItemsByUrls([item.url]);
        return;
      }
    }

    await enqueueWrite(async () => {
      const current = await readList();
      const index = current.findIndex((entry) => entry.url === item.url);
      const existing = index >= 0 ? current[index] : undefined;
      if (!existing) return;

      const merged = mediaItemSchema.safeParse({
        ...existing,
        stream: { ...(existing.stream ?? {}), ...info },
        durationInSeconds: info.durationSeconds ?? existing.durationInSeconds,
        sizeInBytes: info.estimatedBytes ?? existing.sizeInBytes,
      });
      if (!merged.success) return;

      current[index] = merged.data;
      await chrome.storage.session.set({ [MEDIA_KEY]: current });
    });
  } catch (error) {
    console.error("[media-pack] falha ao resolver manifesto", error);
  }
}

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error: unknown) => console.error("[media-pack] falha ao configurar o side panel", error));

console.log("[media-pack] service worker iniciado");

// Sem efeito em produção (só ativa com VITE_EXT_AUTO_RELOAD=1 no build).
startAutoReload();
