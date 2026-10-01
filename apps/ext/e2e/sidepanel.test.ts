import { expect, test } from "vitest";
import type { WebExtBrowser } from "vitest-environment-web-ext";

const PACK_NAME = "Referências de design";

/**
 * O `@types/chrome` declara um global `browser` (alias do Firefox), que colide
 * com o `browser` injetado pelo ambiente. Acessamos via `globalThis` com o tipo certo.
 */
function getBrowser(): WebExtBrowser {
  return (globalThis as unknown as { browser: WebExtBrowser }).browser;
}

test("abre o side panel e cria um pack", async () => {
  const page = await getBrowser().getSidePanelPage();

  await page.getByRole("heading", { name: "Media Pack" }).waitFor({ state: "visible" });

  await page.getByLabel("Nome do pack").fill(PACK_NAME);
  await page.getByRole("button", { name: "Criar pack" }).click();

  await page.getByText(PACK_NAME).waitFor({ state: "visible" });
  expect(await page.getByText("Packs (1)").count()).toBeGreaterThan(0);
});

test("valida o nome vazio mostrando um alerta", async () => {
  const page = await getBrowser().getSidePanelPage();

  await page.getByRole("button", { name: "Criar pack" }).click();
  await page.getByRole("alert").waitFor({ state: "visible" });

  expect(await page.getByRole("alert").textContent()).toBeTruthy();
});
