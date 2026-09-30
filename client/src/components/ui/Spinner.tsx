import type { ReactNode } from "react";

/**
 * Small loading state. A ring for "something is happening", and a three-dot
 * "thinking" row for a short wait where a spinner would feel too mechanical.
 */
export function Spinner({ label, className = "" }: { label?: string; className?: string }) {
  return (
    <div className={`flex items-center justify-center gap-2.5 ${className}`}>
      <span
        className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent opacity-70"
        aria-hidden
      />
      {label && <span className="text-sm text-current">{label}</span>}
    </div>
  );
}

/** Three bouncing dots — for waits short enough that a ring would feel heavy. */
export function Dots({ label, className = "" }: { label?: string; className?: string }) {
  return (
    <div className={`flex items-center justify-center gap-2 ${className}`}>
      <span className="cryo-dots flex items-center gap-1" aria-hidden>
        <i className="h-1.5 w-1.5 rounded-full bg-current" />
        <i className="h-1.5 w-1.5 rounded-full bg-current" />
        <i className="h-1.5 w-1.5 rounded-full bg-current" />
      </span>
      {label && <span className="text-sm text-current">{label}</span>}
    </div>
  );
}

/** Full-pane loading state, for a route or view that is still arriving. */
export function LoadingPane({ label = "Loading…", children }: { label?: string; children?: ReactNode }) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-ink-faint">
      <Spinner label={label} />
      {children}
    </div>
  );
}
