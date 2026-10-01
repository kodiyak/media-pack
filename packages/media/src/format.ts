const UNITS = ["KB", "MB", "GB", "TB"] as const;

/** Formata bytes de forma curta (ex.: `1.4 MB`). */
export function formatBytes(bytes?: number): string {
  if (bytes === undefined) return "—";
  if (bytes < 1024) return `${bytes} B`;

  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }

  const digits = value >= 100 ? 0 : 1;
  return `${value.toFixed(digits)} ${UNITS[unit] ?? "KB"}`;
}
