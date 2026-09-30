import { useEffect, useRef, useState } from "react";
import { Modal } from "../ui/Modal";
import { IconLock, IconX } from "../ui/Icon";

interface Props {
  code: string;
  /** Set after a rejected attempt, cleared when the user edits the field. */
  error: string | null;
  onSubmit: (password: string) => void;
  onClose: () => void;
}

/**
 * Asked once per device, then remembered: the server keeps the visitor out until
 * they supply the reserved room's password, and hands back an access token
 * afterwards.
 */
export function ReservedPassword({ code, error, onSubmit, onClose }: Props) {
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Don't let Escape dismiss the prompt: the user is standing in front of a
  // locked door, and the only way out is the Cancel button. Escape still closes
  // it (Modal owns that), so nothing gets stuck.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = () => {
    if (!password.trim() || busy) return;
    setBusy(true);
    onSubmit(password);
  };

  return (
    <Modal onClose={onClose} title="Password required">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/15 text-accent">
            <IconLock width={17} height={17} />
          </span>
          <h2 className="text-lg font-semibold text-ink">Password required</h2>
        </div>
        <button
          onClick={onClose}
          className="flex h-9 w-9 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-base-border"
          aria-label="Close"
        >
          <IconX width={18} height={18} />
        </button>
      </div>

      <p className="mb-4 text-sm text-ink-muted">
        This room is reserved. Please enter the password.
      </p>

      <div className="mb-3 flex items-center gap-2 text-xs text-ink-faint">
        <span>Room</span>
        <code className="rounded bg-base-sunken px-1.5 py-0.5 font-mono tracking-widest text-ink-muted">
          {code}
        </code>
      </div>

      <div className="relative">
        <input
          ref={inputRef}
          type={show ? "text" : "password"}
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
          }}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Password"
          autoComplete="off"
          aria-label="Room password"
          aria-invalid={!!error}
          className="w-full rounded-2xl border border-base-border2 bg-base-sunken px-4 py-3.5 pr-16 text-[15px] text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint transition-colors hover:text-ink"
        >
          {show ? "Hide" : "Show"}
        </button>
      </div>

      {error && (
        <p className="mt-2 text-sm text-rose-300" role="alert">
          {error}
        </p>
      )}

      <p className="mt-3 text-xs text-ink-faint">
        You'll only be asked once — this device stays unlocked until the password
        changes.
      </p>

      <div className="mt-4 flex gap-2">
        <button
          onClick={onClose}
          className="rounded-2xl border border-base-border2 px-4 py-3.5 text-[15px] font-semibold text-ink-muted transition-colors hover:text-ink"
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={!password.trim()}
          className="flex-1 rounded-2xl bg-accent py-3.5 text-[15px] font-semibold text-white transition-opacity disabled:opacity-40"
        >
          Enter
        </button>
      </div>
    </Modal>
  );
}
