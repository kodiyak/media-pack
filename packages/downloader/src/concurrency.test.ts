import { describe, expect, it } from "vitest";
import { createSemaphore, releaseOnEnd } from "./concurrency";

describe("createSemaphore", () => {
  it("rejeita limites inválidos", () => {
    expect(() => createSemaphore(0)).toThrow();
    expect(() => createSemaphore(1.5)).toThrow();
  });

  it("entrega vagas até o limite e enfileira o excedente", async () => {
    const semaphore = createSemaphore(2);

    const first = await semaphore.acquire();
    const second = await semaphore.acquire();
    expect(semaphore.available).toBe(0);

    let thirdAcquired = false;
    const third = semaphore.acquire().then((release) => {
      thirdAcquired = true;
      return release;
    });

    await Promise.resolve();
    expect(thirdAcquired).toBe(false);
    expect(semaphore.waiting).toBe(1);

    first();
    const releaseThird = await third;
    expect(thirdAcquired).toBe(true);
    expect(semaphore.available).toBe(0);

    second();
    releaseThird();
    expect(semaphore.available).toBe(2);
  });

  it("remove da fila quando o abort acontece", async () => {
    const semaphore = createSemaphore(1);
    const release = await semaphore.acquire();
    const controller = new AbortController();

    const pending = semaphore.acquire(controller.signal);
    controller.abort();

    await expect(pending).rejects.toThrow();
    expect(semaphore.waiting).toBe(0);

    release();
    expect(semaphore.available).toBe(1);
  });

  it("rejeita imediatamente se o signal já está abortado", async () => {
    const semaphore = createSemaphore(1);
    const controller = new AbortController();
    controller.abort();

    await expect(semaphore.acquire(controller.signal)).rejects.toThrow();
    expect(semaphore.available).toBe(1);
  });

  it("ignora liberações repetidas da mesma vaga", async () => {
    const semaphore = createSemaphore(1);
    const release = await semaphore.acquire();

    release();
    release();

    expect(semaphore.available).toBe(1);
  });
});

describe("releaseOnEnd", () => {
  it("libera a vaga quando o stream termina", async () => {
    let released = 0;
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      },
    });

    const body = releaseOnEnd(source, () => {
      released += 1;
    });
    const bytes = new Uint8Array(await new Response(body).arrayBuffer());

    expect([...bytes]).toEqual([1, 2, 3]);
    expect(released).toBe(1);
  });

  it("libera a vaga quando o stream é cancelado (uma única vez)", async () => {
    let released = 0;
    const source = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array([1]));
      },
    });

    const body = releaseOnEnd(source, () => {
      released += 1;
    });
    const reader = body.getReader();
    await reader.read();
    await reader.cancel();

    expect(released).toBe(1);
  });

  it("libera a vaga quando a leitura falha", async () => {
    let released = 0;
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("boom"));
      },
    });

    const body = releaseOnEnd(source, () => {
      released += 1;
    });

    await expect(new Response(body).arrayBuffer()).rejects.toThrow("boom");
    expect(released).toBe(1);
  });
});
