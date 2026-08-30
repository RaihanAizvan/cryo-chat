import { useState } from "react";
import { avatarColor } from "@cryo/shared";
import {
  useRoomHistory,
  roomStatus,
  removeRoomHistory,
  clearRoomHistory,
  type HistoryEntry,
} from "../../lib/roomHistory";
import { timeAgo, formatCountdown } from "../../lib/format";
import { useNow } from "../../hooks/useNow";
import { IconUsers, IconX, IconArrowRight, IconCheck, IconLink } from "../ui/Icon";
import { roomShareLink } from "../chat/ShareRoom";

interface Props {
  onJoin: (roomId: string) => void;
}

/** Clickable card for a previously visited room, with live/expired status. */
function HistoryCard({
  entry,
  featured,
  onJoin,
}: {
  entry: HistoryEntry;
  featured?: boolean;
  onJoin: (id: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const now = useNow(1000);
  const live = roomStatus(entry, now) === "live";

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(roomShareLink(entry.id));
    } catch {
      /* ignore */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border transition-colors ${
        featured
          ? "border-accent/40 bg-accent/5"
          : "border-base-border bg-base-raised"
      }`}
    >
      <span
        className="absolute inset-y-0 left-0 w-1"
        style={{ background: avatarColor(entry.color) }}
      />
      <div className="flex w-full items-center gap-3 py-3 pl-4 pr-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                live
                  ? "bg-emerald-500/15 text-emerald-300"
                  : "bg-rose-500/10 text-rose-300"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  live ? "bg-emerald-400" : "bg-rose-400"
                }`}
              />
              {live ? "Active" : "Expired"}
            </span>
            <span className="font-mono text-[12px] font-semibold tracking-widest text-ink">
              {entry.code}
            </span>
          </div>

          <div
            className={`mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs ${
              featured ? "text-ink-muted" : "text-ink-faint"
            }`}
          >
            <span className="inline-flex items-center gap-1">
              <IconUsers width={13} height={13} />
              {entry.lastParticipants || 1}{" "}
              {entry.lastParticipants === 1 ? "person" : "people"}
            </span>
            <span className="font-mono tabular-nums">
              {live
                ? entry.isPrivate
                  ? "always open"
                  : `expires in ${formatCountdown(entry.expiresAt, now)}`
                : "room vanished"}
            </span>
            <span>· {timeAgo(entry.lastVisitedAt, now)}</span>          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={copyLink}
            className="flex h-8 w-8 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-base-border active:bg-base-border2"
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
            className="flex h-8 w-8 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-base-border active:bg-base-border2"
            aria-label="Remove from history"
            title="Remove from history"
          >
            <IconX width={16} height={16} />
          </button>
        </div>
      </div>
      <button
        onClick={() => onJoin(entry.id)}
        className={`flex w-full items-center justify-center gap-2 border-t py-2.5 text-[13px] font-semibold transition-colors ${
          featured
            ? "border-accent/20 bg-accent/10 text-accent active:bg-accent/20"
            : live
              ? "border-base-border text-ink active:bg-base-border"
              : "border-base-border text-ink-faint active:bg-base-border"
        }`}
      >
        {live ? "Continue" : "Try reopening"}
        <IconArrowRight width={15} height={15} />
      </button>
    </div>
  );
}

export function RecentRooms({ onJoin }: Props) {
  const history = useRoomHistory();
  const now = useNow(1000);

  if (history.length === 0) return null;

  // Promote the most recently visited live room.
  const live = history.filter((e) => roomStatus(e, now) === "live");
  const featured = live.length > 0 ? live[0] : undefined;
  const rest = history.filter((e) => e.id !== featured?.id);

  return (
    <section className="w-full px-6">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-faint">
          Recent rooms
        </h2>
        <button
          onClick={clearRoomHistory}
          className="text-xs text-ink-faint transition-colors hover:text-ink-muted"
        >
          Clear
        </button>
      </div>

      <div className="flex flex-col gap-2.5">
        {featured && (
          <div>
            <p className="mb-1.5 px-1 text-xs font-medium text-accent">
              Continue where you left off
            </p>
            <HistoryCard entry={featured} featured onJoin={onJoin} />
          </div>
        )}
        {rest.map((e) => (
          <HistoryCard key={e.id} entry={e} onJoin={onJoin} />
        ))}
      </div>
    </section>
  );
}
