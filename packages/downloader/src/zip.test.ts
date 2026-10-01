import { describe, expect, it, vi } from "vitest";
import { createZipStream, type DownloadSource, urlSource, type ZipProgressEvent } from "./zip";

const encode = (text: string) => new TextEncoder().encode(text);

/** Fonte que entrega os bytes como stream (exercita o caminho com progresso). */
function streamSource(filename: string, payload: Uint8Array): DownloadSource {
  return {
    filename,
    async open() {
      const response = new Response(payload.buffer as ArrayBuffer, {
        headers: { "content-length": String(payload.byteLength) },
      });
      return { body: response.body ?? payload, totalBytes: payload.byteLength };
    },
  };
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }

  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

describe("urlSource", () => {
  it("baixa via fetch injetável e informa o tamanho", async () => {
    const fetcher = (async () =>
      new Response(encode("ABC").buffer as ArrayBuffer, {
        status: 200,
        headers: { "content-length": "3" },
      })) as typeof globalThis.fetch;

    const opened = await urlSource("https://cdn.test/a.mp4", "a.mp4", fetcher).open();

    expect(opened.totalBytes).toBe(3);
  });
});

describe("createZipStream", () => {
  it("empacota as fontes e reporta progresso do arquivo e geral", async () => {
    const sources = [streamSource("a.mp4", encode("AAA")), streamSource("a.mp4", encode("BBB"))];
    const events: ZipProgressEvent[] = [];

    const bytes = await readAll(createZipStream(sources, { onProgress: (e) => events.push(e) }));
    const text = new TextDecoder().decode(bytes);

    expect(text.startsWith("PK")).toBe(true);
    expect(text).toContain("a.mp4");
    expect(text).toContain("a (2).mp4");
    expect(events.filter((event) => event.phase === "done")).toHaveLength(2);

    const last = events.at(-1);
    expect(last?.filePercent).toBe(100);
    expect(last?.overallPercent).toBe(100);
  });

  it("sinaliza erro e segue em frente", async () => {
    const onProgress = vi.fn<(event: ZipProgressEvent) => void>();
    const failing: DownloadSource = {
      filename: "x.mp4",
      async open() {
        throw new Error("HTTP 404 Not Found");
      },
    };

    await readAll(createZipStream([failing], { onProgress }));

    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ phase: "error" }));
  });

  it("repassa o progresso por segmento da fonte", async () => {
    const events: ZipProgressEvent[] = [];
    const source: DownloadSource = {
      filename: "v.mp4",
      async open(_signal, onProgress) {
        onProgress?.({ subIndex: 1, subTotal: 2 });
        onProgress?.({ subIndex: 2, subTotal: 2 });
        return { body: encode("MP4") };
      },
    };

    await readAll(createZipStream([source], { onProgress: (event) => events.push(event) }));

    const mid = events.find((event) => event.subIndex === 1 && event.subTotal === 2);
    expect(mid?.filePercent).toBe(50);
    expect(events.at(-1)?.filePercent).toBe(100);
  });
});
