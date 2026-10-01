# media-pack

Monorepo Turborepo gerenciado com **pnpm**. Extensão Chrome (MV3, **Side Panel**) que
**identifica mídias enquanto as páginas carregam** e baixa as selecionadas em um único **ZIP** —
tudo em *streaming*, sem estourar a RAM.

| Pacote            | Caminho               | Descrição                                                                 |
| ----------------- | --------------------- | ------------------------------------------------------------------------- |
| `@repo/protocol`  | `packages/protocol`   | Schemas e tipagens compartilhadas (**Zod**, reexportado)                   |
| `@repo/media`     | `packages/media`      | Identificação de mídia: content-type/extensão → tipo, nome de arquivo, auto-seleção (puro/testável) |
| `@repo/streams`   | `packages/streams`    | Resolução de manifestos **HLS/DASH** (m3u8-parser/fast-xml-parser) e metadados de stream |
| `@repo/downloader`| `packages/downloader` | Download em streaming + ZIP (`client-zip`) gravando direto no disco        |
| `@repo/ui`        | `packages/ui`         | Componentes **shadcn/ui** (Tailwind v4, exportados em source)              |
| `@apps/ext`       | `apps/ext`            | Extensão Chrome (MV3, **Side Panel**) com Vite + React + CRXJS             |

## Requisitos

- Node.js `>= 22.12`
- pnpm `10.13.1` (fixado em `packageManager`; habilite com `corepack enable`)

```bash
pnpm install
```

## Comandos

| Comando             | Descrição                                              |
| ------------------- | ------------------------------------------------------ |
| `pnpm dev`          | Vite/CRXJS dev server (carregue `dist` manualmente)    |
| `pnpm dev:ext`      | ⭐ Abre um Chromium novo com a extensão + side panel (HMR) |
| `pnpm build`        | Build de todos os pacotes                              |
| `pnpm typecheck`    | Checagem de tipos (`tsc --noEmit`)                     |
| `pnpm test`         | Testes unitários (Vitest) — `test:watch` para watch    |
| `pnpm test:e2e`     | E2E no Chromium real com a extensão carregada          |
| `pnpm lint`         | Biome em cada pacote (Turbo)                           |
| `pnpm check`        | Biome em todo o repo — `check:fix` aplica os fixes     |
| `pnpm format`       | Biome formatter                                        |
| `pnpm clean`        | Limpa artefatos                                        |

## Como funciona

1. O **service worker** registra `chrome.webRequest.onHeadersReceived` e observa as respostas que
   são mídia (imagem, vídeo, áudio, documento, arquivo). Manifestos `.m3u8`/`.mpd` entram como
   `streamType` (HLS/DASH).
2. `@repo/media` classifica cada resposta (tipo, nome de arquivo a partir do
   `Content-Disposition`/URL, tamanho) e o item é gravado em `chrome.storage.session`.
3. **S1 (eager-manifest)**: para cada manifesto, `@repo/streams` baixa o `.m3u8`/`.mpd` (alguns KB) e
   enriquece o item com **variantes, duração, container (TS/fMP4), criptografia e tamanho estimado**.
   A qualidade escolhida segue a preferência **“Qualidade do stream”** (padrão: melhor).
4. O **side panel** lista as mídias em tempo real, com **filtro + auto-seleção por tipo** (mostra só
   os tipos marcados e já os marca), tamanho mínimo, seleção manual e busca.
5. Ao clicar em **Baixar**, o download e a montagem do ZIP acontecem **juntos, em streaming** (um
   arquivo por vez, gravando direto no disco). A UI mostra **duas barras**: **"Download"** (progresso
   do vídeo atual) e **"ZIP"** (vídeos baixados ÷ total). Ao terminar, o progresso é **resetado** e um
   **toast** confirma. O `client-zip` faz `store` (sem compressão) — ideal para mídia, que já é
   comprimida.

## Catalog do pnpm

Todas as versões ficam centralizadas no `catalog` de [`pnpm-workspace.yaml`](./pnpm-workspace.yaml).
Nos `package.json` os pacotes referenciam `"catalog:"`:

```json
{
  "dependencies": { "client-zip": "catalog:" }
}
```

Para atualizar uma versão em todo o monorepo, edite o `catalog` e rode `pnpm install`.

## `@repo/protocol`

Ponto único de verdade das tipagens. O `zod` é reexportado, então importe sempre daqui:

```ts
import { z, mediaItemSchema, type MediaItem, type MediaPrefs } from "@repo/protocol";
```

## `@repo/media`

Lógica pura (sem `chrome.*`), por isso 100% testável:

- `classifyResponse(details)` → item de mídia (ou `null` se não for mídia).
- `deriveFilename(...)`, `sanitizeFilename(...)`, `filenameFromContentDisposition(...)`.
- `shouldAutoSelect(item, prefs)`, `matchesKind(...)`, `matchesTab(...)`, `matchesQuery(...)`.
- `selectVariant(variants, policy)`, `variantLabel(variant)` (HLS/DASH).
- `formatBytes(...)`, `formatDuration(...)`, `KIND_LABELS`, `STREAM_LABELS`, `MEDIA_KINDS`.

## `@repo/streams`

Resolução de manifestos na **Fase A (etapa S1)** — sem baixar segmentos ainda:

- `parseHlsManifest(text, baseUrl)` → variantes (master) ou container/criptografia/segmentos/live.
- `parseDashManifest(xml, baseUrl)` → representações de vídeo, duração e live.
- `resolveStreamInfo({ url, streamType }, { fetch? })` → `Partial<StreamInfo>` (S1).
- Helpers: `resolveUrl`, `positiveInt`, `asArray`, `asString`, `estimateBytes`, `parseIsoDuration`.

> A conversão **TS/fMP4 → MP4** com `mux.js` (e o download dos segmentos) entra na **Fase B**.

## `@repo/downloader`

Baixa e zipa na **mesma esteira** (`client-zip` puxa uma fonte por vez, sem manter o conteúdo na
RAM). Cada entrada é uma `DownloadSource` (`{ filename, open(signal) }`); `urlSource(url, filename)`
é a fonte padrão. `createZipStream(sources, { onProgress, signal })` emite dois progressos por evento:

- `filePercent` → progresso do **arquivo atual** (barra "Download");
- `overallPercent` → **arquivos baixados ÷ total** (barra "ZIP").

Outros:

- `prepareZipSink(name)` → `ZipSink` (grava com a File System Access API; fallback blob).
- `buildZipName()` → `media-pack-<timestamp>.zip`.

## `@repo/ui` (shadcn)

- Tema Tailwind v4 em `packages/ui/src/styles/globals.css`.
- O app importa o CSS com `@import "@repo/ui/globals.css"` e aponta os `@source` para escanear o pacote.
- **Tema (light/dark/system)**: `ThemeProvider` + `useTheme` seguem o guia **Vite** do shadcn
  (provider próprio com `localStorage`/`matchMedia`, sem `next-themes`). O `ModeToggle` é o botão de
  tema (`DropdownMenu`) exibido no topo do side panel.
- **Avisos**: `Toaster` + `toast` (baseado no [sonner](https://ui.shadcn.com/docs/components/sonner)).
- Adicione novos componentes shadcn sempre pelo CLI, dentro do pacote:

```bash
pnpm --filter @repo/ui ui add <componente>
```

Os componentes usam a convenção atual do shadcn: `cn` (de `cn`) e `radix-ui`.

## Extensão (`@apps/ext`)

- `manifest.config.ts` declara o manifest MV3 com o **Side Panel** (`side_panel.default_path`),
  o service worker e as permissões `storage`, `webRequest` e `sidePanel`.
- `/src/background` → service worker (monitora a rede e grava em `chrome.storage.session`).
- `/src/sidepanel` → React do painel (lista, seleção e download em ZIP).
- Clique no ícone da extensão abre o side panel
  (`chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`).
- O build gera `apps/ext/dist`; carregue em `chrome://extensions` com **"Carregar sem compactação"**.

## Ver a UI rodando

Da mais fiel/automática para a mais simples:

### 1. `dev:ext` — navegador novo com a extensão + side panel (HMR) ⭐

```bash
pnpm dev:ext
```

Um script (`apps/ext/scripts/dev-browser.mjs`) sobe o Vite/CRXJS e usa o Playwright para abrir um
**Chromium novo já com a extensão carregada**, com a página do `sidepanel.html` em uma aba. Edite os
arquivos e o **HMR reflete na hora**.

> O painel lateral *docked* do Chrome não pode ser aberto por script (exige gesto do usuário). Dê
> **1 clique no ícone da extensão** para encaixá-lo — depois disso ele também reflete o HMR. Feche o
> navegador para encerrar tudo.

### 2. Extensão real com carregamento manual

```bash
pnpm dev
```

Depois carregue `apps/ext/dist` em `chrome://extensions` (modo desenvolvedor) e clique no ícone da
extensão para abrir o side panel.

### 3. `dev:ui` — só a UI, sem extensão

```bash
pnpm --filter @apps/ext dev:ui
```

Abre `http://localhost:5174/sidepanel.html` no navegador padrão, com HMR. Loop mais rápido para
iterar no visual; as APIs `chrome.*` ficam indisponíveis, então a lista aparece vazia (o resto da UI
funciona).

### 4. E2E automatizado no Chromium (dá pra assistir)

```bash
pnpm test:e2e
```

Usa [`vitest-environment-web-ext`](https://crxjs.dev/guide/test/installation) + Playwright: sobe o
Chromium com a extensão, abre o side panel via `browser.getSidePanelPage()` e testa o fluxo. Por
padrão roda **com a janela visível** (`playwright.headless: false` em `vitest.e2e.config.ts`) —
aumente `slowMo` ali para assistir com calma.

> Antes do primeiro E2E: `pnpm --filter @apps/ext exec playwright install chromium`.

## Tooling

- **TypeScript 7** (compilador nativo).
- **Biome** para lint + formatação (sem ESLint/Prettier).
- **Vitest** + Testing Library (unit) e **Playwright** via `vitest-environment-web-ext` (E2E).
