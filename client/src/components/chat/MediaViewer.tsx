import { useEffect, useState } from "react";
import { IconDownload, IconEye, IconX } from "../ui/Icon";

interface Props {
  src: string;
  onClose: () => void;
  /** One-time uploads hide the save action and show a lock hint. */
  viewOnce?: boolean;
  /** Fired once the image bytes actually load (consumes view-once uploads). */
  onLoaded?: () => void;
  /** Called when the image could not be fetched (e.g. a consumed view-once). */
  onLoadError?: () => void;
  /** Preferred save file name (an extension is derived from the bytes). */
  fileName?: string;
}

/**
 * Fullscreen image viewer (lightbox). Fixed overlay above everything: dark
 * backdrop, enlarged image, save button (only for non view-once), close via
 * the X button, Escape, or tapping the backdrop. Tapping the image does not
 * close it.
 */
export function MediaViewer({ src, onClose, viewOnce, onLoaded, onLoadError, fileName }: Props) {
  const [downloading, setDownloading] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const save = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error("fetch");
      const blob = await res.blob();
      const ext = (blob.type.split("/")[1] ?? "bin").replace("jpeg", "jpg");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName || `cryo.${ext}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      // ignore save failures
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/90"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="flex items-center justify-between gap-2 p-2 text-white/80"
        onClick={(e) => e.stopPropagation()}
      >
        {viewOnce ? (
          <span className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs text-white/80">
            <IconEye width={14} height={14} />
            One-time · gone for everyone once opened
          </span>
        ) : (
          <button
            type="button"
            onClick={() => void save()}
            disabled={downloading}
            aria-label="Save image"
            className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white/90 transition-colors hover:bg-white/20 active:bg-white/30 disabled:opacity-50"
          >
            <IconDownload width={15} height={15} />
            {downloading ? "Saving…" : "Save"}
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close image"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/90 transition-colors hover:bg-white/20 active:bg-white/30"
        >
          <IconX width={18} height={18} />
        </button>
      </div>

      <div className="flex flex-1 items-center justify-center overflow-hidden p-4">
        {loadError ? (
          <span className="text-sm text-white/60">Media unavailable</span>
        ) : (
          <img
            src={src}
            alt=""
            onLoad={() => {
              if (loadError) return;
              onLoaded?.();
            }}
            onError={() => {
              setLoadError(true);
              onLoadError?.();
            }}
            onClick={(e) => e.stopPropagation()}
            className="max-h-full max-w-full object-contain"
            draggable={false}
          />
        )}
      </div>
    </div>
  );
}