/// <reference path="./muxjs.d.ts" />

/** Tipos mínimos da API do mux.js usada para TS → fMP4. */

export type TransmuxedSegment = {
  initSegment?: Uint8Array;
  data?: Uint8Array;
  type?: string;
};

export type TransmuxerLike = {
  on(event: "data", handler: (segment: TransmuxedSegment) => void): void;
  push(bytes: Uint8Array): void;
  flush(): void;
};

export type CreateTransmuxer = () => TransmuxerLike | Promise<TransmuxerLike>;

/** Fábrica real (lazy): só carrega o mux.js quando for de fato transmuxar. */
export async function createMuxTransmuxer(): Promise<TransmuxerLike> {
  const module = await import("mux.js");
  const Transmuxer = module.default.mp4.Transmuxer;
  return new Transmuxer({ keepOriginalTimestamps: true }) as TransmuxerLike;
}
