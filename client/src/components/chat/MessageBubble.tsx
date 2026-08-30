import type { PublicMessage } from "@cryo/shared";
import { Avatar } from "../ui/Avatar";
import { formatTime } from "../../lib/format";
import { IconCheck, IconDoubleTick } from "../ui/Icon";

interface Props {
  message: PublicMessage;
  mine: boolean;
  firstInGroup: boolean;
  /** True when a recipient is present in the room, meaning the message was seen. */
  seen?: boolean;
}

export function MessageBubble({ message, mine, firstInGroup, seen }: Props) {
  const showName = !mine && firstInGroup;

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
          <div
            className={`whitespace-pre-wrap [overflow-wrap:anywhere] px-3.5 py-2 pb-1.5 text-[15px] leading-relaxed ${
              mine
                ? "rounded-bubble rounded-br-md bg-accent text-white"
                : "rounded-bubble rounded-bl-md border border-base-border bg-base-raised text-ink"
            }`}
          >
            {message.text}
            <span
              className={`ml-1.5 flex items-center justify-end gap-0.5 whitespace-nowrap pt-1 text-right text-[9px] leading-none ${
                mine ? "text-white/60" : "text-ink-faint"
              }`}
            >
              {formatTime(message.sentAt)}
              {mine &&
                (seen ? (
                  <IconDoubleTick
                    width={13}
                    height={13}
                    strokeWidth={2.2}
                    className="-mr-0.5 text-emerald-300"
                  />
                ) : (
                  <IconCheck width={11} height={11} strokeWidth={2.4} />
                ))}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
