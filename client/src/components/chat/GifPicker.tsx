import { useEffect, useRef, useState } from "react";
import { IconImage, IconSearch, IconSticker, IconX } from "../ui/Icon";

interface Props {
  /** Which tab is shown when the panel opens (composer opens on stickers). */
  initialMode?: "gif" | "sticker";
  /** Called with a gif/sticker's bytes when the user picks one from the grid. */
  onPickGif: (file: File) => void;
  /** Stickers send instantly (WhatsApp-style) instead of opening the caption sheet. */
  onPickSticker: (file: File) => void;
  /** Sticker tab: user wants to build a sticker from one of their own images. */
  onPickStickerFromImage: () => void;
  /** GIF tab: upload the user's own .gif file. */
  onPickFile: () => void;
  onClose: () => void;
}

/** One server-proxied GIF/sticker result (id, title, preview, full). */
interface GifEntry {
  id: string;
  title?: string;
  preview: string;
  full: string;
}

/** Server returned 503 because GIPHY_API_KEY is not configured. */
class GiphyKeyError extends Error {}

/**
 * GIF / sticker picker. Search runs server-side (`GET /api/giphy`) so the
 * Giphy key can live in the server env (Abasthan root settings) instead of a
 * client build-time `VITE_` var. Without a configured key the panel still
 * supports uploading your own .gif files. Picked media is fetched client-side
 * from Giphy's CDN and funneled into the same upload path as photos, so it
 * stays ephemeral like everything else.
 */
export function GifPicker({
  initialMode = "gif",
  onPickGif,
  onPickSticker,
  onPickStickerFromImage,
  onPickFile,
  onClose,
}: Props) {
  const [mode, setMode] = useState<"gif" | "sticker">(initialMode);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GifEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const seq = useRef(0);
  // Search is available until the server says the key is missing (503).
  const [searchEnabled, setSearchEnabled] = useState(true);

  useEffect(() => {
    const q = query.trim();
    const mySeq = ++seq.current;
    setLoading(true);
    setError("");
    const kind = mode === "sticker" ? "stickers" : "gifs";
    const url = new URL(
      q
        ? `/api/giphy?kind=${kind}&q=${encodeURIComponent(q)}`
        : `/api/giphy?kind=${kind}`,
      window.location.origin,
    );

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(url.toString());
        if (!res.ok) {
          if (res.status === 503) {
            throw new GiphyKeyError();
          }
          throw new Error("bad");
        }
        const data = (await res.json()) as { results: GifEntry[] };
        if (mySeq === seq.current && !cancelled) {
          setResults(data.results);
        }
      } catch (e) {
        if (mySeq !== seq.current || cancelled) return;
        if (e instanceof GiphyKeyError) {
          setSearchEnabled(false);
          setResults([]);
        } else {
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
  }, [query, mode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pick = async (r: GifEntry) => {
    if (busyId || !r.full) return;
    setBusyId(r.id);
    try {
      const res = await fetch(r.full);
      if (!res.ok) throw new Error("fetch");
      const blob = await res.blob();
      const file = new File([blob], "gif.gif", { type: "image/gif" });
      if (mode === "sticker") {
        onPickSticker(file);
      } else {
        onPickGif(file);
      }
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
              <div className="grid grid-cols-4 gap-1.5">
                {results.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => void pick(r)}
                    disabled={busyId !== null}
                    aria-label={r.title ?? (mode === "sticker" ? "Choose sticker" : "Choose GIF")}
                    className={`group relative overflow-hidden rounded-lg bg-base-border ${
                      mode === "sticker" ? "aspect-square" : "aspect-video"
                    }`}
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
                Set{" "}
                <code className="rounded bg-base-border px-1">GIPHY_API_KEY</code>{" "}
                (server env) to
                search. You can still {mode === "sticker" ? "make your own." : "upload your own."}
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

            {mode === "sticker" ? (
              <button
                type="button"
                onClick={onPickStickerFromImage}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-base-border2 py-2.5 text-xs font-medium text-ink-muted transition-colors hover:bg-base-border"
              >
                <IconSticker width={16} height={16} />
                Make a sticker
              </button>
            ) : (
              <button
                type="button"
                onClick={onPickFile}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-base-border2 py-2.5 text-xs font-medium text-ink-muted transition-colors hover:bg-base-border"
              >
                <IconImage width={16} height={16} />
                Upload a GIF
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}