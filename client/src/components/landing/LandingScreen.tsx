import { useState } from "react";
import { useSession, useConnectionStatus, connectAndInit } from "../../lib/store";
import { getStoredDisplayName } from "../../lib/prefs";
import { Avatar } from "../ui/Avatar";
import { IconArrowRight, IconPlus, IconLink } from "../ui/Icon";
import { JoinRoom } from "./JoinRoom";
import { NameEditor } from "./NameEditor";
import { ConnectionStatus } from "../chat/ConnectionStatus";
import { RecentRooms } from "../home/RecentRooms";
import type { RoomActions, RoomState } from "../../hooks/useChatRoom";

interface Props {
  state: RoomState;
  actions: RoomActions;
}

const CONNECT_LABEL: Record<string, string> = {
  connected: "Connected",
  connecting: "Connecting…",
  reconnecting: "Reconnecting…",
  disconnected: "Connect",
};

export function LandingScreen({ state, actions }: Props) {
  const session = useSession();
  const connection = useConnectionStatus();
  const [joinOpen, setJoinOpen] = useState(false);
  const [editName, setEditName] = useState(false);

  const connected = connection === "connected";
  const pending = connection === "connecting" || connection === "reconnecting";
  const privateRoomCode = session.reservedRoomCode;

  return (
    <div className="flex min-h-full flex-col">
      {/* Header with connection + profile */}
      <header className="flex items-center justify-between gap-3 px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-4">
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
      <div className="flex flex-col items-center px-6 pt-6 pb-8 text-center">
        <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-base-border bg-base-raised text-xl text-ink">
          <span className="font-semibold tracking-tight">cr</span>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-ink">
          Chat with no trace.
        </h1>
        <p className="mt-2.5 max-w-[17rem] text-[15px] leading-relaxed text-ink-muted">
          Private rooms, ephemeral by design. Rooms vanish when you leave.
        </p>

        {/* Explicit connect / status control */}
        <div className="mt-5 flex items-center gap-2">
          {connected ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Connected
            </span>
          ) : (
            <button
              onClick={connectAndInit}
              disabled={pending}
              className="flex items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-4 py-2 text-sm font-semibold text-accent transition-colors active:bg-accent/20 disabled:opacity-60"
            >
              <IconLink width={16} height={16} />
              {CONNECT_LABEL[connection] ?? "Connect"}
            </button>
          )}
        </div>
      </div>

      {/* Preserved private room for you and a friend */}
      {privateRoomCode && (
        <div className="w-full px-6 pb-3">
          <div className="relative overflow-hidden rounded-2xl border border-accent/30 bg-accent/5 px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wider text-accent">
                  Your private room
                </p>
                <p className="mt-0.5 text-xs text-ink-muted">
                  Just you and a friend. This code always works.
                </p>
                <div className="mt-2.5 inline-flex items-center gap-1 rounded-lg border border-base-border2 bg-base px-2.5 py-1 font-mono text-[13px] font-semibold tracking-[0.3em] text-ink">
                  {privateRoomCode.slice(0, 4)} {privateRoomCode.slice(4)}
                </div>
              </div>
              <button
                onClick={() => actions.joinRoom(privateRoomCode)}
                disabled={!connected}
                className="flex shrink-0 items-center gap-1.5 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-40"
              >
                Enter
                <IconArrowRight width={15} height={15} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Recently visited rooms */}
      <div className="flex flex-1 flex-col overflow-y-auto">
        <RecentRooms onJoin={actions.joinRoom} />
      </div>

      {/* Quick actions */}
      <div className="mt-auto flex flex-col gap-3 px-6 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <button
          onClick={actions.createRoom}
          disabled={!connected}
          className="flex items-center justify-center gap-2 rounded-2xl bg-accent py-3.5 text-[15px] font-semibold text-white transition-transform active:scale-[0.99] disabled:opacity-40"
        >
          <IconPlus width={18} height={18} />
          Create a room
        </button>
        <button
          onClick={() => setJoinOpen(true)}
          disabled={!connected}
          className="flex items-center justify-center gap-2 rounded-2xl border border-base-border2 bg-base-raised py-3.5 text-[15px] font-semibold text-ink transition-colors active:bg-base-border disabled:opacity-40"
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
        <NameEditor
          initial={getStoredDisplayName() ?? session.name ?? ""}
          onClose={() => setEditName(false)}
        />
      )}
    </div>
  );
}
