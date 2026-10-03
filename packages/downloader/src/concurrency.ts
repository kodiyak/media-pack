/**
 * Semáforo simples com fila FIFO, usado para limitar quantas conversões de
 * stream (HLS/DASH) rodam ao mesmo tempo quando há vários downloads concorrentes.
 * Arquivos comuns (download direto) não passam por aqui.
 */
export type Semaphore = {
  /** Reserva uma vaga. Retorna a função de liberação (idempotente). */
  acquire(signal?: AbortSignal): Promise<() => void>;
  readonly available: number;
  readonly waiting: number;
};

function abortReason(signal?: AbortSignal): Error {
  if (signal?.reason instanceof Error) return signal.reason;
  return new DOMException("Aborted", "AbortError");
}

export function createSemaphore(limit: number): Semaphore {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("O limite do semáforo deve ser um inteiro >= 1.");
  }

  let available = limit;
  const waiters: ((release: () => void) => void)[] = [];

  /** Cada vaga recebe sua própria função de liberação, idempotente. */
  const makeRelease = (): (() => void) => {
    let released = false;
    return () => {
      if (released) return;
      released = true;

      const next = waiters.shift();
      if (next) next(makeRelease());
      else available += 1;
    };
  };

  return {
    get available() {
      return available;
    },
    get waiting() {
      return waiters.length;
    },
    acquire(signal) {
      if (signal?.aborted) return Promise.reject(abortReason(signal));
      if (available > 0) {
        available -= 1;
        return Promise.resolve(makeRelease());
      }

      return new Promise<() => void>((resolve, reject) => {
        const waiter = (release: () => void): void => {
          signal?.removeEventListener("abort", onAbort);
          resolve(release);
        };
        const onAbort = (): void => {
          const index = waiters.indexOf(waiter);
          if (index >= 0) waiters.splice(index, 1);
          reject(abortReason(signal));
        };

        signal?.addEventListener("abort", onAbort, { once: true });
        waiters.push(waiter);
      });
    },
  };
}

/**
 * Encapsula um stream para liberar a vaga do semáforo quando ele termina de ser
 * lido (ou é cancelado), já que o client-zip consome a fonte de forma preguiçosa.
 */
export function releaseOnEnd(
  body: ReadableStream<Uint8Array>,
  release: () => void,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let released = false;
  const finish = (): void => {
    if (released) return;
    released = true;
    release();
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await reader.read();
        if (result.done) {
          finish();
          controller.close();
        } else if (result.value) {
          controller.enqueue(result.value);
        }
      } catch (error) {
        finish();
        controller.error(error);
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        finish();
      }
    },
  });
}
