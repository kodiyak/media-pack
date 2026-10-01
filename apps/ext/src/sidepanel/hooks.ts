import { DEFAULT_MEDIA_PREFS, type MediaItem, type MediaPrefs } from "@repo/protocol";
import { useCallback, useEffect, useState } from "react";
import {
  hasExtensionApi,
  readPrefs,
  readStoredMedia,
  subscribeToMedia,
  writePrefs,
} from "./lib/chrome";

/** Mídias capturadas pelo service worker (via `chrome.storage.session`). */
export function useCollectedMedia(): MediaItem[] {
  const [media, setMedia] = useState<MediaItem[]>([]);

  useEffect(() => {
    if (!hasExtensionApi()) return;

    let active = true;
    void readStoredMedia().then((items) => {
      if (active) setMedia(items);
    });
    const unsubscribe = subscribeToMedia((items) => {
      if (active) setMedia(items);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return media;
}

/** Id da aba ativa na janela atual (para o filtro "aba atual"). */
export function useCurrentTabId(): number | null {
  const [tabId, setTabId] = useState<number | null>(null);

  useEffect(() => {
    if (!hasExtensionApi()) return;

    let active = true;
    const refresh = async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (active) setTabId(tab?.id ?? null);
    };

    void refresh();
    chrome.tabs.onActivated.addListener(refresh);
    chrome.tabs.onUpdated.addListener(refresh);

    return () => {
      active = false;
      if (!hasExtensionApi()) return;
      chrome.tabs.onActivated.removeListener(refresh);
      chrome.tabs.onUpdated.removeListener(refresh);
    };
  }, []);

  return tabId;
}

/** Preferências de auto-seleção, persistidas em `chrome.storage.local`. */
export function useMediaPrefs(): [MediaPrefs, (patch: Partial<MediaPrefs>) => void] {
  const [prefs, setPrefs] = useState<MediaPrefs>(DEFAULT_MEDIA_PREFS);

  useEffect(() => {
    if (!hasExtensionApi()) return;

    let active = true;
    void readPrefs().then((stored) => {
      if (active && stored) setPrefs(stored);
    });

    return () => {
      active = false;
    };
  }, []);

  const update = useCallback((patch: Partial<MediaPrefs>) => {
    setPrefs((current) => {
      const next = { ...current, ...patch };
      void writePrefs(next);
      return next;
    });
  }, []);

  return [prefs, update];
}
