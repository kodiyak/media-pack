/**
 * mux.js 6.x não publica tipos. Declaração mínima do que usamos:
 * `new muxjs.mp4.Transmuxer().push(...)` emitindo `data`/`initSegment`.
 */
declare module "mux.js" {
  export type MuxTransmuxedSegment = {
    initSegment?: Uint8Array;
    data?: Uint8Array;
    type?: string;
  };

  export class Transmuxer {
    constructor(options?: { keepOriginalTimestamps?: boolean; remux?: boolean });
    on(event: "data", handler: (segment: MuxTransmuxedSegment) => void): void;
    on(event: "done", handler: () => void): void;
    push(bytes: Uint8Array): void;
    flush(): void;
  }

  const muxjs: {
    mp4: { Transmuxer: typeof Transmuxer };
  };

  export default muxjs;
}
