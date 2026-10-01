import type {
  BoxKind,
  DataStream,
  ISOFile,
  Movie,
  MP4BoxBuffer,
  Sample,
  SampleEntryFourCC,
} from "mp4box";

export type MuxFmp4Options = {
  /** Limite de bytes (vídeo + áudio) aceito para o remux em memória. */
  maxBytes?: number;
};

export const DEFAULT_MUX_MAX_BYTES = 512 * 1024 * 1024;

type Mp4BoxModule = typeof import("mp4box");

type MuxSample = {
  data: Uint8Array<ArrayBuffer>;
  dts: number;
  cts: number;
  duration: number;
  isSync: boolean;
};

type DemuxedTrack = {
  kind: "video" | "audio";
  id: number;
  codec: string;
  timescale: number;
  duration: number;
  width?: number;
  height?: number;
  sampleRate?: number;
  channelCount?: number;
  sampleSize?: number;
  entryType: string;
  entryBoxes: unknown[];
  samples: MuxSample[];
};

/**
 * Junta vídeo (H.264) e áudio (AAC) de dois MP4s em um único MP4.
 *
 * Carrega o mp4box.js sob demanda (dynamic import), desmonta as duas faixas,
 * copia as caixas de codec (avcC/esds) e remonta as amostras em ordem de DTS.
 * Trabalha inteiramente em memória; respeite `DEFAULT_MUX_MAX_BYTES`.
 */
export async function muxFmp4(
  videoBytes: Uint8Array,
  audioBytes: Uint8Array,
  options: MuxFmp4Options = {},
): Promise<Uint8Array> {
  const maxBytes = options.maxBytes ?? DEFAULT_MUX_MAX_BYTES;
  if (videoBytes.byteLength + audioBytes.byteLength > maxBytes) {
    throw new Error("Mídia grande demais para remuxar com áudio.");
  }

  const mp4box = await import("mp4box");
  const video = await demuxTrack(mp4box, videoBytes, "video");
  const audio = await demuxTrack(mp4box, audioBytes, "audio");

  validateCodec(video, "avc");
  validateCodec(audio, "mp4a");

  return remux(mp4box, video, audio);
}

function demuxTrack(
  mp4box: Mp4BoxModule,
  bytes: Uint8Array,
  expectedKind: "video" | "audio",
): Promise<DemuxedTrack> {
  return new Promise((resolve, reject) => {
    const file = mp4box.createFile();
    const samples: MuxSample[] = [];
    let info: DemuxedTrack | undefined;
    let settled = false;

    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      reject(new Error(message));
    };

    file.onError = (error: unknown) => fail(String(error));

    file.onReady = (movie: Movie) => {
      const track = pickTrack(movie, expectedKind);
      if (!track) {
        fail("Faixa ausente no MP4.");
        return;
      }

      const trak = findTrak(file, track.id);
      const entry = trak?.mdia?.minf?.stbl?.stsd?.entries?.[0] as
        | { type?: string; boxes?: unknown[] }
        | undefined;
      info = {
        kind: expectedKind,
        id: track.id,
        codec: track.codec ?? "",
        timescale: track.timescale || 1,
        duration: track.duration ?? 0,
        width: track.video?.width,
        height: track.video?.height,
        sampleRate: track.audio?.sample_rate,
        channelCount: track.audio?.channel_count,
        sampleSize: track.audio?.sample_size,
        entryType: entry?.type ?? (expectedKind === "video" ? "avc1" : "mp4a"),
        entryBoxes: entry?.boxes ? [...entry.boxes] : [],
        samples,
      };

      file.setExtractionOptions(track.id, null, { nbSamples: 1000 });
      file.start();
    };

    file.onSamples = (_id: number, _user: unknown, batch: Sample[]) => {
      for (const sample of batch) {
        if (!sample.data) continue;
        samples.push({
          data: new Uint8Array(sample.data),
          dts: sample.dts,
          cts: sample.cts,
          duration: sample.duration,
          isSync: sample.is_sync === true,
        });
      }
    };

    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as MP4BoxBuffer;
    buffer.fileStart = 0;
    file.appendBuffer(buffer);
    file.flush();

    setTimeout(() => {
      if (settled) return;
      settled = true;
      if (!info) {
        reject(new Error("Não foi possível ler os metadados do MP4."));
        return;
      }
      if (samples.length === 0) {
        reject(new Error("Nenhuma amostra encontrada no MP4."));
        return;
      }
      resolve(info);
    }, 0);
  });
}

function remux(mp4box: Mp4BoxModule, video: DemuxedTrack, audio: DemuxedTrack): Uint8Array {
  const out = mp4box.createFile();
  out.init();

  out.addTrack({
    type: video.entryType as SampleEntryFourCC,
    hdlr: "vide",
    width: video.width ?? 0,
    height: video.height ?? 0,
    timescale: video.timescale,
    media_duration: video.duration,
    description_boxes: video.entryBoxes as BoxKind[],
  });
  out.addTrack({
    type: audio.entryType as SampleEntryFourCC,
    hdlr: "soun",
    channel_count: audio.channelCount ?? 2,
    samplesize: audio.sampleSize ?? 16,
    samplerate: audio.sampleRate ?? 44100,
    timescale: audio.timescale,
    media_duration: audio.duration,
    description_boxes: audio.entryBoxes as BoxKind[],
  });

  const moov = out.moov as unknown as { traks: Array<{ tkhd: { track_id: number } }> };
  const videoId = moov.traks[0]?.tkhd.track_id;
  const audioId = moov.traks[1]?.tkhd.track_id;
  if (videoId === undefined || audioId === undefined) {
    throw new Error("Falha ao criar as faixas do arquivo remuxado.");
  }

  const merged = mergeSamples(video, audio, videoId, audioId);
  for (const sample of merged) {
    out.addSample(sample.trackId, sample.data, {
      duration: sample.duration,
      cts: sample.cts,
      dts: sample.dts,
      is_sync: sample.isSync,
      sample_description_index: 1,
    });
  }

  out.flush();
  return dataStreamToBytes(out.getBuffer());
}

function mergeSamples(
  video: DemuxedTrack,
  audio: DemuxedTrack,
  videoId: number,
  audioId: number,
): Array<{
  trackId: number;
  data: Uint8Array<ArrayBuffer>;
  dts: number;
  cts: number;
  duration: number;
  isSync: boolean;
}> {
  const videoItems = video.samples.map((sample) => ({
    trackId: videoId,
    data: sample.data,
    dts: sample.dts,
    cts: sample.cts,
    duration: sample.duration,
    isSync: sample.isSync,
    time: sample.dts / video.timescale,
    order: 0,
  }));
  const audioItems = audio.samples.map((sample) => ({
    trackId: audioId,
    data: sample.data,
    dts: sample.dts,
    cts: sample.cts,
    duration: sample.duration,
    isSync: sample.isSync,
    time: sample.dts / audio.timescale,
    order: 1,
  }));

  return [...videoItems, ...audioItems]
    .sort((a, b) => a.time - b.time || a.order - b.order)
    .map(({ time: _time, order: _order, ...sample }) => sample);
}

function pickTrack(movie: Movie, kind: "video" | "audio") {
  return (
    movie.tracks.find((track) => kindOf(track) === kind) ??
    (kind === "video" ? movie.tracks[0] : movie.tracks[movie.tracks.length - 1])
  );
}

function kindOf(track: Movie["tracks"][number]): "video" | "audio" | undefined {
  if (track.video) return "video";
  if (track.audio) return "audio";
  const codec = track.codec ?? "";
  if (codec.startsWith("avc") || codec.startsWith("hvc") || codec.startsWith("hev")) return "video";
  if (codec.startsWith("mp4a") || codec.startsWith("ac-") || codec.startsWith("ec-"))
    return "audio";
  return undefined;
}

function validateCodec(track: DemuxedTrack, prefix: string): void {
  if (!track.codec.toLowerCase().startsWith(prefix)) {
    throw new Error(`Codec não suportado para remux: ${track.codec || "desconhecido"}.`);
  }
}

function findTrak(file: ISOFile, id: number) {
  const moov = file.moov as unknown as {
    traks?: Array<{
      tkhd?: { track_id?: number };
      mdia?: { minf?: { stbl?: { stsd?: { entries?: unknown[] } } } };
    }>;
  };
  return moov.traks?.find((trak) => trak.tkhd?.track_id === id);
}

function dataStreamToBytes(stream: DataStream): Uint8Array {
  const total = stream.getPosition();
  stream.seek(0);
  return stream.mapUint8Array(total);
}
