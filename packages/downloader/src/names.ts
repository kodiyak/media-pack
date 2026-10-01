/** Garante nomes únicos dentro de um destino (evita sobrescrever arquivos). */
export function uniqueEntryName(used: Set<string>, filename: string): string {
  const safe = sanitizeEntryName(filename);
  if (!used.has(safe)) {
    used.add(safe);
    return safe;
  }

  const dot = safe.lastIndexOf(".");
  const base = dot > 0 ? safe.slice(0, dot) : safe;
  const extension = dot > 0 ? safe.slice(dot) : "";

  let counter = 2;
  let candidate = `${base} (${counter})${extension}`;
  while (used.has(candidate)) {
    counter += 1;
    candidate = `${base} (${counter})${extension}`;
  }

  used.add(candidate);
  return candidate;
}

/** Remove separadores de caminho e caracteres problemáticos. */
export function sanitizeEntryName(name: string): string {
  const cleaned = name
    .replace(/[\\/]+/g, "_")
    .replace(/[<>:"|?*]/g, "_")
    .replace(/\p{Cc}/gu, "_")
    .trim();
  return cleaned.slice(0, 180) || "arquivo";
}
