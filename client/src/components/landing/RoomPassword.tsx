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
  /**
   * Seconds left on the server's rate limit. While this is counting down the
   * prompt is inert — a throttled visitor who can keep submitting will keep
   * earning rejections and will read it as a ban rather than a wait.
   */
  retryAfterSeconds: number;
  onSubmit: (password: string) => void;
  onClose: () => void;
}

/**
 * Asked once per device, then remembered: the server keeps a visitor out of a
 * private room until they supply the password, and hands back an access token
 * afterwards.
 *
 * The room asking for a password is not a failure, so it is not dressed up as
 * one: no red, no warning icon, no "wrong" until something is actually wrong.
 */
export function RoomPassword({
  code,
  error,
  busy,
  retryAfterSeconds,
  onSubmit,
  onClose,
}: Props) {
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Tick the wait down locally so the number the visitor reads is the number
  // they are actually waiting, not the one the server happened to send.
  // Adjusting during render rather than in an effect: the server value is a
  // prop, and this is React's sanctioned way to derive state from a prop
  // without a cascading second render.
  const [wait, setWait] = useState({ server: retryAfterSeconds, left: retryAfterSeconds });
  if (wait.server !== retryAfterSeconds) {
    setWait({ server: retryAfterSeconds, left: retryAfterSeconds });
  }
  const waitLeft = wait.left;

  useEffect(() => {
    if (waitLeft <= 0) return;
    const t = setTimeout(
      () => setWait((w) => ({ ...w, left: Math.max(0, w.left - 1) })),
      1000,
    );
    return () => clearTimeout(t);
  }, [waitLeft]);

  const throttled = waitLeft > 0;
  const blocked = busy || throttled;

  const submit = () => {
    if (!password.trim() || blocked) return;
    onSubmit(password);
  };

  return (
    <Modal onClose={busy ? () => undefined : onClose} title="Password needed">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-[17px] font-semibold tracking-tight text-ink">
          This room is private
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
        Only people with the password can read this conversation.
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
          disabled={blocked}
          className="w-full rounded-2xl border border-base-border2 bg-base-sunken px-4 py-3.5 pr-16 text-[15px] text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none disabled:opacity-60"
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          disabled={blocked}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint transition-colors hover:text-ink disabled:opacity-40"
        >
          {show ? "Hide" : "Show"}
        </button>
      </div>

      {/* Announced once when the wait starts, not re-announced every second —
          a screen reader repeating "30 seconds" sixty times is worse than
          silence. The number itself stays visible and updates silently. */}
      {throttled ? (
        <p className="mt-2.5 text-sm text-amber-300" role="status">
          Too many attempts. Wait {waitLeft}s.
        </p>
      ) : error ? (
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
          disabled={!password.trim() || blocked}
          className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-accent py-3.5 text-[15px] font-semibold text-white transition-transform active:scale-[0.99] disabled:opacity-40"
        >
          {busy ? <Spinner label="Entering" /> : throttled ? `Wait ${waitLeft}s` : "Enter"}
        </button>
      </div>
    </Modal>
  );
}
