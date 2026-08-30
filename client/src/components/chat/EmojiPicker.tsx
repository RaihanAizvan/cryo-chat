import { useState } from "react";
import { EMOJI_CATEGORIES, getRecentEmojis } from "../../lib/emoji";

interface Props {
  onPick: (emoji: string) => void;
}

/** Instagram-style emoji sheet: category tabs + grid + recently used row. */
export function EmojiPicker({ onPick }: Props) {
  const [catId, setCatId] = useState(EMOJI_CATEGORIES[0].id);
  const recent = getRecentEmojis();
  const active = EMOJI_CATEGORIES.find((c) => c.id === catId) ?? EMOJI_CATEGORIES[0];

  return (
    <div className="flex h-[17rem] flex-col overflow-hidden rounded-t-2xl border border-b-0 border-base-border2 bg-base-raised shadow-2xl">
      {/* Category tabs */}
      <div className="no-scrollbar flex shrink-0 gap-1 overflow-x-auto border-b border-base-border px-2 py-1.5">
        {EMOJI_CATEGORIES.map((c) => (
          <button
            key={c.id}
            onClick={() => setCatId(c.id)}
            aria-label={c.label}
            title={c.label}
            className={`flex h-9 shrink-0 items-center justify-center rounded-lg px-1.5 text-[20px] transition-colors ${
              active.id === c.id
                ? "bg-base-border"
                : "hover:bg-base-border/50"
            }`}
          >
            <span aria-hidden>{c.icon}</span>
          </button>
        ))}
      </div>

      {/* Emoji grid */}
      <div className="no-scrollbar flex-1 overflow-y-auto overscroll-contain p-1.5">
        {recent.length > 0 && (
          <div className="mb-1.5 grid grid-cols-8 gap-0.5 border-b border-base-border pb-1.5">
            {recent.map((e) => (
              <EmojiButton key={e} emoji={e} onPick={onPick} />
            ))}
          </div>
        )}
        <div className="grid grid-cols-8 gap-0.5">
          {active.emojis.map((e) => (
            <EmojiButton key={e} emoji={e} onPick={onPick} />
          ))}
        </div>
      </div>
    </div>
  );
}

function EmojiButton({ emoji, onPick }: { emoji: string; onPick: (e: string) => void }) {
  return (
    <button
      onClick={() => onPick(emoji)}
      aria-label={emoji}
      className="flex h-9 items-center justify-center rounded-lg text-[22px] leading-none transition-transform hover:bg-base-border active:scale-90"
    >
      {emoji}
    </button>
  );
}