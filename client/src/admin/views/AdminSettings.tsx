import { useCallback, useState } from "react";
import type { AdminSettings, ReservedRoomAccess } from "@cryo/shared";
import { adminApi } from "../adminApi";
import { Badge, Card, CardHeader, EmptyState, ErrorBanner, Spinner } from "../components";
import { usePoll } from "../usePoll";
import { IconRefresh } from "../../components/ui/Icon";

const POLL = 10000;

interface FieldDef {
  key: keyof Omit<AdminSettings, "adminEnabled">;
  label: string;
  hint: string;
  kind: "number" | "text" | "toggle";
  min?: number;
  max?: number;
  step?: number;
}

const NUMBER_FIELDS: FieldDef[] = [
  { key: "maxMessageLength", label: "Max message length", hint: "Characters, capped by the client protocol at 2000.", kind: "number", min: 1, max: 2000 },
  { key: "maxRoomSize", label: "Max room size", hint: "Concurrent members per room.", kind: "number", min: 2, max: 200 },
  { key: "roomTtlMinutes", label: "Room TTL", hint: "Minutes a room lives without activity before expiring.", kind: "number", min: 1, max: 10080 },
  { key: "messageTtlMinutes", label: "Message retention", hint: "Minutes messages are kept before pruned.", kind: "number", min: 1, max: 10080 },
  { key: "messageCap", label: "Message cap", hint: "Newest N messages retained per room.", kind: "number", min: 20, max: 5000 },
  { key: "maxSocketsPerIp", label: "Sockets per IP", hint: "Connection limit per client address.", kind: "number", min: 1, max: 200 },
  { key: "messageRateLimit", label: "Message rate limit", hint: "Messages per participant per window.", kind: "number", min: 1, max: 500 },
  { key: "messageRateWindowSeconds", label: "Rate window (s)", hint: "Rolling window for the rate limit.", kind: "number", min: 1, max: 3600 },
];

const TEXT_FIELDS: FieldDef[] = [
  { key: "reservedRoomCode", label: "Reserved room code", hint: "Exactly 4 letters/digits — the persistent room.", kind: "text" },
];

const TOGGLE_FIELDS: FieldDef[] = [
  { key: "reservedRoomEnabled", label: "Reserved room enabled", hint: "When off, the reserved room is not auto-created.", kind: "toggle" },
  { key: "voiceNotesEnabled", label: "Voice notes enabled", hint: "When off, the app hides the voice-note (mic) button.", kind: "toggle" },
];

export function AdminSettings() {
  const s = usePoll<AdminSettings>(
    useCallback(() => adminApi.settings(), []),
    POLL,
  );
  const access = usePoll<ReservedRoomAccess>(
    useCallback(() => adminApi.reservedRoom(), []),
    POLL,
  );

  const [form, setForm] = useState<Partial<AdminSettings> | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Reserved-room password controls. The value is write-only: it is sent to the
  // server and never read back, so the field clears itself after a successful
  // save instead of pretending to display the current value.
  const [pwDraft, setPwDraft] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwDone, setPwDone] = useState<string | null>(null);

  // Initialize the editable form from the first settings snapshot that comes
  // back. Guarded so it only runs once — user edits are never overwritten by
  // later polls.
  if (s.data && form === null) {
    setForm(s.data);
  }

  if (s.loading && !s.data) return <Spinner />;
  if (s.error) return <ErrorBanner message={`Settings: ${s.error}`} onRetry={s.reload} />;
  if (!form) return <EmptyState label="Couldn't load settings." />;

  const current = s.data!;
  const dirty = NUMBER_FIELDS.some((f) => form[f.key] !== current[f.key]) ||
    TEXT_FIELDS.some((f) => form[f.key] !== current[f.key]) ||
    TOGGLE_FIELDS.some((f) => form[f.key] !== current[f.key]);

  const set = <K extends keyof Omit<AdminSettings, "adminEnabled">>(key: K, value: AdminSettings[K]) =>
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));

  const reset = () => setForm({ ...current });

  const locked = access.data?.locked ?? current.reservedRoomPasswordSet;

  const setPassword = async () => {
    setPwBusy(true);
    setPwError(null);
    setPwDone(null);
    try {
      await adminApi.setReservedRoomPassword(pwDraft);
      setPwDraft("");
      setShowPw(false);
      setPwDone("Password updated. Everyone has to enter the new one.");
      access.reload();
      s.reload();
    } catch (e) {
      setPwError(e instanceof Error ? e.message : "Could not set the password");
    } finally {
      setPwBusy(false);
    }
  };

  const removePassword = async () => {
    setPwBusy(true);
    setPwError(null);
    setPwDone(null);
    try {
      await adminApi.clearReservedRoomPassword();
      setPwDraft("");
      setPwDone("Password removed. The room is open to anyone with the code.");
      access.reload();
      s.reload();
    } catch (e) {
      setPwError(e instanceof Error ? e.message : "Could not remove the password");
    } finally {
      setPwBusy(false);
    }
  };

  const revokeAccess = async () => {
    setPwBusy(true);
    setPwError(null);
    setPwDone(null);
    try {
      await adminApi.revokeReservedRoomAccess();
      setPwDone("Saved access revoked. The next time someone joins, they have to enter the password again.");
    } catch (e) {
      setPwError(e instanceof Error ? e.message : "Could not revoke access");
    } finally {
      setPwBusy(false);
    }
  };

  const save = async () => {
    if (!form) return;
    const patch: Record<string, unknown> = {};
    const all: (FieldDef & { key: keyof Omit<AdminSettings, "adminEnabled"> })[] = [
      ...NUMBER_FIELDS,
      ...TEXT_FIELDS,
      ...TOGGLE_FIELDS,
    ];
    for (const f of all) {
      if (form[f.key] !== current[f.key]) patch[f.key] = form[f.key];
    }
    setSaving(true);
    setSaveError(null);
    try {
      const next = await adminApi.updateSettings(patch as never);
      setForm({ ...next });
      setSaved(Date.now());
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-ink">Settings</h1>
          <p className="text-sm text-ink-faint">
            Live runtime values — they reset to env defaults on server restart.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {saved && (
            <span className="text-xs text-emerald-400" aria-live="polite">
              Saved {new Date(saved).toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={s.reload}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-xl border border-base-border2 bg-base-raised px-3 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:text-ink disabled:opacity-40"
          >
            <IconRefresh width={13} height={13} />
            Reload
          </button>
        </div>
      </div>

      <Card>
        <CardHeader
          title="App settings"
          subtitle="Applied immediately to live traffic"
          right={
            <Badge tone={current.adminEnabled ? "green" : "amber"}>
              admin {current.adminEnabled ? "enabled" : "disabled"}
            </Badge>
          }
        />
        <div className="p-4">
          <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            {NUMBER_FIELDS.map((f) => (
              <label key={f.key} className="flex flex-col gap-1">
                <span className="text-xs font-medium uppercase tracking-wider text-ink-faint">
                  {f.label}
                </span>
                <input
                  type="number"
                  min={f.min}
                  max={f.max}
                  step={f.step}
                  value={form[f.key] as number}
                  onChange={(e) => set(f.key, Number(e.target.value))}
                  className="w-full rounded-xl border border-base-border2 bg-base-sunken px-3 py-2 text-sm tabular-nums text-ink focus:border-accent focus:outline-none"
                />
                <span className="text-[11px] text-ink-faint">{f.hint}</span>
              </label>
            ))}
            {TEXT_FIELDS.map((f) => (
              <label key={f.key} className="flex flex-col gap-1">
                <span className="text-xs font-medium uppercase tracking-wider text-ink-faint">
                  {f.label}
                </span>
                <input
                  type="text"
                  value={String(form[f.key] ?? "")}
                  maxLength={4}
                  onChange={(e) => set(f.key, e.target.value.toUpperCase())}
                  className="w-full rounded-xl border border-base-border2 bg-base-sunken px-3 py-2 font-mono text-sm text-ink focus:border-accent focus:outline-none"
                />
                <span className="text-[11px] text-ink-faint">{f.hint}</span>
              </label>
            ))}
            {TOGGLE_FIELDS.map((f) => (
              <div key={f.key} className="flex items-center justify-between gap-3 rounded-xl border border-base-border bg-base-sunken/50 px-3 py-3">
                <div>
                  <span className="text-sm font-medium text-ink">{f.label}</span>
                  <p className="text-[11px] text-ink-faint">{f.hint}</p>
                </div>
                <button
                  role="switch"
                  aria-checked={Boolean(form[f.key])}
                  onClick={() => set(f.key, !form[f.key])}
                  className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                    form[f.key] ? "bg-accent" : "bg-base-border2"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
                      form[f.key] ? "left-[22px]" : "left-0.5"
                    }`}
                  />
                </button>
              </div>
            ))}
          </div>

          {saveError && (
            <p className="mt-4 rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
              {saveError}
            </p>
          )}

          <div className="mt-5 flex items-center justify-end gap-2 border-t border-base-border pt-4">
            {dirty && (
              <span className="mr-auto text-[11px] text-amber-300">Unsaved changes</span>
            )}
            <button
              onClick={reset}
              disabled={!dirty || saving}
              className="rounded-xl border border-base-border2 px-3 py-2 text-sm text-ink-muted transition-colors hover:text-ink disabled:opacity-40"
            >
              Reset
            </button>
            <button
              onClick={() => void save()}
              disabled={!dirty || saving}
              className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white transition-transform active:scale-[0.99] disabled:opacity-40"
            >
              {saving && (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              )}
              Save changes
            </button>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Reserved room access"
          subtitle="The always-open room behind the fixed code"
          right={
            <Badge tone={locked ? "green" : "amber"}>
              {locked ? "password protected" : "open to anyone"}
            </Badge>
          }
        />
        <div className="p-4">
          <p className="text-xs leading-relaxed text-ink-muted">
            The code is only four characters, so the password is what actually
            keeps the reserved room private. After a visitor types it once, their
            device keeps an access token and is not asked again — until you
            change the password or revoke access, which stops every saved token
            from working.
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-ink-faint">
            <span>Code</span>
            <code className="rounded bg-base-sunken px-1.5 py-0.5 font-mono text-ink-muted">
              {access.data?.code ?? current.reservedRoomCode}
            </code>
            {!access.data?.enabled && (
              <Badge tone="faint">room disabled</Badge>
            )}
          </div>

          <label className="mt-4 flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wider text-ink-faint">
              {locked ? "Change password" : "Set a password"}
            </span>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type={showPw ? "text" : "password"}
                  value={pwDraft}
                  onChange={(e) => setPwDraft(e.target.value)}
                  placeholder="At least 4 characters"
                  autoComplete="new-password"
                  aria-label="Reserved room password"
                  className="w-full rounded-xl border border-base-border2 bg-base-sunken px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint transition-colors hover:text-ink"
                >
                  {showPw ? "Hide" : "Show"}
                </button>
              </div>
              <button
                onClick={() => void setPassword()}
                disabled={pwBusy || pwDraft.trim().length < 4}
                className="shrink-0 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white transition-transform active:scale-[0.99] disabled:opacity-40"
              >
                {pwBusy ? "…" : locked ? "Update" : "Set"}
              </button>
            </div>
            <span className="text-[11px] text-ink-faint">
              {locked
                ? "Changing it signs out every device that already unlocked the room."
                : "Until you set one, anyone with the code can walk in."}
            </span>
          </label>

          {pwError && (
            <p className="mt-3 rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
              {pwError}
            </p>
          )}
          {pwDone && (
            <p className="mt-3 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
              {pwDone}
            </p>
          )}

          {locked && (
            <div className="mt-4 flex flex-wrap gap-2 border-t border-base-border pt-4">
              <button
                onClick={() => void revokeAccess()}
                disabled={pwBusy}
                className="rounded-xl border border-base-border2 px-3 py-2 text-sm text-ink-muted transition-colors hover:text-ink disabled:opacity-40"
              >
                Revoke saved access
              </button>
              <button
                onClick={() => void removePassword()}
                disabled={pwBusy}
                className="rounded-xl border border-rose-500/30 px-3 py-2 text-sm text-rose-300 transition-colors hover:bg-rose-500/10 disabled:opacity-40"
              >
                Remove password
              </button>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}