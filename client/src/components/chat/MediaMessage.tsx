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
 * - One-time media: a small "One-time" tile. Tapping opens it in the lightbox;
 *   the first successful load consumes the upload server-side, and after the
 *   viewer closes the tile reads "Viewed" and never opens again (bytes are
 *   gone for everyone; a storage flag plus the 404 enforce it locally too).
 */
export function MediaMessage({ attachment, sessionId }: Props) {
  const viewOnce = Boolean(attachment.viewOnce);
  const isGif = attachment.type === "gif";
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

  // Shared media sizing: gifs render smaller, stills a bit larger.
  const imgStyle: CSSProperties = isGif
    ? { width: "min(52vw, 190px)", maxHeight: 240, aspectRatio: dimsAspect(attachment) }
    : { width: "min(70vw, 300px)", maxHeight: 320, aspectRatio: dimsAspect(attachment) };

  if (viewOnce && !consumed) {
    return (
      <>
        <button
          type="button"
          onClick={() => setViewerOpen(true)}
          aria-label="Open one-time image"
          className="group flex cursor-zoom-in flex-col items-center gap-1 rounded-bubble border border-base-border bg-ink-muted/30 px-6 py-4 text-center transition-colors hover:bg-ink-muted/40"
        >
          <IconEye width={22} height={22} className="text-ink-faint transition-opacity group-hover:opacity-70" />
          <span className="text-xs font-semibold text-ink-muted">One-time</span>
          <span className="text-[10px] text-ink-faint/80">Tap to open</span>
        </button>
        {viewerOpen && (
          <MediaViewer
            src={url}
            onClose={() => setViewerOpen(false)}
            viewOnce
            onLoaded={handleViewerLoaded}
            onLoadError={handleViewerError}
          />
        )}
      </>
    );
  }

  if (viewOnce) {
    return (
      <div className="flex flex-col items-center gap-1 rounded-bubble border border-base-border bg-ink-muted/30 px-6 py-4 text-center">
        <IconEye width={20} height={20} className="text-ink-faint" />
        <span className="text-xs font-semibold text-ink-muted">Viewed</span>
        <span className="text-[10px] text-ink-faint/80">Gone for everyone</span>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setViewerOpen(true)}
        aria-label={isGif ? "Open GIF" : "Open image"}
        className="block cursor-zoom-in"
      >
        <div className="relative">
          <img
            src={url}
            alt={attachment.name ?? (isGif ? "GIF" : "Image")}
            loading="lazy"
            draggable={false}
            className="block max-w-full select-none rounded-bubble bg-ink-muted/30"
            style={imgStyle}
          />
          {isGif && (
            <span className="pointer-events-none absolute left-1.5 top-1.5 rounded bg-black/55 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white/90">
              GIF
            </span>
          )}
        </div>
      </button>
      {viewerOpen && (
        <MediaViewer
          src={url}
          onClose={() => setViewerOpen(false)}
          fileName={attachment.name}
        />
      )}
    </>
  );
}

function dimsAspect(attachment: MessageAttachment): string | undefined {
  if (attachment.width && attachment.height) {
    return `${attachment.width} / ${attachment.height}`;
  }
  return undefined;
}