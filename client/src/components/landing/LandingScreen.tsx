import { useState } from "react";
import { useSession } from "../../lib/store";
import { Avatar } from "../ui/Avatar";
import { IconArrowRight, IconPlus } from "../ui/Icon";
import { JoinRoom } from "./JoinRoom";
import { NameEditor } from "./NameEditor";
import { ConnectionStatus } from "../chat/ConnectionStatus";
import type { RoomActions, RoomState } from "../../hooks/useChatRoom";

interface Props {
  state: RoomState;
  actions: RoomActions;
}

export function LandingScreen({ state, actions }: Props) {
  const session = useSession();
  const [joinOpen, setJoinOpen] = useState(false);
  const [editName, setEditName] = useState(false);

  return (
    <div className="flex min-h-full flex-col">
      {/* Header with connection + profile */}
      <header className="flex items-center justify-between px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-4">
        <ConnectionStatus />
        <button
          onClick={() => setEditName(true)}
          className="flex items-center gap-2 rounded-full py-1 pl-1 pr-3 transition-colors hover:bg-base-raised active:bg-base-border"
          aria-label="Change display name"
        >
          {session.name && (
            <Avatar name={session.name} color={session.color} size="sm" />
          )}
          <span className="max-w-[9rem] truncate text-sm text-ink-muted">
            {session.name ?? "…"}
          </span>
        </button>
      </header>

      {/* Hero */}
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-base-border text-xl text-ink">
          <span className="font-semibold tracking-tight">cr</span>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-ink">
          Chat with no trace.
        </h1>
        <p className="mt-3 max-w-[16rem] text-[15px] leading-relaxed text-ink-muted">
          Create a private room, share the link, and talk. Rooms vanish when you
          leave.
        </p>
      </div>

      {/* Actions */}
      <div className="mt-auto flex flex-col gap-3 px-6 pb-[max(1.75rem,env(safe-area-inset-bottom))]">
        <button
          onClick={actions.createRoom}
          className="flex items-center justify-center gap-2 rounded-2xl bg-accent py-3.5 text-[15px] font-semibold text-white transition-transform active:scale-[0.99]"
        >
          <IconPlus width={18} height={18} />
          Create a room
        </button>
        <button
          onClick={() => setJoinOpen(true)}
          className="flex items-center justify-center gap-2 rounded-2xl border border-base-border2 bg-base-raised py-3.5 text-[15px] font-semibold text-ink transition-colors active:bg-base-border"
        >
          Join a room
          <IconArrowRight width={18} height={18} />
        </button>
      </div>

      {joinOpen && (
        <JoinRoom
          error={state.joinError}
          onErrorClear={actions.clearJoinError}
          onClose={() => {
            actions.clearJoinError();
            setJoinOpen(false);
          }}
          onJoin={actions.joinRoom}
        />
      )}

      {editName && (
        <NameEditor initial={session.name ?? ""} onClose={() => setEditName(false)} />
      )}
    </div>
  );
}
