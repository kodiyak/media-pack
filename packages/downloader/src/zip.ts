import { makeZip } from "client-zip";

/** Um arquivo a ser baixado e empacotado. */
export type DownloadFile = {
  url: string;
  filename: string;
};

export type ZipProgressEvent =
  | { phase: "fetching"; index: number; total: number; filename: string }
  | {
      phase: "progress";
      index: number;
      total: number;
      filename: string;
      loadedBytes: number;
      totalBytes?: number;
    }
  | { phase: "done"; index: number; total: number; filename: string }
  | { phase: "error"; index: number; total: number; filename: string; error: string };

export type CreateZipOptions = {
  /** Injetável para testes; por padrão usa o `fetch` global. */
  fetch?: typeof globalThis.fetch;
  onProgress?: (event: ZipProgressEvent) => void;
  signal?: AbortSignal;
};

/**
 * Gera o ZIP como um `ReadableStream` (streaming): cada arquivo é buscado e
 * escrito sob demanda, sem manter o conteúdo todo na memória.
 */
export function createZipStream(
  files: DownloadFile[],
  options: CreateZipOptions = {},
): ReadableStream<Uint8Array> {
  return makeZip(entries(files, options)) as ReadableStream<Uint8Array>;
}

type ZipEntry = {
  name: string;
  input: ReadableStream<Uint8Array> | Uint8Array;
  lastModified?: Date;
};

async function* entries(
  files: DownloadFile[],
  options: CreateZipOptions,
): AsyncGenerator<ZipEntry> {
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  const used = new Set<string>();
  const total = files.length;

  for (let index = 0; index < total; index += 1) {
    const file = files[index];
    if (!file) continue;

    const name = uniqueEntryName(used, file.filename);
    options.onProgress?.({ phase: "fetching", index, total, filename: name });

    try {
      const response = await fetcher(file.url, {
        signal: options.signal,
        credentials: "include",
        redirect: "follow",
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
      }

      const totalBytes = parseContentLength(response);
      const body = response.body;
      let input: ReadableStream<Uint8Array> | Uint8Array;

      if (body) {
        let loadedBytes = 0;
        input = countBytes(body, (chunkBytes) => {
          loadedBytes += chunkBytes;
          options.onProgress?.({
            phase: "progress",
            index,
            total,
            filename: name,
            loadedBytes,
            totalBytes,
          });
        });
      } else {
        input = new Uint8Array(await response.arrayBuffer());
      }

      yield { name, input, lastModified: parseLastModified(response) };
      options.onProgress?.({ phase: "done", index, total, filename: name });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      options.onProgress?.({
        phase: "error",
        index,
        total,
        filename: name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/** Garante nomes únicos dentro do ZIP (evita sobrescrever arquivos). */
export function uniqueEntryName(used: Set<string>, filename: string): string {
  const safe = sanitizeEntryName(filename);
  if (!used.has(safe)) {
    used.add(safe);
    return safe;
  }

  const dot = safe.lastIndexOf(".");
  const base = dot > 0 ? safe.slice(0, dot) : safe;
  const extension = dot > 0 ? safe.slice(dot) : "";

  let counter = 2;
  let candidate = `${base} (${counter})${extension}`;
  while (used.has(candidate)) {
    counter += 1;
    candidate = `${base} (${counter})${extension}`;
  }

  used.add(candidate);
  return candidate;
}

export function sanitizeEntryName(name: string): string {
  const cleaned = name
    .replace(/[\\/]+/g, "_")
    .replace(/[<>:"|?*]/g, "_")
    .replace(/\p{Cc}/gu, "_")
    .trim();
  return cleaned.slice(0, 180) || "arquivo";
}

function countBytes(
  body: ReadableStream<Uint8Array>,
  onChunk: (chunkBytes: number) => void,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      controller.enqueue(value);
      onChunk(value.byteLength);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

function parseContentLength(response: Response): number | undefined {
  const raw = response.headers.get("content-length");
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function parseLastModified(response: Response): Date | undefined {
  const raw = response.headers.get("last-modified");
  if (!raw) return undefined;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
