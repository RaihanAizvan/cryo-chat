/** Dependency-free charts for the admin console (pure divs, no SVG math). */

const MAX_BARS = 60;

export function GroupedBarChart({
  buckets,
}: {
  buckets: { ts: number; messages: number; joins: number; uploads: number }[];
}) {
  const window = buckets.slice(-MAX_BARS);
  const max = Math.max(1, ...window.flatMap((b) => [b.messages, b.joins, b.uploads]));

  return (
    <div>
      <div className="flex h-40 items-end">
        {window.map((b) => {
          const hM = Math.max(2, Math.round((b.messages / max) * 100));
          const hJ = Math.max(2, Math.round((b.joins / max) * 100));
          const hU = Math.max(2, Math.round((b.uploads / max) * 100));
          return (
            <div
              key={b.ts}
              className="group relative flex flex-1 flex-col items-center justify-end"
            >
              <div className="flex w-full max-w-[6px] flex-col gap-px">
                <div
                  title={`messages: ${b.messages}`}
                  className="w-full rounded-[1px] bg-accent"
                  style={{ height: `${hM}px`, opacity: b.messages ? 1 : 0.08 }}
                />
                <div
                  title={`joins: ${b.joins}`}
                  className="w-full rounded-[1px] bg-emerald-400"
                  style={{ height: `${hJ}px`, opacity: b.joins ? 1 : 0.08 }}
                />
                <div
                  title={`uploads: ${b.uploads}`}
                  className="w-full rounded-[1px] bg-orange-400"
                  style={{ height: `${hU}px`, opacity: b.uploads ? 1 : 0.08 }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-ink-faint">
        <span>{fmtAxis(window[0]?.ts)}</span>
        <span>{fmtAxis(window[window.length - 1]?.ts)}</span>
      </div>
    </div>
  );
}

function fmtAxis(ts: number | undefined): string {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** Thin horizontal bars (used for message-type splits). */
export function SplitBars({ splits }: { splits: Record<string, number> }) {
  const entries = Object.entries(splits);
  const total = entries.reduce((acc, [, v]) => acc + v, 0);
  return (
    <ul className="space-y-2.5">
      {entries.map(([label, value]) => {
        const pct = total > 0 ? Math.round((value / total) * 100) : 0;
        return (
          <li key={label}>
            <div className="flex items-center justify-between text-xs">
              <span className="capitalize text-ink-muted">{label}</span>
              <span className="tabular-nums text-ink">{value}</span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-base-sunken">
              <div
                className="h-full rounded-full bg-accent transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Tiny sparkline for dashboard cards. */
export function Sparkline({ points, color = "#6d8bff" }: { points: number[]; color?: string }) {
  const max = Math.max(1, ...points);
  const last = points.slice(-48);
  return (
    <div className="flex h-12 items-end gap-[2px]">
      {last.map((v, i) => (
        <div
          key={i}
          className="min-w-[2px] flex-1 rounded-[1px]"
          style={{ height: `${Math.max(8, Math.round((v / max) * 100))}%`, backgroundColor: color }}
        />
      ))}
    </div>
  );
}