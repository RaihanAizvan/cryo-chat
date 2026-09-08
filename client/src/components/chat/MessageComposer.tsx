import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ClipboardEvent } from "react";
import type { MessageAttachment } from "@cryo/shared";
import { MAX_MESSAGE_LENGTH } from "@cryo/shared";
import { IconEmoji, IconImage, IconSend, IconSticker } from "../ui/Icon";
import { EmojiPicker } from "./EmojiPicker";
import { AttachmentSheet } from "./AttachmentSheet";
import { GifPicker } from "./GifPicker";
import { uploadMedia } from "../../lib/api";
import { makeSticker } from "../../lib/sticker";
import { recordEmoji } from "../../lib/emoji";
import { useCoarsePointer, useKeyboardInset } from "../../hooks/useKeyboardInset";

interface Props {
  onSend: (text: string, attachment?: MessageAttachment) => void;
  onHeightChange?: (height: number) => void;
  /** Called (throttled) while the user types, to show the typing indicator. */
  onTyping?: () => void;
}

interface PendingMedia {
  file: File;
  previewUrl: string;
}

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export function MessageComposer({ onSend, onHeightChange, onTyping }: Props) {
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
    onSend(trimmed);
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

  const beginPending = (file: File) => {
    if (!IMAGE_TYPES.includes(file.type)) return;
    closeAllPanels();
    const url = URL.createObjectURL(file);
    setPendingObj(url);
    setPending({ file, previewUrl: url });
  };

  /** Upload the pending file, then send it as a message with a caption. */
  const sendPending = async (caption: string, viewOnce: boolean) => {
    const p = pending;
    if (!p) return;
    const up = await uploadMedia(p.file, { viewOnce, name: p.file.name });
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
      const up = await uploadMedia(file, { name: "sticker", sticker: true });
      onSend("", {
        type: "sticker",
        mediaId: up.mediaId,
        width: up.width,
        height: up.height,
        name: "Sticker",
      });
    } catch {
      // silent – a failed sticker needs no UI ceremony
    }
  };

  /** "Make a sticker": square-crop the picked image, then send it instantly. */
  const sendStickerFromImage = async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    try {
      const sticker = await makeSticker(file);
      await sendSticker(sticker);
    } catch {
      // silent
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