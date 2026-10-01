import type { StreamVariant, StreamVariantPolicy } from "@repo/protocol";

/** Altura alvo da política "equilibrada". */
const BALANCED_TARGET_HEIGHT = 720;

function bandwidthOf(variant: StreamVariant): number {
  return variant.bandwidth ?? 0;
}

function heightOf(variant: StreamVariant): number {
  return variant.height ?? variant.width ?? 0;
}

/**
 * Escolhe a variante conforme a política:
 * - `best`: maior banda;
 * - `smallest`: menor banda;
 * - `balanced`: mais próxima de 720p (empate pela maior banda).
 */
export function selectVariant(
  variants: StreamVariant[],
  policy: StreamVariantPolicy,
): StreamVariant | null {
  if (variants.length === 0) return null;

  const sorted = [...variants].sort((a, b) => {
    if (policy === "balanced") {
      const distance =
        Math.abs(heightOf(a) - BALANCED_TARGET_HEIGHT) -
        Math.abs(heightOf(b) - BALANCED_TARGET_HEIGHT);
      if (distance !== 0) return distance;
    }
    return bandwidthOf(b) - bandwidthOf(a);
  });

  return policy === "smallest" ? (sorted.at(-1) ?? null) : (sorted[0] ?? null);
}

/** Rótulo curto de uma variante (ex.: `1080p · 4.0 Mb/s`). */
export function variantLabel(variant: StreamVariant): string {
  if (variant.label) return variant.label;

  const resolution =
    variant.height !== undefined
      ? `${variant.height}p`
      : variant.width !== undefined
        ? `${variant.width}px`
        : null;
  const bitrate =
    variant.bandwidth !== undefined ? `${(variant.bandwidth / 1_000_000).toFixed(1)} Mb/s` : null;

  return [resolution, bitrate].filter(Boolean).join(" · ") || "Qualidade padrão";
}
