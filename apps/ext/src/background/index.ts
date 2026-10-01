import { type ClassifyInput, classifyResponse, parseContentRangeTotal } from "@repo/media";
import { type ClassifiedMedia, type MediaItem, mediaItemSchema, z } from "@repo/protocol";
import { resolveStreamInfo } from "@repo/streams";

const MEDIA_KEY = "media";
const MAX_ITEMS = 2000;

const mediaListSchema = z.array(mediaItemSchema);

type TabInfo = { url?: string; title?: string };

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
