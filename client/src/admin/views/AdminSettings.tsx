import { useCallback, useEffect, useRef, useState } from "react";
import type { AdminSettings } from "@cryo/shared";
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
];

export function AdminSettings() {
  const s = usePoll<AdminSettings>(
    useCallback(() => adminApi.settings(), []),
    POLL,
  );

  const [form, setForm] = useState<Partial<AdminSettings> | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const wasData = useRef(false);

  useEffect(() => {
    if (s.data && !wasData.current) {
      wasData.current = true;
      setForm({ ...s.data });
    }
    if (s.data) setForm((prev) => prev ?? { ...s.data });
  }, [s.data]);

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
    </div>
  );
}