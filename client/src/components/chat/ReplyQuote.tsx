import type { MessageReply } from "@cryo/shared";
import { mediaUrl } from "../../lib/api";
import { IconEye } from "../ui/Icon";

const TYPE_LABEL: Record<string, string> = {
  image: "Photo",
  gif: "GIF",
  sticker: "Sticker",
};

interface Props {
  reply: MessageReply;
  /** Render with the sender's bubble palette (light text on accent). */
  mine: boolean;
  /** Called with the quoted message id when the block is tapped. */
  onTap?: (messageId: string) => void;
}

/** WhatsApp-style quote block shown above the bubble of a replying message. */
export function ReplyQuote({ reply, mine, onTap }: Props) {
  const hasThumb = Boolean(reply.attachment?.mediaId) && !reply.viewOnce;
  const label = reply.viewOnce
    ? "One-time media"
    : reply.attachment
      ? TYPE_LABEL[reply.attachment.type] ?? "Media"
      : null;
  const snippet = reply.text || label || "";

  return (
    <button
      type="button"
      onClick={() => onTap?.(reply.messageId)}
      className={`flex w-full items-stretch gap-2 overflow-hidden rounded-lg p-1.5 text-left ${
        mine ? "bg-white/15" : "bg-base-border/80"
      } ${onTap ? "cursor-pointer" : "cursor-default"} active:opacity-80`}
    >
      <span
        className={`w-1 shrink-0 self-stretch rounded-full ${
          mine ? "bg-white/60" : "bg-accent"
        }`}
      />
      <span className="flex min-w-0 flex-col justify-center">
        <span
          className={`truncate text-[10px] font-semibold leading-tight ${
            mine ? "text-white/85" : "text-accent"
          }`}
        >
          {reply.name}
        </span>
        <span className={`mt-0.5 flex min-w-0 items-center gap-1.5 ${mine ? "text-white/70" : "text-ink-muted"}`}>
          {hasThumb && (
            <img
              src={mediaUrl(reply.attachment!.mediaId!, "")}
              alt=""
              loading="lazy"
              draggable={false}
              className="h-6 w-6 shrink-0 rounded border border-black/10 object-cover"
            />
          )}
          {reply.viewOnce && (
            <IconEye
              width={12}
              height={12}
              strokeWidth={2.2}
              className="shrink-0 text-ink-faint"
            />
          )}
          <span className="truncate text-[12px] leading-snug">{snippet}</span>
        </span>
      </span>
    </button>
  );
}