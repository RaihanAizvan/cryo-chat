import type { ReactNode } from "react";
import { IconAlertTriangle } from "../components/ui/Icon";

/** Small, reusable bits for the admin console. */

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-8 text-sm text-ink-faint">
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-ink-faint border-t-accent" />
      {label}
    </div>
  );
}

export function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-ink-faint">
      <IconAlertTriangle width={20} height={20} className="opacity-60" />
      {label}
    </div>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
      <span className="flex items-center gap-2">
        <IconAlertTriangle width={16} height={16} className="shrink-0" />
        {message}
      </span>
      {onRetry && (
        <button
          onClick={onRetry}
          className="shrink-0 rounded-lg border border-rose-500/30 px-2.5 py-1 text-xs font-semibold transition-colors hover:bg-rose-500/10"
        >
          Retry
        </button>
      )}
    </div>
  );
}

type Tone = "default" | "accent" | "green" | "amber" | "rose" | "faint";

const TONE_CLASS: Record<Tone, string> = {
  default: "border-base-border2 bg-base-raised text-ink-muted",
  accent: "border-accent/40 bg-accent/10 text-accent",
  green: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  amber: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  rose: "border-rose-500/30 bg-rose-500/10 text-rose-300",
  faint: "border-base-border bg-base-sunken text-ink-faint",
};

export function Badge({
  children,
  tone = "default",
  className = "",
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${TONE_CLASS[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function StatCard({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-base-border bg-base-raised p-4">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-ink-faint">
        {icon && <span className="text-accent">{icon}</span>}
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums tracking-tight text-ink">
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-ink-faint">{sub}</div>}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-base-border bg-base-raised ${className}`}>
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 pb-1 pt-3.5">
      <div>
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-ink-faint">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

export function Th({ children, right }: { children?: ReactNode; right?: boolean }) {
  return (
    <th
      className={`px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-faint ${
        right ? "text-right" : ""
      }`}
    >
      {children}
    </th>
  );
}

export function Td({ children, right }: { children?: ReactNode; right?: boolean }) {
  return (
    <td className={`px-3 py-2.5 align-middle text-sm text-ink ${right ? "text-right" : ""}`}>
      {children}
    </td>
  );
}

/** Confirm popover-style action button used for destructive ops. */
export function DangerButton({
  label,
  busyLabel,
  confirmLabel,
  onConfirm,
  busy,
  disabled,
}: {
  label: string;
  busyLabel: string;
  confirmLabel: string;
  onConfirm: () => void;
  busy: boolean;
  disabled?: boolean;
}) {
  if (busy) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg border border-base-border2 px-2 py-1 text-[11px] text-ink-faint">
        <span className="h-2 w-2 animate-spin rounded-full border border-ink-faint border-t-transparent" />
        {busyLabel}
      </span>
    );
  }
  return (
    <button
      onClick={(e) => {
        if (e.currentTarget.dataset.confirm === "yes") {
          onConfirm();
          return;
        }
        const btn = e.currentTarget;
        btn.dataset.confirm = "yes";
        btn.textContent = confirmLabel;
        window.setTimeout(() => {
          btn.dataset.confirm = "";
          btn.textContent = label;
        }, 2200);
      }}
      disabled={disabled}
      className="rounded-lg border border-rose-500/30 px-2 py-1 text-[11px] font-semibold text-rose-300 transition-colors hover:bg-rose-500/10 disabled:opacity-40"
    >
      {label}
    </button>
  );
}

/** Prev/next + page indicator used to walk paginated admin lists. */
export function Pagination({
  page,
  pageCount,
  total,
  pageSize,
  onPage,
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  onPage: (p: number) => void;
}) {
  if (pageCount <= 1) return null;
  const from = page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  const btn =
    "rounded-lg border border-base-border2 bg-base-raised px-2.5 py-1 text-xs font-medium text-ink-muted transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-35";
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-base-border px-4 py-3">
      <span className="text-xs tabular-nums text-ink-faint">
        {from}–{to} of {total}
      </span>
      <div className="flex items-center gap-2">
        <button className={btn} disabled={page <= 0} onClick={() => onPage(page - 1)}>
          ← Prev
        </button>
        <span className="text-xs tabular-nums text-ink-faint">
          Page {page + 1} / {pageCount}
        </span>
        <button className={btn} disabled={page >= pageCount - 1} onClick={() => onPage(page + 1)}>
          Next →
        </button>
      </div>
    </div>
  );
}