import { z } from "../zod";
import { mediaKindSchema, streamVariantPolicySchema } from "./media";

/** Preferências usadas pelo painel para decidir o que auto-selecionar. */
export const mediaPrefsSchema = z.object({
  /** Tipos que entram marcados automaticamente. */
  autoSelectKinds: z.array(mediaKindSchema).default(["video"]),
  /** Ignora mídias menores que isso (0 = sem mínimo). */
  minSizeInBytes: z.number().int().nonnegative().default(0),
  /** Mostra apenas o que veio da aba ativa. */
  onlyCurrentTab: z.boolean().default(true),
  /** Inclui manifestos HLS/DASH na auto-seleção. */
  includeStreams: z.boolean().default(true),
  /** Qualidade preferida ao resolver manifestos HLS/DASH. */
  streamVariantPolicy: streamVariantPolicySchema.default("best"),
});
export type MediaPrefs = z.infer<typeof mediaPrefsSchema>;
export type MediaPrefsInput = z.input<typeof mediaPrefsSchema>;

/** Preferências padrão (aplicadas quando não há nada salvo). */
export const DEFAULT_MEDIA_PREFS: MediaPrefs = mediaPrefsSchema.parse({});
