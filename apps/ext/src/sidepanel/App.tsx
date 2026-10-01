import {
  buildZipName,
  canUseFileSystemAccess,
  createZipStream,
  saveStreamAsBlob,
  saveStreamWithPicker,
  type ZipProgressEvent,
} from "@repo/downloader";
import {
  formatBytes,
  KIND_LABELS,
  MEDIA_KINDS,
  matchesQuery,
  matchesTab,
  shouldAutoSelect,
} from "@repo/media";
import type { MediaItem, MediaKind } from "@repo/protocol";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
  Progress,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
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

type JobState = {
  done: number;
  total: number;
  label: string;
  percent: number;
  errors: number;
};

export function App() {
  const media = useCollectedMedia();
  const currentTabId = useCurrentTabId();
  const [prefs, updatePrefs] = useMediaPrefs();

  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState("");
  const [job, setJob] = useState<JobState | null>(null);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const searchId = useId();

  const visible = useMemo(
    () =>
      media.filter(
        (item) => matchesTab(item, currentTabId, prefs.onlyCurrentTab) && matchesQuery(item, query),
      ),
    [media, currentTabId, prefs.onlyCurrentTab, query],
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
    setJob(null);
  }, []);

  const handleDownload = useCallback(async () => {
    if (busy || selected.length === 0) return;

    const files = selected.map((item) => ({
      url: item.url,
      filename: item.filename ?? `media-${item.id}`,
    }));
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setJob({ done: 0, total: files.length, label: "Preparando…", percent: 0, errors: 0 });

    const onProgress = (event: ZipProgressEvent) => {
      setJob((current) => {
        const base = current ?? {
          done: 0,
          total: files.length,
          label: "",
          percent: 0,
          errors: 0,
        };
        if (event.phase === "fetching") {
          return {
            ...base,
            label: `Baixando ${event.filename}`,
            percent: (event.index / event.total) * 100,
          };
        }
        if (event.phase === "progress") {
          const fraction = event.totalBytes ? event.loadedBytes / event.totalBytes : 0;
          return {
            ...base,
            label: `Baixando ${event.filename}`,
            percent: ((event.index + fraction) / event.total) * 100,
          };
        }
        if (event.phase === "done") {
          return {
            ...base,
            done: event.index + 1,
            label: `${event.filename} adicionado`,
            percent: ((event.index + 1) / event.total) * 100,
          };
        }
        return { ...base, errors: base.errors + 1, label: `Falhou: ${event.filename}` };
      });
    };

    try {
      const stream = createZipStream(files, { onProgress, signal: controller.signal });
      const zipName = buildZipName();

      if (canUseFileSystemAccess()) {
        const saved = await saveStreamWithPicker(stream, zipName);
        setJob({
          done: files.length,
          total: files.length,
          label: `Salvo como ${saved}`,
          percent: 100,
          errors: 0,
        });
      } else {
        await saveStreamAsBlob(stream, zipName);
        setJob({
          done: files.length,
          total: files.length,
          label: `Baixado ${zipName}`,
          percent: 100,
          errors: 0,
        });
      }
    } catch (error) {
      if (controller.signal.aborted) {
        setJob(null);
      } else {
        setJob((current) => ({
          done: current?.done ?? 0,
          total: files.length,
          label: `Erro: ${error instanceof Error ? error.message : String(error)}`,
          percent: current?.percent ?? 0,
          errors: (current?.errors ?? 0) + 1,
        }));
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }, [busy, selected]);

  return (
    <main className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <Layers className="size-5 text-primary" />
        <h1 className="mr-auto text-base font-semibold">Media Pack</h1>
        <Badge variant="secondary">
          {selected.length}/{visible.length}
        </Badge>
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
            <span className="text-sm font-medium">Auto-selecionar tipo</span>
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
                        {item.mimeType ?? KIND_LABELS[item.kind]}
                        {item.streamType ? ` · ${item.streamType.toUpperCase()}` : ""} ·{" "}
                        {formatBytes(item.sizeInBytes)}
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
        {job ? (
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="truncate">{job.label}</span>
              <span className="shrink-0">
                {job.done}/{job.total}
                {job.errors > 0 ? ` · ${job.errors} falha(s)` : ""}
              </span>
            </div>
            <Progress value={job.percent} />
          </div>
        ) : null}

        <div className="flex gap-2">
          <Button
            className="flex-1"
            disabled={busy || selected.length === 0}
            onClick={() => void handleDownload()}
          >
            <Download />
            {busy ? "Baixando…" : `Baixar ${selected.length} (.zip)`}
          </Button>
          {busy ? (
            <Button variant="outline" onClick={() => abortRef.current?.abort()}>
              Cancelar
            </Button>
          ) : null}
        </div>

        <p className="text-xs text-muted-foreground">
          {canUseFileSystemAccess()
            ? "O ZIP é gravado em streaming direto no disco."
            : "Seu navegador vai baixar o ZIP pela memória."}
        </p>
      </footer>
    </main>
  );
}
