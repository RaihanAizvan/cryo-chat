import type { PublicMessage } from "@cryo/shared";
import { Avatar } from "../ui/Avatar";

interface Props {
  message: PublicMessage;
  mine: boolean;
  firstInGroup: boolean;
}

export function MessageBubble({ message, mine, firstInGroup }: Props) {
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
            className={`whitespace-pre-wrap [overflow-wrap:anywhere] px-3.5 py-2 text-[15px] leading-relaxed ${
              mine
                ? "rounded-bubble rounded-br-md bg-accent text-white"
                : "rounded-bubble rounded-bl-md border border-base-border bg-base-raised text-ink"
            }`}
          >
            {message.text}
          </div>
        </div>
      </div>
    </div>
  );
}
