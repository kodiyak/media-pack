import type { MediaItem } from "@repo/protocol";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

function makeItem(partial: Partial<MediaItem>): MediaItem {
  return {
    id: crypto.randomUUID(),
    url: "https://cdn.test/clipe.mp4",
    kind: "video",
    filename: "clipe.mp4",
    createdAt: new Date().toISOString(),
    ...partial,
  };
}

function stubChrome(media: MediaItem[]) {
  vi.stubGlobal("chrome", {
    runtime: { id: "test-extension" },
    storage: {
      session: {
        get: vi.fn(async () => ({ media })),
        set: vi.fn(async () => {}),
      },
      local: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => {}),
      },
      onChanged: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
    tabs: {
      query: vi.fn(async () => [{ id: 1 }]),
      onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
      onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("<App />", () => {
  it("mostra o estado vazio quando a API da extensão não está disponível", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: /media pack/i })).toBeInTheDocument();
    expect(screen.getByText(/abra uma página com mídia/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /baixar 0/i })).toBeDisabled();
  });

  it("lista as mídias e auto-seleciona vídeos", async () => {
    stubChrome([
      makeItem({ kind: "video", filename: "clipe.mp4", sizeInBytes: 1024 * 1024 }),
      makeItem({ kind: "image", filename: "foto.png" }),
    ]);

    render(<App />);

    expect(await screen.findByText("clipe.mp4")).toBeInTheDocument();
    expect(screen.getByText("foto.png")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /baixar 1/i })).toBeEnabled();
  });

  it("permite desmarcar a seleção automática", async () => {
    stubChrome([makeItem({ kind: "video", filename: "clipe.mp4" })]);
    const user = userEvent.setup();

    render(<App />);
    await screen.findByText("clipe.mp4");

    await user.click(screen.getByRole("button", { name: /limpar seleção/i }));

    expect(screen.getByRole("button", { name: /baixar 0/i })).toBeDisabled();
  });
});
