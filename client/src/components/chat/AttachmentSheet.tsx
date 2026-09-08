import { useEffect, useState } from "react";
import { MAX_MESSAGE_LENGTH } from "@cryo/shared";
import { IconEye, IconSend, IconX } from "../ui/Icon";

interface Props {
  /** Picked image/gif to preview and send. */
  file: File;
  /** Object URL of the picked file (owned by the parent). */
  previewUrl: string;
  onCancel: () => void;
  /** Upload + send. Should reject on failure so the sheet shows the error. */
  onSend: (caption: string, viewOnce: boolean) => Promise<void>;
}

/**
 * Preview sheet for media about to be sent: shows the image/gif, lets the user
 * add a caption and mark it "one-time", then uploads via the parent. Rendered
 * in the same popover slot as the emoji picker (just above the composer).
 */
export function AttachmentSheet({ file, previewUrl, onCancel, onSend }: Props) {
  const [caption, setCaption] = useState("");
  const [viewOnce, setViewOnce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await onSend(caption.trim(), viewOnce);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send that.");
      setBusy(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-10" aria-hidden onClick={onCancel} />
      <div className="absolute inset-x-0 bottom-full z-20 mx-auto max-w-2xl px-2 pb-1">
        <div className="cryo-pop rounded-2xl border border-base-border2 bg-base-raised p-3 shadow-xl">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">
                  {file.type === "image/gif" ? "GIF" : "Image"}
                </span>
                <button
                  type="button"
                  onClick={onCancel}
                  aria-label="Cancel"
                  className="flex h-7 w-7 items-center justify-center rounded-full text-ink-muted hover:bg-base-border"
                >
                  <IconX width={16} height={16} />
                </button>
              </div>

              <div className="mt-2 flex items-end gap-3">
                <img
                  src={previewUrl}
                  alt="Preview"
                  className="block max-h-56 w-full shrink-0 rounded-2xl object-contain sm:max-w-[280px]"
                />
                <input
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  maxLength={MAX_MESSAGE_LENGTH}
                  placeholder="Add a caption…"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void submit();
                    }
                  }}
                  className="min-w-0 flex-1 rounded-3xl border border-base-border2 bg-base px-4 py-2 text-[15px] text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
                />
              </div>

              <div className="mt-3 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setViewOnce((v) => !v)}
                  aria-pressed={viewOnce}
                  className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    viewOnce
                      ? "border-accent bg-accent text-white"
                      : "border-base-border2 bg-base text-ink-muted hover:bg-base-border"
                  }`}
                >
                  <IconEye width={14} height={14} />
                  One-time
                </button>
                {viewOnce && (
                  <span className="min-w-0 flex-1 text-right text-[10px] leading-tight text-ink-faint">
                    Gone for everyone once opened.
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => void submit()}
                  disabled={busy}
                  aria-label="Send media"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-white transition-all active:scale-95 disabled:opacity-40 disabled:active:scale-100"
                >
                  <IconSend width={16} height={16} className="ml-0.5" />
                </button>
              </div>

              {error && (
                <p className="mt-2 text-xs font-medium text-rose-400">{error}</p>
              )}
              {busy && (
                <p className="mt-2 text-xs text-ink-faint">Uploading…</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}