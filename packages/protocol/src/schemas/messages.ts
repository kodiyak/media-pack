import { z } from "../zod";
import { streamContainerSchema, streamTypeSchema, streamVariantPolicySchema } from "./media";

/** Plano DASH serializável enviado ao documento offscreen. */
export const preparedTrackPlanSchema = z.object({
  container: streamContainerSchema,
  segments: z.array(
    z.object({
      url: z.url(),
      byteRange: z
        .object({
          offset: z.number().int().nonnegative(),
          length: z.number().int().positive(),
        })
        .optional(),
    }),
  ),
  initUrl: z.url().optional(),
  singleUrl: z.url().optional(),
});
export type PreparedTrackPlan = z.infer<typeof preparedTrackPlanSchema>;

/** Solicita a conversão de uma única entrada, somente após o clique em Baixar. */
export const streamPrepareRequestSchema = z.object({
  type: z.literal("streams.prepare"),
  requestId: z.uuid(),
  url: z.url(),
  streamType: streamTypeSchema,
  policy: streamVariantPolicySchema,
  filename: z.string().min(1),
  track: preparedTrackPlanSchema.optional(),
});
export type StreamPrepareRequest = z.infer<typeof streamPrepareRequestSchema>;

/** Variante interna, aceita apenas pelo documento offscreen. */
export const streamPrepareOffscreenRequestSchema = streamPrepareRequestSchema.extend({
  type: z.literal("streams.prepare.offscreen"),
});
export type StreamPrepareOffscreenRequest = z.infer<typeof streamPrepareOffscreenRequestSchema>;

/** Cancela a conversão ativa no offscreen. */
export const streamCancelRequestSchema = z.object({
  type: z.literal("streams.cancel"),
  requestId: z.uuid(),
});
export type StreamCancelRequest = z.infer<typeof streamCancelRequestSchema>;

export const streamCancelOffscreenRequestSchema = streamCancelRequestSchema.extend({
  type: z.literal("streams.cancel.offscreen"),
});
export type StreamCancelOffscreenRequest = z.infer<typeof streamCancelOffscreenRequestSchema>;

export const preparedFileSchema = z.object({
  name: z.string().min(1),
  filename: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
});
export type PreparedFile = z.infer<typeof preparedFileSchema>;

export const streamPrepareResponseSchema = z.object({
  requestId: z.uuid(),
  ok: z.boolean(),
  file: preparedFileSchema.optional(),
  error: z.string().optional(),
});
export type StreamPrepareResponse = z.infer<typeof streamPrepareResponseSchema>;

export const streamProgressMessageSchema = z.object({
  type: z.literal("streams.progress"),
  requestId: z.uuid(),
  subIndex: z.number().int().nonnegative(),
  subTotal: z.number().int().positive(),
});
export type StreamProgressMessage = z.infer<typeof streamProgressMessageSchema>;
