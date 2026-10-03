import {
  DEFAULT_MEDIA_PREFS,
  type DownloadJobState,
  downloadJobsSchema,
  type MediaItem,
  type MediaPrefs,
} from "@repo/protocol";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DOWNLOAD_KEY,
  hasExtensionApi,
  readDownloadJobs,
  readPrefs,
  readStoredMedia,
  subscribeToMedia,
  writePrefs,
} from "./lib/chrome";
import { subscribeToDownloadState } from "./lib/downloads";

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

/**
 * Job de download da aba informada. O painel guarda todos os estados (mapa) e
 * filtra pela aba ativa, de modo que trocar de aba troca o job exibido — e
 * downloads de outras abas continuam rodando em segundo plano. A reconexão
 * funciona lendo o snapshot persistido no storage e acompanhando o offscreen.
 */
export function useDownloadJob(
  tabId: number | null,
): [DownloadJobState | null, (state: DownloadJobState | null) => void] {
  const [jobs, setJobs] = useState<DownloadJobState[]>([]);

  useEffect(() => {
    if (!hasExtensionApi()) return;

    let active = true;
    void readDownloadJobs().then((stored) => {
      if (active) setJobs(stored);
    });

    const upsert = (state: DownloadJobState): void => {
      if (!active) return;
      setJobs((current) => {
        const index = current.findIndex((job) => job.jobId === state.jobId);
        if (index < 0) return [...current, state];
        const next = current.slice();
        next[index] = state;
        return next;
      });
    };

    const unsubscribe = subscribeToDownloadState(upsert);

    const onChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ): void => {
      if (areaName !== "session") return;
      const change = changes[DOWNLOAD_KEY];
      if (!change) return;
      const parsed = downloadJobsSchema.safeParse(change.newValue);
      if (active) setJobs(parsed.success ? Object.values(parsed.data) : []);
    };
    chrome.storage.onChanged.addListener(onChanged);

    return () => {
      active = false;
      unsubscribe();
      if (hasExtensionApi()) chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  const job = useMemo(() => jobs.find((entry) => entry.tabId === tabId) ?? null, [jobs, tabId]);

  const setJob = useCallback(
    (state: DownloadJobState | null) => {
      setJobs((current) => {
        if (!state) return current.filter((entry) => entry.tabId !== tabId);
        const index = current.findIndex((entry) => entry.jobId === state.jobId);
        if (index < 0) return [...current, state];
        const next = current.slice();
        next[index] = state;
        return next;
      });
    },
    [tabId],
  );

  return [job, setJob];
}
