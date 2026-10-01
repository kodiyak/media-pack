import { makeZip } from "client-zip";
import { uniqueEntryName } from "./names";
import { countBytes, parseContentLength, toErrorMessage } from "./stream";

/** Conteúdo aberto de uma fonte: stream (ou bytes) + tamanho conhecido. */
export type OpenedSource = {
  body: ReadableStream<Uint8Array> | Uint8Array;
  totalBytes?: number;
};

/**
 * Uma entrada do ZIP, aberta sob demanda. Arquivos comuns usam `urlSource`;
 * streams transmuxados (Fase B) retornam o MP4 gerado aqui.
 */
export type DownloadSource = {
  filename: string;
  open(signal?: AbortSignal): Promise<OpenedSource>;
};

export type ZipProgressEvent = {
  phase: "converting" | "downloading" | "done" | "error";
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
  /** Progresso interno da fonte, ex.: segmento `i` de `n` (streams). */
  subIndex?: number;
  subTotal?: number;
  error?: string;
};

export type ZipOptions = {
  onProgress?: (event: ZipProgressEvent) => void;
  signal?: AbortSignal;
};

/** Fonte padrão: baixa a URL direto (com cookies da sessão). */
export function urlSource(
  url: string,
  filename: string,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch.bind(globalThis),
): DownloadSource {
  return {
    filename,
    async open(signal) {
      const response = await fetchImpl(url, {
        signal,
        credentials: "include",
        redirect: "follow",
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
      }

      const totalBytes = parseContentLength(response);
      const body = response.body ?? new Uint8Array(await response.arrayBuffer());
      return { body, totalBytes };
    },
  };
}

/**
 * Baixa as fontes e monta o ZIP em streaming (uma por vez, sem manter o
 * conteúdo na memória). Emite progresso do arquivo atual e geral.
 */
export function createZipStream(
  sources: DownloadSource[],
  options: ZipOptions = {},
): ReadableStream<Uint8Array> {
  return makeZip(entries(sources, options)) as ReadableStream<Uint8Array>;
}

type ZipEntry = {
  name: string;
  input: ReadableStream<Uint8Array> | Uint8Array;
};

async function* entries(sources: DownloadSource[], options: ZipOptions): AsyncGenerator<ZipEntry> {
  const used = new Set<string>();
  const total = sources.length;

  for (let index = 0; index < total; index += 1) {
    const source = sources[index];
    if (!source) continue;

    const name = uniqueEntryName(used, source.filename);
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
      const opened = await source.open(options.signal);
      const totalBytes = opened.totalBytes;
      let loadedBytes = 0;
      let input: ReadableStream<Uint8Array> | Uint8Array;

      if (opened.body instanceof Uint8Array) {
        loadedBytes = opened.body.byteLength;
        input = opened.body;
      } else {
        input = countBytes(opened.body, (chunkBytes) => {
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
      }

      yield { name, input };

      options.onProgress?.({
        phase: "done",
        index,
        total,
        filename: name,
        loadedBytes,
        totalBytes: totalBytes ?? loadedBytes,
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
