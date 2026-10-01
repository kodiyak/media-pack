# media-pack

Monorepo Turborepo gerenciado com **pnpm**. Extensão Chrome (MV3, **Side Panel**) que
**identifica mídias enquanto as páginas carregam** e baixa as selecionadas em um único **ZIP** —
tudo em *streaming*, sem estourar a RAM.

| Pacote            | Caminho               | Descrição                                                                 |
| ----------------- | --------------------- | ------------------------------------------------------------------------- |
| `@repo/protocol`  | `packages/protocol`   | Schemas e tipagens compartilhadas (**Zod**, reexportado)                   |
| `@repo/media`     | `packages/media`      | Identificação de mídia: content-type/extensão → tipo, nome de arquivo, auto-seleção (puro/testável) |
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
   `stream` (HLS/DASH).
2. `@repo/media` classifica cada resposta (tipo, nome de arquivo a partir do
   `Content-Disposition`/URL, tamanho) e o item é gravado em `chrome.storage.session`.
3. O **side panel** lista as mídias em tempo real, com **auto-seleção por tipo/tamanho** e seleção
   manual (checkboxes + busca).
4. Ao clicar em **Baixar**, `@repo/downloader` faz `fetch` de cada item e monta o ZIP com
   `makeZip` (`ReadableStream`), gravando **direto no disco** pela File System Access API
   (`showSaveFilePicker`) — sem bufferizar o ZIP inteiro. Sem suporte, cai para blob.

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
- `shouldAutoSelect(item, prefs)`, `matchesTab(...)`, `matchesQuery(...)`.
- `formatBytes(...)`, `KIND_LABELS`, `MEDIA_KINDS`.

## `@repo/downloader`

- `createZipStream(files, options)` → `ReadableStream<Uint8Array>` (streaming, um arquivo por vez).
- `saveStreamWithPicker(stream, name)` → grava no disco via File System Access API.
- `saveStreamAsBlob(stream, name)` → fallback.
- `buildZipName()` → `media-pack-<timestamp>.zip`.
- Eventos de progresso por arquivo (`fetching` / `progress` / `done` / `error`).

## `@repo/ui` (shadcn)

- Tema Tailwind v4 em `packages/ui/src/styles/globals.css`.
- O app importa o CSS com `@import "@repo/ui/globals.css"` e aponta os `@source` para escanear o pacote.
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
