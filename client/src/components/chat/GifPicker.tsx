import { useEffect, useRef, useState } from "react";
import { IconImage, IconSearch, IconSticker, IconX } from "../ui/Icon";
import { fetchStickers, type PackSticker } from "../../lib/api";

interface Props {
  /** Which tab is shown when the panel opens (composer opens on the pack). */
  initialMode?: "pack" | "gif" | "sticker";
  /** Pack sticker picked: send it instantly by reference (no upload). */
  onPickPackSticker: (mediaId: string) => void;
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
 * Sticker / GIF picker, custom-first.
 *
 * 1. **Pack** tab — the project's Cloudinary sticker pack (metadata from
 *    `GET /api/stickers`); picking sends instantly by reference, no upload.
 *    Hidden when the server says the pack isn't configured (404).
 * 2. "Make a sticker" / "Upload a GIF" — always available.
 * 3. **GIF** / **Sticker** tabs — Giphy search runs server-side
 *    (`GET /api/giphy`) so the key stays server-side; hidden once the server
 *    says the key is missing (503). Picked media is fetched from Giphy's CDN
 *    and funneled into the normal upload path, so it stays ephemeral.
 */
export function GifPicker({
  initialMode = "pack",
  onPickPackSticker,
  onPickGif,
  onPickSticker,
  onPickStickerFromImage,
  onPickFile,
  onClose,
}: Props) {
  const [mode, setMode] = useState<"pack" | "gif" | "sticker">(initialMode);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GifEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const seq = useRef(0);
  // Search is available until the server says the key is missing (503).
  const [searchEnabled, setSearchEnabled] = useState(true);
  const [pack, setPack] = useState<PackSticker[] | null | undefined>(undefined);
  // Latest pack for the async callbacks below (functional setState reads the
  // live mode; pack is only readable through a ref there).
  const packRef = useRef(pack);
  useEffect(() => {
    packRef.current = pack;
  }, [pack]);

  useEffect(() => {
    let cancelled = false;
    fetchStickers().then((list) => {
      if (cancelled) return;
      setPack(list);
      // No pack → don't strand the user on the pack tab (mode read live via
      // the functional update).
      setMode((m) => (list === null && m === "pack" ? "sticker" : m));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (mode === "pack") return;
    const q = query.trim();
    const mySeq = ++seq.current;
    const kind = mode === "sticker" ? "stickers" : "gifs";
    const url = new URL(
      q
        ? `/api/giphy?kind=${kind}&q=${encodeURIComponent(q)}`
        : `/api/giphy?kind=${kind}`,
      window.location.origin,
    );

    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError("");
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
          // No Giphy key → jump to the pack (custom-first) when one exists.
          const p = packRef.current;
          setMode((m) =>
            m !== "pack" && p !== null && p !== undefined ? "pack" : m,
          );
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
              {([
                ...(pack !== undefined && pack !== null ? [["pack", "Pack"] as const] : []),
                ...(searchEnabled ? [["gif", "GIF"] as const, ["sticker", "Sticker"] as const] : []),
              ]).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setMode(id);
                    if (id === "pack") {
                      setResults([]);
                      setError("");
                    }
                  }}
                  aria-pressed={mode === id}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide transition-colors ${
                    mode === id
                      ? "bg-base-raised text-accent shadow-sm"
                      : "text-ink-faint hover:text-ink-muted"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {searchEnabled && mode !== "pack" && (
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
                  aria-label={`Search ${mode === "sticker" ? "stickers" : "GIFs"}`}
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
            {mode === "pack" ? (
              pack === undefined ? (
                <p className="py-4 text-center text-xs text-ink-faint">
                  Loading…
                </p>
              ) : pack !== null ? (
                <>
                  {pack.length > 0 ? (
                    <div className="grid grid-cols-4 gap-1.5">
                      {pack.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => onPickPackSticker(s.id)}
                          aria-label={s.name ?? "Choose sticker"}
                          className="group relative aspect-square overflow-hidden rounded-lg bg-base-border"
                        >
                          <img
                            src={s.url}
                            alt={s.name ?? ""}
                            loading="lazy"
                            draggable={false}
                            className="h-full w-full object-contain transition-opacity group-hover:opacity-80"
                          />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="py-4 text-center text-xs leading-relaxed text-ink-faint">
                      No stickers in the pack yet. Add images under the{" "}
                      <code className="rounded bg-base-border px-1">
                        cryo/stickers
                      </code>{" "}
                      folder in Cloudinary.
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={onPickStickerFromImage}
                    className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-base-border2 py-2.5 text-xs font-medium text-ink-muted transition-colors hover:bg-base-border"
                  >
                    <IconSticker width={16} height={16} />
                    Make a sticker
                  </button>
                </>
              ) : null
            ) : (
              <>
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
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}