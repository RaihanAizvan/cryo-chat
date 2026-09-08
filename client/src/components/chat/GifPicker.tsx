import { useEffect, useRef, useState } from "react";
import { IconImage, IconSearch, IconX } from "../ui/Icon";

interface Props {
  /** Called with a gif's bytes when the user picks one from the grid. */
  onPickGif: (file: File) => void;
  /** Called when the user chooses to upload their own .gif file. */
  onPickFile: () => void;
  onClose: () => void;
}

/** One entry of Giphy's `data` array (see api.giphy.com/v1/gifs/search). */
interface GiphyResult {
  id: string;
  title?: string;
  images: Record<
    string,
    { url?: string; width?: string; height?: string; size?: string }
  >;
}

const GIPHY_KEY = import.meta.env.VITE_GIPHY_API_KEY?.trim() ?? "";

/** Pick a small animated preview and a full-quality version for uploading. */
function toGifEntry(r: GiphyResult): { id: string; title?: string; preview: string; full: string } {
  const preview =
    r.images["fixed_width_small"]?.url ??
    r.images["fixed_height_small"]?.url ??
    r.images["preview_gif"]?.url ??
    r.images["original"]?.url ??
    "";
  // Prefer `fixed_width` (~600px, a few hundred KB) over `downsized` (up to
  // ~8 MB) so uploads stay small like the user's own photos.
  const full =
    r.images["fixed_width"]?.url ??
    r.images["fixed_height"]?.url ??
    r.images["downsized"]?.url ??
    r.images["original"]?.url ??
    preview;
  return { id: r.id, title: r.title, preview, full };
}

/**
 * GIF / sticker picker. With `VITE_GIPHY_API_KEY` configured it shows a
 * searchable Giphy grid (trending until you type) for both animated GIFs and
 * stickers. Without it the panel still supports uploading your own .gif files.
 * Picked media is fetched client-side and funneled into the same upload path as
 * photos, so it stays ephemeral like everything else.
 */
export function GifPicker({ onPickGif, onPickFile, onClose }: Props) {
  const [mode, setMode] = useState<"gif" | "sticker">("gif");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ReturnType<typeof toGifEntry>[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const seq = useRef(0);

  const searchEnabled = GIPHY_KEY.length > 0;

  useEffect(() => {
    if (!searchEnabled) return;
    const q = query.trim();
    const mySeq = ++seq.current;
    setLoading(true);
    setError("");
    const kind = mode === "sticker" ? "stickers" : "gifs";
    const url = new URL(
      q
        ? `https://api.giphy.com/v1/${kind}/search`
        : `https://api.giphy.com/v1/${kind}/trending`,
    );
    url.searchParams.set("api_key", GIPHY_KEY);
    url.searchParams.set("limit", "28");
    url.searchParams.set("rating", "g");
    if (q) url.searchParams.set("q", q);

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(url.toString());
        if (!res.ok) throw new Error("bad");
        const data = (await res.json()) as { data?: GiphyResult[] };
        if (mySeq === seq.current && !cancelled) {
          setResults((data.data ?? []).map(toGifEntry));
        }
      } catch {
        if (mySeq === seq.current && !cancelled) {
          setError("GIF search isn't responding. Try again.");
          setResults([]);
        }
      } finally {
        if (mySeq === seq.current && !cancelled) setLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, searchEnabled, mode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pick = async (r: ReturnType<typeof toGifEntry>) => {
    if (busyId || !r.full) return;
    setBusyId(r.id);
    try {
      const res = await fetch(r.full);
      if (!res.ok) throw new Error("fetch");
      const blob = await res.blob();
      onPickGif(new File([blob], "gif.gif", { type: "image/gif" }));
    } catch {
      setError("Couldn't download that GIF. Try another.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-10" aria-hidden onClick={onClose} />
      <div className="absolute inset-x-0 bottom-full z-20 mx-auto max-w-2xl px-2 pb-1">
        <div className="cryo-pop rounded-2xl border border-base-border2 bg-base-raised p-3 shadow-xl">
          <div className="flex items-center gap-2">
            <div className="flex shrink-0 rounded-full bg-base-border p-0.5">
              {(["gif", "sticker"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide transition-colors ${
                    mode === m
                      ? "bg-base-raised text-accent shadow-sm"
                      : "text-ink-faint hover:text-ink-muted"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            {searchEnabled && (
              <div className="relative min-w-0 flex-1">
                <IconSearch
                  width={14}
                  height={14}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
                />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={`Search ${mode === "sticker" ? "stickers" : "GIFs"}…`}
                  className="w-full rounded-3xl border border-base-border2 bg-base py-1.5 pl-8 pr-3 text-[13px] text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
                />
              </div>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close GIF picker"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-base-border"
            >
              <IconX width={16} height={16} />
            </button>
          </div>

          <div className="mt-2.5 max-h-64 overflow-y-auto pr-0.5">
            {searchEnabled && results.length > 0 && (
              <div className="grid grid-cols-3 gap-1.5">
                {results.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => void pick(r)}
                    disabled={busyId !== null}
                    aria-label={r.title ?? "Choose GIF"}
                    className="group relative aspect-video overflow-hidden rounded-lg bg-base-border"
                  >
                    <img
                      src={r.preview}
                      alt={r.title ?? ""}
                      loading="lazy"
                      className={`h-full w-full object-cover transition-opacity ${
                        busyId === r.id ? "opacity-40" : "group-hover:opacity-80"
                      }`}
                    />
                    {busyId === r.id && (
                      <span className="absolute inset-0 flex items-center justify-center text-[11px] text-ink-muted">
                        …
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}

            {!searchEnabled && (
              <p className="mb-2 text-left text-[11px] leading-relaxed text-ink-faint">
                Set <code className="rounded bg-base-border px-1">VITE_GIPHY_API_KEY</code>{" "}
                to search GIFs. You can still upload your own.
              </p>
            )}

            {loading && (
              <p className="py-4 text-center text-xs text-ink-faint">Loading…</p>
            )}
            {error && (
              <p className="py-2 text-center text-xs font-medium text-rose-400">
                {error}
              </p>
            )}
            {searchEnabled && !loading && results.length === 0 && !error && (
              <p className="py-4 text-center text-xs text-ink-faint">
                No {mode === "sticker" ? "stickers" : "GIFs"} found.
              </p>
            )}

            <button
              type="button"
              onClick={onPickFile}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-base-border2 py-2.5 text-xs font-medium text-ink-muted transition-colors hover:bg-base-border"
            >
              <IconImage width={16} height={16} />
              Upload a GIF
            </button>
          </div>
        </div>
      </div>
    </>
  );
}