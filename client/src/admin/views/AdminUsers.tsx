import { useCallback, useMemo, useState } from "react";
import type { AdminUser } from "@cryo/shared";
import { avatarColor } from "@cryo/shared";
import { adminApi } from "../adminApi";
import { Badge, Card, DangerButton, EmptyState, ErrorBanner, Spinner } from "../components";
import { usePoll } from "../usePoll";
import { fmtDateTime, fmtNum, fmtRelative, shortId } from "../format";
import { IconRefresh, IconSearch } from "../../components/ui/Icon";

const POLL = 6000;

export function AdminUsers({ onOpenRoom }: { onOpenRoom: (id: string) => void }) {
  const users = usePoll<AdminUser[]>(
    useCallback(() => adminApi.users(), []),
    POLL,
  );
  const [query, setQuery] = useState("");
  const [onlyBanned, setOnlyBanned] = useState(false);
  const [busy, setBusy] = useState<Record<string, string | null>>({});

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (users.data ?? []).filter((u) => {
      if (onlyBanned !== u.banned) return false;
      if (!q) return true;
      return u.name.toLowerCase().includes(q) || u.sessionId.toLowerCase().includes(q);
    });
  }, [users.data, query, onlyBanned]);

  const toggleBan = async (u: AdminUser) => {
    const key = `ban:${u.sessionId}`;
    if (busy[key]) return;
    setBusy((b) => ({ ...b, [key]: "…" }));
    try {
      if (u.banned) await adminApi.unbanUser(u.sessionId);
      else await adminApi.banUser(u.sessionId);
      users.reload();
    } finally {
      setBusy((b) => ({ ...b, [key]: null }));
    }
  };

  const purge = async (u: AdminUser) => {
    const key = `purge:${u.sessionId}`;
    if (busy[key]) return;
    setBusy((b) => ({ ...b, [key]: "…" }));
    try {
      await adminApi.purgeUser(u.sessionId);
      users.reload();
    } finally {
      setBusy((b) => ({ ...b, [key]: null }));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-ink">Users</h1>
          <p className="text-sm text-ink-faint">
            {users.data ? `${users.data.length} identities` : "…"} · auto-refresh
          </p>
        </div>
        <button
          onClick={users.reload}
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
            placeholder="Search name or session id…"
            className="w-full rounded-xl border border-base-border2 bg-base-raised py-2 pl-9 pr-3 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
          />
        </div>
        <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-base-border2 bg-base-raised px-3 py-2 text-sm text-ink-muted">
          <input
            type="checkbox"
            checked={onlyBanned}
            onChange={(e) => setOnlyBanned(e.target.checked)}
            className="h-4 w-4 accent-rose-500"
          />
          Banned only
        </label>
      </div>

      {users.error ? (
        <ErrorBanner message={`Users: ${users.error}`} onRetry={users.reload} />
      ) : users.loading && !users.data ? (
        <Spinner />
      ) : filtered.length === 0 ? (
        <EmptyState label={query ? "No users match your search." : "No identities issued yet."} />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse">
              <thead className="bg-base-sunken/50">
                <tr>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                    Identity
                  </th>
                  <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                    Created
                  </th>
                  <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                    Activity
                  </th>
                  <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                    Room
                  </th>
                  <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-base-border">
                {filtered.map((u: AdminUser) => (
                  <tr key={u.sessionId} className="transition-colors hover:bg-base-sunken/40">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <span
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                          style={{ backgroundColor: avatarColor(u.color) }}
                        >
                          {u.name.slice(0, 1).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium text-ink">{u.name}</span>
                            {u.banned && <Badge tone="rose">banned</Badge>}
                            {u.online ? (
                              <Badge tone="green">online</Badge>
                            ) : (
                              <Badge tone="faint">offline</Badge>
                            )}
                          </div>
                          <div className="font-mono text-[11px] text-ink-faint">
                            {shortId(u.sessionId)}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-xs tabular-nums text-ink-muted">
                      {fmtDateTime(u.createdAt)}
                    </td>
                    <td className="px-3 py-3 text-xs tabular-nums text-ink-muted">
                      {fmtNum(u.messages)} msgs · {fmtNum(u.uploads)} uploads
                      {u.lastActiveAt && (
                        <span className="block text-ink-faint">
                          last {fmtRelative(u.lastActiveAt)}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {u.roomId ? (
                        <button
                          onClick={() => onOpenRoom(u.roomId!)}
                          className="rounded-lg px-2 py-1 font-mono text-xs text-accent transition-colors hover:bg-accent/10"
                        >
                          {u.roomCode}
                        </button>
                      ) : (
                        <span className="text-xs text-ink-faint">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        {u.banned ? (
                          <button
                            onClick={() => void toggleBan(u)}
                            disabled={Boolean(busy[`ban:${u.sessionId}`])}
                            className="rounded-lg border border-emerald-500/30 px-2 py-1 text-[11px] font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/10"
                          >
                            {busy[`ban:${u.sessionId}`] ?? "Unban"}
                          </button>
                        ) : (
                          <DangerButton
                            label="Ban"
                            busyLabel="Banning…"
                            confirmLabel="Ban?"
                            busy={busy[`ban:${u.sessionId}`] === "…"}
                            onConfirm={() =>
                              toggleBan(u).catch(() => {
                                users.reload();
                              })
                            }
                          />
                        )}
                        <DangerButton
                          label="Purge"
                          busyLabel="Purging…"
                          confirmLabel="Purge?"
                          busy={busy[`purge:${u.sessionId}`] === "…"}
                          onConfirm={() => purge(u)}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}