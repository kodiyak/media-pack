import { describe, expect, it, vi } from "vitest";
import { createZipStream, type DownloadFile, uniqueEntryName, type ZipProgressEvent } from "./zip";

function fakeFetch(payloads: Record<string, Uint8Array>): typeof globalThis.fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const payload = payloads[url];
    if (!payload) return new Response("not found", { status: 404, statusText: "Not Found" });

    return new Response(payload.buffer as ArrayBuffer, {
      status: 200,
      headers: { "content-length": String(payload.byteLength), "content-type": "video/mp4" },
    });
  }) as typeof globalThis.fetch;
}

async function readStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
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

describe("uniqueEntryName", () => {
  it("desambigua nomes repetidos", () => {
    const used = new Set<string>();
    expect(uniqueEntryName(used, "a.mp4")).toBe("a.mp4");
    expect(uniqueEntryName(used, "a.mp4")).toBe("a (2).mp4");
    expect(uniqueEntryName(used, "a.mp4")).toBe("a (3).mp4");
  });

  it("sanitiza separadores de caminho", () => {
    const used = new Set<string>();
    expect(uniqueEntryName(used, "../etc/passwd")).toBe(".._etc_passwd");
  });
});

describe("createZipStream", () => {
  it("empacota os arquivos e reporta progresso", async () => {
    const files: DownloadFile[] = [
      { url: "https://cdn.test/a.mp4", filename: "a.mp4" },
      { url: "https://cdn.test/b.mp4", filename: "a.mp4" },
    ];
    const events: ZipProgressEvent[] = [];
    const encoder = new TextEncoder();

    const stream = createZipStream(files, {
      fetch: fakeFetch({
        "https://cdn.test/a.mp4": encoder.encode("AAA"),
        "https://cdn.test/b.mp4": encoder.encode("BBB"),
      }),
      onProgress: (event) => events.push(event),
    });

    const bytes = await readStream(stream);
    const text = new TextDecoder().decode(bytes);

    expect(text.startsWith("PK")).toBe(true);
    expect(text).toContain("a.mp4");
    expect(text).toContain("a (2).mp4");
    expect(events.filter((event) => event.phase === "done")).toHaveLength(2);
    expect(events.some((event) => event.phase === "progress")).toBe(true);
  });

  it("segue em frente quando um arquivo falha", async () => {
    const onProgress = vi.fn<(event: ZipProgressEvent) => void>();

    const stream = createZipStream([{ url: "https://cdn.test/missing", filename: "x.mp4" }], {
      fetch: fakeFetch({}),
      onProgress,
    });

    await readStream(stream);

    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ phase: "error" }));
  });
});
