import { buildZipName, canUseFileSystemAccess, toErrorMessage } from "@repo/downloader";
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
import {
  type ComponentType,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useCollectedMedia, useCurrentTabId, useDownloadJob, useMediaPrefs } from "./hooks";
import { clearDownloadJob, clearStoredMedia } from "./lib/chrome";
import {
  cancelDownload,
  pickAndStoreFileHandle,
  saveStagedZip,
  startDownload,
} from "./lib/downloads";

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

export function App() {
  const media = useCollectedMedia();
  const currentTabId = useCurrentTabId();
  const [prefs, updatePrefs] = useMediaPrefs();

  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState("");
  const [job, setJob] = useDownloadJob();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handledJobRef = useRef<string | null>(null);
  const searchId = useId();

  const busy = starting || job?.status === "running";

  useEffect(() => {
    if (!job) return;
    const key = `${job.jobId}:${job.status}`;
    if (handledJobRef.current === key) return;

    if (job.status === "done") {
      handledJobRef.current = key;
      setError(null);
      toast.success("ZIP salvo", { description: job.zipName });
    } else if (job.status === "error") {
      handledJobRef.current = key;
      const message = job.error ?? "Falha no download.";
      setError(message);
      toast.error("Falha no download", { description: message });
    } else if (job.status === "cancelled") {
      handledJobRef.current = key;
      toast.info("Download cancelado");
    }
  }, [job]);

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
    setError(null);
  }, []);

  const handleDownload = useCallback(async () => {
    if (busy || selected.length === 0) return;

    const jobId = crypto.randomUUID();
    const zipName = buildZipName();
    setStarting(true);
    setError(null);

    try {
      // O seletor de arquivo precisa acontecer dentro do gesto do usuário; o handle
      // vai para o IndexedDB para o offscreen gravar mesmo se o painel fechar.
      if (canUseFileSystemAccess()) {
        await pickAndStoreFileHandle(jobId, zipName);
      }

      const response = await startDownload({
        jobId,
        zipName,
        items: selected,
        policy: prefs.streamVariantPolicy,
      });
      if (!response.ok) throw new Error(response.error ?? "Falha ao iniciar o download.");

      setJob({
        jobId,
        status: "running",
        zipName,
        total: selected.length,
        index: 0,
        filename: "",
        loadedBytes: 0,
        filePercent: 0,
        overallPercent: 0,
        updatedAt: new Date().toISOString(),
      });
    } catch (cause) {
      if (!isAbortError(cause)) {
        const message = toErrorMessage(cause);
        setError(message);
        toast.error("Falha no download", { description: message });
      }
    } finally {
      setStarting(false);
    }
  }, [busy, selected, prefs.streamVariantPolicy, setJob]);

  const handleCancel = useCallback(() => {
    if (job) cancelDownload(job.jobId);
  }, [job]);

  const handleSaveStaged = useCallback(async () => {
    if (job?.status !== "ready" || !job.stagedName) return;

    try {
      const name = await saveStagedZip(job.stagedName, job.zipName);
      toast.success("ZIP salvo", { description: name });
    } catch (cause) {
      if (!isAbortError(cause)) {
        const message = toErrorMessage(cause);
        setError(message);
        toast.error("Falha ao salvar", { description: message });
      }
    } finally {
      void clearDownloadJob();
      setJob(null);
    }
  }, [job, setJob]);

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
        {job?.status === "running" ? (
          <div className="flex flex-col gap-3 rounded-md border bg-muted/30 p-3">
            <ProgressRow
              label="Download"
              percent={job.filePercent}
              title={`Baixando ${job.filename || "…"}`}
              detail={`${formatBytes(job.loadedBytes)}${
                job.totalBytes ? ` / ${formatBytes(job.totalBytes)}` : ""
              }${job.subTotal ? ` · ${job.subIndex ?? 0}/${job.subTotal} seg` : ""}`}
            />
            <ProgressRow
              label="ZIP"
              percent={job.overallPercent}
              title="Baixando vídeos…"
              detail={`${Math.min(job.index + 1, job.total)}/${job.total}`}
            />
          </div>
        ) : null}

        {job?.status === "ready" ? (
          <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 p-3">
            <span className="text-xs text-muted-foreground">
              ZIP pronto ({job.zipName}). Escolha onde salvar.
            </span>
            <Button size="sm" onClick={() => void handleSaveStaged()}>
              Salvar ZIP
            </Button>
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
            <Button variant="outline" onClick={handleCancel}>
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

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function ProgressRow({
  label,
  percent,
  detail,
  title,
}: {
  label: string;
  percent: number;
  detail: string;
  title: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">{Math.round(percent)}%</span>
      </div>
      <Progress value={percent} />
      <span className="truncate text-xs text-muted-foreground">
        {title} · {detail}
      </span>
    </div>
  );
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
