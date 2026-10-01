import type { MediaItem, MediaPrefs } from "@repo/protocol";

/** Regra de auto-seleção com base nas preferências do painel. */
export function shouldAutoSelect(item: MediaItem, prefs: MediaPrefs): boolean {
  if (!prefs.autoSelectKinds.includes(item.kind)) return false;
  if (item.streamType && !prefs.includeStreams) return false;
  if (
    prefs.minSizeInBytes > 0 &&
    item.sizeInBytes !== undefined &&
    item.sizeInBytes < prefs.minSizeInBytes
  ) {
    return false;
  }
  return true;
}

/** Filtro por aba (itens sem `tabId` são sempre mantidos). */
export function matchesTab(
  item: MediaItem,
  currentTabId: number | null,
  onlyCurrentTab: boolean,
): boolean {
  if (!onlyCurrentTab || currentTabId === null) return true;
  return item.tabId === undefined || item.tabId === currentTabId;
}

/** Filtro de busca textual (nome, URL ou título da página). */
export function matchesQuery(item: MediaItem, query: string): boolean {
  const term = query.trim().toLowerCase();
  if (!term) return true;
  return (
    (item.filename ?? "").toLowerCase().includes(term) ||
    item.url.toLowerCase().includes(term) ||
    (item.pageTitle ?? "").toLowerCase().includes(term)
  );
}
