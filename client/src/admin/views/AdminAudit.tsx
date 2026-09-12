import { useCallback, useState } from "react";
import type { AdminAuditEvent, AdminAuditKind } from "@cryo/shared";
import { adminApi } from "../adminApi";
import { Badge, Card, EmptyState, ErrorBanner, Pagination, Spinner } from "../components";
import { usePoll } from "../usePoll";
import { usePagination } from "../usePagination";
import { fmtTime } from "../format";
import { IconPause, IconPlayFilled, IconRefresh } from "../../components/ui/Icon";

const POLL = 4500;
const PAGE_SIZE = 100;

const AUDIT_KINDS: AdminAuditKind[] = [
  "session:created",
  "session:renamed",
  "session:banned",
  "session:unbanned",
  "room:created",
  "room:joined",
  "room:left",
  "room:expired",
  "room:closed",
  "room:cleared",
  "room:renamed",
  "message:send",
  "media:upload",
  "member:kicked",
  "member:banned",
  "settings:update",
];

const KIND_TONE: Record<AdminAuditKind, string> = {
  "session:created": "green",
  "session:renamed": "green",
  "session:banned": "rose",
  "session:unbanned": "amber",
  "room:created": "accent",
  "room:joined": "green",
  "room:left": "faint",
  "room:expired": "faint",
  "room:closed": "amber",
  "room:cleared": "amber",
  "room:renamed": "accent",
  "message:send": "default",
  "media:upload": "default",
  "member:kicked": "rose",
  "member:banned": "rose",
  "settings:update": "amber",
};

export function AdminAudit() {
  const [activeKinds, setActiveKinds] = useState<Set<AdminAuditKind>>(new Set());
  const [paused, setPaused] = useState(false);

  const events = usePoll<AdminAuditEvent[]>(
    useCallback(
      () => adminApi.audit({ limit: 250, kinds: activeKinds.size ? [...activeKinds] : undefined }),
      [activeKinds],
    ),
    paused ? 0 : POLL,
  );

  const toggleKind = (k: AdminAuditKind) => {
    setActiveKinds((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const filterKey = [...activeKinds].sort().join(",") || "all";
  const paged = usePagination(events.data ?? [], PAGE_SIZE, `${filterKey}|${paused}`);

  const visible = paged.slice;

  const tone = (k: AdminAuditKind): "default" | "green" | "amber" | "rose" | "faint" | "accent" =>
    (KIND_TONE[k] as "default" | "green" | "amber" | "rose" | "faint" | "accent") ?? "default";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-ink">Audit trail</h1>
          <p className="text-sm text-ink-faint">
            {events.data ? `${events.data.length} events` : "…"} in memory
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPaused((p) => !p)}
            className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors ${
              paused
                ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                : "border-base-border2 bg-base-raised text-ink-muted hover:text-ink"
            }`}
          >
            {paused ? <IconPlayFilled width={12} height={12} /> : <IconPause width={12} height={12} />}
            {paused ? "Resume" : "Pause"}
          </button>
          <button
            onClick={events.reload}
            className="flex items-center gap-1.5 rounded-xl border border-base-border2 bg-base-raised px-3 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:text-ink"
          >
            <IconRefresh width={13} height={13} />
            Refresh
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {AUDIT_KINDS.map((k) => (
          <button
            key={k}
            onClick={() => toggleKind(k)}
            className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
              activeKinds.has(k)
                ? "border-accent/50 bg-accent text-white"
                : "border-base-border2 bg-base-raised text-ink-faint hover:text-ink"
            }`}
          >
            {k}
          </button>
        ))}
        {activeKinds.size > 0 && (
          <button
            onClick={() => setActiveKinds(new Set())}
            className="rounded-full border border-base-border2 px-2.5 py-1 text-[11px] font-medium text-rose-300 transition-colors hover:bg-rose-500/10"
          >
            clear filters
          </button>
        )}
      </div>

      {events.error ? (
        <ErrorBanner message={`Audit: ${events.error}`} onRetry={events.reload} />
      ) : events.loading && !events.data ? (
        <Spinner />
      ) : visible.length === 0 ? (
        <EmptyState label="No matching events yet." />
      ) : (
<Card className="overflow-hidden">
            <div className="divide-y divide-base-border">
              {visible.map((e) => (
                <div key={e.id} className="flex gap-3 px-3 py-2.5">
                  <span className="mt-0.5 shrink-0 text-[11px] tabular-nums text-ink-faint">
                    {fmtTime(e.ts)}
                  </span>
                  <span className="flex shrink-0 items-center justify-center py-0.5">
                    <Badge tone={tone(e.kind)}>{e.kind}</Badge>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-ink">
                      {e.message}
                      {e.actor && (
                        <span className="text-ink-faint"> · <span className="text-ink-muted">{e.actor}</span></span>
                      )}
                      {e.roomCode && (
                        <span className="ml-2 inline-block">
                          <Badge tone="faint" className="font-mono">
                            {e.roomCode}
                          </Badge>
                        </span>
                      )}
                    </p>
                    {e.detail && (
                      <p className="mt-0.5 truncate font-mono text-[11px] text-ink-faint">{e.detail}</p>
                    )}
                  </div>
                </div>
              ))}
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