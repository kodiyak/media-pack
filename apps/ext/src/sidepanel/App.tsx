import {
  buildZipName,
  canUseFileSystemAccess,
  createZipStream,
  type DownloadSource,
  prepareZipSink,
  toErrorMessage,
  urlSource,
  type ZipProgressEvent,
} from "@repo/downloader";
import {
  formatBytes,
  formatDuration,
  KIND_LABELS,
  MEDIA_KINDS,
  matchesKind,
  matchesQuery,
  matchesTab,
  STREAM_LABELS,
  selectVariant,
  shouldAutoSelect,
  variantLabel,
} from "@repo/media";
import type { MediaItem, MediaKind, StreamVariantPolicy } from "@repo/protocol";
import {
  hlsOutputFilename,
  openDashTrack,
  openHlsStream,
  resolveDashTracks,
  streamBaseName,
} from "@repo/streams";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
  ModeToggle,
  Progress,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Toaster,
  toast,
} from "@repo/ui";
import {
  Download,
  FileArchive,
  File as FileIcon,
  FileText,
  Image as ImageIcon,
  Layers,
  Music,
  Search,
  Trash2,
  Video,
} from "lucide-react";
import { type ComponentType, useCallback, useId, useMemo, useRef, useState } from "react";
import { useCollectedMedia, useCurrentTabId, useMediaPrefs } from "./hooks";
import { clearStoredMedia } from "./lib/chrome";

const KIND_ICONS: Record<MediaKind, ComponentType<{ className?: string }>> = {
  video: Video,
  audio: Music,
  image: ImageIcon,
  document: FileText,
  archive: FileArchive,
  other: FileIcon,
};

const SIZE_OPTIONS: { label: string; value: number }[] = [
  { label: "Qualquer tamanho", value: 0 },
  { label: "Mais de 100 KB", value: 100 * 1024 },
  { label: "Mais de 1 MB", value: 1024 * 1024 },
  { label: "Mais de 10 MB", value: 10 * 1024 * 1024 },
];

const STREAM_QUALITY_OPTIONS: { label: string; value: StreamVariantPolicy }[] = [
  { label: "Melhor qualidade", value: "best" },
  { label: "Equilibrada (720p)", value: "balanced" },
  { label: "Menor", value: "smallest" },
];

type ProgressState = {
  label: string;
  detail: string;
  percent: number;
};

export function App() {
  const media = useCollectedMedia();
  const currentTabId = useCurrentTabId();
  const [prefs, updatePrefs] = useMediaPrefs();

  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState("");
  const [downloadJob, setDownloadJob] = useState<ProgressState | null>(null);
  const [zipJob, setZipJob] = useState<ProgressState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const searchId = useId();

  const visible = useMemo(
    () =>
      media.filter(
        (item) =>
          matchesKind(item, prefs.autoSelectKinds) &&
          matchesTab(item, currentTabId, prefs.onlyCurrentTab) &&
          matchesQuery(item, query),
      ),
    [media, currentTabId, prefs.onlyCurrentTab, prefs.autoSelectKinds, query],
  );

  const isSelected = useCallback(
    (item: MediaItem) => overrides[item.id] ?? shouldAutoSelect(item, prefs),
    [overrides, prefs],
  );

  const selected = useMemo(() => visible.filter(isSelected), [visible, isSelected]);

  const toggleItem = useCallback(
    (item: MediaItem) => {
      setOverrides((current) => ({ ...current, [item.id]: !isSelected(item) }));
    },
    [isSelected],
  );

  const setAllVisible = useCallback(
    (value: boolean) => {
      setOverrides((current) => {
        const next = { ...current };
        for (const item of visible) next[item.id] = value;
        return next;
      });
    },
    [visible],
  );

  const toggleKind = useCallback(
    (kind: MediaKind) => {
      updatePrefs({
        autoSelectKinds: prefs.autoSelectKinds.includes(kind)
          ? prefs.autoSelectKinds.filter((entry) => entry !== kind)
          : [...prefs.autoSelectKinds, kind],
      });
    },
    [prefs.autoSelectKinds, updatePrefs],
  );

  const handleClear = useCallback(() => {
    void clearStoredMedia();
    setOverrides({});
    setDownloadJob(null);
    setZipJob(null);
    setError(null);
  }, []);

  const handleDownload = useCallback(async () => {
    if (busy || selected.length === 0) return;

    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError(null);
    setDownloadJob({ label: "Preparando…", detail: "", percent: 0 });
    setZipJob({ label: "Preparando…", detail: "", percent: 0 });

    const onProgress = (event: ZipProgressEvent) => {
      if (event.phase === "error") {
        setError(`Falhou: ${event.filename} (${event.error})`);
      }

      // Barra 1: progresso do arquivo atual.
      const segments = event.subTotal ? ` · ${event.subIndex ?? 0}/${event.subTotal} seg` : "";
      setDownloadJob({
        label: `Baixando ${event.filename}`,
        detail: `${formatBytes(event.loadedBytes)}${
          event.totalBytes ? ` / ${formatBytes(event.totalBytes)}` : ""
        }${segments}`,
        percent: event.filePercent,
      });

      // Barra 2: vídeos baixados comparados ao total.
      setZipJob({
        label: "Baixando vídeos…",
        detail: `${Math.min(event.index + 1, event.total)}/${event.total}`,
        percent: event.overallPercent,
      });
    };

    type Sink = Awaited<ReturnType<typeof prepareZipSink>>;
    let sink: Sink | null = null;

    try {
      // O seletor de arquivo precisa acontecer dentro do gesto do usuário.
      sink = await prepareZipSink(buildZipName());

      // Resolve as fontes (DASH precisa do manifesto antes de escrever o ZIP).
      const sources = await buildSources(selected, prefs.streamVariantPolicy, controller.signal);
      setZipJob({ label: "Baixando…", detail: `0/${sources.length}`, percent: 0 });

      await sink.write(createZipStream(sources, { signal: controller.signal, onProgress }));

      toast.success("ZIP salvo", { description: sink.name });

      // Finalizado: reseta o progresso.
      setDownloadJob(null);
      setZipJob(null);
    } catch (cause) {
      if (controller.signal.aborted) {
        await sink?.abort();
        toast.info("Download cancelado");
        setDownloadJob(null);
        setZipJob(null);
      } else {
        setError(toErrorMessage(cause));
        toast.error("Falha no download", { description: toErrorMessage(cause) });
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }, [busy, selected, prefs.streamVariantPolicy]);

  return (
    <main className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <Layers className="size-5 text-primary" />
        <h1 className="mr-auto text-base font-semibold">Media Pack</h1>
        <Badge variant="secondary">
          {selected.length}/{visible.length}
        </Badge>
        <ModeToggle />
        <Button
          variant="ghost"
          size="icon"
          aria-label="Limpar lista"
          disabled={media.length === 0}
          onClick={handleClear}
        >
          <Trash2 />
        </Button>
      </header>

      <Card className="m-4 gap-3 py-4">
        <CardHeader className="gap-1">
          <CardTitle className="text-sm">Captura</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Mostrar e auto-selecionar</span>
            <div className="flex flex-wrap gap-1.5">
              {MEDIA_KINDS.map((kind) => (
                <Button
                  key={kind}
                  size="sm"
                  variant={prefs.autoSelectKinds.includes(kind) ? "default" : "outline"}
                  onClick={() => toggleKind(kind)}
                >
                  {KIND_LABELS[kind]}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Tamanho mínimo</span>
              <Select
                value={String(prefs.minSizeInBytes)}
                onValueChange={(value) => updatePrefs({ minSizeInBytes: Number(value) })}
              >
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SIZE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={String(option.value)}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Qualidade do stream</span>
              <Select
                value={prefs.streamVariantPolicy}
                onValueChange={(value) =>
                  updatePrefs({ streamVariantPolicy: value as StreamVariantPolicy })
                }
              >
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STREAM_QUALITY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Aba</span>
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  variant={prefs.onlyCurrentTab ? "default" : "outline"}
                  onClick={() => updatePrefs({ onlyCurrentTab: true })}
                >
                  Aba atual
                </Button>
                <Button
                  size="sm"
                  variant={!prefs.onlyCurrentTab ? "default" : "outline"}
                  onClick={() => updatePrefs({ onlyCurrentTab: false })}
                >
                  Todas
                </Button>
              </div>
            </div>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id={searchId}
              className="pl-8"
              placeholder="Buscar por nome, URL ou página"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>

          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant="outline"
              disabled={visible.length === 0}
              onClick={() => setAllVisible(true)}
            >
              Selecionar todos
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={visible.length === 0}
              onClick={() => setAllVisible(false)}
            >
              Limpar seleção
            </Button>
          </div>
        </CardContent>
      </Card>

      <section className="flex-1 overflow-y-auto px-4">
        {visible.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {media.length === 0
              ? "Abra uma página com mídia para começar a coletar."
              : "Nenhuma mídia corresponde aos filtros."}
          </p>
        ) : (
          <ul className="flex flex-col divide-y">
            {visible.map((item) => {
              const Icon = KIND_ICONS[item.kind];
              return (
                <li key={item.id}>
                  <div className="flex items-center gap-3 py-2">
                    <Checkbox
                      aria-label={`Selecionar ${item.filename ?? item.url}`}
                      checked={isSelected(item)}
                      onCheckedChange={() => toggleItem(item)}
                    />
                    <Icon className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{item.filename ?? item.url}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {describeItem(item, prefs.streamVariantPolicy)}
                      </p>
                    </div>
                    <Badge variant="secondary">{KIND_LABELS[item.kind]}</Badge>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <footer className="sticky bottom-0 flex flex-col gap-2 border-t bg-background p-4">
        {downloadJob || zipJob ? (
          <div className="flex flex-col gap-3 rounded-md border bg-muted/30 p-3">
            <ProgressRow label="Download" job={downloadJob} />
            <ProgressRow label="ZIP" job={zipJob} />
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}

        <div className="flex gap-2">
          <Button
            className="flex-1"
            disabled={busy || selected.length === 0}
            onClick={() => void handleDownload()}
          >
            <Download />
            {busy ? "Processando…" : `Baixar ${selected.length} (.zip)`}
          </Button>
          {busy ? (
            <Button variant="outline" onClick={() => abortRef.current?.abort()}>
              Cancelar
            </Button>
          ) : null}
        </div>

        <p className="text-xs text-muted-foreground">
          {canUseFileSystemAccess()
            ? "Baixa tudo e grava o ZIP em streaming direto no disco."
            : "Seu navegador vai baixar o ZIP pela memória."}
        </p>
      </footer>

      <Toaster position="top-center" />
    </main>
  );
}

function ProgressRow({ label, job }: { label: string; job: ProgressState | null }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">{Math.round(job?.percent ?? 0)}%</span>
      </div>
      <Progress value={job?.percent ?? 0} />
      <span className="truncate text-xs text-muted-foreground">
        {job ? `${job.label} · ${job.detail}` : "Aguardando…"}
      </span>
    </div>
  );
}

/** Monta as fontes do ZIP: HLS converte na hora, DASH vira vídeo + áudio. */
async function buildSources(
  items: MediaItem[],
  policy: StreamVariantPolicy,
  signal: AbortSignal,
): Promise<DownloadSource[]> {
  const sources: DownloadSource[] = [];

  for (const item of items) {
    if (isConvertibleHls(item)) {
      sources.push({
        filename: hlsOutputFilename(item),
        open: (openSignal, onProgress) =>
          openHlsStream({ url: item.url, policy, signal: openSignal, onProgress }),
      });
      continue;
    }

    if (item.streamType === "dash") {
      sources.push(...(await buildDashSources(item, policy, signal)));
      continue;
    }

    sources.push(urlSource(item.url, item.filename ?? `media-${item.id}`));
  }

  return sources;
}

async function buildDashSources(
  item: MediaItem,
  policy: StreamVariantPolicy,
  signal: AbortSignal,
): Promise<DownloadSource[]> {
  const base = streamBaseName(item);

  try {
    const { tracks } = await resolveDashTracks({ url: item.url, policy, signal });
    return tracks.map((track) => ({
      filename: track.kind === "video" ? `${base}.mp4` : `${base}.audio.m4a`,
      open: (openSignal, onProgress) =>
        openDashTrack(track.plan, { signal: openSignal, onProgress }),
    }));
  } catch (error) {
    const message = toErrorMessage(error);
    return [
      {
        filename: `${base}.mp4`,
        open: async () => {
          throw new Error(message);
        },
      },
    ];
  }
}

/** Só converte HLS VOD sem DRM; o resto cai no download direto. */
function isConvertibleHls(item: MediaItem): boolean {
  if (item.streamType !== "hls") return false;

  const { stream } = item;
  if (!stream) return true;
  return !stream.live && stream.encryption !== "sample-aes";
}

/** Linha de metadados do item (streams mostram qualidade/duração/tamanho). */
function describeItem(item: MediaItem, policy: StreamVariantPolicy): string {
  if (item.streamType) {
    const { stream } = item;
    if (!stream) return `${STREAM_LABELS[item.streamType]} · resolvendo…`;

    const parts = [STREAM_LABELS[item.streamType]];
    const variant = selectVariant(stream.variants ?? [], policy);
    if (variant) parts.push(variantLabel(variant));

    const duration = formatDuration(stream.durationSeconds ?? item.durationInSeconds);
    if (duration) parts.push(duration);

    const bytes = stream.estimatedBytes ?? item.sizeInBytes;
    if (bytes !== undefined) parts.push(`~${formatBytes(bytes)}`);

    if (stream.container) parts.push(stream.container.toUpperCase());
    if (stream.encryption && stream.encryption !== "none") {
      parts.push(stream.encryption.toUpperCase());
    }
    if (stream.live) parts.push("Ao vivo");

    return parts.join(" · ");
  }

  return `${item.mimeType ?? KIND_LABELS[item.kind]} · ${formatBytes(item.sizeInBytes)}`;
}
