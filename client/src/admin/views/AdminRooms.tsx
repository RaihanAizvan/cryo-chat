import { useCallback, useMemo, useState } from "react";
import type { AdminRoomSummary } from "@cryo/shared";
import { adminApi } from "../adminApi";
import { Badge, Card, EmptyState, ErrorBanner, Pagination, Spinner } from "../components";
import { Modal } from "../../components/ui/Modal";
import { IconX } from "../../components/ui/Icon";
import { usePoll } from "../usePoll";
import { usePagination } from "../usePagination";
import { fmtDateTime, fmtExpiry, fmtNum, shortId } from "../format";
import {
  IconArrowRight,
  IconLock,
  IconRefresh,
  IconSearch,
  IconShield,
  IconUsers,
} from "../../components/ui/Icon";

const POLL = 6000;
const PAGE_SIZE = 20;

type Filter = "normal" | "reserved" | "locked";

/**
 * Per-room access controls. Any room can be marked reserved (it stops expiring
 * on its own) and any room can carry its own password, so an admin can lock a
 * room from the list instead of hunting for it in settings.
 *
 * Passwords are write-only: the server never sends the value back, so the field
 * clears after a save rather than pretending to show what is set.
 */
function RoomAccessDialog({
  room,
  onClose,
  onChanged,
}: {
  room: AdminRoomSummary;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [reserved, setReserved] = useState(room.reserved);
  const [locked, setLocked] = useState(room.locked);
  const [draft, setDraft] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const run = async (action: () => Promise<AdminRoomSummary>, message: string) => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const updated = await action();
      setReserved(updated.reserved);
      setLocked(updated.locked);
      setDone(message);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const toggleReserved = () =>
    void run(
      () => adminApi.setRoomReserved(room.id, !reserved),
      reserved
        ? `Room ${room.code} will expire like any other room now.`
        : `Room ${room.code} is reserved — it will not expire on its own.`,
    );

  const setPassword = () => {
    const value = draft;
    setDraft("");
    return void run(
      () => adminApi.setRoomPassword(room.id, value),
      `Password set. Everyone has to enter it again.`,
    );
  };

  return (
    <Modal title={`Access for room ${room.code}`} onClose={busy ? () => undefined : onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[17px] font-semibold tracking-tight text-ink">Room {room.code}</h2>
            <p className="mt-0.5 font-mono text-[11px] text-ink-faint">{shortId(room.id)}</p>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            className="-mr-1 -mt-1 flex h-8 w-8 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-base-border disabled:opacity-40"
            aria-label="Close"
          >
            <IconX width={17} height={17} />
          </button>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-xl border border-base-border bg-base-sunken/50 px-3 py-3">
          <div>
            <span className="text-sm font-medium text-ink">Reserved</span>
            <p className="text-[11px] text-ink-faint">
              Reserved rooms stay alive instead of expiring on their own.
            </p>
          </div>
          <button
            role="switch"
            aria-checked={reserved}
            aria-label="Reserved"
            disabled={busy}
            onClick={toggleReserved}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
              reserved ? "bg-accent" : "bg-base-border2"
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
                reserved ? "left-[22px]" : "left-0.5"
              }`}
            />
          </button>
        </div>

        <div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-ink-faint">
              {locked ? "Change password" : "Set a password"}
            </span>
            {locked ? <Badge tone="green">password protected</Badge> : <Badge tone="amber">open to anyone</Badge>}
          </div>
          <p className="mt-1 text-[11px] text-ink-faint">
            A room code is only four characters. Without a password anyone who
            guesses it can walk in.
          </p>
          <div className="mt-2 flex gap-2">
            <div className="relative flex-1">
              <input
                type={show ? "text" : "password"}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="At least 4 characters"
                autoComplete="new-password"
                aria-label={`Password for room ${room.code}`}
                className="w-full rounded-xl border border-base-border2 bg-base-sunken px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint transition-colors hover:text-ink"
              >
                {show ? "Hide" : "Show"}
              </button>
            </div>
            <button
              onClick={setPassword}
              disabled={busy || draft.trim().length < 4}
              className="shrink-0 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white transition-transform active:scale-[0.99] disabled:opacity-40"
            >
              {busy ? "…" : locked ? "Update" : "Set"}
            </button>
          </div>
          <span className="text-[11px] text-ink-faint">
            {locked
              ? "Changing it signs out every device that already unlocked the room."
              : "Until you set one, anyone with the code can get in."}
          </span>
        </div>

        {error && (
          <p className="rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
            {error}
          </p>
        )}
        {done && (
          <p className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
            {done}
          </p>
        )}

        {locked && (
          <div className="flex flex-wrap gap-2 border-t border-base-border pt-4">
            <button
              onClick={() =>
                void run(
                  () => adminApi.revokeRoomAccess(room.id),
                  "Every saved device has to enter the password again.",
                )
              }
              disabled={busy}
              className="rounded-xl border border-base-border2 px-3 py-2 text-sm text-ink-muted transition-colors hover:text-ink disabled:opacity-40"
            >
              Revoke saved access
            </button>
            <button
              onClick={() =>
                void run(
                  () => adminApi.clearRoomPassword(room.id),
                  `Room ${room.code} is open to anyone with the code now.`,
                )
              }
              disabled={busy}
              className="rounded-xl border border-rose-500/30 px-3 py-2 text-sm text-rose-300 transition-colors hover:bg-rose-500/10 disabled:opacity-40"
            >
              Remove password
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}

export function AdminRooms({ onOpenRoom }: { onOpenRoom: (id: string) => void }) {
  const rooms = usePoll<AdminRoomSummary[]>(
    useCallback(() => adminApi.rooms(), []),
    POLL,
  );
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("normal");
  const [editingId, setEditingId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rooms.data ?? []).filter((r) => {
      if (filter === "reserved" && !r.reserved) return false;
      if (filter === "normal" && r.reserved) return false;
      if (filter === "locked" && !r.locked) return false;
      if (!q) return true;
      return r.code.toLowerCase().includes(q) || r.id.toLowerCase().includes(q);
    });
  }, [rooms.data, query, filter]);

  const paged = usePagination(filtered, PAGE_SIZE, `${query}|${filter}`);
  const pageRows = paged.slice;
  const editing = (rooms.data ?? []).find((r) => r.id === editingId) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-ink">Rooms</h1>
          <p className="text-sm text-ink-faint">
            {rooms.data ? `${rooms.data.length} live` : "…"} · auto-refresh
          </p>
        </div>
        <button
          onClick={rooms.reload}
          className="flex items-center gap-1.5 rounded-xl border border-base-border2 bg-base-raised px-3 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:text-ink"
        >
          <IconRefresh width={13} height={13} />
          Refresh
        </button>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <IconSearch
            width={15}
            height={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search room code or id…"
            className="w-full rounded-xl border border-base-border2 bg-base-raised py-2 pl-9 pr-3 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
          />
        </div>
        <div className="flex gap-1 rounded-xl border border-base-border2 p-0.5">
          {(["normal", "reserved", "locked"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                filter === f ? "bg-accent text-white" : "text-ink-muted hover:text-ink"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {rooms.error ? (
        <ErrorBanner message={`Rooms: ${rooms.error}`} onRetry={rooms.reload} />
      ) : rooms.loading && !rooms.data ? (
        <Spinner />
      ) : filtered.length === 0 ? (
        <EmptyState label={query ? "No rooms match your search." : "No live rooms right now."} />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse">
              <thead className="bg-base-sunken/50">
                <tr>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                    Room
                  </th>
                  <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                    Created
                  </th>
                  <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                    Expires
                  </th>
                  <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                    Members
                  </th>
                  <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                    Messages
                  </th>
                  <th className="px-3 py-2.5 text-right" />
                </tr>
              </thead>
              <tbody className="divide-y divide-base-border">
                {pageRows.map((r: AdminRoomSummary) => (
                  <tr
                    key={r.id}
                    onClick={() => onOpenRoom(r.id)}
                    className="cursor-pointer transition-colors hover:bg-base-sunken/40"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {r.reserved ? (
                          <IconShield width={14} height={14} className="shrink-0 text-accent" />
                        ) : r.locked ? (
                          <IconLock width={14} height={14} className="shrink-0 text-accent" />
                        ) : (
                          <IconUsers width={14} height={14} className="shrink-0 text-ink-faint" />
                        )}
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium text-ink">{r.code}</span>
                            {r.reserved && <Badge tone="accent">reserved</Badge>}
                            {r.locked && <Badge tone="green">locked</Badge>}
                          </div>
                          <div className="font-mono text-[11px] text-ink-faint">{shortId(r.id)}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-xs tabular-nums text-ink-muted">
                      {fmtDateTime(r.createdAt)}
                    </td>
                    <td className="px-3 py-3 text-xs tabular-nums text-ink-muted">
                      {r.reserved ? "never" : fmtExpiry(r.expiresAt)}
                    </td>
                    <td className="px-3 py-3 text-sm tabular-nums text-ink">
                      {r.participantCount}
                    </td>
                    <td className="px-3 py-3 text-right text-sm tabular-nums text-ink">
                      {fmtNum(r.messageCount)}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingId(r.id);
                          }}
                          className="rounded-lg border border-base-border2 px-2.5 py-1 text-xs font-medium text-ink-muted transition-colors hover:text-ink"
                        >
                          Access
                        </button>
                        <IconArrowRight width={15} height={15} className="text-ink-faint" />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={paged.page}
            pageCount={paged.pageCount}
            total={paged.total}
            pageSize={PAGE_SIZE}
            onPage={paged.setPage}
          />
        </Card>
      )}

      {editing && (
        <RoomAccessDialog
          // Remount when the server-side state changes, so the dialog always
          // starts from the room's real state instead of a stale copy.
          key={`${editing.id}:${editing.reserved}:${editing.locked}`}
          room={editing}
          onClose={() => setEditingId(null)}
          onChanged={rooms.reload}
        />
      )}
    </div>
  );
}
