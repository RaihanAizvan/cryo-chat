import { useState } from "react";
import { MAX_NAME_LENGTH } from "@cryo/shared";
import { updateDisplayName } from "../../lib/store";
import { setStoredDisplayName } from "../../lib/prefs";
import { Modal } from "../ui/Modal";
import { IconX } from "../ui/Icon";

interface Props {
  initial: string;
  onClose: () => void;
}

export function NameEditor({ initial, onClose }: Props) {
  const [name, setName] = useState(initial);

  const submit = () => {
    const trimmed = name.trim();
    if (trimmed) {
      setStoredDisplayName(trimmed);
      updateDisplayName(trimmed);
      onClose();
    }
  };

  return (
    <Modal onClose={onClose} title="Change display name">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-ink">Display name</h2>
        <button
          onClick={onClose}
          className="flex h-9 w-9 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-base-border"
          aria-label="Close"
        >
          <IconX width={18} height={18} />
        </button>
      </div>

      <p className="mb-4 text-sm text-ink-muted">
        Anonymity is the point — no email or account needed.
      </p>

      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        maxLength={MAX_NAME_LENGTH}
        autoCapitalize="words"
        autoCorrect="off"
        className="w-full rounded-2xl border border-base-border2 bg-base-sunken px-4 py-3.5 text-[15px] text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
      />

      <button
        onClick={submit}
        disabled={!name.trim()}
        className="mt-4 w-full rounded-2xl bg-accent py-3.5 text-[15px] font-semibold text-white transition-opacity disabled:opacity-40"
      >
        Save
      </button>
    </Modal>
  );
}
