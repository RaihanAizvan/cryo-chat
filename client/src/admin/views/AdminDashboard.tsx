import { useCallback } from "react";
import type { AdminAnalytics, AdminStats } from "@cryo/shared";
import { adminApi } from "../adminApi";
import { Badge, Card, CardHeader, EmptyState, ErrorBanner, Spinner, StatCard } from "../components";
import { GroupedBarChart } from "../Chart";
import { usePoll } from "../usePoll";
import { fmtNum, fmtUptime } from "../format";
import { IconBroadcast } from "../../components/ui/Icon";

const POLL = 5000;

export function AdminDashboard({
  onOpenRoom,
  onOpenRooms,
}: {
  onOpenRoom: (id: string) => void;
  onOpenRooms: () => void;
}) {
  const stats = usePoll<AdminStats>(
    useCallback(() => adminApi.stats(), []),
    POLL,
  );
  const analytics = usePoll<AdminAnalytics>(
    useCallback(() => adminApi.analytics(), []),
    POLL,
  );

  if (stats.loading && !stats.data) return <Spinner />;

  if (stats.error) return <ErrorBanner message={`Dashboard: ${stats.error}`} onRetry={stats.reload} />;

  const s = stats.data!;
  const buckets = analytics.data?.buckets ?? [];
  const topRooms = analytics.data?.topRooms ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-ink">Server overview</h1>
          <p className="text-sm text-ink-faint">Live state, refreshed every {POLL / 1000}s.</p>
        </div>
        <Badge tone="green" className="hidden sm:inline-flex">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          live
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Live rooms" value={fmtNum(s.liveRooms)} />
        <StatCard
          label="Online now"
          value={fmtNum(s.onlineParticipants)}
          sub={`${fmtNum(s.totalParticipants)} total seated`}
        />
        <StatCard
          label="Messages"
          value={fmtNum(s.totalMessages)}
          sub={`${fmtNum(s.totalUploads)} uploads`}
        />
        <StatCard
          label="Sessions"
          value={fmtNum(s.totalSessions)}
          sub={`${fmtNum(s.bannedSessions)} banned`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="Traffic · last 60 min" subtitle="messages / joins / uploads" />
          <div className="p-4">
            {buckets.length ? (
              <GroupedBarChart buckets={buckets} />
            ) : (
              <EmptyState label="No activity yet in this window." />
            )}
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title="Media stored"
            subtitle={`${fmtNum(s.mediaFiles)} files · ${fmtNum(s.mediaBytes)} B`}
          />
          <div className="p-4">
            <div className="flex items-end justify-between">
              <IconBroadcast width={28} height={28} className="text-accent opacity-70" />
              <div className="text-right">
                <div className="text-sm text-ink-faint">memory</div>
                <div className="text-2xl font-semibold tabular-nums text-ink">
                  {s.memoryMb.toFixed(1)} <span className="text-sm text-ink-faint">MB</span>
                </div>
              </div>
            </div>
            <div className="mt-4 space-y-2 border-t border-base-border pt-3 text-xs">
              <div className="flex justify-between">
                <span className="text-ink-faint">Session identities</span>
                <span className="tabular-nums text-ink">{fmtNum(s.totalSessions)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-faint">Uptime</span>
                <span className="tabular-nums text-ink">{fmtUptime(s.uptimeSeconds)}</span>
              </div>
            </div>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Busiest rooms"
          subtitle="by message count, last 60 min"
          right={
            <button
              onClick={onOpenRooms}
              className="text-xs font-medium text-accent transition-colors hover:text-ink"
            >
              View all →
            </button>
          }
        />
        <div className="divide-y divide-base-border p-1">
          {topRooms.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-ink-faint">No rooms created yet.</p>
          )}
          {topRooms.map((r) => (
            <button
              key={r.roomId}
              onClick={() => onOpenRoom(r.roomId)}
              className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-base-sunken/60"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-ink">{r.code}</div>
                <div className="text-xs text-ink-faint">last 60 min</div>
              </div>
              <span className="shrink-0 rounded-full bg-base-sunken px-2.5 py-1 text-xs tabular-nums text-ink-muted">
                {fmtNum(r.count)} msgs
              </span>
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}