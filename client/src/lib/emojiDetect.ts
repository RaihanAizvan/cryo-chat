/**
 * Emoji-only message detection, following WhatsApp's behaviour: a message made
 * up solely of emoji renders large, without the chat bubble.
 */

// One emoji grapheme: a pictographic emoji (optionally skin-tone / VS16
// modified) or a ZWJ sequence of them, a flag pair, or a keycap sequence.
// Plain ASCII digits / `#` / `*` are intentionally NOT matchable (they only
// count as emoji when combined with a combining keycap), so things like "12"
// never render as giant emoji.
const EMOJI_CHUNK =
  /^(?:[\p{Extended_Pictographic}\uFE0F]\p{Emoji_Modifier}?(?:\u200D[\p{Extended_Pictographic}\uFE0F]\p{Emoji_Modifier}?)*|[\p{Regional_Indicator}]{2}|[#*0-9]\uFE0F?\u20E3)+$/u;

const EMOJI_WS = /[\s\u200B\uFEFF]*/g;

/** True when the message is "all emoji" and warrants the bubble-less treatment. */
export function isEmojiOnly(text: string): boolean {
  const stripped = text.replace(EMOJI_WS, "");
  if (!stripped) return false;
  // hard cap on emoji count so a wall of emoji doesn't blow up the layout
  if (Array.from(stripped).length > 12) return false;
  return EMOJI_CHUNK.test(stripped);
}
