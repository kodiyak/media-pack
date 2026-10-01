import { makeZip } from "client-zip";
import { uniqueEntryName } from "./names";
import { countBytes, parseContentLength, toErrorMessage } from "./stream";

/** Um arquivo a ser baixado e empacotado. */
export type DownloadFile = {
  url: string;
  filename: string;
};

export type ZipProgressEvent = {
  phase: "downloading" | "done" | "error";
  /** Índice (0-based) do arquivo atual. */
  index: number;
  total: number;
  filename: string;
  /** Bytes já lidos do arquivo atual. */
  loadedBytes: number;
  /** Tamanho total do arquivo atual (quando o servidor informa). */
  totalBytes?: number;
  /** Progresso do arquivo atual, de 0 a 100. */
  filePercent: number;
  /** Progresso geral (arquivos baixados + fração do atual), de 0 a 100. */
  overallPercent: number;
  error?: string;
};

export type ZipOptions = {
  /** Injetável para testes; por padrão usa o `fetch` global. */
  fetch?: typeof globalThis.fetch;
  onProgress?: (event: ZipProgressEvent) => void;
  signal?: AbortSignal;
};

/**
 * Baixa os arquivos e monta o ZIP em streaming (um arquivo por vez, sem manter
 * o conteúdo na memória). Emite progresso do arquivo atual e geral.
 */
export function createZipStream(
  files: DownloadFile[],
  options: ZipOptions = {},
): ReadableStream<Uint8Array> {
  return makeZip(entries(files, options)) as ReadableStream<Uint8Array>;
}

type ZipEntry = {
  name: string;
  input: ReadableStream<Uint8Array> | Uint8Array;
  lastModified?: Date;
};

async function* entries(files: DownloadFile[], options: ZipOptions): AsyncGenerator<ZipEntry> {
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  const used = new Set<string>();
  const total = files.length;

  for (let index = 0; index < total; index += 1) {
    const file = files[index];
    if (!file) continue;

    const name = uniqueEntryName(used, file.filename);
    options.onProgress?.({
      phase: "downloading",
      index,
      total,
      filename: name,
      loadedBytes: 0,
      filePercent: 0,
      overallPercent: (index / total) * 100,
    });

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
      let loadedBytes = 0;
      let input: ReadableStream<Uint8Array> | Uint8Array;

      if (body) {
        input = countBytes(body, (chunkBytes) => {
          loadedBytes += chunkBytes;
          const fraction = totalBytes ? loadedBytes / totalBytes : 0;
          options.onProgress?.({
            phase: "downloading",
            index,
            total,
            filename: name,
            loadedBytes,
            totalBytes,
            filePercent: fraction * 100,
            overallPercent: ((index + fraction) / total) * 100,
          });
        });
      } else {
        const buffer = new Uint8Array(await response.arrayBuffer());
        loadedBytes = buffer.byteLength;
        input = buffer;
      }

      yield { name, input };

      options.onProgress?.({
        phase: "done",
        index,
        total,
        filename: name,
        loadedBytes,
        totalBytes,
        filePercent: 100,
        overallPercent: ((index + 1) / total) * 100,
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      options.onProgress?.({
        phase: "error",
        index,
        total,
        filename: name,
        loadedBytes: 0,
        filePercent: 0,
        overallPercent: (index / total) * 100,
        error: toErrorMessage(error),
      });
    }
  }
}
