import { z } from "../zod";

/** Categorias de mídia que a extensão identifica e permite auto-selecionar. */
export const mediaKindSchema = z.enum(["image", "video", "audio", "document", "archive", "other"]);
export type MediaKind = z.infer<typeof mediaKindSchema>;

/** Formatos de streaming (manifesto). Os segmentos são tratados à parte. */
export const streamTypeSchema = z.enum(["hls", "dash"]);
export type StreamType = z.infer<typeof streamTypeSchema>;

/** Como o manifesto entrega os segmentos. */
export const streamContainerSchema = z.enum(["ts", "fmp4"]);
export type StreamContainer = z.infer<typeof streamContainerSchema>;

/** Proteção do stream (AES-128 é suportado; SAMPLE-AES ainda não). */
export const streamEncryptionSchema = z.enum(["none", "aes-128", "sample-aes"]);
export type StreamEncryption = z.infer<typeof streamEncryptionSchema>;

/** Uma qualidade/representação disponível no manifesto. */
export const streamVariantSchema = z.object({
  url: z.url().optional(),
  bandwidth: z.number().int().positive().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  codecs: z.string().optional(),
  label: z.string().optional(),
});
export type StreamVariant = z.infer<typeof streamVariantSchema>;

/** Metadados resolvidos de um manifesto HLS/DASH (etapa S1). */
export const streamInfoSchema = z.object({
  container: streamContainerSchema.optional(),
  encryption: streamEncryptionSchema.optional(),
  live: z.boolean().optional(),
  segmentCount: z.number().int().nonnegative().optional(),
  durationSeconds: z.number().nonnegative().optional(),
  estimatedBytes: z.number().int().nonnegative().optional(),
  variants: z.array(streamVariantSchema).optional(),
  selectedVariantUrl: z.url().optional(),
  renditionUrls: z.array(z.url()).optional(),
  resolvedAt: z.iso.datetime().optional(),
});
export type StreamInfo = z.infer<typeof streamInfoSchema>;

/** Política de escolha de qualidade (variante) usada pela UI. */
export const streamVariantPolicySchema = z.enum(["best", "balanced", "smallest"]);
export type StreamVariantPolicy = z.infer<typeof streamVariantPolicySchema>;

/** Estado da conversão de um manifesto para MP4 (Fase B). */
export const conversionStatusSchema = z.enum(["pending", "converting", "ready", "error"]);
export type ConversionStatus = z.infer<typeof conversionStatusSchema>;

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
  /** Metadados resolvidos do manifesto (etapa S1). */
  stream: streamInfoSchema.optional(),
  /** Estado da conversão para MP4 (Fase B). */
  conversionStatus: conversionStatusSchema.optional(),
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
