import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ClipboardEvent } from "react";
import type { MessageAttachment, PublicMessage } from "@cryo/shared";
import { MAX_MESSAGE_LENGTH } from "@cryo/shared";
import { IconImage, IconMic, IconReply, IconSend, IconSticker, IconX } from "../ui/Icon";
import { AttachmentSheet } from "./AttachmentSheet";
import { GifPicker } from "./GifPicker";
import { MEDIA_TRAY_HEIGHT } from "../../lib/mediaTray";
import { VoiceRecorder } from "./VoiceRecorder";
import {
  uploadMedia,
  getCloudinaryPreset,
  uploadToCloudinary,
  registerRemoteMedia,
  preloadStickers,
  type UploadResult,
} from "../../lib/api";
import { prepareUpload } from "../../lib/image";
import { makeSticker } from "../../lib/sticker";
import { recordEmoji } from "../../lib/emoji";
import { startVoiceRecording, type ActiveVoiceRecording } from "../../lib/voice";
import { useVoiceNotesEnabled } from "../../lib/store";
import { useCoarsePointer, useKeyboardInset } from "../../hooks/useKeyboardInset";

interface Props {
  onSend: (text: string, attachment?: MessageAttachment, replyTo?: PublicMessage) => void;
  onHeightChange?: (height: number) => void;
  /** Called (throttled) while the user types, to show the typing indicator. */
  onTyping?: () => void;
  /** Message being replied to (quote pill above the input). */
  replyTarget?: PublicMessage | null;
  onCancelReply?: () => void;
}

interface PendingMedia {
  file: File;
  previewUrl: string;
}

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/** On-screen keyboard inset in px right now (0 when no keyboard is open). */
function keyboardInset(): number {
  if (typeof window === "undefined" || !window.visualViewport) return 0;
  const vv = window.visualViewport;
  return Math.max(0, window.innerHeight - (vv.height + (vv.offsetTop || 0)));
}

/** Poll for `cond()` to return true (or a timeout), then run `done()`. */
function waitUntil(cond: () => boolean, done: () => void, timeoutMs = 700) {
  const start = performance.now();
  const step = () => {
    if (cond() || performance.now() - start >= timeoutMs) return done();
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** Snippet shown in the reply pill: the message text, or a media label. */
function replyPreview(m: PublicMessage): string {
  if (m.text) return m.text;
  const a = m.attachment;
  if (!a) return "";
  if (a.viewOnce) return "One-time media";
  if (a.type === "gif") return "GIF";
  if (a.type === "sticker") return "Sticker";
  if (a.type === "voice") return "Voice note";
  if (a.name) return a.name;
  return "Photo";
}

export function MessageComposer({
  onSend,
  onHeightChange,
  onTyping,
  replyTarget,
  onCancelReply,
}: Props) {
  const [text, setText] = useState("");
  const [gifOpen, setGifOpen] = useState(false);
  // Closing is animated: the composer stays raised at tray height until the
  // keyboard is fully back, so the input never dips while transitioning.
  const [closingTray, setClosingTray] = useState(false);
  // Whether the keyboard was up before the tray opened — closing restores it so
  // composing continues exactly where the user left off.
  const hadKeyboardRef = useRef(false);
  const [pending, setPending] = useState<PendingMedia | null>(null);
  // Track the object URL separately so the sheet closes before we revoke it.
  const [pendingObj, setPendingObj] = useState<string | null>(null);
  const [rec, setRec] = useState<ActiveVoiceRecording | null>(null);
  const [recStartedAt, setRecStartedAt] = useState(0);
  const [recBusy, setRecBusy] = useState(false);
  const isCoarse = useCoarsePointer();
  const { inset } = useKeyboardInset();
  const voiceNotesEnabled = useVoiceNotesEnabled();
  const taRef = useRef<HTMLTextAreaElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const gifInputRef = useRef<HTMLInputElement>(null);
  const stickerInputRef = useRef<HTMLInputElement>(null);

  // Warm the sticker pack cache as soon as the composer mounts so the tray
  // opens without a loading flash.
  useEffect(() => {
    void preloadStickers();
  }, []);

  // While the media tray is open the bar sits above it (WhatsApp-style: the
  // tray fills the space the keyboard would occupy). The keyboard inset still
  // applies on top so focusing the tray's search box raises everything above
  // the keyboard instead of covering it. While `closingTray` waits for the
  // keyboard to come back, the bar stays raised so nothing dips.
  const trayOffset = gifOpen || closingTray ? MEDIA_TRAY_HEIGHT : 0;

  const onChange = (value: string) => {
    setText(value);
    if (value && onTyping) onTyping();
  };

  // Voice notes switched off mid-recording: drop the active recording the
  // moment the toggle flips, then release the mic once it's stashed.
  const [prevVoiceEnabled, setPrevVoiceEnabled] = useState(voiceNotesEnabled);
  const [staleRec, setStaleRec] = useState<ActiveVoiceRecording | null>(null);
  if (voiceNotesEnabled !== prevVoiceEnabled) {
    setPrevVoiceEnabled(voiceNotesEnabled);
    if (!voiceNotesEnabled && rec) {
      setStaleRec(rec);
      setRec(null);
      setRecStartedAt(0);
    }
  }
  useEffect(() => {
    if (staleRec) staleRec.cancel();
  }, [staleRec]);

  useEffect(() => {
    if (!gifOpen && !pending && !rec) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setGifOpen(false);
      if (pending) {
        setPending(null);
        setPendingObj(null);
      }
      if (rec && !recBusy) {
        rec.cancel();
        setRec(null);
        setRecStartedAt(0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [gifOpen, pending, rec, recBusy]);

  // Keep the enter key behavior: on touch, Enter inserts newline → user taps
  // the send button. On desktop, Enter sends (Shift+Enter for newline).

  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    // Cap at ~6 lines (~144px) to avoid the composer becoming huge.
    ta.style.height = `${Math.min(ta.scrollHeight, 144)}px`;
  }, [text]);

  // Report the composer's rendered height so the message list can reserve
  // space above it (avoids long inputs hiding the newest message).
  useLayoutEffect(() => {
    if (!onHeightChange) return;
    const el = barRef.current;
    if (!el) return;
    const report = () => onHeightChange(el.offsetHeight);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [onHeightChange]);

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed, undefined, replyTarget ?? undefined);
    setText("");
    taRef.current?.focus();
  };

  /**
   * Insert an emoji at the caret (fallback: append), keeping focus in the box.
   * When the emoji tab is open the textarea isn't focused — append instead of
   * stealing focus, so the tray stays open and the keyboard stays down.
   */
  const insertEmoji = (emoji: string) => {
    const ta = taRef.current;
    const focused = !!ta && document.activeElement === ta;
    const start = focused ? ta.selectionStart : text.length;
    const end = focused ? ta.selectionEnd : start;
    const next = (text.slice(0, start) + emoji + text.slice(end)).slice(
      0,
      MAX_MESSAGE_LENGTH,
    );
    setText(next);
    recordEmoji(emoji);
    if (onTyping) onTyping();
    if (focused && ta) {
      setTimeout(() => {
        const pos = start + emoji.length;
        ta.focus();
        ta.setSelectionRange(pos, pos);
      }, 0);
    }
  };

  const closeAllPanels = () => {
    setGifOpen(false);
  };

  /** Open the tray: drop the keyboard (WhatsApp-style slide-in) + warm the pack. */
  const openTray = () => {
    const ta = taRef.current;
    const wasFocused = !!ta && document.activeElement === ta;
    hadKeyboardRef.current = wasFocused || keyboardInset() > 8;
    const el = document.activeElement;
    if (el instanceof HTMLElement) el.blur();
    void preloadStickers(true);
    if (hadKeyboardRef.current) {
      // The keyboard is up: let it finish sliding away first, then reveal the
      // tray. Raising the bar to tray height while the keyboard is still up
      // stacks the tray area on top of it for a frame — the bar just follows
      // the inset down like a normal keyboard close instead.
      waitUntil(() => keyboardInset() <= 8, () => setGifOpen(true), 600);
    } else {
      setGifOpen(true);
    }
  };

  /**
   * Close the tray. If a keyboard was up before it opened, bring it back and
   * hold the bar at tray height until it has fully risen so the input field
   * stays exactly where it was.
   */
  const closeTray = () => {
    setGifOpen(false);
    if (hadKeyboardRef.current) {
      setClosingTray(true);
      taRef.current?.focus();
      waitUntil(() => keyboardInset() > 8, () => setClosingTray(false));
    } else {
      setClosingTray(false);
    }
  };

  useEffect(() => {
    return () => {
      if (pendingObj) URL.revokeObjectURL(pendingObj);
    };
  }, [pendingObj]);

  /**
   * Upload a file to the chat. When Cloudinary is configured (server says so),
   * push the bytes straight to the CDN from the browser and register the
   * result — big uploads then bypass the host's request-body ceiling and never
   * touch server RAM. If Cloudinary is unavailable/unreachable/out of credits,
   * fall back to the classic in-memory upload so sending never hard-fails.
   */
  const uploadAny = async (
    file: File,
    opts: { name?: string; sticker?: boolean; viewOnce?: boolean; voice?: boolean; duration?: number },
  ): Promise<UploadResult> => {
    // Voice notes are tiny — never round-trip them through Cloudinary, just
    // use the in-memory upload path directly.
    if (opts.voice) {
      return uploadMedia(file, {
        viewOnce: opts.viewOnce,
        name: opts.name,
        voice: true,
        duration: opts.duration,
      });
    }
    const preset = await getCloudinaryPreset();
    if (preset) {
      try {
        const r = await uploadToCloudinary(file, preset);
        return await registerRemoteMedia({
          publicId: r.publicId,
          width: r.width,
          height: r.height,
          viewOnce: opts.viewOnce,
          name: opts.name,
          sticker: opts.sticker,
        });
      } catch {
        // Cloudinary flaked or its budget is gone — try the in-memory path.
      }
    }
    return uploadMedia(file, {
      viewOnce: opts.viewOnce,
      name: opts.name,
      sticker: opts.sticker,
    });
  };

  /** Short-lived inline notice for instant-send failures (stickers, etc.). */
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showNotice = (msg: string) => {
    setNotice(msg);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 5000);
  };
  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    [],
  );

  // Leaving the chat must release the mic (and drop any in-progress note).
  const recRef = useRef<ActiveVoiceRecording | null>(null);
  useEffect(() => {
    recRef.current = rec;
  }, [rec]);
  useEffect(
    () => () => {
      recRef.current?.cancel();
    },
    [],
  );

  const beginPending = async (file: File) => {
    if (!IMAGE_TYPES.includes(file.type)) return;
    closeAllPanels();
    let f = file;
    try {
      f = await prepareUpload(file);
    } catch {
      // keep the original on decode failure
    }
    const url = URL.createObjectURL(f);
    setPendingObj(url);
    setPending({ file: f, previewUrl: url });
  };

  /** Upload the pending file, then send it as a message with a caption. */
  const sendPending = async (caption: string, viewOnce: boolean) => {
    const p = pending;
    if (!p) return;
    const up = await uploadAny(p.file, { viewOnce, name: p.file.name });
    onSend(
      caption,
      {
        type: up.type,
        mediaId: up.mediaId,
        viewOnce: up.viewOnce,
        width: up.width,
        height: up.height,
        name: up.name,
      },
      replyTarget ?? undefined,
    );
    clearPending();
  };

  /** Send a sticker immediately (WhatsApp-style, no caption step). */
  const sendSticker = async (file: File) => {
    try {
      const up = await uploadAny(file, { name: "sticker", sticker: true });
      onSend("", {
        type: "sticker",
        mediaId: up.mediaId,
        width: up.width,
        height: up.height,
        name: "Sticker",
      });
    } catch (err) {
      showNotice(
        err instanceof Error && err.message ? err.message : "Couldn't send that sticker.",
      );
    }
  };

  /** "Make a sticker": square-crop the picked image, then send it instantly. */
  const sendStickerFromImage = async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    try {
      let sticker = await makeSticker(file);
      try {
        sticker = await prepareUpload(sticker);
      } catch {
        // keep the makeSticker output if downscaling fails
      }
      await sendSticker(sticker);
    } catch {
      showNotice("Couldn't make a sticker from that image.");
    }
  };

  /**
   * Send a pack sticker instantly by reference: the pack ships with the server
   * build, so there's nothing to upload — the server resolves the mediaId and
   * every participant streams it from the CDN. The tray stays open so several
   * stickers can be fired off in a row.
   */
  const sendPackSticker = (mediaId: string) => {
    onSend("", { type: "sticker", mediaId });
  };

  const clearPending = () => {
    setPending(null);
    setPendingObj((u) => {
      if (u) URL.revokeObjectURL(u);
      return null;
    });
    taRef.current?.focus();
  };

  /** Start recording a voice note (mic permission prompt on first use). */
  const startVoice = async () => {
    if (!voiceNotesEnabled) return;
    closeAllPanels();
    // Re-tapping the mic restarts: release the previous stream first so the
    // microphone indicator doesn't stay lit on an orphaned recorder.
    rec?.cancel();
    setRec(null);
    setRecStartedAt(0);
    try {
      const r = await startVoiceRecording();
      if (!r) {
        showNotice("Couldn't start recording. Check your microphone permission.");
        return;
      }
      setRec(r);
      setRecStartedAt(Date.now());
    } catch {
      showNotice("Couldn't start recording. Check your microphone permission.");
    }
  };

  /** Stop the recorder, upload the note (in-memory path), and send it. */
  const sendVoiceNote = async () => {
    if (!rec || recBusy) return;
    setRecBusy(true);
    try {
      const { blob, duration } = await rec.stop();
      const file = new File([blob], "voice-note.wav", {
        type: blob.type || "audio/wav",
      });
      const up = await uploadAny(file, { name: "Voice note", voice: true, duration });
      onSend("", { type: "voice", mediaId: up.mediaId, duration: up.duration, name: up.name }, replyTarget ?? undefined);
    } catch (err) {
      showNotice(
        err instanceof Error && err.message ? err.message : "Couldn't send the voice note.",
      );
    } finally {
      setRec(null);
      setRecStartedAt(0);
      setRecBusy(false);
    }
  };

  /** Discard a recording without uploading. */
  const cancelVoiceNote = () => {
    rec?.cancel();
    setRec(null);
    setRecStartedAt(0);
  };

  /** Paste an image straight into the composer (WhatsApp-style). */
  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const f = item.getAsFile();
        if (f) {
          e.preventDefault();
          beginPending(f);
          return;
        }
      }
    }
  };

  const sidebarButton =
    "mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-base-raised active:bg-base-border";

  return (
    <div
      ref={barRef}
      className="fixed z-20 border-t border-base-border bg-base/95 backdrop-blur"
      style={{
        bottom: `calc(${inset + trayOffset}px + env(safe-area-inset-bottom))`,
        left: "env(safe-area-inset-left)",
        right: "env(safe-area-inset-right)",
      }}
    >
      {replyTarget && (
        <div className="mx-auto max-w-2xl px-3 pt-2">
          <div className="cryo-in flex items-center gap-2.5 rounded-2xl border border-base-border2 bg-base-raised px-3 py-1.5">
            <IconReply
              width={15}
              height={15}
              className="shrink-0 -scale-x-100 text-accent"
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[10px] font-semibold text-accent">
                {replyTarget.name}
              </div>
              <div className="truncate text-xs text-ink-muted">
                {replyPreview(replyTarget)}
              </div>
            </div>
            <button
              type="button"
              onClick={onCancelReply}
              aria-label="Cancel reply"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-base-border hover:text-ink"
            >
              <IconX width={13} height={13} />
            </button>
          </div>
        </div>
      )}

      {notice && (
        <p className="mx-auto max-w-2xl px-3 pb-1 text-xs font-medium leading-snug text-rose-400">
          {notice}
        </p>
      )}

      <div className="mx-auto flex max-w-2xl items-end gap-2 px-3 py-2.5">
        <button
          onClick={() => (gifOpen ? closeTray() : openTray())}
          aria-label={gifOpen ? "Close stickers" : "Open stickers"}
          className={`mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors ${
            gifOpen
              ? "bg-base-border text-accent"
              : "text-ink-muted hover:bg-base-raised active:bg-base-border"
          }`}
        >
          <IconSticker width={22} height={22} />
        </button>

        <textarea
          ref={taRef}
          rows={1}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => {
            // Tapping the input while the tray is open dismisses it — otherwise
            // the keyboard and the tray would stack on top of each other.
            if (gifOpen) {
              setGifOpen(false);
              setClosingTray(true);
              waitUntil(() => keyboardInset() > 8, () => setClosingTray(false));
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              if (!isCoarse) {
                e.preventDefault();
                submit();
              }
            }
          }}
          onPaste={handlePaste}
          maxLength={MAX_MESSAGE_LENGTH}
          placeholder="Message…"
          aria-label="Message"
          enterKeyHint={isCoarse ? "enter" : "send"}
          autoCapitalize="sentences"
          autoCorrect="on"
          className="max-h-[9rem] flex-1 resize-none overflow-hidden rounded-3xl border border-base-border2 bg-base-raised px-4 py-2.5 text-[15px] leading-relaxed text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
          style={{ minHeight: "42px" }}
        />

        <button
          onClick={() => imageInputRef.current?.click()}
          aria-label="Attach image"
          className={sidebarButton}
        >
          <IconImage width={21} height={21} />
        </button>

        {voiceNotesEnabled && (
          <button
            type="button"
            onClick={() => void startVoice()}
            disabled={recBusy}
            aria-label={rec ? "Restart voice note" : "Record voice note"}
            className={`mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-40 ${
              rec
                ? "bg-rose-500/15 text-rose-500"
                : "text-ink-muted hover:bg-base-raised active:bg-base-border"
            }`}
          >
            <IconMic width={21} height={21} />
          </button>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={!text.trim()}
          aria-label="Send message"
          className="mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-white transition-all active:scale-95 disabled:opacity-30 disabled:active:scale-100"
        >
          <IconSend width={18} height={18} className="ml-0.5" />
        </button>
      </div>

      <input
        ref={stickerInputRef}
        type="file"
        accept="image/*"
        multiple={false}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void sendStickerFromImage(f);
        }}
      />
      <input
        ref={imageInputRef}
        type="file"
        accept={IMAGE_TYPES.join(",")}
        multiple={false}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) beginPending(f);
        }}
      />
      <input
        ref={gifInputRef}
        type="file"
        accept="image/gif,image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) beginPending(f);
        }}
      />

      {pending && (
        <AttachmentSheet
          key={pendingObj ?? "pending"}
          file={pending.file}
          previewUrl={pending.previewUrl}
          onCancel={clearPending}
          onSend={sendPending}
        />
      )}

      {!pending && gifOpen && (
        <GifPicker
          onPickPackSticker={sendPackSticker}
          onPickGif={(f) => beginPending(f)}
          onPickSticker={(f) => void sendSticker(f)}
          onPickEmoji={insertEmoji}
          onPickStickerFromImage={() => {
            setGifOpen(false);
            setTimeout(() => stickerInputRef.current?.click(), 0);
          }}
          onPickFile={() => gifInputRef.current?.click()}
          onClose={closeTray}
        />
      )}

      {!pending && rec && (
        <VoiceRecorder
          startedAt={recStartedAt}
          busy={recBusy}
          onSend={() => sendVoiceNote()}
          onCancel={cancelVoiceNote}
        />
      )}
    </div>
  );
}