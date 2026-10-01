/** Nome base (sem extensão) de um item de mídia/stream. */
export function streamBaseName(item: { filename?: string; title?: string }): string {
  const source = item.filename ?? item.title ?? "video";
  const withoutExtension = source.replace(/\.[^./\\]+$/, "");
  return withoutExtension || "video";
}
