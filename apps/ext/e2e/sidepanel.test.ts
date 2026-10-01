import { expect, test } from "vitest";
import type { WebExtBrowser } from "vitest-environment-web-ext";

const ITEM = {
  id: "00000000-0000-4000-8000-000000000001",
  url: "https://cdn.example.com/clipe.mp4",
  kind: "video",
  filename: "clipe.mp4",
  mimeType: "video/mp4",
  sizeInBytes: 1048576,
  createdAt: "2026-01-01T00:00:00.000Z",
};

/**
 * O `@types/chrome` declara um global `browser` (alias do Firefox), que colide
 * com o `browser` injetado pelo ambiente. Acessamos via `globalThis` com o tipo certo.
 */
function getBrowser(): WebExtBrowser {
  return (globalThis as unknown as { browser: WebExtBrowser }).browser;
}

test("abre o side panel com a UI nova", async () => {
  const page = await getBrowser().getSidePanelPage();
  await page.getByRole("heading", { name: "Media Pack" }).waitFor({ state: "visible" });

  expect(await page.getByRole("heading", { name: "Media Pack" }).count()).toBeGreaterThan(0);
});

test("lista as mídias gravadas no storage e habilita o download", async () => {
  const page = await getBrowser().getSidePanelPage();
  await page.getByRole("heading", { name: "Media Pack" }).waitFor({ state: "visible" });

  await page.evaluate(async (item) => {
    await chrome.storage.session.set({ media: [item] });
  }, ITEM);

  await page.getByText("clipe.mp4").waitFor({ state: "visible" });

  expect(await page.getByRole("button", { name: /baixar 1/i }).isEnabled()).toBe(true);
});
