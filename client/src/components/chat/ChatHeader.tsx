import { useEffect, useMemo, useState } from "react";
import type { PublicRoom, Participant } from "@cryo/shared";
import { IconBack, IconDots, IconCopy, IconCheck, IconLink, IconX, IconEdit, IconTrash } from "../ui/Icon";
import { Avatar } from "../ui/Avatar";
import { ConnectionStatus } from "./ConnectionStatus";
import { roomShareLink } from "./ShareRoom";
import { getStoredPeer, storePeer, type StoredPeer } from "../../lib/peer";

function formatLastSeen(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return `today at ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `yesterday at ${time}`;
  const date = d.toLocaleDateString([], { month: "short", day: "numeric" });
  return `on ${date} at ${time}`;
}

interface Props {
  room: PublicRoom;
  participantCount: number;
  participants: Participant[];
  selfId: string | null;
  notice: string | null;
  /** IDs of participants currently typing (persistent room). */
  typing: string[] | null;
  onBack: () => void;
  onLeave: () => void;
  onClose: () => void;
  onClearChat: () => void;
  onRenameParticipant: (participantId: string, name: string) => void;
}

export function ChatHeader({
  room,
  participantCount,
  participants,
  selfId,
  notice,
  typing,
  onBack,
  onLeave,
  onClose,
  onClearChat,
  onRenameParticipant,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState<"link" | "code" | null>(null);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [renaming, setRenaming] = useState<Participant | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // WhatsApp-style: remember the other person in the special space so the
  // header keeps showing their name and last-seen even after they step out.
  // Peer must be state (not a ref) so the header re-renders the moment the
  // other person joins — a ref mutation alone would never repaint the header.
  // Seeded + persisted to localStorage so "last seen" survives leaving,
  // rejoining, and page reloads.
  const initialPeer = useMemo(
    () => (room.persistent ? getStoredPeer(room.code) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [peer, setPeer] = useState<StoredPeer | null>(initialPeer);
  // Entering a different room must not leak the previous room's peer; reload
  // whatever we remember for the new space.
  useEffect(() => {
    setPeer(room.persistent ? getStoredPeer(room.code) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.id]);
  useEffect(() => {
    if (!room.persistent) return;
    const other = participants.find((p) => p.id !== selfId);
    if (other) {
      const seen = { id: other.id, name: other.name, color: other.color, lastSeen: Date.now() };
      storePeer(room.code, seen);
      setPeer((prev) =>
        prev && prev.id === seen.id
          ? { ...prev, lastSeen: seen.lastSeen }
          : seen,
      );
    }
  }, [participants, selfId, room.persistent, room.code]);
  const otherPresent = participants.some((p) => p.id !== selfId);

  const copy = async (kind: "link" | "code") => {
    const text = kind === "link" ? roomShareLink(room) : room.code;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
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
    setTimeout(() => setCopied(null), 1500);
  };

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
          {room.persistent ? (
            /* The special space renders like a 1-on-1 chat: peer avatar, name,
               and a last-seen style presence line. No code, no member list. */
            <div className="flex min-w-0 items-center gap-2.5">
              <Avatar
                name={peer?.name ?? "Your space"}
                color={peer?.color ?? 0}
                size="sm"
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-semibold text-ink">
                  {peer ? peer.name : "Your space"}
                </div>
                <div className="flex items-center gap-1.5 text-[11px]">
                  {typing && typing.length > 0 ? (
                    <span className="flex items-center gap-1 text-ink-muted">
                      <span className="flex items-center gap-0.5">
                        <span className="cryo-dot" />
                        <span className="cryo-dot" style={{ animationDelay: "0.15s" }} />
                        <span className="cryo-dot" style={{ animationDelay: "0.3s" }} />
                      </span>
                      typing…
                    </span>
                  ) : !peer ? (
                    <span className="text-ink-faint">Waiting for someone…</span>
                  ) : otherPresent ? (
                    <>
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                      <span className="font-medium text-emerald-300">
                        Active now
                      </span>
                    </>
                  ) : (
                    <span className="text-ink-faint">
                      Last seen {formatLastSeen(peer.lastSeen)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[15px] font-semibold text-ink">
                    {participantCount === 2
                      ? "Private chat"
                      : `Room · ${participantCount}`}
                  </span>
                  <span className="rounded-md bg-base-border px-1.5 py-0.5 font-mono text-[11px] font-semibold tracking-wider text-ink-muted">
                    {room.code}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-[11px]">
                  {typing && typing.length > 0 ? (
                    <span className="flex items-center gap-1 text-ink-muted">
                      <span className="flex items-center gap-0.5">
                        <span className="cryo-dot" />
                        <span className="cryo-dot" style={{ animationDelay: "0.15s" }} />
                        <span className="cryo-dot" style={{ animationDelay: "0.3s" }} />
                      </span>
                      {participantCount > 2
                        ? `${participants.find((p) => p.id === typing[0])?.name ?? "Someone"} is typing…`
                        : "typing…"}
                    </span>
                  ) : (
                    <ConnectionStatus />
                  )}
                </div>
              </div>
            </>
          )}
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
          <div className="cryo-pop absolute right-3 top-full z-20 mt-1 w-44 overflow-hidden rounded-xl border border-base-border2 bg-base-raised p-1 shadow-xl">
            <button
              onClick={() => {
                copy("link");
                setMenuOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-ink transition-colors hover:bg-base-border"
            >
              {copied === "link" ? (
                <IconCheck width={15} height={15} className="text-emerald-400" />
              ) : (
                <IconLink width={15} height={15} className="text-ink-muted" />
              )}
              {copied === "link" ? "Link copied" : "Copy invite link"}
            </button>
            <button
              onClick={() => {
                copy("code");
                setMenuOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-ink transition-colors hover:bg-base-border"
            >
              {copied === "code" ? (
                <IconCheck width={15} height={15} className="text-emerald-400" />
              ) : (
                <IconCopy width={15} height={15} className="text-ink-muted" />
              )}
              {copied === "code" ? (
                "Code copied"
              ) : (
                <>
                  Copy code{" "}
                  <span className="ml-auto font-mono text-[11px] tracking-widest text-ink-faint">
                    {room.code}
                  </span>
                </>
              )}
            </button>
            <div className="my-1 h-px bg-base-border" />
            {room.persistent && peer && (
              <button
                onClick={() => {
                  const target =
                    participants.find((p) => p.id === peer.id) ??
                    participants.find((p) => p.name === peer.name) ??
                    ({ id: peer.id, name: peer.name, color: peer.color, joinedAt: Date.now(), status: "online" } as Participant);
                  setRenaming(target);
                  setRenameValue("");
                  setMenuOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-ink transition-colors hover:bg-base-border"
              >
                <IconEdit width={15} height={15} className="text-ink-muted" />
                Rename {peer.name}
              </button>
            )}
            {confirmingClear ? (
              <div className="px-3 py-2">
                <p className="mb-2 text-xs text-ink-muted">
                  Clear all messages in this room?
                </p>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => {
                      onClearChat();
                      setMenuOpen(false);
                      setConfirmingClear(false);
                    }}
                    className="flex-1 rounded-lg bg-rose-500/15 px-2 py-1.5 text-xs font-semibold text-rose-300 transition-colors hover:bg-rose-500/25"
                  >
                    Clear
                  </button>
                  <button
                    onClick={() => setConfirmingClear(false)}
                    className="flex-1 rounded-lg bg-base-border px-2 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:bg-base-border2"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setConfirmingClear(true)}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-ink transition-colors hover:bg-base-border"
              >
                <IconTrash width={15} height={15} className="text-ink-muted" />
                Clear chat
              </button>
            )}
            <div className="my-1 h-px bg-base-border" />
            {room.persistent && (
              <>
                {confirmingClose ? (
                  <div className="px-3 py-2">
                    <p className="mb-2 text-xs text-ink-muted">
                      Close this space for everyone?
                    </p>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => {
                          onClose();
                          setMenuOpen(false);
                          setConfirmingClose(false);
                        }}
                        className="flex-1 rounded-lg bg-rose-500/15 px-2 py-1.5 text-xs font-semibold text-rose-300 transition-colors hover:bg-rose-500/25"
                      >
                        Close
                      </button>
                      <button
                        onClick={() => setConfirmingClose(false)}
                        className="flex-1 rounded-lg bg-base-border px-2 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:bg-base-border2"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmingClose(true)}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-rose-300 transition-colors hover:bg-base-border"
                  >
                    <IconX width={15} height={15} className="text-rose-300" />
                    Close space
                  </button>
                )}
                <div className="my-1 h-px bg-base-border" />
              </>
            )}
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

      {/* Rename any participant in this room. */}
      {renaming && (
        <>
          <div
            className="fixed inset-0 z-30 bg-black/40"
            onClick={() => setRenaming(null)}
          />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const name = renameValue.trim();
              if (name) {
                onRenameParticipant(renaming.id, name);
                setRenaming(null);
              }
            }}
            className="cryo-pop fixed left-1/2 top-1/2 z-40 w-72 -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-base-border2 bg-base-raised p-4 shadow-2xl"
          >
            <h3 className="mb-1 text-[15px] font-semibold text-ink">
              Rename participant
            </h3>
            <p className="mb-3 text-xs text-ink-muted">
              {renaming.name} will see this new name everywhere in the room.
            </p>
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              maxLength={24}
              placeholder="New name…"
              className="w-full rounded-xl border border-base-border2 bg-base px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
            />
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setRenaming(null)}
                className="flex-1 rounded-xl bg-base-border px-3 py-2 text-sm font-medium text-ink-muted transition-colors hover:bg-base-border2"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!renameValue.trim()}
                className="flex-1 rounded-xl bg-accent px-3 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-40"
              >
                Save
              </button>
            </div>
          </form>
        </>
      )}
    </header>
  );
}