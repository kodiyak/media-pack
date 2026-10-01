import { z } from "../zod";
import { mediaItemSchema } from "./media";

/** Ciclo de vida de um "pack" de mídia. */
export const packStatusSchema = z.enum([
  "draft",
  "collecting",
  "ready",
  "exporting",
  "completed",
  "failed",
]);
export type PackStatus = z.infer<typeof packStatusSchema>;

/** Um pack agrega uma coleção de itens de mídia. */
export const packSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(120),
  description: z.string().max(1000).optional(),
  status: packStatusSchema.default("draft"),
  items: z.array(mediaItemSchema).default([]),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Pack = z.infer<typeof packSchema>;
export type PackInput = z.input<typeof packSchema>;

/** Payload para criar um pack (o resto é derivado pela aplicação). */
export const createPackInputSchema = packSchema.pick({ name: true, description: true });
export type CreatePackInput = z.infer<typeof createPackInputSchema>;
