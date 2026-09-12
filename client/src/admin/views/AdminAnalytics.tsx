import { useCallback } from "react";
import type { AdminAnalytics } from "@cryo/shared";
import { adminApi } from "../adminApi";
import { Badge, Card, CardHeader, EmptyState, ErrorBanner, Spinner } from "../components";
import { GroupedBarChart, SplitBars } from "../Chart";
import { usePoll } from "../usePoll";
import { fmtNum } from "../format";
import { IconRefresh } from "../../components/ui/Icon";

const POLL = 20000;

export function AdminAnalytics({ onOpenRoom }: { onOpenRoom: (id: string) => void }) {
  const a = usePoll<AdminAnalytics>(
    useCallback(() => adminApi.analytics(), []),
    POLL,
  );

  if (a.loading && !a.data) return <Spinner />;
  if (a.error) return <ErrorBanner message={`Analytics: ${a.error}`} onRetry={a.reload} />;

  const d = a.data!;
  const totals = d.buckets.reduce(
    (acc, b) => ({
      messages: acc.messages + b.messages,
      joins: acc.joins + b.joins,
      leaves: acc.leaves + b.leaves,
      uploads: acc.uploads + b.uploads,
    }),
    { messages: 0, joins: 0, leaves: 0, uploads: 0 },
  );

  const counts: { label: string; value: number; cls: string }[] = [
    { label: "Messages", value: totals.messages, cls: "bg-accent" },
    { label: "Joins", value: totals.joins, cls: "bg-emerald-400" },
    { label: "Leaves", value: totals.leaves, cls: "bg-zinc-400" },
    { label: "Uploads", value: totals.uploads, cls: "bg-orange-400" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-ink">Analytics</h1>
          <p className="text-sm text-ink-faint">Rolling 60-minute view · 1-minute buckets</p>
        </div>
        <button
          onClick={a.reload}
          className="flex items-center gap-1.5 rounded-xl border border-base-border2 bg-base-raised px-3 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:text-ink"
        >
          <IconRefresh width={13} height={13} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {counts.map((c) => (
          <Card key={c.label} className="p-4">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${c.cls}`} />
              <span className="text-xs font-medium uppercase tracking-wider text-ink-faint">
                {c.label}
              </span>
            </div>
            <div className="mt-2 text-2xl font-semibold tabular-nums text-ink">{fmtNum(c.value)}</div>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader title="Activity" subtitle="messages · joins · uploads per minute" />
        <div className="p-4">
          {d.buckets.length ? (
            <GroupedBarChart buckets={d.buckets} />
          ) : (
            <EmptyState label="No traffic in the last 60 minutes." />
          )}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Message types" subtitle="all time since boot" />
          <div className="p-4">
            <SplitBars splits={d.splits} />
          </div>
        </Card>

        <Card>
          <CardHeader title="Busiest rooms" subtitle="by message count, last 60 min" />
          <div className="p-4">
            {d.topRooms.length === 0 ? (
              <EmptyState label="No activity." />
            ) : (
              <ul className="space-y-2">
                {d.topRooms.map((r, i) => (
                  <li key={r.roomId}>
                    <button
                      onClick={() => onOpenRoom(r.roomId)}
                      className="flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-base-sunken/50"
                    >
                      <span className="w-5 text-right text-xs tabular-nums text-ink-faint">
                        {i + 1}
                      </span>
                      <span className="flex-1 truncate font-mono text-sm text-ink">{r.code}</span>
                      <Badge tone="default">{fmtNum(r.count)}</Badge>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}