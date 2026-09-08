import { useCallback, useEffect, useRef, useState } from "react";
import type { MessageAttachment } from "@cryo/shared";
import { mediaUrl, markMediaViewed } from "../../lib/api";
import { IconEye, IconImage } from "../ui/Icon";

interface Props {
  attachment: MessageAttachment;
  /** Viewer's session id – used as the fetch identity for the media bytes. */
  sessionId: string;
}

/**
 * Renders an uploaded image/gif inside a chat bubble.
 *
 * - Normal media: a rounded `<img>` (gifs animate; stills are sized by their
 *   intrinsic dimensions to avoid layout shift).
 * - One-time media starts behind a "Tap to open" tile. Opening fetches the
 *   bytes and marks the upload viewed on the server, which deletes it for
 *   everyone (so the sender loses access too). Once gone the server answers
 *   404 and we fall back to an "opened"/expired placeholder.
 */
export function MediaMessage({ attachment, sessionId }: Props) {
  const [revealed, setRevealed] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const firstLoadRef = useRef(false);

  const viewOnce = Boolean(attachment.viewOnce);
  const url = mediaUrl(attachment.mediaId, sessionId);

  // Normal media renders directly; only one-time uploads wait for a tap.
  useEffect(() => {
    if (!viewOnce) setRevealed(true);
  }, [viewOnce]);

  const handleLoad = useCallback(() => {
    if (viewOnce && !firstLoadRef.current) {
      firstLoadRef.current = true;
      // First successful load by the viewer consumes the upload server-side.
      void markMediaViewed(attachment.mediaId);
    }
  }, [viewOnce, attachment.mediaId]);

  if (!revealed) {
    return (
      <button
        type="button"
        onClick={() => setRevealed(true)}
        aria-label="Tap to open one-time media"
        className={`group flex cursor-pointer flex-col items-center justify-center gap-1.5`}
        style={{
          width: "min(26vw, 240px)",
          aspectRatio:
            attachment.width && attachment.height
              ? `${attachment.width} / ${attachment.height}`
              : "1 / 1",
        }}
      >
        <span className="flex h-full w-full flex-col items-center justify-center gap-1.5 rounded-bubble bg-ink-muted/40 text-ink-faint">
          <IconEye
            width={28}
            height={28}
            className="text-ink-faint group-hover:opacity-70"
          />
          <span className="flex items-center gap-1 text-[11px] font-medium">
            {attachment.type === "gif" ? "Tap to play GIF" : "Tap to open"}
          </span>
          <span className="text-[10px] text-ink-faint/70">One-time</span>
        </span>
      </button>
    );
  }

  if (loadFailed) {
    // A 404 here means the upload was consumed ("opened") or expired.
    return (
      <div
        className="flex flex-col items-center justify-center gap-1 rounded-bubble bg-ink-muted/40 text-ink-faint"
        style={{
          width: "min(26vw, 240px)",
          minHeight: 120,
          aspectRatio:
            attachment.width && attachment.height
              ? `${attachment.width} / ${attachment.height}`
              : undefined,
        }}
      >
        <IconImage width={24} height={24} className="opacity-60" />
        <span className="text-[11px] font-medium">
          {viewOnce ? "Opened" : "Media expired"}
        </span>
      </div>
    );
  }

  // GIFs get a small corner badge; one-time media keeps a subtle lock marker.
  const isGif = attachment.type === "gif";
  return (
    <div className="relative">
      <img
        src={url}
        alt={attachment.name ?? (isGif ? "GIF" : "Image")}
        loading="lazy"
        onLoad={handleLoad}
        onError={() => setLoadFailed(true)}
        className="block max-w-full select-none rounded-bubble bg-ink-muted/30"
        style={{
          width: "min(70vw, 300px)",
          maxHeight: 320,
          aspectRatio:
            attachment.width && attachment.height
              ? `${attachment.width} / ${attachment.height}`
              : undefined,
          objectFit: "contain",
        }}
        draggable={false}
      />
      {isGif && (
        <span className="absolute left-1.5 top-1.5 rounded bg-black/55 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white/90">
          GIF
        </span>
      )}
      {viewOnce && (
        <span className="absolute right-1.5 top-1.5 rounded bg-black/45 p-1 text-white/80">
          <IconEye width={12} height={12} />
        </span>
      )}
    </div>
  );
}