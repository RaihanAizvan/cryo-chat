import { useEffect, useState } from "react";
import { formatDuration } from "../../lib/voice";
import { IconTrash, IconSquare } from "../ui/Icon";

interface Props {
  /** When the recording started (epoch ms) so this panel can show a live timer. */
  startedAt: number;
  /** Stop recording, upload, and send. Rejects on failure. */
  onSend: () => Promise<void>;
  /** Discard the recording. */
  onCancel: () => void;
  /** True while the note is being uploaded. */
  busy?: boolean;
}

/**
 * Inline recording panel (WhatsApp-style): a pulsing red dot with a live timer,
 * a trash control to discard, and a stop button that sends the note.
 */
export function VoiceRecorder({ startedAt, onSend, onCancel, busy }: Props) {
  const [elapsed, setElapsed] = useState(Math.floor((Date.now() - startedAt) / 1000));

  useEffect(() => {
    const t = setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt) / 1000)),
      200,
    );
    return () => clearInterval(t);
  }, [startedAt]);

  return (
    <>
      <div className="fixed inset-0 z-10" aria-hidden onClick={onCancel} />
      <div className="absolute inset-x-0 bottom-full z-20 mx-auto max-w-2xl px-2 pb-1">
        <div className="cryo-pop rounded-2xl border border-base-border2 bg-base-raised px-4 py-3 shadow-xl">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              aria-label="Discard recording"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-base-border disabled:opacity-40"
            >
              <IconTrash width={18} height={18} />
            </button>

            <span className="flex h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-rose-500" />

            <span className="min-w-0 flex-1 text-center font-mono text-lg tabular-nums text-ink">
              {formatDuration(elapsed)}
            </span>

            <button
              type="button"
              onClick={() => void onSend()}
              disabled={busy}
              aria-label={busy ? "Uploading…" : "Send voice note"}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-500 text-white transition-all active:scale-95 disabled:opacity-50 disabled:active:scale-100"
            >
              {busy ? (
                <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-white/60 border-t-white" />
              ) : (
                <IconSquare width={16} height={16} />
              )}
            </button>
          </div>
          {busy && (
            <p className="mt-2 text-center text-[10px] text-ink-faint">
              Uploading voice note…
            </p>
          )}
        </div>
      </div>
    </>
  );
}