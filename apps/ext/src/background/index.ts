import { extensionMessageSchema, type MediaItem, mediaItemSchema, z } from "@repo/protocol";

const MEDIA_KEY = "media";
const MAX_ITEMS = 200;

const mediaListSchema = z.array(mediaItemSchema);

console.log("[media-pack] service worker iniciado");

// Clique no ícone da extensão abre o side panel (Chrome 116+).
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => {
  console.error("[media-pack] falha ao configurar o side panel", error);
});

async function readMedia(): Promise<MediaItem[]> {
  const stored = await chrome.storage.local.get(MEDIA_KEY);
  const parsed = mediaListSchema.safeParse(stored[MEDIA_KEY]);
  return parsed.success ? parsed.data : [];
}

async function saveMedia(item: MediaItem): Promise<void> {
  const current = await readMedia();

  if (current.some((entry) => entry.url === item.url)) return;

  await chrome.storage.local.set({ [MEDIA_KEY]: [item, ...current].slice(0, MAX_ITEMS) });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const parsed = extensionMessageSchema.safeParse(message);

  if (!parsed.success) {
    sendResponse({ ok: false, error: "Mensagem inválida." });
    return false;
  }

  if (parsed.data.type === "media:collected") {
    saveMedia(parsed.data.payload)
      .then(() => sendResponse({ ok: true }))
      .catch((error: unknown) => sendResponse({ ok: false, error: String(error) }));
    return true; // resposta assíncrona
  }

  sendResponse({ ok: true });
  return false;
});
