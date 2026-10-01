import type { Movie, MP4BoxBuffer } from "mp4box";
import { createFile } from "mp4box";
import { describe, expect, it } from "vitest";
import { DEFAULT_MUX_MAX_BYTES, muxFmp4 } from "./mp4box";

const AVC_CONFIG = new Uint8Array([
  0x01, 0x42, 0x00, 0x1f, 0xff, 0xe1, 0x00, 0x02, 0x67, 0x42, 0x01, 0x00, 0x02, 0x68, 0x92,
]);

function dataStreamToBytes(stream: {
  getPosition(): number;
  seek(o: number): void;
  mapUint8Array(l: number): Uint8Array;
}) {
  const total = stream.getPosition();
  stream.seek(0);
  return stream.mapUint8Array(total);
}

/** Cria um MP4 progressivo com uma única faixa, para servir de entrada do mux. */
function buildTestMp4(
  track: Parameters<ReturnType<typeof createFile>["addTrack"]>[0] & { type: string; hdlr: string },
  samples: Array<{
    data: Uint8Array<ArrayBuffer>;
    dts: number;
    cts: number;
    duration: number;
    isSync: boolean;
  }>,
): Uint8Array {
  const file = createFile();
  file.init();
  file.addTrack(track as never);
  const moov = file.moov as unknown as { traks: Array<{ tkhd: { track_id: number } }> };
  const id = moov.traks[moov.traks.length - 1]?.tkhd.track_id;
  for (const sample of samples) {
    file.addSample(id as number, sample.data, {
      duration: sample.duration,
      cts: sample.cts,
      dts: sample.dts,
      is_sync: sample.isSync,
    });
  }
  file.flush();
  return dataStreamToBytes(file.getBuffer());
}

type ParsedInfo = {
  tracks: Array<{ codec: string; nbSamples: number; boxes: string[] }>;
};

function parseBack(bytes: Uint8Array): Promise<ParsedInfo> {
  return new Promise((resolve, reject) => {
    const file = createFile();
    const infos: ParsedInfo["tracks"] = [];
    let ready: Movie | undefined;

    file.onError = (error: unknown) => reject(new Error(String(error)));
    file.onReady = (movie: Movie) => {
      ready = movie;
      const moov = file.moov as unknown as {
        traks?: Array<{
          tkhd?: { track_id?: number };
          mdia?: {
            minf?: {
              stbl?: {
                stsd?: { entries?: Array<{ type?: string; boxes?: Array<{ type?: string }> }> };
              };
            };
          };
        }>;
      };
      for (const track of movie.tracks) {
        const trak = moov.traks?.find((entry) => entry.tkhd?.track_id === track.id);
        const entry = trak?.mdia?.minf?.stbl?.stsd?.entries?.[0];
        infos.push({
          codec: track.codec ?? "",
          nbSamples: track.nb_samples ?? 0,
          boxes: (entry?.boxes ?? []).map((box) => box.type ?? ""),
        });
      }
      file.setExtractionOptions(movie.tracks[0]?.id as number, null, { nbSamples: 1000 });
      file.start();
    };

    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as MP4BoxBuffer;
    buffer.fileStart = 0;
    file.appendBuffer(buffer);
    file.flush();

    setTimeout(() => {
      if (!ready) {
        reject(new Error("onReady não disparou."));
        return;
      }
      resolve({ tracks: infos });
    }, 0);
  });
}

describe("muxFmp4", () => {
  it("remuxa vídeo (avc1) e áudio (mp4a) em um único MP4", async () => {
    const video = buildTestMp4(
      {
        type: "avc1",
        hdlr: "vide",
        width: 64,
        height: 48,
        timescale: 30,
        avcDecoderConfigRecord: AVC_CONFIG.buffer,
      },
      [
        {
          data: new Uint8Array([0, 0, 0, 1, 0x65, 0x80]),
          dts: 0,
          cts: 0,
          duration: 1,
          isSync: true,
        },
        {
          data: new Uint8Array([0, 0, 0, 1, 0x41, 0x90]),
          dts: 1,
          cts: 1,
          duration: 1,
          isSync: false,
        },
      ],
    );
    const audio = buildTestMp4(
      {
        type: "mp4a",
        hdlr: "soun",
        channel_count: 2,
        samplesize: 16,
        samplerate: 44100,
        timescale: 44100,
      },
      [
        { data: new Uint8Array([0x21, 0x10]), dts: 0, cts: 0, duration: 1024, isSync: true },
        { data: new Uint8Array([0x21, 0x11]), dts: 1024, cts: 1024, duration: 1024, isSync: true },
      ],
    );

    const muxed = await muxFmp4(video, audio);
    const parsed = await parseBack(muxed);

    expect(parsed.tracks).toHaveLength(2);
    expect(parsed.tracks[0]?.codec.startsWith("avc")).toBe(true);
    expect(parsed.tracks[0]?.nbSamples).toBe(2);
    expect(parsed.tracks[0]?.boxes).toContain("avcC");
    expect(parsed.tracks[1]?.codec.startsWith("mp4a")).toBe(true);
    expect(parsed.tracks[1]?.nbSamples).toBe(2);
  });

  it("recusa quando o total passa do limite configurado", async () => {
    const video = buildTestMp4(
      { type: "avc1", hdlr: "vide", width: 64, height: 48, timescale: 30 },
      [{ data: new Uint8Array([0, 0, 0, 1, 0x65]), dts: 0, cts: 0, duration: 1, isSync: true }],
    );
    const audio = buildTestMp4(
      {
        type: "mp4a",
        hdlr: "soun",
        channel_count: 2,
        samplesize: 16,
        samplerate: 44100,
        timescale: 44100,
      },
      [{ data: new Uint8Array([0x21, 0x10]), dts: 0, cts: 0, duration: 1024, isSync: true }],
    );

    await expect(muxFmp4(video, audio, { maxBytes: 10 })).rejects.toThrow(/grande demais/);
  });

  it("recusa codec de áudio fora do whitelist (avc como áudio)", async () => {
    const video = buildTestMp4(
      { type: "avc1", hdlr: "vide", width: 64, height: 48, timescale: 30 },
      [{ data: new Uint8Array([0, 0, 0, 1, 0x65]), dts: 0, cts: 0, duration: 1, isSync: true }],
    );
    // Passa um MP4 de vídeo no lugar do áudio: codec avc1 → não mp4a.
    await expect(muxFmp4(video, video)).rejects.toThrow(/Codec não suportado/);
  });

  it("expõe o limite padrão para o fallback do downloader", () => {
    expect(DEFAULT_MUX_MAX_BYTES).toBe(512 * 1024 * 1024);
  });
});
