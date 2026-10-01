import type { MediaItem, MediaKind, MediaPrefs } from "@repo/protocol";

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

/**
 * Filtro de visibilidade por tipo: mostra apenas os tipos marcados.
 * Sem nenhum tipo marcado, mostra tudo.
 */
export function matchesKind(item: MediaItem, autoSelectKinds: MediaKind[]): boolean {
  if (autoSelectKinds.length === 0) return true;
  return autoSelectKinds.includes(item.kind);
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
