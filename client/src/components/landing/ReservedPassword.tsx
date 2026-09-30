import { useEffect, useRef, useState } from "react";
import { Modal } from "../ui/Modal";
import { Dots, Spinner } from "../ui/Spinner";
import { IconLock, IconX } from "../ui/Icon";

interface Props {
  code: string;
  /** Only a *wrong* password is an error; being asked is not. */
  error: string | null;
  /** True while the server is checking the password. */
  busy: boolean;
  onSubmit: (password: string) => void;
  onClose: () => void;
}

/**
 * Asked once per device, then remembered: the server keeps a visitor out of a
 * password-protected room until they supply the password, and hands back an
 * access token afterwards.
 *
 * The room asking for a password is not a failure, so it is not dressed up as
 * one: no red, no warning icon, no "wrong" until something is actually wrong.
 */
export function ReservedPassword({ code, error, busy, onSubmit, onClose }: Props) {
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = () => {
    if (!password.trim() || busy) return;
    onSubmit(password);
  };

  return (
    <Modal onClose={busy ? () => undefined : onClose} title="Password needed">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-[17px] font-semibold tracking-tight text-ink">
          This room is reserved
        </h2>
        <button
          onClick={onClose}
          disabled={busy}
          className="-mr-1 -mt-1 flex h-8 w-8 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-base-border disabled:opacity-40"
          aria-label="Close"
        >
          <IconX width={17} height={17} />
        </button>
      </div>

      <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
        Please enter the password.
      </p>

      <div className="mt-4 flex items-center gap-2">
        <IconLock width={13} height={13} className="shrink-0 text-ink-faint" />
        <span className="text-[11px] uppercase tracking-wider text-ink-faint">
          Room
        </span>
        <code className="rounded bg-base-sunken px-1.5 py-0.5 font-mono tracking-widest text-ink-muted">
          {code}
        </code>
      </div>

      <div className="relative mt-3">
        <input
          ref={inputRef}
          type={show ? "text" : "password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            submit();
          }}
          placeholder="Password"
          autoComplete="off"
          spellCheck={false}
          aria-label="Room password"
          aria-invalid={!!error}
          aria-busy={busy}
          disabled={busy}
          className="w-full rounded-2xl border border-base-border2 bg-base-sunken px-4 py-3.5 pr-16 text-[15px] text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none disabled:opacity-60"
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          disabled={busy}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint transition-colors hover:text-ink disabled:opacity-40"
        >
          {show ? "Hide" : "Show"}
        </button>
      </div>

      {error ? (
        <p className="mt-2.5 flex items-center gap-1.5 text-sm text-rose-300" role="alert">
          {error}
        </p>
      ) : busy ? (
        <p className="mt-2.5 text-accent">
          <Dots label="Checking…" />
        </p>
      ) : null}

      <div className="mt-5 flex gap-2">
        <button
          onClick={onClose}
          disabled={busy}
          className="rounded-2xl border border-base-border2 px-5 py-3.5 text-[15px] font-semibold text-ink-muted transition-colors hover:text-ink disabled:opacity-40"
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={!password.trim() || busy}
          className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-accent py-3.5 text-[15px] font-semibold text-white transition-transform active:scale-[0.99] disabled:opacity-40"
        >
          {busy ? <Spinner label="Entering" /> : "Enter"}
        </button>
      </div>
    </Modal>
  );
}
