import { z } from "../zod";

/** Categorias de mídia suportadas pela extensão. */
export const mediaKindSchema = z.enum(["image", "video", "audio", "document", "other"]);
export type MediaKind = z.infer<typeof mediaKindSchema>;

/** Um arquivo de mídia capturado/coletado pela extensão. */
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
  sourceUrl: z.url().optional(),
  pageTitle: z.string().optional(),
  createdAt: z.iso.datetime(),
});
export type MediaItem = z.infer<typeof mediaItemSchema>;
export type MediaItemInput = z.input<typeof mediaItemSchema>;
