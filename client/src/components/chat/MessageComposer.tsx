import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ClipboardEvent } from "react";
import type { MessageAttachment, PublicMessage } from "@cryo/shared";
import { MAX_MESSAGE_LENGTH } from "@cryo/shared";
import { IconEmoji, IconImage, IconReply, IconSend, IconSticker, IconX } from "../ui/Icon";
import { EmojiPicker } from "./EmojiPicker";
import { AttachmentSheet } from "./AttachmentSheet";
import { GifPicker } from "./GifPicker";
import {
  uploadMedia,
  getCloudinaryPreset,
  uploadToCloudinary,
  registerRemoteMedia,
  type UploadResult,
} from "../../lib/api";
import { prepareUpload } from "../../lib/image";
import { makeSticker } from "../../lib/sticker";
import { recordEmoji } from "../../lib/emoji";
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

/** Snippet shown in the reply pill: the message text, or a media label. */
function replyPreview(m: PublicMessage): string {
  if (m.text) return m.text;
  const a = m.attachment;
  if (!a) return "";
  if (a.viewOnce) return "One-time media";
  if (a.type === "gif") return "GIF";
  if (a.type === "sticker") return "Sticker";
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
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [gifOpen, setGifOpen] = useState(false);
  const [pending, setPending] = useState<PendingMedia | null>(null);
  const isCoarse = useCoarsePointer();
  const { inset } = useKeyboardInset();
  const taRef = useRef<HTMLTextAreaElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const gifInputRef = useRef<HTMLInputElement>(null);
  const stickerInputRef = useRef<HTMLInputElement>(null);

  const onChange = (value: string) => {
    setText(value);
    if (value && onTyping) onTyping();
  };

  useEffect(() => {
    if (!emojiOpen && !gifOpen && !pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setEmojiOpen(false);
      setGifOpen(false);
      if (pending) {
        setPending(null);
        setPendingObj(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [emojiOpen, gifOpen, pending]);

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

  /** Insert an emoji at the caret (fallback: append), keeping focus in the box. */
  const insertEmoji = (emoji: string) => {
    const ta = taRef.current;
    const start = ta?.selectionStart ?? text.length;
    const end = ta?.selectionEnd ?? start;
    const next = (text.slice(0, start) + emoji + text.slice(end)).slice(
      0,
      MAX_MESSAGE_LENGTH,
    );
    setText(next);
    recordEmoji(emoji);
    if (onTyping) onTyping();
    setTimeout(() => {
      const pos = start + emoji.length;
      ta?.focus();
      ta?.setSelectionRange(pos, pos);
    }, 0);
  };

  const closeAllPanels = () => {
    setEmojiOpen(false);
    setGifOpen(false);
  };

  /** Track the object URL separately so the sheet closes before we revoke it. */
  const [pendingObj, setPendingObj] = useState<string | null>(null);
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
    opts: { name?: string; sticker?: boolean; viewOnce?: boolean },
  ): Promise<UploadResult> => {
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
    onSend(caption, {
      type: up.type,
      mediaId: up.mediaId,
      viewOnce: up.viewOnce,
      width: up.width,
      height: up.height,
      name: up.name,
    });
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

  const clearPending = () => {
    setPending(null);
    setPendingObj((u) => {
      if (u) URL.revokeObjectURL(u);
      return null;
    });
    taRef.current?.focus();
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
        bottom: `calc(${inset}px + env(safe-area-inset-bottom))`,
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

      <div className="mx-auto flex max-w-2xl items-end gap-2 px-3 py-2.5">
        <button
          onClick={() => {
            setGifOpen(false);
            setEmojiOpen((v) => !v);
          }}
          aria-label={emojiOpen ? "Close emoji picker" : "Open emoji picker"}
          className={`mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors ${
            emojiOpen
              ? "bg-base-border text-accent"
              : "text-ink-muted hover:bg-base-raised active:bg-base-border"
          }`}
        >
          <IconEmoji width={22} height={22} />
        </button>

        <textarea
          ref={taRef}
          rows={1}
          value={text}
          onChange={(e) => onChange(e.target.value)}
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

        <button
          onClick={() => {
            setEmojiOpen(false);
            setGifOpen((v) => !v);
          }}
          aria-label={gifOpen ? "Close sticker picker" : "Open sticker picker"}
          className={`mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors ${
            gifOpen
              ? "bg-base-border text-accent"
              : "text-ink-muted hover:bg-base-raised active:bg-base-border"
          }`}
        >
          <IconSticker width={21} height={21} />
        </button>

        <button
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
          initialMode="sticker"
          onPickGif={(f) => beginPending(f)}
          onPickSticker={(f) => void sendSticker(f)}
          onPickStickerFromImage={() => {
            setGifOpen(false);
            setTimeout(() => stickerInputRef.current?.click(), 0);
          }}
          onPickFile={() => gifInputRef.current?.click()}
          onClose={() => setGifOpen(false)}
        />
      )}

      {!pending && emojiOpen && (
        <>
          <div
            className="fixed inset-0 z-10"
            aria-hidden
            onClick={() => setEmojiOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-full z-20 mx-auto max-w-2xl px-2 pb-1">
            <EmojiPicker onPick={insertEmoji} />
          </div>
        </>
      )}
    </div>
  );
}