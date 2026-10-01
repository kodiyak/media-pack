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

/** Formata uma duração em segundos (ex.: `12:05`, `1:02:03`). */
export function formatDuration(totalSeconds?: number): string | undefined {
  if (totalSeconds === undefined || !Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return undefined;
  }

  const seconds = Math.round(totalSeconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");

  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}
