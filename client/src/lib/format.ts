/**
 * Small formatting helpers used across the UI.
 */

/** Format a timestamp as a short time, e.g. "9:41 AM". */
export function formatTime(ts: number): string {
  const d = new Date(ts);
  let h = d.getHours();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  const m = d.getMinutes().toString().padStart(2, "0");
  return `${h}:${m} ${ampm}`;
}

/** Whether two timestamps fall at the same wall-clock hour (for grouping markers). */
export function sameMinute(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getHours() === db.getHours() &&
    da.getMinutes() === db.getMinutes() &&
    da.getDate() === db.getDate() &&
    da.getMonth() === db.getMonth() &&
    da.getFullYear() === db.getFullYear()
  );
}

/** Format a large seconds count as "remaining ~1h". */
export function formatLeftover(ms: number): string {
  const totalMin = Math.max(0, Math.ceil(ms / 60000));
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** Short "time ago" label for the last-visited line, e.g. "just now", "3m", "2h". */
export function timeAgo(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/** Remaining lifetime label for a live room, e.g. "ends in 45m". */
export function formatRemaining(expiresAt: number, now = Date.now()): string {
  const ms = expiresAt - now;
  if (ms <= 0) return "expired";
  return `ends in ${formatLeftover(ms)}`;
}

/** Live countdown with seconds, e.g. "1:23:45" (or "MM:SS" under an hour). */
export function formatCountdown(expiresAt: number, now = Date.now()): string {
  const totalSec = Math.max(0, Math.floor((expiresAt - now) / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = m.toString().padStart(2, "0");
  const ss = s.toString().padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + second).toUpperCase() || "?";
}
