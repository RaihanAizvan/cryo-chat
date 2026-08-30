import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { MAX_MESSAGE_LENGTH } from "@cryo/shared";
import { IconEmoji, IconSend } from "../ui/Icon";
import { EmojiPicker } from "./EmojiPicker";
import { recordEmoji } from "../../lib/emoji";
import { useCoarsePointer, useKeyboardInset } from "../../hooks/useKeyboardInset";

interface Props {
  onSend: (text: string) => void;
  onHeightChange?: (height: number) => void;
}

export function MessageComposer({ onSend, onHeightChange }: Props) {
  const [text, setText] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const isCoarse = useCoarsePointer();
  const { inset } = useKeyboardInset();
  const taRef = useRef<HTMLTextAreaElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!emojiOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setEmojiOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [emojiOpen]);

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
    setTimeout(() => {
      const pos = start + emoji.length;
      ta?.focus();
      ta?.setSelectionRange(pos, pos);
    }, 0);
  };

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
          onClick={() => setEmojiOpen((v) => !v)}
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
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              if (!isCoarse) {
                e.preventDefault();
                submit();
              }
            }
          }}
          maxLength={MAX_MESSAGE_LENGTH}
          placeholder="Message…"
          enterKeyHint={isCoarse ? "enter" : "send"}
          autoCapitalize="sentences"
          autoCorrect="on"
          className="max-h-[9rem] flex-1 resize-none overflow-hidden rounded-3xl border border-base-border2 bg-base-raised px-4 py-2.5 text-[15px] leading-relaxed text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
          style={{ minHeight: "42px" }}
        />

        <button
          onClick={submit}
          disabled={!text.trim()}
          aria-label="Send message"
          className="mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-white transition-all active:scale-95 disabled:opacity-30 disabled:active:scale-100"
        >
          <IconSend width={18} height={18} className="ml-0.5" />
        </button>
      </div>

      {emojiOpen && (
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
