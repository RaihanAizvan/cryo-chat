import { useState } from "react";
import type { PublicRoom, Participant } from "@cryo/shared";
import { Avatar } from "../ui/Avatar";
import { IconCopy, IconCheck, IconLink } from "../ui/Icon";

interface Props {
  room: PublicRoom;
  participants: Participant[];
  selfId: string | null;
}

export function roomShareLink(roomId: string): string {
  const base = window.location.origin;
  return `${base}/r/${roomId}`;
}

export function ShareRoom({ room, participants, selfId }: Props) {
  const [copied, setCopied] = useState<"link" | "code" | null>(null);

  const copy = async (kind: "link" | "code") => {
    const text = kind === "link" ? roomShareLink(room.id) : room.code;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for browsers without clipboard API.
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        /* ignore */
      }
      document.body.removeChild(ta);
    }
    setCopied(kind);
    setTimeout(() => setCopied(null), 2000);
  };

  const others = participants.filter((p) => p.id !== selfId);

  return (
    <div className="flex flex-col items-center px-6 pb-6 pt-10 text-center">
      <p className="mb-6 text-sm text-ink-muted">
        {others.length === 0
          ? "You're all set. Share the invite to bring someone in."
          : `Waiting for more people to join.`}
      </p>

      {/* Participants */}
      <div className="mb-8 flex items-center">
        {participants.length === 0 ? (
          <div className="flex h-16 w-16 items-center justify-center rounded-full border border-dashed border-base-border2 text-ink-faint">
            ?
          </div>
        ) : (
          <div className="flex -space-x-3">
            {participants.map((p) => (
              <div
                key={p.id}
                className="ring-2 ring-base"
                title={p.id === selfId ? "You" : p.name}
              >
                <Avatar name={p.name} color={p.color} size="lg" />
              </div>
            ))}
          </div>
        )}
      </div>

      {participants.length > 0 && (
        <div className="mb-8 grid w-full grid-cols-1 gap-1.5">
          {participants.map((p) => (
            <div key={p.id} className="flex items-center justify-center gap-2 text-sm text-ink-muted">
              <Avatar name={p.name} color={p.color} size="xs" />
              <span className="truncate">{p.name}</span>
              {p.id === selfId && (
                <span className="text-xs text-ink-faint">(you)</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Invite actions */}
      <div className="w-full max-w-xs space-y-2.5">
        <button
          onClick={() => copy("link")}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-accent py-3.5 text-[15px] font-semibold text-white transition-transform active:scale-[0.99]"
        >
          {copied === "link" ? (
            <>
              <IconCheck width={18} height={18} /> Link copied
            </>
          ) : (
            <>
              <IconLink width={18} height={18} /> Copy invite link
            </>
          )}
        </button>
        <button
          onClick={() => copy("code")}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-base-border2 bg-base-raised py-3.5 text-[15px] font-semibold text-ink transition-colors active:bg-base-border"
        >
          {copied === "code" ? (
            <>
              <IconCheck width={16} height={16} /> Copied
            </>
          ) : (
            <>
              <IconCopy width={16} height={16} /> Copy code{" "}
              <span className="font-mono tracking-widest text-ink-muted">
                {room.code}
              </span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
