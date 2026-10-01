import {
  createPackInputSchema,
  type MediaItem,
  mediaItemSchema,
  type Pack,
  z,
} from "@repo/protocol";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Separator,
} from "@repo/ui";
import { FolderPlus, Images, Layers } from "lucide-react";
import { useEffect, useId, useState } from "react";

const MEDIA_KEY = "media";
const mediaListSchema = z.array(mediaItemSchema);

function hasExtensionApi(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);
}

/** Lê as mídias coletadas do storage; no navegador comum (dev:ui) fica vazio. */
function useCollectedMedia(): MediaItem[] {
  const [media, setMedia] = useState<MediaItem[]>([]);

  useEffect(() => {
    if (!hasExtensionApi()) return;

    let active = true;

    const apply = (value: unknown) => {
      const parsed = mediaListSchema.safeParse(value);
      if (active) setMedia(parsed.success ? parsed.data : []);
    };

    void chrome.storage.local.get(MEDIA_KEY).then((stored) => apply(stored[MEDIA_KEY]));

    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== "local") return;
      const change = changes[MEDIA_KEY];
      if (change) apply(change.newValue);
    };

    chrome.storage.onChanged.addListener(listener);
    return () => {
      active = false;
      chrome.storage.onChanged.removeListener(listener);
    };
  }, []);

  return media;
}

function createPack(name: string, description?: string): Pack {
  const now = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    name,
    description,
    status: "draft",
    items: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function App() {
  const inputId = useId();
  const media = useCollectedMedia();
  const [name, setName] = useState("");
  const [packs, setPacks] = useState<Pack[]>([]);
  const [error, setError] = useState<string | null>(null);

  function handleCreate() {
    const parsed = createPackInputSchema.safeParse({ name: name.trim() });

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Dados inválidos.");
      return;
    }

    setPacks((current) => [createPack(parsed.data.name, parsed.data.description), ...current]);
    setName("");
    setError(null);
  }

  return (
    <main className="flex min-h-screen flex-col gap-4 bg-background p-4">
      <header className="flex items-center gap-2">
        <Layers className="size-5 text-primary" />
        <h1 className="text-lg font-semibold">Media Pack</h1>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Images className="size-4" />
            Mídias coletadas ({media.length})
          </CardTitle>
          <CardDescription>Imagens encontradas nas páginas que você visitou.</CardDescription>
        </CardHeader>
        <CardContent>
          {media.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Abra uma página com imagens para começar a coletar.
            </p>
          ) : (
            <ul className="grid grid-cols-3 gap-2">
              {media.slice(0, 9).map((item) => (
                <li
                  key={item.id}
                  className="aspect-square overflow-hidden rounded-md border bg-muted"
                >
                  <img
                    src={item.url}
                    alt={item.filename ?? item.title ?? "Mídia coletada"}
                    loading="lazy"
                    className="size-full object-cover"
                  />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Separator />

      <Card>
        <CardHeader>
          <CardTitle>Criar pack</CardTitle>
          <CardDescription>Agrupe as mídias coletadas em um pack.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={inputId}>Nome do pack</Label>
            <Input
              id={inputId}
              value={name}
              placeholder="Ex.: Referências de design"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") handleCreate();
              }}
            />
          </div>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <Button onClick={handleCreate}>
            <FolderPlus />
            Criar pack
          </Button>
        </CardContent>
      </Card>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">Packs ({packs.length})</h2>

        {packs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum pack criado ainda.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {packs.map((pack) => (
              <li key={pack.id}>
                <Card className="gap-2 py-4">
                  <CardContent className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{pack.name}</span>
                    <Badge variant="secondary">{pack.status}</Badge>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
