import { z } from "../zod";

/** Categorias de mídia que a extensão identifica e permite auto-selecionar. */
export const mediaKindSchema = z.enum(["image", "video", "audio", "document", "archive", "other"]);
export type MediaKind = z.infer<typeof mediaKindSchema>;

/** Formatos de streaming (manifesto). Os segmentos são tratados à parte. */
export const streamTypeSchema = z.enum(["hls", "dash"]);
export type StreamType = z.infer<typeof streamTypeSchema>;

/** Um arquivo de mídia identificado durante o carregamento das páginas. */
export const mediaItemSchema = z.object({
  id: z.uuid(),
  url: z.url(),
  kind: mediaKindSchema,
  mimeType: z.string().min(1).optional(),
  filename: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  sizeInBytes: z.number().int().nonnegative().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  durationInSeconds: z.number().nonnegative().optional(),
  posterUrl: z.url().optional(),
  /** Presente quando o item é um manifesto HLS/DASH, não o vídeo em si. */
  streamType: streamTypeSchema.optional(),
  /** Aba que originou a requisição (para o filtro "aba atual"). */
  tabId: z.number().int().optional(),
  /** URL da página onde a mídia apareceu. */
  sourceUrl: z.url().optional(),
  pageTitle: z.string().optional(),
  createdAt: z.iso.datetime(),
});
export type MediaItem = z.infer<typeof mediaItemSchema>;
export type MediaItemInput = z.input<typeof mediaItemSchema>;

/** Item que ainda não recebeu `id`/`createdAt` (saída da classificação). */
export type ClassifiedMedia = Omit<MediaItem, "id" | "createdAt">;
