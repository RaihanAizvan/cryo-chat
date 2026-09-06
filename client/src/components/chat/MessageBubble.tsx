import { Fragment } from "react";
import type { PublicMessage } from "@cryo/shared";
import { Avatar } from "../ui/Avatar";
import { formatTime } from "../../lib/format";
import { IconCheck, IconClock, IconAlertTriangle, IconDoubleTick } from "../ui/Icon";
import { isEmojiOnly } from "../../lib/emojiDetect";

interface Props {
  message: PublicMessage;
  mine: boolean;
  firstInGroup: boolean;
  /** True when a recipient is present in the room, meaning the message was seen. */
  seen?: boolean;
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

export function MessageBubble({ message, mine, firstInGroup, seen }: Props) {
  const showName = !mine && firstInGroup;
  const emojiOnly = isEmojiOnly(message.text);
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

  return (
    <div
      className={`flex w-full items-end gap-2 ${mine ? "justify-end" : "justify-start"}`}
    >
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
        <div className="cryo-in flex items-end gap-1.5">
          {emojiOnly ? (
            <div className="relative pr-0.5">
              <span className="block whitespace-pre-wrap px-1 text-[2.6rem] leading-[1.15]">
                {message.text}
              </span>
              <span
                className={`relative -top-1.5 ml-1.5 flex items-center gap-0.5 whitespace-nowrap pb-0.5 text-right text-[9px] leading-none ${
                  mine ? "text-ink-faint/70" : "text-ink-faint"
                }`}
              >
                {formatTime(message.sentAt)}
                {mine && <StatusIcon status={status} tone="plain" />}
              </span>
            </div>
          ) : (
            <div
              className={`whitespace-pre-wrap [overflow-wrap:anywhere] px-3.5 py-2 pb-1.5 text-[15px] leading-relaxed ${
                mine
                  ? "rounded-bubble rounded-br-md bg-accent text-white"
                  : "rounded-bubble rounded-bl-md border border-base-border bg-base-raised text-ink"
              }`}
            >
              {renderText(message.text)}
              <span
                className={`ml-1.5 flex items-center justify-end gap-0.5 whitespace-nowrap pt-1 text-right text-[9px] leading-none ${
                  mine ? "text-white/60" : "text-ink-faint"
                }`}
              >
                {formatTime(message.sentAt)}
                {mine && (
                  <StatusIcon
                    status={status}
                    tone={mine ? "on-accent" : "plain"}
                  />
                )}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
