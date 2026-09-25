import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  IconEmoji,
  IconGrid,
  IconImage,
  IconSearch,
  IconSparkle,
  IconSticker,
} from "../ui/Icon";
import { EmojiPicker } from "./EmojiPicker";
import { peekStickers, preloadStickers, type PackSticker } from "../../lib/api";
import { MEDIA_TRAY_HEIGHT } from "../../lib/mediaTray";

/** Recently-used pack stickers, most-recent-first (committed on tray close). */
const RECENT_PACK_KEY = "cryo:recentPackStickers";
const RECENT_PACK_CAP = 12;

function readRecentIds(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_PACK_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr)
      ? arr.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}

function writeRecentIds(ids: string[]) {
  try {
    window.localStorage.setItem(RECENT_PACK_KEY, JSON.stringify(ids));
  } catch {
    // private mode etc. — recents just reset next time
  }
}

interface Props {
  /** Pack sticker picked: send it instantly by reference (no upload). */
  onPickPackSticker: (mediaId: string) => void;
  /** Called with a gif/sticker's bytes when the user picks one from the grid. */
  onPickGif: (file: File) => void;
  /** Stickers send instantly (WhatsApp-style) instead of opening the caption sheet. */
  onPickSticker: (file: File) => void;
  /** Emoji tab: insert into the message text (tray stays open). */
  onPickEmoji: (emoji: string) => void;
  /** Sticker tab: user wants to build a sticker from one of their own images. */
  onPickStickerFromImage: () => void;
  /** GIF tab: upload the user's own .gif file. */
  onPickFile: () => void;
  onClose: () => void;
}

type TrayMode = "pack" | "gif" | "sticker" | "emoji";

/**
 * The tray re-opens on the tab you last used (WhatsApp-style), persisted so it
 * also survives a page reload. Falls back to the pack when no pack is
 * configured.
 */
const LAST_TRAY_TAB_KEY = "cryo:lastTrayTab";

function rememberTab(id: TrayMode) {
  try {
    window.localStorage.setItem(LAST_TRAY_TAB_KEY, id);
  } catch {
    // private mode etc. — reverting to defaults is fine
  }
}

function readLastTab(): TrayMode {
  try {
    const v = window.localStorage.getItem(LAST_TRAY_TAB_KEY);
    if (v === "pack" || v === "gif" || v === "sticker" || v === "emoji") {
      return v;
    }
  } catch {
    // ignore storage errors
  }
  return "pack";
}

function initialTab(): TrayMode {
  const last = readLastTab();
  if (last === "pack" && peekStickers() === null) return "sticker";
  return last;
}

/** Server returned 503 because GIPHY_API_KEY is not configured. */
class GiphyKeyError extends Error {}

/** One server-proxied GIF/sticker result (id, title, preview, full). */
interface GifEntry {
  id: string;
  title?: string;
  preview: string;
  full: string;
}

/**
 * Constant-height placeholder grid so the tray never resizes while loading —
 * same cell count as the real grids, just pulsing, so the tray's frame is
 * stable from the first frame.
 */
function SkeletonGrid({ heart }: { heart?: boolean }) {
  return (
    <div
      className={`grid grid-cols-4 gap-1.5 ${heart ? "pt-2" : "py-2"} pr-0.5`}
    >
      {Array.from({ length: 12 }, (_, i) => (
        <div
          key={i}
          className="aspect-square animate-pulse rounded-lg bg-base-border"
        />
      ))}
    </div>
  );
}

/**
 * Sticker / GIF / emoji picker, custom-first. Renders as a fixed-height tray
 * that replaces the keyboard area beneath the composer (WhatsApp-style): it is
 * always the same height (see MEDIA_TRAY_HEIGHT), so the loading state can't
 * resize it — the pack and GIF grids show skeleton placeholders at full size
 * until the bytes arrive. The pack / GIF / sticker / emoji tabs live in a dock
 * at the bottom, and the tray re-opens on whichever tab you used last.
 *
 * 1. **Pack** tab — the project's Cloudinary sticker pack (metadata from
 *    `GET /api/stickers`, preloaded so it's ready before the tray opens);
 *    picking sends instantly by reference, no upload. Hidden when the server
 *    says the pack isn't configured (404).
 * 2. "Make a sticker" / "Upload a GIF" — always available.
 * 3. **GIF** / **Sticker** tabs — Giphy search runs server-side
 *    (`GET /api/giphy`) so the key stays server-side; hidden once the server
 *    says the key is missing (503). Picked media is fetched from Giphy's CDN
 *    and funneled into the normal upload path, so it stays ephemeral.
 * 4. **Emoji** tab — the inline emoji sheet.
 */
export function GifPicker({
  onPickPackSticker,
  onPickGif,
  onPickSticker,
  onPickEmoji,
  onPickStickerFromImage,
  onPickFile,
  onClose,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Kept in a ref so the outside-tap listener (added once) always sees the
  // latest onClose without re-subscribing every render.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Recents are snapshotted when the tray opens and only committed when it
  // closes — so cells never shuffle mid-session while you tap stickers.
  const [recentIds] = useState<string[]>(() => readRecentIds());
  const sessionPicksRef = useRef<string[]>([]);
  useEffect(
    () => () => {
      const picks = sessionPicksRef.current;
      if (picks.length === 0) return;
      const merged = [...picks, ...readRecentIds().filter((id) => !picks.includes(id))];
      writeRecentIds(merged.slice(0, RECENT_PACK_CAP));
    },
    [],
  );

  // Tap anywhere outside the tray panel (the chat above, the composer bar)
  // dismisses it — WhatsApp behaviour.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target instanceof Node ? e.target : null;
      if (panelRef.current?.contains(t)) return;
      onCloseRef.current();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);
  const [mode, setMode] = useState<TrayMode>(initialTab);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GifEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const seq = useRef(0);
  // Search is available until the server says the key is missing (503).
  const [searchEnabled, setSearchEnabled] = useState(true);
  // First paint reads the cached pack (if any) so a warm tray opens with
  // content instead of a skeleton flash.
  const [pack, setPack] = useState<PackSticker[] | null | undefined>(() =>
    peekStickers(),
  );
  // Latest pack for the async callbacks below (functional setState reads the
  // live mode; pack is only readable through a ref there).
  const packRef = useRef(pack);
  useEffect(() => {
    packRef.current = pack;
  }, [pack]);

  const switchTab = (id: TrayMode) => {
    rememberTab(id);
    setMode(id);
    if (id === "pack") {
      setResults([]);
      setError("");
    }
  };

  useEffect(() => {
    let cancelled = false;
    preloadStickers().then((list) => {
      if (cancelled) return;
      setPack(list);
      // No pack → don't strand the user on the pack tab (mode read live via
      // the functional update).
      if (list === null) {
        rememberTab("sticker");
        setMode((m) => (m === "pack" ? "sticker" : m));
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (mode === "pack" || mode === "emoji") return;
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
          if (p !== null && p !== undefined) {
            rememberTab("pack");
            setMode((m) => (m !== "pack" ? "pack" : m));
          }
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

  const packTabVisible = pack !== undefined && pack !== null;

  // Recents-first pack order for this session — snapshotted at open, stable
  // while the tray stays open (picks only move to the front on the NEXT open).
  const recentCells: PackSticker[] = [];
  const restCells: PackSticker[] = [];
  if (pack) {
    const seen = new Set<string>();
    for (const id of recentIds) {
      const s = pack.find((x) => x.id === id);
      if (s && !seen.has(s.id)) {
        recentCells.push(s);
        seen.add(s.id);
      }
    }
    for (const s of pack) if (!seen.has(s.id)) restCells.push(s);
  }

  const choosePackSticker = (id: string) => {
    if (!sessionPicksRef.current.includes(id)) sessionPicksRef.current.push(id);
    onPickPackSticker(id);
  };

  // Bottom dock: the tray's tab bar, centered. The pack tab is the project's
  // Cloudinary pack; GIF/Sticker (Giphy) appear while search is available;
  // Emoji always.
  const dockTabs: { id: TrayMode; label: string; icon: ReactNode }[] = [
    ...(packTabVisible
      ? [
          {
            id: "pack" as const,
            label: "Pack",
            icon: <IconSticker width={14} height={14} />,
          },
        ]
      : []),
    ...(searchEnabled
      ? [
          {
            id: "gif" as const,
            label: "GIF",
            icon: <IconGrid width={14} height={14} />,
          },
          {
            id: "sticker" as const,
            label: "Sticker",
            icon: <IconSparkle width={14} height={14} />,
          },
        ]
      : []),
    { id: "emoji" as const, label: "Emoji", icon: <IconEmoji width={14} height={14} /> },
  ];

  return (
    <div className="absolute inset-x-0 top-full z-10">
      <div
        ref={panelRef}
        className="cryo-in mx-auto flex max-w-2xl flex-col overflow-hidden border-t border-base-border2 bg-base/95 backdrop-blur md:rounded-t-2xl"
        style={{ height: MEDIA_TRAY_HEIGHT }}
      >
        {searchEnabled && (mode === "gif" || mode === "sticker") && (
          <div className="shrink-0 px-2 pt-2">
            <div className="relative">
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
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {mode === "emoji" ? (
            <EmojiPicker onPick={onPickEmoji} />
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
              {mode === "pack" ? (
                pack === undefined ? (
                  <SkeletonGrid heart />
                ) : pack !== null ? (
                  <>
                    {pack.length > 0 ? (
                      <>
                        {recentCells.length > 0 && (
                          <>
                            <p className="px-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                              Recently used
                            </p>
                            <div className="grid grid-cols-4 gap-1.5 pt-1 pr-0.5">
                              {recentCells.map((s) => (
                                <button
                                  key={s.id}
                                  type="button"
                                  onClick={() => choosePackSticker(s.id)}
                                  aria-label={s.name ?? "Choose sticker"}
                                  className="group relative aspect-square overflow-hidden rounded-lg bg-base-border transition-colors hover:bg-base-border2"
                                >
                                  <img
                                    src={s.url}
                                    alt={s.name ?? ""}
                                    loading="lazy"
                                    draggable={false}
                                    className="h-full w-full object-contain transition-transform duration-150 group-hover:scale-105"
                                  />
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                        {restCells.length > 0 && (
                          <div className="grid grid-cols-4 gap-1.5 pt-2 pr-0.5">
                            {restCells.map((s) => (
                              <button
                                key={s.id}
                                type="button"
                                onClick={() => choosePackSticker(s.id)}
                                aria-label={s.name ?? "Choose sticker"}
                                className="group relative aspect-square overflow-hidden rounded-lg bg-base-border transition-colors hover:bg-base-border2"
                              >
                                <img
                                  src={s.url}
                                  alt={s.name ?? ""}
                                  loading="lazy"
                                  draggable={false}
                                  className="h-full w-full object-contain transition-transform duration-150 group-hover:scale-105"
                                />
                              </button>
                            ))}
                          </div>
                        )}
                      </>
                    ) : (
                      <p className="py-6 text-center text-xs leading-relaxed text-ink-faint">
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
                  {loading ? (
                    <SkeletonGrid heart={false} />
                  ) : (
                    <>
                      {searchEnabled && results.length > 0 && (
                        <div className="grid grid-cols-4 gap-1.5 pt-2 pr-0.5">
                          {results.map((r) => (
                            <button
                              key={r.id}
                              type="button"
                              onClick={() => void pick(r)}
                              disabled={busyId !== null}
                              aria-label={r.title ?? (mode === "sticker" ? "Choose sticker" : "Choose GIF")}
                              className={`group relative overflow-hidden rounded-lg bg-base-border hover:bg-base-border2 ${
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
                        <p className="py-4 text-left text-[11px] leading-relaxed text-ink-faint">
                          Set{" "}
                          <code className="rounded bg-base-border px-1">GIPHY_API_KEY</code>{" "}
                          (server env) to
                          search. You can still {mode === "sticker" ? "make your own." : "upload your own."}
                        </p>
                      )}

                      {error && (
                        <p className="py-2 text-center text-xs font-medium text-rose-400">
                          {error}
                        </p>
                      )}

                      {searchEnabled &&
                        !loading &&
                        results.length === 0 &&
                        !error && (
                          <p className="py-4 text-center text-xs text-ink-faint">
                            No {mode === "sticker" ? "stickers" : "GIFs"} found.
                          </p>
                        )}

                      {mode === "sticker" ? (
                        <button
                          type="button"
                          onClick={onPickStickerFromImage}
                          className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-base-border2 py-2.5 text-xs font-medium text-ink-muted transition-colors hover:bg-base-border"
                        >
                          <IconSticker width={16} height={16} />
                          Make a sticker
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={onPickFile}
                          className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-base-border2 py-2.5 text-xs font-medium text-ink-muted transition-colors hover:bg-base-border"
                        >
                          <IconImage width={16} height={16} />
                          Upload a GIF
                        </button>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex shrink-0 justify-center border-t border-base-border bg-base/50 px-3 py-1.5">
          <div className="flex gap-0.5 rounded-full bg-base-border p-1">
            {dockTabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => switchTab(t.id)}
                aria-pressed={mode === t.id}
                className={`flex h-8 items-center gap-1 rounded-full px-3 text-[11px] font-semibold uppercase tracking-wide transition-colors ${
                  mode === t.id
                    ? "bg-base-raised text-accent shadow-sm"
                    : "text-ink-faint hover:text-ink-muted"
                }`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}