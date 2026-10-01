import { z } from "../zod";
import { mediaItemSchema } from "./media";
import { createPackInputSchema, packSchema } from "./pack";

/**
 * Mensagens trocadas entre popup, content scripts e service worker
 * via `chrome.runtime.sendMessage`.
 */
export const extensionMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ping") }),
  z.object({ type: z.literal("media:collected"), payload: mediaItemSchema }),
  z.object({ type: z.literal("pack:create"), payload: createPackInputSchema }),
  z.object({ type: z.literal("pack:upsert"), payload: packSchema }),
  z.object({ type: z.literal("pack:error"), payload: z.object({ message: z.string() }) }),
]);
export type ExtensionMessage = z.infer<typeof extensionMessageSchema>;

/** Resposta padrão do service worker. */
export const extensionResponseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), data: z.unknown().optional() }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type ExtensionResponse = z.infer<typeof extensionResponseSchema>;
