import {
  type MediaItem,
  type MediaPrefs,
  mediaItemSchema,
  mediaPrefsSchema,
  z,
} from "@repo/protocol";

export const MEDIA_KEY = "media";
export const PREFS_KEY = "prefs";

const mediaListSchema = z.array(mediaItemSchema);

/** `chrome.*` só existe dentro da extensão (no `dev:ui` não existe). */
export function hasExtensionApi(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);
}

export async function readStoredMedia(): Promise<MediaItem[]> {
  if (!hasExtensionApi()) return [];
  const stored = await chrome.storage.session.get(MEDIA_KEY);
  const parsed = mediaListSchema.safeParse(stored[MEDIA_KEY]);
  return parsed.success ? parsed.data : [];
}

export async function clearStoredMedia(): Promise<void> {
  if (!hasExtensionApi()) return;
  await chrome.storage.session.set({ [MEDIA_KEY]: [] });
}

export function subscribeToMedia(listener: (items: MediaItem[]) => void): () => void {
  if (!hasExtensionApi()) return () => {};

  const onChanged = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string,
  ): void => {
    if (areaName !== "session") return;
    const change = changes[MEDIA_KEY];
    if (!change) return;
    const parsed = mediaListSchema.safeParse(change.newValue);
    listener(parsed.success ? parsed.data : []);
  };

  chrome.storage.onChanged.addListener(onChanged);
  return () => {
    if (hasExtensionApi()) chrome.storage.onChanged.removeListener(onChanged);
  };
}

export async function readPrefs(): Promise<MediaPrefs | null> {
  if (!hasExtensionApi()) return null;
  const stored = await chrome.storage.local.get(PREFS_KEY);
  const parsed = mediaPrefsSchema.safeParse(stored[PREFS_KEY]);
  return parsed.success ? parsed.data : null;
}

export async function writePrefs(prefs: MediaPrefs): Promise<void> {
  if (!hasExtensionApi()) return;
  await chrome.storage.local.set({ [PREFS_KEY]: prefs });
}
