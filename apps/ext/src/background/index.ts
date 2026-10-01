import { type ClassifyInput, classifyResponse, parseContentRangeTotal } from "@repo/media";
import {
  type ClassifiedMedia,
  type MediaItem,
  mediaItemSchema,
  type StreamCancelRequest,
  type StreamPrepareRequest,
  streamCancelRequestSchema,
  streamPrepareRequestSchema,
  streamPrepareResultMessageSchema,
  z,
} from "@repo/protocol";
import { resolveStreamInfo } from "@repo/streams";

const MEDIA_KEY = "media";
const MAX_ITEMS = 2000;

const mediaListSchema = z.array(mediaItemSchema);

/** URLs de rendições (variantes/áudio/legenda) já cobertas por uma master playlist. */
const knownRenditionUrls = new Set<string>();

type TabInfo = { url?: string; title?: string };

type OffscreenContext = { contextType?: string; documentUrl?: string };
type OffscreenApi = {
  createDocument(options: {
    url: string;
    reasons: ["WORKERS"];
    justification: string;
  }): Promise<void>;
  closeDocument(): Promise<void>;
};
type RuntimeWithContexts = typeof chrome.runtime & {
  getContexts?: (filter: {
    contextTypes: string[];
    documentUrls?: string[];
  }) => Promise<OffscreenContext[]>;
};

const offscreenApi = (chrome as unknown as { offscreen?: OffscreenApi }).offscreen;
const runtimeWithContexts = chrome.runtime as RuntimeWithContexts;
const offscreenUrl = chrome.runtime.getURL("offscreen.html");
let offscreenReady = false;
const pendingPrepares = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (error: unknown) => void }
>();

/** Cria o documento offscreen somente quando o usuário inicia um download. */
async function ensureOffscreen(): Promise<void> {
  if (offscreenReady) return;
  if (!offscreenApi) throw new Error("A API offscreen não está disponível.");

  const contexts = runtimeWithContexts.getContexts
    ? await runtimeWithContexts.getContexts({
        contextTypes: ["OFFSCREEN_DOCUMENT"],
        documentUrls: [offscreenUrl],
      })
    : [];

  if (!contexts.some((context) => context.documentUrl === offscreenUrl)) {
    await offscreenApi.createDocument({
      url: "offscreen.html",
      reasons: ["WORKERS"],
      justification: "Converter streams somente durante um download iniciado pelo usuário.",
    });
  }
  offscreenReady = true;
}

async function closeOffscreen(): Promise<void> {
  if (!offscreenReady || !offscreenApi) return;
  offscreenReady = false;
  await offscreenApi.closeDocument().catch(() => {});
}

async function forwardStreamPrepare(request: StreamPrepareRequest): Promise<unknown> {
  await ensureOffscreen();

  const result = new Promise<unknown>((resolve, reject) => {
    pendingPrepares.set(request.requestId, { resolve, reject });
  });

  try {
    sendWithoutResponse({
      ...request,
      type: "streams.prepare.offscreen",
    });
    return await withTimeout(result, 10 * 60 * 1000, "Tempo limite da conversão offscreen.");
  } finally {
    pendingPrepares.delete(request.requestId);
    await closeOffscreen();
  }
}

async function forwardStreamCancel(request: StreamCancelRequest): Promise<unknown> {
  if (!offscreenReady) return { ok: true };
  sendWithoutResponse({
    ...request,
    type: "streams.cancel.offscreen",
  });
  return { ok: true };
}

function sendWithoutResponse(message: unknown): void {
  chrome.runtime.sendMessage(message, () => {
    void chrome.runtime.lastError;
  });
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
  const result = streamPrepareResultMessageSchema.safeParse(message);
  if (result.success) {
    pendingPrepares.get(result.data.requestId)?.resolve(result.data);
    return false;
  }

  const prepare = streamPrepareRequestSchema.safeParse(message);
  if (prepare.success) {
    void forwardStreamPrepare(prepare.data)
      .then(sendResponse)
      .catch((error: unknown) =>
        sendResponse({
          requestId: prepare.data.requestId,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    return true;
  }

  const cancel = streamCancelRequestSchema.safeParse(message);
  if (cancel.success) {
    void forwardStreamCancel(cancel.data)
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
