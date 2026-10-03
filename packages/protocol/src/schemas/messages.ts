import { z } from "../zod";
import { mediaItemSchema, streamVariantPolicySchema } from "./media";

/** Handshake: o documento offscreen avisa que já registrou seus listeners. */
export const offscreenReadyMessageSchema = z.object({
  type: z.literal("streams.ready"),
});
export type OffscreenReadyMessage = z.infer<typeof offscreenReadyMessageSchema>;

/** Pedido de fechamento do documento offscreen. */
export const offscreenCloseMessageSchema = z.object({
  type: z.literal("streams.close"),
});
export type OffscreenCloseMessage = z.infer<typeof offscreenCloseMessageSchema>;

/** Ciclo de vida de um job de download. */
export const downloadStatusSchema = z.enum(["running", "ready", "done", "error", "cancelled"]);
export type DownloadStatus = z.infer<typeof downloadStatusSchema>;

/**
 * Estado observável de um job de download. Fica em `chrome.storage.session`
 * para que o side panel se reconecte mesmo depois de fechado e reaberto.
 */
export const downloadJobStateSchema = z.object({
  jobId: z.uuid(),
  /** Aba que iniciou o job (para o painel mostrar só o job da aba ativa). */
  tabId: z.number().int().optional(),
  status: downloadStatusSchema,
  zipName: z.string().min(1),
  total: z.number().int().nonnegative(),
  index: z.number().int().nonnegative(),
  filename: z.string(),
  loadedBytes: z.number().nonnegative(),
  totalBytes: z.number().nonnegative().optional(),
  filePercent: z.number().min(0).max(100),
  overallPercent: z.number().min(0).max(100),
  subIndex: z.number().int().nonnegative().optional(),
  subTotal: z.number().int().positive().optional(),
  /** ZIP temporário no OPFS (fallback quando não dá para gravar direto no disco). */
  stagedName: z.string().optional(),
  error: z.string().optional(),
  updatedAt: z.iso.datetime(),
});
export type DownloadJobState = z.infer<typeof downloadJobStateSchema>;

/** Mapa `jobId → estado`, persistido em `chrome.storage.session`. */
export const downloadJobsSchema = z.record(z.string(), downloadJobStateSchema);
export type DownloadJobs = z.infer<typeof downloadJobsSchema>;

/** Inicia um download em lote; a lista de itens é totalmente serializável. */
export const downloadStartRequestSchema = z.object({
  type: z.literal("downloads.start"),
  jobId: z.uuid(),
  tabId: z.number().int(),
  zipName: z.string().min(1),
  items: z.array(mediaItemSchema),
  policy: streamVariantPolicySchema,
});
export type DownloadStartRequest = z.infer<typeof downloadStartRequestSchema>;

/** Variante interna, aceita apenas pelo documento offscreen. */
export const downloadStartOffscreenRequestSchema = downloadStartRequestSchema.extend({
  type: z.literal("downloads.start.offscreen"),
});
export type DownloadStartOffscreenRequest = z.infer<typeof downloadStartOffscreenRequestSchema>;

/** Cancela o job de download ativo no offscreen. */
export const downloadCancelRequestSchema = z.object({
  type: z.literal("downloads.cancel"),
  jobId: z.uuid(),
});
export type DownloadCancelRequest = z.infer<typeof downloadCancelRequestSchema>;

export const downloadCancelOffscreenRequestSchema = downloadCancelRequestSchema.extend({
  type: z.literal("downloads.cancel.offscreen"),
});
export type DownloadCancelOffscreenRequest = z.infer<typeof downloadCancelOffscreenRequestSchema>;

/** Remove um job finalizado do estado persistido (ex.: após salvar o ZIP staged). */
export const downloadDismissRequestSchema = z.object({
  type: z.literal("downloads.dismiss"),
  jobId: z.uuid(),
});
export type DownloadDismissRequest = z.infer<typeof downloadDismissRequestSchema>;

/** Atualização de estado emitida pelo offscreen (progresso + transições). */
export const downloadStateMessageSchema = z.object({
  type: z.literal("downloads.state"),
  state: downloadJobStateSchema,
});
export type DownloadStateMessage = z.infer<typeof downloadStateMessageSchema>;
