import { useState } from "react";
import type { PublicRoom } from "@cryo/shared";
import { Modal } from "../ui/Modal";
import { IconCheck, IconLock, IconUnlock } from "../ui/Icon";

interface Props {
  room: PublicRoom;
  onClose: () => void;
  onSetPrivate: (password: string, expiresAt: number) => Promise<void>;
  onMakePublic: () => Promise<void>;
}

/**
 * Expiry presets. "Never" is the default because a surprise reopening is
 * worse than a stale password — but the choice is visible rather than implied,
 * because a password nobody remembers renewing is how a "private" room quietly
 * becomes an open one.
 */
const EXPIRY_CHOICES = [
  { label: "Never", value: 0 },
  { label: "7 days", value: 7 * 24 * 60 * 60 * 1000 },
  { label: "30 days", value: 30 * 24 * 60 * 60 * 1000 },
] as const;

function describeExpiry(at: number): string {
  if (!at) return "never expires";
  const days = Math.round((at - Date.now()) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "expires now";
  return days === 1 ? "expires tomorrow" : `expires in ${days} days`;
}

/**
 * Snap a remaining-time to the closest preset at or below it. The room may hold
 * an expiry the user set on another device between our offered choices, and a
 * radio group with nothing selected is worse than one that rounds down.
 */
function nearestPreset(remainingMs: number): number {
  const finite = [...EXPIRY_CHOICES].filter((c) => c.value > 0).sort((a, b) => a.value - b.value);
  return finite.find((c) => c.value <= remainingMs)?.value ?? finite[finite.length - 1].value;
}

/**
 * Host-only privacy controls.
 *
 * Deliberately one password field and one expiry choice rather than a settings
 * page: the whole decision is "should anyone without this be able to walk in?"
 * Everything else about the room keeps working the same either way.
 */
export function RoomSettings({ room, onClose, onSetPrivate, onMakePublic }: Props) {
  const locked = room.locked;
  const [password, setPassword] = useState("");
  // Seeded from the room, not synced: this sheet is mounted fresh each time it
  // opens, so pre-selecting the room's current expiry costs no effect and stops
  // an edit from silently resetting how long the new password lasts.
  const [expiry, setExpiry] = useState(() =>
    room.passwordExpiresAt === 0 ? 0 : room.passwordExpiresAt - Date.now(),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = password.trim().length >= 4 && !busy;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      // The deadline is stamped on submit, not on open: "expires in 7 days"
      // should mean seven days from when the password was actually set, and
      // reading the clock during render is what React rightly complains about.
      const lifetime = expiry === 0 ? 0 : nearestPreset(expiry);
      await onSetPrivate(password, lifetime === 0 ? 0 : Date.now() + lifetime);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't set the password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={busy ? () => undefined : onClose} title="Room settings">
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-base font-semibold text-ink">Room settings</h2>
          <p className="mt-0.5 text-xs text-ink-muted">
            Code {room.code} ·{" "}
            {locked ? describeExpiry(room.passwordExpiresAt) : "anyone with the link can join"}
          </p>
        </div>

        {locked ? (
          <>
            <div className="flex items-start gap-3 rounded-xl border border-base-border bg-base-sunken/60 p-3">
              <IconLock width={16} height={16} className="mt-0.5 shrink-0 text-accent" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">This room is private</p>
                <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">
                  {describeExpiry(room.passwordExpiresAt)}. Setting a new password signs out
                  everyone else&rsquo;s saved device — they&rsquo;ll be asked for it again.
                </p>
              </div>
            </div>

            <form onSubmit={submit} className="flex flex-col gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium uppercase tracking-wider text-ink-faint">
                  New password
                </span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 4 characters"
                  autoComplete="new-password"
                  disabled={busy}
                  className="w-full rounded-xl border border-base-border2 bg-base-sunken px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none disabled:opacity-50"
                />
              </label>
              <ExpiryPicker value={expiry} onChange={setExpiry} disabled={busy} />
              {error && (
                <p className="rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={!canSubmit}
                className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white transition-transform active:scale-[0.99] disabled:opacity-40"
              >
                {busy ? "Saving…" : "Change password"}
              </button>
            </form>

            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await onMakePublic();
                  onClose();
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Couldn't open the room.");
                } finally {
                  setBusy(false);
                }
              }}
              className="flex items-center justify-center gap-1.5 rounded-xl border border-base-border2 px-4 py-2 text-sm font-medium text-ink-muted transition-colors hover:text-ink disabled:opacity-40"
            >
              <IconUnlock width={14} height={14} />
              Make room public
            </button>
          </>
        ) : (
          <>
            <div className="flex items-start gap-3 rounded-xl border border-base-border bg-base-sunken/60 p-3">
              <IconUnlock width={16} height={16} className="mt-0.5 shrink-0 text-ink-muted" />
              <p className="text-xs leading-relaxed text-ink-muted">
                Anyone with the code can join and read everything. Add a password if this
                conversation should not be open to whoever gets the link.
              </p>
            </div>

            <form onSubmit={submit} className="flex flex-col gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium uppercase tracking-wider text-ink-faint">
                  Password
                </span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 4 characters"
                  autoComplete="new-password"
                  autoFocus
                  disabled={busy}
                  className="w-full rounded-xl border border-base-border2 bg-base-sunken px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none disabled:opacity-50"
                />
              </label>
              <ExpiryPicker value={expiry} onChange={setExpiry} disabled={busy} />
              {error && (
                <p className="rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={!canSubmit}
                className="flex items-center justify-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white transition-transform active:scale-[0.99] disabled:opacity-40"
              >
                <IconLock width={14} height={14} />
                {busy ? "Saving…" : "Make room private"}
              </button>
            </form>
            <p className="text-center text-[11px] text-ink-faint">
              Everyone already in the room stays in.
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}

function ExpiryPicker({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (ms: number) => void;
  disabled: boolean;
}) {
  const selected = value === 0 ? 0 : nearestPreset(value);
  return (
    <fieldset disabled={disabled}>
      <legend className="mb-1 text-xs font-medium uppercase tracking-wider text-ink-faint">
        Password expires
      </legend>
      <div className="flex gap-1.5">
        {EXPIRY_CHOICES.map((c) => {
          const active = selected === c.value;
          return (
            <label
              key={c.label}
              className={`flex flex-1 cursor-pointer items-center justify-center gap-1 rounded-xl border px-2 py-2 text-xs font-medium transition-colors ${
                active
                  ? "border-accent bg-accent/15 text-ink"
                  : "border-base-border2 text-ink-muted hover:text-ink"
              } ${disabled ? "opacity-50" : ""}`}
            >
              <input
                type="radio"
                name="password-expiry"
                className="sr-only"
                checked={active}
                onChange={() => onChange(c.value)}
              />
              {active && <IconCheck width={12} height={12} />}
              {c.label}
            </label>
          );
        })}
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">
        When a password expires the room goes back to public and says so in the chat, rather
        than quietly locking everyone out.
      </p>
    </fieldset>
  );
}