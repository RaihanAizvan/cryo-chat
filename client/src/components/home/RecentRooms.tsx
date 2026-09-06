import { useState } from "react";
import {
  useRoomHistory,
  roomStatus,
  removeRoomHistory,
  clearRoomHistory,
  type HistoryEntry,
} from "../../lib/roomHistory";
import { timeAgo } from "../../lib/format";
import { useNow } from "../../hooks/useNow";
import { Avatar } from "../ui/Avatar";
import { IconX, IconCheck, IconLink } from "../ui/Icon";
import { roomShareLink } from "../chat/ShareRoom";

interface Props {
  onJoin: (code: string) => void;
}

/** The display name of a chat, like a contact row in a messenger. */
function roomName(entry: HistoryEntry): string {
  if (entry.persistent) return "Your space";
  // When it was last a two-person chat it reads like a direct conversation.
  return entry.lastParticipants <= 2 ? "Private chat" : `Room ${entry.code}`;
}

/** One chat row: avatar (dp), name + time on top, people + status below. */
function HistoryRow({
  entry,
  onJoin,
}: {
  entry: HistoryEntry;
  onJoin: (code: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const now = useNow(1000);
  const status = roomStatus(entry, now);
  const live = status === "live";

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(roomShareLink(entry));
    } catch {
      /* ignore */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <li className="flex w-full items-center gap-2 rounded-xl transition-colors hover:bg-base-raised active:bg-base-border">
      <button
        onClick={() => onJoin(entry.code)}
        className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-2 text-left"
      >
        <Avatar name={roomName(entry)} color={entry.color} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[15px] font-semibold text-ink">
              {roomName(entry)}
            </span>
            <span className="shrink-0 text-[11px] tabular-nums text-ink-faint">
              {timeAgo(entry.lastVisitedAt, now)}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[13px]">
            <span className="truncate text-ink-muted">
              {entry.lastParticipants || 1}{" "}
              {entry.lastParticipants === 1 ? "person" : "people"}
              {!live && (
                <span
                  className={`font-medium ${
                    status === "closed" ? "text-rose-300" : "text-ink-faint"
                  }`}
                >
                  {" "}
                  · {status === "closed" ? "closed" : "expired"}
                </span>
              )}
            </span>
            <span
              className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                live
                  ? "bg-emerald-500/15 text-emerald-300"
                  : status === "closed"
                    ? "bg-rose-500/10 text-rose-300"
                    : "bg-slate-500/10 text-slate-300"
              }`}
            >
              {live ? (entry.persistent ? "open" : "active") : status}
            </span>
          </div>
        </div>
      </button>

      <div className="flex shrink-0 items-center gap-0.5 pr-1">
        <button
          onClick={copyLink}
          className="flex h-9 w-9 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-base-border active:bg-base-border2"
          aria-label="Copy invite link"
          title="Copy invite link"
        >
          {copied ? (
            <IconCheck width={16} height={16} className="text-emerald-400" />
          ) : (
            <IconLink width={16} height={16} />
          )}
        </button>
        <button
          onClick={() => removeRoomHistory(entry.id)}
          className="flex h-9 w-9 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-base-border active:bg-base-border2"
          aria-label="Remove from history"
          title="Remove from history"
        >
          <IconX width={16} height={16} />
        </button>
      </div>
    </li>
  );
}

export function RecentRooms({ onJoin }: Props) {
  const history = useRoomHistory();

  if (history.length === 0) return null;

  return (
    <section className="w-full px-4">
      <div className="mb-1 flex items-center justify-between px-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-faint">
          Recent
        </h2>
        <button
          onClick={clearRoomHistory}
          className="text-xs text-ink-faint transition-colors hover:text-ink-muted"
        >
          Clear
        </button>
      </div>

      <ul className="stagger flex flex-col py-1">
        {history.map((e) => (
          <HistoryRow key={e.id} entry={e} onJoin={onJoin} />
        ))}
      </ul>
    </section>
  );
}