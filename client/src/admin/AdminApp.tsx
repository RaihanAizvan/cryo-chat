import { useCallback, useState } from "react";
import {
  IconChart,
  IconFileText,
  IconGear,
  IconGrid,
  IconLock,
  IconLogOut,
  IconRefresh,
  IconShield,
  IconUsers,
} from "../components/ui/Icon";
import { adminApi, clearAdminKey, getAdminKey, setAdminKey, AdminApiError } from "./adminApi";
import { usePoll } from "./usePoll";
import { AdminDashboard } from "./views/AdminDashboard";
import { AdminRooms } from "./views/AdminRooms";
import { AdminRoomDetail } from "./views/AdminRoomDetail";
import { AdminUsers } from "./views/AdminUsers";
import { AdminAudit } from "./views/AdminAudit";
import { AdminAnalytics } from "./views/AdminAnalytics";
import { AdminSettings } from "./views/AdminSettings";
import { fmtUptime } from "./format";

export type AdminView =
  | { name: "dashboard" }
  | { name: "rooms" }
  | { name: "room"; roomId: string }
  | { name: "users" }
  | { name: "audit" }
  | { name: "analytics" }
  | { name: "settings" };

type AdminNavName = Exclude<AdminView["name"], "room">;

const NAV: { name: AdminNavName; label: string; icon: (p: { width?: number; height?: number }) => React.ReactElement }[] = [
  { name: "dashboard", label: "Dashboard", icon: IconGrid },
  { name: "rooms", label: "Rooms", icon: IconFileText },
  { name: "users", label: "Users", icon: IconUsers },
  { name: "audit", label: "Audit", icon: IconShield },
  { name: "analytics", label: "Analytics", icon: IconChart },
  { name: "settings", label: "Settings", icon: IconGear },
];

function AuthGate({ onSuccess }: { onSuccess: () => void }) {
  const [key, setKey] = useState("");
  const [bad, setBad] = useState(false);
  const [busy, setBusy] = useState(false);
  const [disabledMsg, setDisabledMsg] = useState<string | null>(null);

  const submit = async () => {
    if (!key.trim()) return;
    setBusy(true);
    setBad(false);
    setDisabledMsg(null);
    setAdminKey(key.trim());
    try {
      await adminApi.ping();
      onSuccess();
    } catch (e) {
      if (e instanceof AdminApiError) {
        if (e.kind === "unauthorized") {
          setBad(true);
          clearAdminKey();
        } else if (e.kind === "disabled") {
          setDisabledMsg(e.message);
          clearAdminKey();
        } else {
          setBad(true);
          clearAdminKey();
        }
      } else {
        setBad(true);
        clearAdminKey();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center px-6 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-base-border bg-base-raised text-ink">
            <IconLock width={22} height={22} />
          </span>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Admin console</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Enter the admin key to inspect and moderate live rooms.
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="flex flex-col gap-3"
        >
          <input
            type="password"
            autoFocus
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Admin key"
            autoComplete="off"
            className="w-full rounded-2xl border border-base-border2 bg-base-sunken px-4 py-3 text-[15px] text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
          />
          {bad && (
            <p className="text-xs text-rose-400">That key isn't recognised. Try again.</p>
          )}
          {disabledMsg && (
            <p className="text-xs text-amber-300">{disabledMsg}</p>
          )}
          <button
            type="submit"
            disabled={busy || !key.trim()}
            className="mt-1 flex items-center justify-center gap-2 rounded-2xl bg-accent py-3 text-[15px] font-semibold text-white transition-transform active:scale-[0.99] disabled:opacity-40"
          >
            {busy ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            ) : (
              <IconLock width={16} height={16} />
            )}
            Unlock
          </button>
        </form>

        <a
          href="/"
          className="mt-6 block text-center text-xs text-ink-faint underline-offset-2 hover:underline"
        >
          Back to chat
        </a>
      </div>
    </div>
  );
}

export function AdminApp() {
  const [view, setView] = useState<AdminView>({ name: "dashboard" });
  const [unlocked, setUnlocked] = useState(() => getAdminKey() !== "");

  // Keep the sidebar's live uptime/rooms summary fresh.
  const { data: statsData, reload: reloadStats } = usePoll(
    useCallback(() => adminApi.stats(), []),
    8000,
  );

  if (!unlocked) {
    return <AuthGate onSuccess={() => setUnlocked(true)} />;
  }

  const navItem = (item: (typeof NAV)[number]) => {
    const active = item.name === view.name || (item.name === "rooms" && view.name === "room");
    const Icon = item.icon;
    return (
      <button
        key={item.name}
        onClick={() => {
          setView({ name: item.name } as AdminView);
        }}
        className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[13.5px] font-medium transition-colors ${
          active
            ? "bg-accent/12 text-accent"
            : "text-ink-muted hover:bg-base-raised hover:text-ink"
        }`}
      >
        <Icon width={18} height={18} />
        {item.label}
      </button>
    );
  };

  return (
    <div className="min-h-full bg-base">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-base-border bg-base-raised md:flex">
        <div className="flex items-center gap-2.5 px-5 pt-5 pb-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-base-border2 bg-base-sunken text-sm font-semibold text-ink">
            cr
          </span>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-ink">Admin console</div>
            <div className="text-[11px] text-ink-faint">cryo · live oversight</div>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3">
          {NAV.map(navItem)}
        </nav>
        <div className="border-t border-base-border px-5 py-4">
          <button
            onClick={() => {
              clearAdminKey();
              setUnlocked(false);
            }}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-medium text-ink-faint transition-colors hover:bg-base-raised hover:text-ink"
          >
            <IconLogOut width={16} height={16} />
            Sign out
          </button>
          <div className="mt-3 flex items-center justify-between px-3 text-[11px] text-ink-faint">
            <button
              onClick={reloadStats}
              className="flex items-center gap-1 transition-colors hover:text-ink"
              title="Refresh"
            >
              <IconRefresh width={12} height={12} />
              {statsData ? `${statsData.liveRooms} rooms · ${statsData.onlineParticipants} online` : "…"}
            </button>
            <span>{statsData ? `up ${fmtUptime(statsData.uptimeSeconds)}` : ""}</span>
          </div>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-base-border bg-base-raised/95 px-4 py-2.5 backdrop-blur md:hidden">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-base-border2 bg-base-sunken text-xs font-semibold text-ink">
            cr
          </span>
          <span className="text-sm font-semibold text-ink">Admin</span>
        </div>
        <button
          onClick={() => {
            clearAdminKey();
            setUnlocked(false);
          }}
          className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-ink-faint"
        >
          <IconLogOut width={14} height={14} />
          Out
        </button>
      </header>
      {/* Mobile nav strip */}
      <nav className="sticky top-[45px] z-20 flex gap-1 overflow-x-auto border-b border-base-border bg-base px-3 py-1.5 md:hidden">
        {NAV.map((item) => {
          const active = item.name === view.name || (item.name === "rooms" && view.name === "room");
          const Icon = item.icon;
          return (
            <button
              key={item.name}
              onClick={() => setView({ name: item.name } as AdminView)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                active ? "bg-accent text-white" : "bg-base-raised text-ink-muted"
              }`}
            >
              <Icon width={14} height={14} />
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* Main content */}
      <main className="px-4 py-5 md:pl-[16.5rem] md:pr-6">
        <div className="mx-auto max-w-5xl">
          {view.name === "dashboard" && (
            <AdminDashboard
              onOpenRoom={(id) => setView({ name: "room", roomId: id })}
              onOpenRooms={() => setView({ name: "rooms" })}
            />
          )}
          {view.name === "rooms" && <AdminRooms onOpenRoom={(id) => setView({ name: "room", roomId: id })} />}
          {view.name === "room" && (
            <AdminRoomDetail
              roomId={view.roomId}
              onBack={() => setView({ name: "rooms" })}
            />
          )}
          {view.name === "users" && (
            <AdminUsers onOpenRoom={(id) => setView({ name: "room", roomId: id })} />
          )}
          {view.name === "audit" && <AdminAudit />}
          {view.name === "analytics" && (
            <AdminAnalytics onOpenRoom={(id) => setView({ name: "room", roomId: id })} />
          )}
          {view.name === "settings" && <AdminSettings />}
        </div>
      </main>
    </div>
  );
}