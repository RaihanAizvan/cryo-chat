import { useState } from "react";
import { Modal } from "../ui/Modal";
import { IconX } from "../ui/Icon";

interface Props {
  error: string | null;
  onErrorClear: () => void;
  onClose: () => void;
  onJoin: (code: string) => void;
}

export function JoinRoom({ error, onErrorClear, onClose, onJoin }: Props) {
  const [code, setCode] = useState("");

  const submit = () => {
    if (code.trim()) {
      onErrorClear();
      onJoin(code);
    }
  };

  return (
    <Modal onClose={onClose} title="Join a room">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-ink">Join a room</h2>
        <button
          onClick={onClose}
          className="flex h-9 w-9 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-base-border"
          aria-label="Close"
        >
          <IconX width={18} height={18} />
        </button>
      </div>

      <p className="mb-4 text-sm text-ink-muted">
        Enter the 8-character room code shared with you.
      </p>

      <input
        autoFocus
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder="e.g. X7K9P2MA"
        inputMode="text"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        maxLength={12}
        aria-invalid={!!error}
        className="w-full rounded-2xl border border-base-border2 bg-base-sunken px-4 py-3.5 text-[15px] text-ink tracking-[0.2em] placeholder:tracking-normal placeholder:text-ink-faint focus:border-accent focus:outline-none"
      />

      {error && (
        <p className="mt-2 text-sm text-rose-300" role="alert">
          {error}
        </p>
      )}

      <button
        onClick={submit}
        disabled={!code.trim()}
        className="mt-4 w-full rounded-2xl bg-accent py-3.5 text-[15px] font-semibold text-white transition-opacity disabled:opacity-40"
      >
        Join
      </button>
    </Modal>
  );
}
