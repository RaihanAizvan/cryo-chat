import { useEffect, useRef, useState } from "react";
import { IconImage, IconSearch, IconX } from "../ui/Icon";

interface Props {
  /** Called with a gif's bytes when the user picks one from the grid. */
  onPickGif: (file: File) => void;
  /** Called when the user chooses to upload their own .gif file. */
  onPickFile: () => void;
  onClose: () => void;
}

/** Tenor result entries we map over (see tenor.com/v2/search). */
interface TenorResult {
  id: string;
  title?: string;
  media_formats: Record<
    string,
    { url?: string; dimensions?: [number, number]; size?: number }
  >;
}

const TENOR_KEY = import.meta.env.VITE_TENOR_API_KEY?.trim() ?? "";

/**
 * GIF picker. With `VITE_TENOR_API_KEY` configured it shows a searchable Tenor
 * grid (trending until you type). Without it the panel still supports uploading
 * your own .gif files. Picked gifs are fetched client-side and funneled into
 * the same upload path as photos, so they stay ephemeral like everything else.
 */
export function GifPicker({ onPickGif, onPickFile, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TenorResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const seq = useRef(0);

  const searchEnabled = TENOR_KEY.length > 0;

  useEffect(() => {
    if (!searchEnabled) return;
    const q = query.trim();
    const mySeq = ++seq.current;
    setLoading(true);
    setError("");
    const url = new URL(
      q
        ? "https://tenor.com/v2/search"
        : "https://tenor.com/v2/trending",
    );
    url.searchParams.set("key", TENOR_KEY);
    url.searchParams.set("limit", "30");
    url.searchParams.set("media_filter", "minimal");
    url.searchParams.set("contentfilter", "moderate");
    if (q) url.searchParams.set("q", q);

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(url.toString());
        if (!res.ok) throw new Error("bad");
        const data = (await res.json()) as { results?: TenorResult[] };
        if (mySeq === seq.current && !cancelled) {
          setResults(data.results ?? []);
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
  }, [query, searchEnabled]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pick = async (r: TenorResult) => {
    if (busyId) return;
    const gif = r.media_formats["gif"] ?? r.media_formats["tinygif"];
    if (!gif?.url) return;
    setBusyId(r.id);
    try {
      const res = await fetch(gif.url);
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
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
              GIF
            </span>
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
                  placeholder="Search GIFs…"
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
                {results.map((r) => {
                  const src =
                    r.media_formats["tinygif"]?.url ??
                    r.media_formats["gif"]?.url;
                  if (!src) return null;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => void pick(r)}
                      disabled={busyId !== null}
                      aria-label={r.title ?? "Choose GIF"}
                      className="group relative aspect-video overflow-hidden rounded-lg bg-base-border"
                    >
                      <img
                        src={src}
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
                  );
                })}
              </div>
            )}

            {!searchEnabled && (
              <p className="mb-2 text-left text-[11px] leading-relaxed text-ink-faint">
                Set <code className="rounded bg-base-border px-1">VITE_TENOR_API_KEY</code>{" "}
                to search GIFs. You can still upload your own.
              </p>
            )}

            {loading && (
              <p className="py-4 text-center text-xs text-ink-faint">Loading GIFs…</p>
            )}
            {error && (
              <p className="py-2 text-center text-xs font-medium text-rose-400">
                {error}
              </p>
            )}
            {searchEnabled && !loading && results.length === 0 && !error && (
              <p className="py-4 text-center text-xs text-ink-faint">
                No GIFs found.
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