import { useConnectionStatus } from "../../lib/store";

const LABEL: Record<string, string> = {
  connected: "Connected",
  connecting: "Connecting",
  reconnecting: "Reconnecting",
  disconnected: "Offline",
};

export function ConnectionStatus() {
  const status = useConnectionStatus();
  const ok = status === "connected";
  const pending = status === "connecting" || status === "reconnecting";

  return (
    <div
      className="flex items-center gap-1.5 px-1 text-xs font-medium text-ink-muted"
      aria-live="polite"
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          ok
            ? "bg-emerald-400"
            : pending
              ? "bg-amber-400 animate-pulse"
              : "bg-rose-400"
        }`}
      />
      {LABEL[status] ?? status}
    </div>
  );
}
