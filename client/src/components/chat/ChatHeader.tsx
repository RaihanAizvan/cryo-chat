import { useState } from "react";
import type { PublicRoom } from "@cryo/shared";
import { IconBack, IconDots } from "../ui/Icon";
import { ConnectionStatus } from "./ConnectionStatus";

interface Props {
  room: PublicRoom;
  participantCount: number;
  notice: string | null;
  onBack: () => void;
  onLeave: () => void;
}

export function ChatHeader({ room, participantCount, notice, onBack, onLeave }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="relative z-20 shrink-0 border-b border-base-border bg-base/95 backdrop-blur">
      <div className="mx-auto flex max-w-2xl items-center gap-2 px-3 py-2.5">
        <button
          onClick={onBack}
          className="flex h-10 w-10 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-base-raised active:bg-base-border"
          aria-label="Back"
        >
          <IconBack width={22} height={22} />
        </button>

        {/* Room title */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2">
            <span className="truncate text-[15px] font-semibold text-ink">
              {participantCount === 2 ? "Private chat" : `Room · ${participantCount}`}
            </span>
            <span className="rounded-md bg-base-border px-1.5 py-0.5 font-mono text-[11px] font-semibold tracking-wider text-ink-muted">
              {room.code}
            </span>
          </div>
          <ConnectionStatus />
        </div>

        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="flex h-10 w-10 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-base-raised active:bg-base-border"
          aria-label="Room options"
        >
          <IconDots width={20} height={20} />
        </button>
      </div>

      {/* Transient notice (join/left/errors) */}
      {notice && (
        <div className="cryo-in border-t border-base-border bg-base-raised/60 px-4 py-2 text-center text-xs text-ink-muted">
          {notice}
        </div>
      )}

      {menuOpen && (
        <>
          <button
            className="fixed inset-0 z-10"
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
          />
          <div className="cryo-pop absolute right-3 top-full z-20 mt-1 w-40 overflow-hidden rounded-xl border border-base-border2 bg-base-raised p-1 shadow-xl">
            <button
              onClick={() => {
                onLeave();
                setMenuOpen(false);
              }}
              className="w-full rounded-lg px-3 py-2 text-left text-sm text-rose-300 transition-colors hover:bg-base-border"
            >
              Leave room
            </button>
          </div>
        </>
      )}
    </header>
  );
}
