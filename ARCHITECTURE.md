# Media Pack — Arquitetura

> Documento de arquitetura do **Media Pack**: uma extensão Chrome (Manifest V3) com
> Side Panel que **identifica mídias enquanto as páginas carregam** e faz
> **download em lote compactando tudo em um único ZIP**, gravado em streaming no disco.

Este documento está segmentado em **contextos** pensados para leitura humana:
monorepo, runtime da extensão, detecção, download/ZIP, conversão de streams,
persistência, UI/tema e qualidade.

---

## Índice

1. [Contexto 1 — Monorepo & pacotes](#contexto-1--monorepo--pacotes)
2. [Contexto 2 — Runtime da extensão (MV3)](#contexto-2--runtime-da-extensão-mv3)
3. [Contexto 3 — Detecção de mídia](#contexto-3--detecção-de-mídia)
4. [Contexto 4 — Download & ZIP em streaming](#contexto-4--download--zip-em-streaming)
5. [Contexto 5 — Conversão de streams](#contexto-5--conversão-de-streams)
6. [Contexto 6 — Persistência](#contexto-6--persistência)
7. [Contexto 7 — UI & tema](#contexto-7--ui--tema)
8. [Contexto 8 — Qualidade, build & e2e](#contexto-8--qualidade-build--e2e)
9. [Decisões de arquitetura](#decisões-de-arquitetura)
10. [Fases do plano & roadmap](#fases-do-plano--roadmap)

---

## Contexto 1 — Monorepo & pacotes

Gerenciado com **pnpm + Turborepo**. Versões centralizadas no **catálogo** do pnpm
(`pnpm-workspace.yaml`). Lint/format com **Biome** apenas (sem Prettier/ESLint).
TypeScript 7 (sem `baseUrl`).

### Layout

```text
media-pack/
├── pnpm-workspace.yaml          # workspaces + catalog: (versões centralizadas)
├── package.json                 # scripts orquestrados pelo Turbo
├── turbo.json                   # pipeline de tasks (typecheck/test/build/e2e)
├── biome.json                   # lint + format (Biome)
├── tsconfig.base.json           # base compartilhada de TS
├── ARCHITECTURE.md              # este documento
├── apps/
│   └── ext/                     # @apps/ext — extensão Chrome (Vite + React)
└── packages/
    ├── protocol/                # @repo/protocol — tipos Zod + re-export do zod
    ├── media/                   # @repo/media — classificação/seleção/nomes
    ├── downloader/              # @repo/downloader — ZIP/stream/sink/OPFS
    ├── streams/                 # @repo/streams — HLS/DASH/transmux/mux
    └── ui/                      # @repo/ui — componentes shadcn + tema
```

### Responsabilidades dos pacotes

| Pacote | Papel | Destaques |
| --- | --- | --- |
| `@repo/protocol` | Contrato único de tipos entre todos os contextos | Schemas Zod de mídia, prefs, mensagens e planos; re-exporta `zod` |
| `@repo/media` | Regras de domínio de mídia | `classify`, `selectVariant`, `matchesKind`, `shouldAutoSelect`, nomes/labels |
| `@repo/downloader` | Pipeline de download + ZIP | `createZipStream`, `prepareZipSink`, `urlSource`, `opfsSource`, `cleanupOpfs` |
| `@repo/streams` | Conversão HLS/DASH → MP4 | `openHlsStream`, `openDashTrack`, `resolveStreamInfo`, `muxFmp4` |
| `@repo/ui` | Componentes visuais | shadcn (Button, Card, Select, …) + `ThemeProvider`/`ModeToggle` |
| `@apps/ext` | A extensão em si | Service Worker, Side Panel, Offscreen document |

> **Nota:** os pacotes internos são **exportados por código-fonte** (sem etapa de
> build): `"exports"` aponta direto para `src/*.ts`. Isso simplifica o consumo via
> Vite/tsc e evita duplicação de build.

### Grafo de dependências

```text
                     ┌──────────────┐
                     │ @repo/ui     │  (só o side panel consome)
                     └──────┬───────┘
                            │
   ┌────────────┐     ┌─────▼──────┐
   │ @apps/ext  │────▶│ @repo/media│
   │ (extensão) │     └─────▲──────┘
   └─────┬──────┘           │
         │            ┌─────┴──────────┐
         │            │ @repo/downloader│
         │            └─────▲──────────┘
         │                  │
         │            ┌─────┴────────┐
         ├───────────▶│ @repo/streams│
         │            └─────▲────────┘
         │                  │
         └──────────▶┌──────┴────────┐
                      │ @repo/protocol│  (todos dependem dele)
                      └───────────────┘
```

---

## Contexto 2 — Runtime da extensão (MV3)

A extensão é um **Service Worker** (sem `persistent: false`, padrão MV3) que
orquestra três superfícies:

```text
                        ┌─────────────────────────────┐
   ┌──────────────┐     │   Service Worker (background) │
   │  Página (aba) │     │  • webRequest.onHeadersReceived│
   │  carrega mídia │────▶│  • classifica + armazena      │
   └──────────────┘ HTTP│  • enriquece manifestos (S1)   │
                         │  • dedupe de rendições HLS     │
                         │  • roteia mensagens            │
                         └──────┬───────────────┬────────┘
                     storage.session│        runtime.sendMessage
                                    │               │
                        ┌───────────▼───┐      ┌────▼──────────────────┐
                        │  Side Panel   │      │  Offscreen doc         │
                        │  (React/SPA)  │      │  (download persistente)│
                        │  • lista/filtra│     │  • HLS/DASH → MP4      │
                        │  • seleciona  │      │  • mux mp4box          │
                        │  • dispara ZIP│      │  • ZIP + grava no disco│
                        └───────────────┘      └────────────────────────┘
```

### Por que um Offscreen document?

O **Service Worker** do MV3 é suspenso a qualquer momento e **não tem acesso a
`ReadableStream`/`Response` de forma confiável** para trabalho de rede longo.
O **documento offscreen** (`offscreen.html`) é criado **somente quando o usuário
inicia um download** (motivo `WORKERS`). Ele hospeda a conversão HLS/DASH + mux
**e também a orquestração do ZIP**, o que mantém o SW leve e faz o download
sobreviver ao fechamento do Side Panel.

```text
SW (leve)                         Offscreen (pesado, sob demanda)
─────────────                     ──────────────────────────────
• intercepta requisições          • baixa playlists/segmentos
• armazena itens                  • transmuxa HLS TS → fMP4
• resolve metadados (S1)          • muxa vídeo+áudio (mp4box)
• roteia mensagens                • escreve no OPFS
                                  • emite progresso
```

---

## Contexto 3 — Detecção de mídia

A captura usa **`chrome.webRequest.onHeadersReceived`** — o ponto mais cedo em
que é possível classificar sem baixar o corpo inteiro.

```text
 Requisição de resposta (aba)
            │
            ▼
 onHeadersReceived (URLs http/https, responseHeaders)
            │
            ├─ headersToRecord()  → mapa minúsculo (content-type, content-length, …)
            ├─ parseContentRangeTotal() → tamanho real em respostas parciais
            ├─ resolveTabInfo(tabId)    → URL/título da aba (cache)
            │
            ▼
 classifyResponse(ClassifyInput)   ← @repo/media
            │  content-type + content-disposition + tamanho + aba
            ▼
 ClassifiedMedia (kind, streamType?, filename?, size?, …)
            │
            ▼
 saveMedia() → chrome.storage.session["media"]  (writeQueue serializada, máx. 2000)
```

### Classificação

`@repo/media/classify.ts` decide:

- **`kind`**: `video` | `audio` | `image` | `document` | `archive` | `other`.
- **`streamType`**: `hls` (`.m3u8`), `dash` (`.mpd`), ou `undefined` (arquivo comum).
- **`filename`**: a partir de `content-disposition` ou do path da URL.

```text
 content-type: video/mp2t  ──▶ kind=video, streamType=hls (se .m3u8)
 content-type: application/dash+xml ──▶ streamType=dash
 content-type: video/mp4   ──▶ kind=video (download direto, já tem áudio)
```

### Etapa S1 — enriquecimento de manifestos

Assim que um item é salvo e é stream, o SW resolve **metadados** (sem baixar
segmentos) e mescla no item:

```text
 saveMedia(item)
      │  item.streamType? (hls/dash)
      ▼
 enrichStream(item) ──▶ resolveStreamInfo({url, streamType})  ← @repo/streams
      │                     │
      │                     ├─ HLS: parseHlsManifest(master) + selectVariant("best")
      │                     │        + parseHlsManifest(variante) → duração/container
      │                     └─ DASH: parseDashManifest + estimateBytes
      ▼
 mescla em item.stream: variants, durationSeconds, estimatedBytes,
 container, encryption, live, renditionUrls, audioRenditions
```

### Dedupe: o master HLS "vence"

Um master HLS referencia rendições (vídeo/áudio/legenda) que também aparecem como
requisições separadas. Sem dedupe, cada rendição viraria um download "lixo".

```text
 master.m3u8 (item A) ──▶ renditionUrls = [720.m3u8, 480.m3u8, audio-en.m3u8, …]
                              │
                              ▼
              knownRenditionUrls.add(...)   (Set em memória do SW)
              removeItemsByUrls(renditionUrls)  (remove itens já capturados)

 rendição já capturada antes do master? ──▶ knownRenditionUrls.has(url) ──▶ remove
```

Resultado: só o **master** fica na lista; as rendições nunca viram downloads
separados.

---

## Contexto 4 — Download & ZIP em streaming

O objetivo central: **baixar N arquivos e compactar em um único ZIP sem estourar a
RAM**. A mídia já é comprimida, então o ZIP usa **client-zip em modo
store-only** (sem recompressão).

### Fluxo do clique em "Baixar" (persistente)

```text
 Usuário clica em "Baixar N (.zip)"        [Side Panel, dentro do gesto]
            │
            ├─ 1. showSaveFilePicker()          ← gesto do usuário
            │       └─ handle → IndexedDB (chave = jobId)
            │
            ├─ 2. runtime.sendMessage("downloads.start")
            │       └─ { jobId, zipName, items[], policy }
            │
            ▼  Service Worker
            ├─ ensureOffscreen()  (cria OU reaproveita um offscreen vivo)
            └─ encaminha "downloads.start.offscreen"
            │
            ▼  Offscreen document   ← o download roda AQUI (sobrevive ao painel)
            ├─ cleanupOpfs()
            ├─ buildDownloadSources(items, policy, signal)
            ├─ createSink():
            │     ├─ handle do IndexedDB → createWritable() → grava DIRETO no disco
            │     └─ fallback: ZIP no OPFS (status "ready")
            └─ createZipStream(sources) → sink.write(...)   (store-only)
                 │
                 └─ emite "downloads.state" a cada progresso
                       ├─ Service Worker: persiste em storage.session["downloadJob"]
                       └─ Side Panel: atualiza as duas barras ao vivo

 Fechar o painel no meio? O offscreen continua baixando.
 Reabrir? Lê o snapshot de storage.session → reconecta no progresso.
```

> **Persistência:** o *writer* (ZIP) e o *producer* (conversão) vivem no offscreen,
> não no painel. O `FileSystemFileHandle` viaja pelo **IndexedDB** (mesma origem da
> extensão). Se o offscreen não conseguir usá-lo, o ZIP é montado no OPFS e o painel
> mostra **"Salvar ZIP"**.

### Pipeline de streaming

```text
 DownloadSource.open()                       (construído no offscreen)
      │
      ├─ HLS conversível ──▶ openHlsStream()  ──▶ body fMP4 (+ mux mp4box)
      ├─ DASH            ──▶ openDashTrack()  ──▶ body fMP4
      └─ arquivo comum   ──▶ urlSource()      ──▶ fetch(url) → Response.body
                                     │
                                     ▼
                     createZipStream() → makeZip (store-only)
                                     │
                                     ▼
              sinkFromFileHandle() → pipeTo(writable)   → disco
              (fallback: writeOpfsFile → storage.session["downloadJob"])
```

Nada fica inteiro em memória: cada fonte é aberta, lida e descartada na ordem do
ZIP. A exceção é o **remux mp4box**, que precisa do áudio+vídeo em memória (veja
Contexto 5) — com limite de tamanho e fallback.

### Semântica de progresso (duas barras)

| Barra | Métrica | Significado |
| --- | --- | --- |
| **Download** | `filePercent` | Progresso do **arquivo atual** (para streams: `subIndex`/`subTotal` segmentos) |
| **ZIP** | `overallPercent` | **Arquivos concluídos ÷ total** |

Ambas **resetam ao finalizar** (sucesso, erro ou cancelamento).

---

## Contexto 5 — Conversão de streams

A conversão vive no **documento offscreen**, acionada sob demanda por cada entrada
do ZIP. O resultado é sempre um **MP4 fragmentado** (fMP4).

### HLS → MP4

```text
 master.m3u8
      │ parseHlsManifest()
      ├─ variants[]         (EXT-X-STREAM-INF)
      ├─ renditionUrls[]    (dedupe no SW)
      └─ audioRenditions[]  (EXT-X-MEDIA TYPE=AUDIO)
      │
      │ selectVariant(policy)  ← "best" | "balanced"(720p) | "smallest"
      ▼
 variante.m3u8 (media playlist)
      │ buildHlsPlan()  → segments[], initUrl, container (ts|fmp4), encryption
      │ assertPlayable(): recusa LIVE e SAMPLE-AES
      ▼
 ┌───────────────────────────────────────────────────────────┐
 │ 1. Áudio separado?                                         │
 │    selectAudioRendition(audioRenditions, variant.audioGroupId)
 │    ├─ SIM ─▶ baixa áudio.m3u8 + video → muxFmp4()         │
 │    │          (falha ⇒ fallback para vídeo sem áudio)      │
 │    └─ NÃO ─▶ só vídeo → openTrackStream()                  │
 └───────────────────────────────────────────────────────────┘
      │
      ▼
 MP4 (fMP4) → writeOpfsFile() → vira entrada do ZIP
```

`openTrackStream` (em `@repo/streams/src/mp4/track.ts`) cobre:

- **fMP4** → concatena segmentos + init (sem re-encode).
- **TS** → transmuxa via **mux.js** para fMP4.
- **single file** → passa direto.

### Mux de áudio separado (mp4box.js)

Playlists HLS **demuxadas** (ex.: HLS CMAF com `EXT-X-MEDIA TYPE=AUDIO`) separam
áudio e vídeo. O `openHlsStream` baixa os dois e chama `muxFmp4`:

```text
 vídeo fMP4 (avc1)      áudio fMP4 (mp4a)
      │                        │
      ▼                        ▼
 demuxTrack()            demuxTrack()      (mp4box, lazy import)
   copia avcC              copia esds
      └───────────┬────────────┘
                  ▼
 remux: createFile() + addTrack(description_boxes) + addSample(ordenado por DTS)
                  ▼
 MP4 único (avc1 + mp4a) → getBuffer() → DataStream → bytes
```

Regras do mux (`@repo/streams/src/mux/mp4box.ts`):

- **Whitelist de codecs**: vídeo `avc*` (H.264) + áudio `mp4a*` (AAC).
- **Limite de memória**: `DEFAULT_MUX_MAX_BYTES = 512 MiB` (vídeo + áudio).
- **Nunca quebra o ZIP**: qualquer falha (áudio ausente, codec não suportado,
  limite excedido) **cai no fallback de vídeo sem áudio**.

### DASH → MP4

```text
 MPD (.mpd)
     │ parseDashManifest() → buildDashPlan()
     │   SegmentTemplate | SegmentList | SegmentBase
     ▼
 tracks[] = [video, audio?]     (resolveDashTracks)
     │
     ├─ video → openDashTrack → fMP4 concat → base.mp4
     └─ audio → openDashTrack → fMP4 concat → base.audio.m4a
```

DASH entrega **dois arquivos** (vídeo `.mp4` + áudio `.m4a`), diferente do HLS que
agora entrega **um único `.mp4`** quando muxa.

### Offscreen: ciclo de vida de um download

```text
 Offscreen recebe downloads.start.offscreen
      │
      ├─ cleanupOpfs()                    (oportunista, ver Contexto 6)
      ├─ buildDownloadSources(items, policy, signal)
      ├─ createSink(): handle do IndexedDB  OU  OPFS (fallback)
      ├─ createZipStream(sources) → sink.write(...)
      │
      └─ emite downloads.state { status, filePercent, overallPercent, … }
           running → done | ready | error | cancelled
```

Cancelamento: `downloads.cancel.offscreen` → `AbortController` do job ativo.

---

## Contexto 6 — Persistência

Três camadas, com propósitos distintos:

```text
 chrome.storage.session           IndexedDB              OPFS
 ──────────────────────           ─────────              ────
 • itens capturados ("media")     • FileSystemFileHandle • ZIP temporário
 • metadados enriquecidos (S1)      do arquivo escolhido   (fallback "ready")
 • estado do download             • chave = jobId        • dir "media-pack-cache"
 • some ao fechar o navegador     • some ao apagar       • persiste até limpar
 • máx. 2000 itens
```

### Estado do download (reconexão do painel)

```text
 service worker                    side panel (ao reabrir)
 ──────────────                    ────────────────────────
 downloads.state (offscreen)       lê storage.session["downloadJob"]
      │ throttle 300ms              │
      ▼                             ▼
 storage.session["downloadJob"]    remonta as duas barras (running)
   { status, filePercent,          ou o botão "Salvar ZIP" (ready)
     overallPercent, stagedName? }
```

Estados: `running` → `done` (gravou no disco) | `ready` (ZIP no OPFS) | `error` | `cancelled`.
Ao chegar num estado terminal, o service worker fecha o offscreen.

### Handles e staging

```text
 FileSystemFileHandle                     OPFS (/media-pack-cache)
 ────────────────────                     ────────────────────────
 painel: showSaveFilePicker()             fallback quando o handle não serve
      │ structured clone                   │ writeOpfsFile("<job>.zip")
      ▼                                     ▼
 IndexedDB "handles" (chave jobId) ──▶ offscreen: createWritable() → disco
                                              │
                            "Salvar ZIP" → opfsSource() → disco → delete
```

Política de limpeza (`DEFAULT_OPFS_POLICY`):

| Critério | Valor |
| --- | --- |
| Idade máxima | 30 min |
| Tamanho máximo total | 1 GiB |
| Máximo de arquivos | 12 |

`selectOpfsEntriesForDeletion` escolhe os mais velhos até voltar aos limites.
Toda conversão começa com `cleanupOpfs()`, então arquivos órfãos (ex.: extensão
fechada no meio) são varridos no próximo download.

---

## Contexto 7 — UI & tema

O Side Panel é uma SPA React (Vite) consumindo `@repo/ui` (shadcn).

```text
 Side Panel (React)
 ├─ Header:  logo | título | badge "selecionados/total" | ModeToggle | limpar
 ├─ Card "Captura":
 │    • botões de tipo (auto-seleção = filtro de visibilidade)
 │    • tamanho mínimo | qualidade do stream | aba (atual/todas)
 │    • busca (nome/URL/página)
 │    • selecionar todos / limpar seleção
 ├─ Lista de mídias (checkbox + ícone + nome + metadados + badge de tipo)
 └─ Footer:
      • barras "Download" (filePercent) e "ZIP" (overallPercent)
      • botão "Baixar N (.zip)" | Cancelar
```

### Auto-seleção = filtro de visibilidade + auto-seleção

`matchesKind(item, prefs.autoSelectKinds)` filtra a lista, e `shouldAutoSelect`
marca os itens por padrão. O usuário pode sobrescrever item a item (`overrides`).

### Tema (light/dark/system)

Implementação conforme o **doc de Vite do shadcn** (provider próprio, **sem
next-themes**):

```text
 ThemeProvider (@repo/ui)
   ├─ localStorage "theme"  ("light" | "dark" | "system")
   ├─ matchMedia("(prefers-color-scheme: dark)") para "system"
   └─ aplica classe .dark no <html>
            │
 ModeToggle (dropdown Claro/Escuro/Sistema) no header do Side Panel
```

---

## Contexto 8 — Qualidade, build & e2e

```text
 pnpm check          Biome (lint + format)
 pnpm typecheck      tsc --noEmit em cada pacote/app
 pnpm test           Vitest (unit + integração por pacote)
 pnpm build          Vite (extensão) — emite dist/ com chunks lazy
 pnpm test:e2e       Vitest e2e do side panel
```

- **Lazy chunks**: `mp4box.all-*.js` só é carregado pelo offscreen (dynamic
  `import("mp4box")`), mantendo o bundle do side panel enxuto.
- Testes de streams cobrem HLS/DASH (manifest, plan, convert), AES-128,
  `resolveStreamInfo` e o **round-trip de mux** (gera fMP4 → demux → remux → relê).

---

## Decisões de arquitetura

| Decisão | Motivo |
| --- | --- |
| pnpm + Turborepo + catálogo | Monorepo com versões centralizadas e cache de tasks |
| Biome apenas | Tooling único, sem Prettier/ESLint |
| Side Panel (não popup) | Superfície fixa, ideal para lista + download em lote |
| Detecção via `webRequest.onHeadersReceived` | Classificação precoce, sem baixar corpos |
| `chrome.storage.session` para itens | Sessão efêmera, sem lixo permanente |
| client-zip store-only | Mídia já comprimida; evita recompressão |
| ZIP em streaming + File System Access | Não estoura RAM em downloads grandes |
| Offscreen document sob demanda | SW é suspenso; o download precisa de contexto vivo |
| Download orquestrado no offscreen | Fechar o side panel não interrompe o ZIP |
| Estado do job em `storage.session` | Painel se reconecta ao progresso ao reabrir |
| Handle do arquivo via IndexedDB | Painel escolhe (gesto), offscreen grava (persistência) |
| OPFS como fallback do ZIP | Funciona sem File System Access/permissão válida |
| Handshake `streams.ready` | Evita mensagem perdida antes do listener do offscreen |
| master HLS vence rendições | Evita downloads "lixo" de variantes/áudio/legenda |
| mp4box lazy + limite 512 MiB + fallback | Junta áudio demuxado sem risco de travar o ZIP |

---

## Fases do plano & roadmap

```text
 Fase A  Detecção + ZIP em streaming ............ ✅
 Fase B  HLS → MP4 (mux.js, AES-128) ............ ✅
 Fase C  DASH → MP4 ............................. ✅
 Fase D  Offscreen + OPFS + lazy conversion ...... ✅
 Fase E  Mux mp4box (áudio separado HLS) ......... ✅
 Fase F  Download persistente (offscreen + IDB) .. ✅
   └─ futuro: mux DASH em um único MP4
   └─ futuro: áudio não-AAC (fallback/transcode)
   └─ futuro: suporte a LIVE (se viável)
```

> **Como navegar no código:** comece por `apps/ext/src/background/index.ts`
> (detecção/roteamento), depois `apps/ext/src/offscreen/downloads.ts` (download
> persistente + ZIP) e `apps/ext/src/sidepanel/App.tsx` (UI). Os pacotes
> `@repo/*` são bibliotecas puras, testáveis em Node, sem acoplamento ao Chrome.
