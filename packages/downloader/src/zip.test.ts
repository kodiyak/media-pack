import { describe, expect, it, vi } from "vitest";
import { createZipStream, type DownloadFile, type ZipProgressEvent } from "./zip";

function fakeFetch(payloads: Record<string, Uint8Array>): typeof globalThis.fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const payload = payloads[url];
    if (!payload) return new Response("not found", { status: 404, statusText: "Not Found" });

    return new Response(payload.buffer as ArrayBuffer, {
      status: 200,
      headers: { "content-length": String(payload.byteLength) },
    });
  }) as typeof globalThis.fetch;
}

const encode = (text: string) => new TextEncoder().encode(text);

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

describe("createZipStream", () => {
  it("empacota os arquivos e reporta progresso do arquivo e geral", async () => {
    const files: DownloadFile[] = [
      { url: "https://cdn.test/a.mp4", filename: "a.mp4" },
      { url: "https://cdn.test/b.mp4", filename: "a.mp4" },
    ];
    const events: ZipProgressEvent[] = [];

    const bytes = await readAll(
      createZipStream(files, {
        fetch: fakeFetch({
          "https://cdn.test/a.mp4": encode("AAA"),
          "https://cdn.test/b.mp4": encode("BBB"),
        }),
        onProgress: (event) => events.push(event),
      }),
    );
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

    await readAll(
      createZipStream([{ url: "https://cdn.test/missing", filename: "x.mp4" }], {
        fetch: fakeFetch({}),
        onProgress,
      }),
    );

    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ phase: "error" }));
  });
});
