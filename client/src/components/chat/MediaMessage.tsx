import { useCallback, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { MessageAttachment } from "@cryo/shared";
import { mediaUrl, markMediaViewed } from "../../lib/api";
import { MediaViewer } from "./MediaViewer";
import { IconEye } from "../ui/Icon";

interface Props {
  attachment: MessageAttachment;
  /** Viewer's session id – used as the fetch identity for the media bytes. */
  sessionId: string;
}

const VIEWED_PREFIX = "cryo_view_once_";

function wasViewedLocally(mediaId: string): boolean {
  try {
    return localStorage.getItem(VIEWED_PREFIX + mediaId) === "1";
  } catch {
    return false;
  }
}

function rememberViewed(mediaId: string): void {
  try {
    localStorage.setItem(VIEWED_PREFIX + mediaId, "1");
  } catch {
    /* storage may be unavailable – server enforces consumption anyway */
  }
}

/**
 * Renders a chat attachment (image or gif).
 *
 * - Normal media: tap to open it enlarged in a lightbox, with a save button.
 * - One-time media: a small "One-time" tile. Tapping opens the lightbox and
 *   the first successful view consumes the upload server-side – but the
 *   lightbox stays open until the user closes it. After that the tile reads
 *   "Viewed" (Gone for everyone) and never opens again.
 *
 * Images size by their natural ratio (max capped) so the outer box hugs any
 * portrait/landscape aspect instead of shrinking oddly.
 */
export function MediaMessage({ attachment, sessionId }: Props) {
  const viewOnce = Boolean(attachment.viewOnce);
  const isGif = attachment.type === "gif";
  const isSticker = attachment.type === "sticker";
  const url = mediaUrl(attachment.mediaId, sessionId);

  const [viewerOpen, setViewerOpen] = useState(false);
  const [consumed, setConsumed] = useState(
    viewOnce && wasViewedLocally(attachment.mediaId),
  );
  const markingRef = useRef(false);

  const consume = useCallback(() => {
    if (markingRef.current) return;
    markingRef.current = true;
    rememberViewed(attachment.mediaId);
    setConsumed(true);
  }, [attachment.mediaId]);

  const openViewer = useCallback(() => {
    // A consumed one-time upload is never re-openable.
    if (viewOnce && consumed) return;
    setViewerOpen(true);
  }, [viewOnce, consumed]);

  const handleViewerLoaded = useCallback(() => {
    if (!viewOnce) return;
    void markMediaViewed(attachment.mediaId).then((ok) => {
      if (ok) consume();
    });
  }, [viewOnce, attachment.mediaId, consume]);

  const handleViewerError = useCallback(() => {
    // A consumed upload 404s for everyone: the sender sees "Viewed" once the
    // recipient has opened it.
    if (viewOnce) consume();
  }, [viewOnce, consume]);

  // Let the natural aspect ratio drive the box; only cap width/height. This
  // makes tall (portrait) and wide images both look right (no odd shrinking).
  // Stickers stay small and square like WhatsApp.
  const imgStyle: CSSProperties = isSticker
    ? { width: 96, height: 96, maxWidth: 96, maxHeight: 96 }
    : isGif
      ? { maxWidth: "min(52vw, 190px)", maxHeight: 240, width: "auto", height: "auto" }
      : { maxWidth: "min(70vw, 300px)", maxHeight: 360, width: "auto", height: "auto" };

  return (
    <>
      {viewOnce ? (
        consumed ? (
          <div className="flex flex-col items-center gap-1 rounded-bubble border border-base-border bg-ink-muted/30 px-6 py-4 text-center">
            <IconEye width={20} height={20} className="text-ink-faint" />
            <span className="text-xs font-semibold text-ink-muted">Viewed</span>
            <span className="text-[10px] text-ink-faint/80">
              Gone for everyone
            </span>
          </div>
        ) : (
          <button
            type="button"
            onClick={openViewer}
            aria-label="Open one-time image"
            className="group flex cursor-zoom-in flex-col items-center gap-1 rounded-bubble border border-base-border bg-ink-muted/30 px-6 py-4 text-center transition-colors hover:bg-ink-muted/40"
          >
            <IconEye width={22} height={22} className="text-ink-faint transition-opacity group-hover:opacity-70" />
            <span className="text-xs font-semibold text-ink-muted">One-time</span>
            <span className="text-[10px] text-ink-faint/80">Tap to open</span>
          </button>
        )
      ) : (
        <button
          type="button"
          onClick={openViewer}
          aria-label={isSticker ? "Open sticker" : isGif ? "Open GIF" : "Open image"}
          className="block cursor-zoom-in"
        >
          <div className="relative">
            <img
              src={url}
              alt={attachment.name ?? (isSticker ? "Sticker" : isGif ? "GIF" : "Image")}
              loading="lazy"
              draggable={false}
              className={`block max-w-full select-none object-contain ${
                isSticker ? "rounded-lg" : "rounded-bubble bg-ink-muted/30"
              }`}
              style={imgStyle}
            />
            {isGif && !isSticker && (
              <span className="pointer-events-none absolute left-1.5 top-1.5 rounded bg-black/55 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white/90">
                GIF
              </span>
            )}
          </div>
        </button>
      )}

      {/* The lightbox renders independently of the bubble state, so consuming
          a one-time upload never closes it before the user does. */}
      {viewerOpen && (
        <MediaViewer
          src={url}
          onClose={() => setViewerOpen(false)}
          viewOnce={viewOnce}
          onLoaded={viewOnce ? handleViewerLoaded : undefined}
          onLoadError={viewOnce ? handleViewerError : undefined}
          fileName={attachment.name}
        />
      )}
    </>
  );
}