import { Fragment, useLayoutEffect, useRef, useState } from "react";
import type { PublicMessage } from "@cryo/shared";
import { IconArrowRight } from "../ui/Icon";
import { sameMinute, formatTime } from "../../lib/format";
import { MessageBubble } from "./MessageBubble";

interface Props {
  messages: PublicMessage[];
  selfId: string | null;
  bottomInset: number;
}

const NEAR_BOTTOM = 48;

/** Group consecutive messages from the same sender within 3 minutes. */
function shouldGroup(prev: PublicMessage | undefined, cur: PublicMessage | undefined): boolean {
  if (!prev || !cur) return false;
  if (prev.kind === "system" || cur.kind === "system") return false;
  if (prev.participantId !== cur.participantId) return false;
  return sameMinute(prev.sentAt, cur.sentAt) || cur.sentAt - prev.sentAt < 3 * 60_000;
}

export function MessageList({ messages, selfId, bottomInset }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const [showJump, setShowJump] = useState(false);

  // After the message list or viewport size changes, stay pinned to the bottom
  // only if the user was already near the bottom (so reading older messages is
  // never interrupted).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, bottomInset]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM;
    stickToBottom.current = nearBottom;
    setShowJump(!nearBottom);
  };

  const jumpToBottom = () => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    stickToBottom.current = true;
    setShowJump(false);
  };

  return (
    <div className="relative h-full overflow-hidden">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="no-scrollbar h-full overflow-y-auto overscroll-contain px-3 py-3"
        style={{ paddingBottom: bottomInset }}
      >
        <div className="mx-auto max-w-2xl space-y-1">
          {messages.map((m, i) => {
            const mine = m.participantId === selfId;
            const prev = messages[i - 1];
            const firstInGroup = !shouldGroup(prev, m);
            // The divider compares against the previous *user* message (not a
            // transient join/left pill), so it shows for the first real message
            // and whenever a gap of ~2 minutes has passed.
            let prevUserSentAt: number | null = null;
            for (let p = i - 1; p >= 0; p--) {
              if (messages[p].kind !== "system") {
                prevUserSentAt = messages[p].sentAt;
                break;
              }
            }
            const showDivider =
              m.kind !== "system" &&
              (prevUserSentAt === null ||
                m.sentAt - prevUserSentAt >= 2 * 60_000);

            if (m.kind === "system") {
              return (
                <div key={m.id} className="my-2 flex items-center justify-center">
                  <span className="rounded-full border border-base-border2 bg-base-raised px-2.5 py-0.5 text-[10px] font-medium text-ink-faint">
                    {m.text}
                  </span>
                </div>
              );
            }

            return (
              <Fragment key={m.id}>
                {showDivider && (
                  <div className="my-2 flex items-center justify-center">
                    <span className="rounded-full border border-base-border2 bg-base-raised px-2.5 py-0.5 text-[10px] font-medium text-ink-faint">
                      {formatTime(m.sentAt)}
                    </span>
                  </div>
                )}
                <MessageBubble
                  message={m}
                  mine={mine}
                  firstInGroup={firstInGroup}
                />
              </Fragment>
            );
          })}
          {messages.length === 0 && (
            <div className="py-4 text-center text-xs text-ink-faint">
              No messages yet. Say hello.
            </div>
          )}
        </div>
      </div>

      {showJump && (
        <button
          onClick={jumpToBottom}
          className="cryo-pop absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-base-border2 bg-base-raised px-3 py-1.5 text-xs font-medium text-ink-muted shadow-lg active:bg-base-border"
          aria-label="Scroll to latest"
        >
          <IconArrowRight width={14} height={14} className="rotate-[-90deg]" />
          Latest
        </button>
      )}
    </div>
  );
}
