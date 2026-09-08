import { Fragment, useRef, useState } from "react";
import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import type { PublicMessage } from "@cryo/shared";
import { Avatar } from "../ui/Avatar";
import { formatTime } from "../../lib/format";
import {
  IconCheck,
  IconClock,
  IconAlertTriangle,
  IconDoubleTick,
  IconReply,
} from "../ui/Icon";
import { isEmojiOnly } from "../../lib/emojiDetect";
import { MediaMessage } from "./MediaMessage";
import { ReplyQuote } from "./ReplyQuote";

interface Props {
  message: PublicMessage;
  mine: boolean;
  firstInGroup: boolean;
  /** True when a recipient is present in the room, meaning the message was seen. */
  seen?: boolean;
  /** Viewer's session id, used to fetch attached media. */
  sessionId: string;
  /** Called after a swipe-right or hovering the reply button. */
  onReply?: (message: PublicMessage) => void;
  /** Called when the quote block is tapped; scrolls to the quoted message. */
  onQuoteTap?: (messageId: string) => void;
}

const URL_RE = /(https?:\/\/[^\s<]+)/g;

/** Render text with http(s) URLs turned into safe, new-tab links. */
function renderText(text: string) {
  const parts = text.split(URL_RE);
  return parts.map((part, i) => {
    if (i % 2 === 1) {
      return (
        <a
          key={i}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-inherit underline-offset-2 hover:opacity-80"
        >
          {part}
        </a>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

/** A tiny delivery-status icon (WhatsApp-style): clock → tick → double tick. */
function StatusIcon({
  status,
  tone,
}: {
  status: "pending" | "sent" | "seen" | "failed";
  tone: "on-accent" | "plain";
}) {
  const color =
    status === "pending"
      ? tone === "on-accent"
        ? "text-white/60"
        : "text-amber-300/80"
      : status === "failed"
        ? "text-rose-400"
        : status === "seen"
          ? "text-emerald-300"
          : tone === "on-accent"
            ? "text-white/60"
            : "text-ink-faint";
  if (status === "pending") {
    return <IconClock width={11} height={11} strokeWidth={2.2} className={color} />;
  }
  if (status === "failed") {
    return (
      <IconAlertTriangle width={11} height={11} strokeWidth={2.2} className={color} />
    );
  }
  if (status === "seen") {
    return (
      <IconDoubleTick
        width={13}
        height={13}
        strokeWidth={2.2}
        className={`-mr-0.5 ${color}`}
      />
    );
  }
  return <IconCheck width={11} height={11} strokeWidth={2.4} className={color} />;
}

const SWIPE_ARM_PX = 56;
const SWIPE_MAX_PX = 88;

/**
 * Mobile-first swipe-to-reply. Touch-action "pan-y" leaves vertical scrolling
 * to the message list while horizontal drags come to us; once the gesture
 * looks horizontal we capture the pointer and rubber-band the bubble. Crossing
 * the arm threshold on release fires the reply; anything else springs back.
 * Click-suppression stops the swipe's trailing "click" from opening media.
 */
function useSwipeToReply(enabled: boolean, onArmed: (() => void) | undefined) {
  const [dragX, setDragX] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    captured: boolean;
  } | null>(null);
  const dxRef = useRef(0);
  const didSwipe = useRef(false);

  const reset = () => {
    drag.current = null;
    dxRef.current = 0;
    setDragX(0);
    setSwiping(false);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!enabled || !onArmed || e.button !== 0) return;
    drag.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      captured: false,
    };
    dxRef.current = 0;
    didSwipe.current = false;
    setDragX(0);
    setSwiping(false);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    // Vertical intent: let the list scroll natively.
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 6) return;
    // Only rightward swipes reply; ignore slop.
    if (dx < 6) return;
    if (!d.captured) {
      try {
        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
        d.captured = true;
      } catch {
        /* ignore capture failure */
      }
    }
    dxRef.current = Math.min(dx, SWIPE_MAX_PX);
    setSwiping(true);
    setDragX(dxRef.current);
  };

  const finish = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    if (dxRef.current >= SWIPE_ARM_PX) {
      didSwipe.current = true;
      drag.current = null;
      dxRef.current = 0;
      onArmed?.();
    }
    reset();
  };

  // Swallow the click that a completed swipe trails behind it.
  const onClickCapture = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (didSwipe.current) {
      e.preventDefault();
      e.stopPropagation();
      didSwipe.current = false;
    }
  };

  const rowStyle: CSSProperties = {
    touchAction: "pan-y",
    transition: swiping ? "none" : "transform 180ms ease-out",
    ...(swiping ? { transform: `translateX(${dragX}px)` } : undefined),
  };

  return {
    rowStyle,
    swiping,
    armed: swiping && dxRef.current >= SWIPE_ARM_PX,
    onPointerDown,
    onPointerMove,
    onPointerUp: finish,
    onPointerCancel: finish,
    onClickCapture,
  };
}

export function MessageBubble({
  message,
  mine,
  firstInGroup,
  seen,
  sessionId,
  onReply,
  onQuoteTap,
}: Props) {
  const showName = !mine && firstInGroup;
  const emojiOnly = isEmojiOnly(message.text);
  const hasMedia = Boolean(message.attachment);
  const replyEnabled = message.kind === "user" && Boolean(onReply);
  const swipe = useSwipeToReply(replyEnabled, onReply ? () => onReply(message) : undefined);
  // Pending/failed are set by the sender's optimistic copy; otherwise the
  // message is "sent" until a recipient is present ("seen").
  const status: "pending" | "sent" | "seen" | "failed" =
    message.status === "pending"
      ? "pending"
      : message.status === "failed"
        ? "failed"
        : mine && seen
          ? "seen"
          : "sent";

  const timeAndStatus = (
    <span
      className={`flex items-center gap-0.5 whitespace-nowrap text-[9px] leading-none ${
        mine ? "text-white/60" : "text-ink-faint"
      }`}
    >
      {formatTime(message.sentAt)}
      {mine && <StatusIcon status={status} tone={mine ? "on-accent" : "plain"} />}
    </span>
  );

  // Overlaid on the image itself: always light-on-dark, even for other users.
  const overlayTimeAndStatus = (
    <span className="flex items-center gap-0.5 whitespace-nowrap text-[9px] leading-none text-white/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">
      {formatTime(message.sentAt)}
      {mine && <StatusIcon status={status} tone="on-accent" />}
    </span>
  );

  const quote = message.replyTo ? (
    <ReplyQuote reply={message.replyTo} mine={mine} onTap={onQuoteTap} />
  ) : null;

  return (
    <div
      data-message-id={message.id}
      onClickCapture={swipe.onClickCapture}
      onPointerDown={swipe.onPointerDown}
      onPointerMove={swipe.onPointerMove}
      onPointerUp={swipe.onPointerUp}
      onPointerCancel={swipe.onPointerCancel}
      style={swipe.rowStyle}
      className={`group relative flex w-full items-end gap-2 ${
        mine ? "justify-end" : "justify-start"
      }`}
    >
      {/* Hover reply button (desktop) — fades in beside the bubble, right side. */}
      {replyEnabled && (
        <button
          type="button"
          onClick={() => onReply?.(message)}
          aria-label="Reply"
          className="absolute right-0.5 top-1/2 z-10 flex -translate-y-1/2 items-center justify-center rounded-full border border-base-border2 bg-base-raised p-1.5 text-ink-muted opacity-0 shadow-md transition-opacity hover:text-accent group-hover:opacity-100"
        >
          <IconReply width={14} height={14} />
        </button>
      )}

      {/* Swipe hint while dragging right. */}
      {swipe.swiping && (
        <span
          className={`pointer-events-none absolute top-1/2 z-10 flex -translate-y-1/2 items-center gap-1 rounded-full bg-ink/85 px-2 py-1 text-[10px] font-semibold text-white shadow-md ${
            swipe.armed ? "" : "opacity-60"
          } ${mine ? "left-1.5" : "right-1.5"}`}
        >
          <IconReply width={12} height={12} />
          Reply
        </span>
      )}

      {/* Leading avatar for other participants, only on the first of a group. */}
      {!mine && (
        <>
          {firstInGroup ? (
            <Avatar name={message.name} color={message.color} size="sm" className="mb-0.5" />
          ) : (
            <span className="w-8 shrink-0" />
          )}
        </>
      )}

      <div
        className={`flex min-w-0 max-w-[78%] flex-col ${mine ? "items-end" : "items-start"}`}
      >
        {showName && (
          <span className="mb-0.5 px-1 text-xs font-medium text-ink-faint">
            {message.name}
          </span>
        )}

        {hasMedia ? (
          <>
            {message.attachment?.type === "sticker" && quote && (
              <div className="mb-1 w-max max-w-full">{quote}</div>
            )}
            <div
              className={`${
                message.attachment?.type === "sticker"
                  ? ""
                  : `overflow-hidden rounded-bubble ${mine ? "" : "border border-base-border"}`
              }`}
            >
              <div className="relative">
                {message.attachment?.type !== "sticker" && quote && (
                  <div className="p-1.5 pb-1">{quote}</div>
                )}
                <MediaMessage attachment={message.attachment!} sessionId={sessionId} />
                {!message.text && (
                  <span className="absolute inset-x-0 bottom-0 flex items-end justify-end gap-0.5 bg-gradient-to-t from-black/45 to-transparent px-2 pb-1.5 pt-4">
                    {overlayTimeAndStatus}
                  </span>
                )}
              </div>
            </div>
            {message.text && (
              <div
                className={`mt-1 max-w-full px-1 text-[15px] leading-relaxed ${
                  mine ? "text-right" : "text-left"
                }`}
              >
                <span className="whitespace-pre-wrap [overflow-wrap:anywhere] text-ink">
                  {emojiOnly ? (
                    <span className="block break-all text-[2.6rem] leading-[1.15]">
                      {message.text}
                    </span>
                  ) : (
                    renderText(message.text)
                  )}
                </span>
                <span className="ml-1.5 flex items-center gap-0.5 whitespace-nowrap text-[9px] leading-none text-ink-faint">
                  {formatTime(message.sentAt)}
                  {mine && <StatusIcon status={status} tone="plain" />}
                </span>
              </div>
            )}
          </>
        ) : (
          <div className={`cryo-in flex items-end gap-1.5 ${emojiOnly ? "flex-col items-start" : ""}`}>
            {emojiOnly ? (
              <>
                {quote && <div className="mb-0.5 w-max max-w-full">{quote}</div>}
                <div className="relative pr-0.5">
                  <span className="block whitespace-pre-wrap px-1 text-[2.6rem] leading-[1.15]">
                    {message.text}
                  </span>
                  <span
                    className={`relative -top-1.5 ml-1.5 flex items-center gap-0.5 whitespace-nowrap pb-0.5 text-right text-[9px] leading-none ${
                      mine ? "text-ink-faint/70" : "text-ink-faint"
                    }`}
                  >
                    {timeAndStatus}
                  </span>
                </div>
              </>
            ) : (
              <div
                className={`rounded-bubble px-3.5 py-2 pb-1.5 text-[15px] leading-relaxed ${
                  mine
                    ? "rounded-br-md bg-accent text-white"
                    : "rounded-bl-md border border-base-border bg-base-raised text-ink"
                }`}
              >
                {quote && (
                  <div className="-mx-1 -mt-0.5 mb-1.5">{quote}</div>
                )}
                <div className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                  {renderText(message.text)}
                </div>
                <span
                  className={`ml-1.5 flex items-center justify-end gap-0.5 whitespace-nowrap pt-1 text-right text-[9px] leading-none ${
                    mine ? "text-white/60" : "text-ink-faint"
                  }`}
                >
                  {timeAndStatus}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}