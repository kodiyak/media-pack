/** Helpers compartilhados pela leitura de manifestos HLS/DASH. */

/** Resolve uma URI relativa contra a URL base do manifesto. */
export function resolveUrl(uri: string, baseUrl: string): string | undefined {
  try {
    return new URL(uri, baseUrl).href;
  } catch {
    return undefined;
  }
}

/** Converte um valor possivelmente string em inteiro positivo. */
export function positiveInt(value: unknown): number | undefined {
  const numeric =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : undefined;
}

/** Normaliza um valor XML textual em string. */
export function asString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return undefined;
}

/** Garante um array a partir de um valor único, array ou ausente. */
export function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Estimativa de tamanho a partir de bitrate (bits/s) e duração (s). */
export function estimateBytes(bandwidth?: number, durationSeconds?: number): number | undefined {
  if (!bandwidth || !durationSeconds) return undefined;
  return Math.round((bandwidth / 8) * durationSeconds);
}

const ISO_DURATION = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?)?$/;

/** Converte uma duração ISO-8601 (`PT1H2M3S`) em segundos. */
export function parseIsoDuration(value?: string): number | undefined {
  if (!value) return undefined;

  const match = ISO_DURATION.exec(value);
  if (!match) return undefined;

  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  const seconds = Number(match[4] ?? 0);
  const total = days * 86_400 + hours * 3600 + minutes * 60 + seconds;

  return Number.isFinite(total) ? total : undefined;
}
