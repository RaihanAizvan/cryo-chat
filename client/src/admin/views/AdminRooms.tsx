import { useCallback, useMemo, useState } from "react";
import type { AdminRoomSummary } from "@cryo/shared";
import { adminApi } from "../adminApi";
import { Badge, Card, EmptyState, ErrorBanner, Pagination, Spinner } from "../components";
import { usePoll } from "../usePoll";
import { usePagination } from "../usePagination";
import { fmtDateTime, fmtExpiry, fmtNum, shortId } from "../format";
import {
  IconArrowRight,
  IconRefresh,
  IconSearch,
  IconShield,
  IconUsers,
} from "../../components/ui/Icon";

const POLL = 6000;
const PAGE_SIZE = 20;

export function AdminRooms({ onOpenRoom }: { onOpenRoom: (id: string) => void }) {
  const rooms = usePoll<AdminRoomSummary[]>(
    useCallback(() => adminApi.rooms(), []),
    POLL,
  );
  const [query, setQuery] = useState("");
  const [showReserved, setShowReserved] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rooms.data ?? []).filter((r) => {
      if (showReserved && !r.persistent) return false;
      if (!showReserved && r.persistent) return false;
      if (!q) return true;
      return r.code.toLowerCase().includes(q) || r.id.toLowerCase().includes(q);
    });
  }, [rooms.data, query, showReserved]);

  const paged = usePagination(filtered, PAGE_SIZE, `${query}|${showReserved}`);
  const pageRows = paged.slice;

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
          <button
            onClick={() => setShowReserved(false)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              !showReserved ? "bg-accent text-white" : "text-ink-muted hover:text-ink"
            }`}
          >
            Normal
          </button>
          <button
            onClick={() => setShowReserved(true)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              showReserved ? "bg-accent text-white" : "text-ink-muted hover:text-ink"
            }`}
          >
            Reserved
          </button>
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
                        {r.persistent ? (
                          <IconShield width={14} height={14} className="shrink-0 text-accent" />
                        ) : (
                          <IconUsers width={14} height={14} className="shrink-0 text-ink-faint" />
                        )}
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium text-ink">{r.code}</span>
                            {r.persistent && <Badge tone="accent">reserved</Badge>}
                          </div>
                          <div className="font-mono text-[11px] text-ink-faint">{shortId(r.id)}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-xs tabular-nums text-ink-muted">
                      {fmtDateTime(r.createdAt)}
                    </td>
                    <td className="px-3 py-3 text-xs tabular-nums text-ink-muted">
                      {r.persistent ? "never" : fmtExpiry(r.expiresAt)}
                    </td>
                    <td className="px-3 py-3 text-sm tabular-nums text-ink">
                      {r.participantCount}
                    </td>
                    <td className="px-3 py-3 text-right text-sm tabular-nums text-ink">
                      {fmtNum(r.messageCount)}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <IconArrowRight width={15} height={15} className="ml-auto text-ink-faint" />
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
    </div>
  );
}