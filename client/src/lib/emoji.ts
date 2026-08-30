/**
 * Curated emoji set for the picker, grouped by category (Instagram-style). Plus
 * a tiny "recently used" store persisted on-device.
 */

export interface EmojiCategory {
  id: string;
  label: string;
  /** Representative emoji used as the tab icon. */
  icon: string;
  emojis: string[];
}

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    id: "smileys",
    label: "Smileys",
    icon: "😀",
    emojis: [
      "😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣",
      "😊", "😇", "🙂", "🙃", "😉", "😌", "😍", "🥰",
      "😘", "😗", "😚", "😙", "😋", "😛", "😝", "😜",
      "🤪", "🤨", "🧐", "🤓", "😎", "🥸", "🤩", "🥳",
      "😏", "😒", "😞", "😔", "😟", "😕", "🙁", "☹️",
      "😣", "😖", "😫", "😩", "🥺", "😢", "😭", "😤",
      "😠", "😡", "🤬", "🤯", "😳", "🥵", "🥶", "😱",
      "😨", "😰", "😥", "😓", "🤗", "🤔", "🫣", "🤭",
      "🫢", "🤫", "🤥", "😶", "😐", "😑", "😬", "🙄",
      "😯", "😴", "🤤", "😪", "😵", "🥱", "😷", "🤒",
      "🤕", "🤢", "🤮", "🤧", "🫥",
    ],
  },
  {
    id: "gestures",
    label: "Gestures",
    icon: "👋",
    emojis: [
      "👋", "🤚", "🖐️", "✋", "🖖", "👌", "🤌", "✌️",
      "🤞", "🤟", "🤘", "🤙", "👈", "👉", "👆", "👇",
      "☝️", "👍", "👎", "✊", "👊", "🤛", "🤜", "👏",
      "🙌", "👐", "🤲", "🤝", "🙏", "✍️", "💅", "🤳",
      "💪", "🦵", "🦶", "👂", "🦻", "👃", "🧠", "🦷",
      "🦴", "👀", "👁️", "👅", "👄",
    ],
  },
  {
    id: "hearts",
    label: "Hearts",
    icon: "❤️",
    emojis: [
      "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍",
      "🤎", "💔", "❣️", "💕", "💞", "💓", "💗", "💖",
      "💘", "💝", "💟", "♥️", "💌", "💋", "💐", "💯",
    ],
  },
  {
    id: "animals",
    label: "Animals",
    icon: "🐶",
    emojis: [
      "🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼",
      "🐨", "🐯", "🦁", "🐮", "🐷", "🐽", "🐸", "🐵",
      "🙈", "🙉", "🙊", "🐒", "🐔", "🐧", "🐦", "🐤",
      "🐣", "🐥", "🦆", "🦅", "🦉", "🦚", "🦜", "🦢",
      "🐢", "🐍", "🦎", "🦖", "🦕", "🐙", "🦑", "🦐",
      "🦞", "🦀", "🐋", "🐬", "🦭", "🐳", "🐊", "🦓",
    ],
  },
  {
    id: "food",
    label: "Food",
    icon: "🍔",
    emojis: [
      "🍎", "🍐", "🍊", "🍋", "🍌", "🍉", "🍇", "🍓",
      "🫐", "🍈", "🍒", "🍑", "🥭", "🍍", "🥥", "🥝",
      "🍅", "🍆", "🥑", "🥦", "🥬", "🌽", "🥕", "🥔",
      "🍞", "🥐", "🥨", "🧀", "🥚", "🍳", "🥞", "🍔",
      "🍟", "🍕", "🥪", "🌮", "🌯", "🥗", "🍝", "🍜",
      "🍲", "🍛", "🍣", "🍱", "🥟", "🍤", "🍙", "🍚",
      "🍧", "🍨", "🍦", "🥧", "🧁", "🍰", "🎂", "🍭",
    ],
  },
  {
    id: "activities",
    label: "Activities",
    icon: "⚽",
    emojis: [
      "⚽", "🏀", "🏈", "⚾", "🥎", "🎾", "🏐", "🏉",
      "🥏", "🎱", "🏓", "🏸", "🏒", "🏑", "🥍", "🏏",
      "⛳", "🏹", "🎣", "🥊", "🥋", "🎽", "🛹", "🎿",
      "⛷️", "🏂", "🏋️", "🤸", "🤺", "🤾", "🏌️", "🏇",
      "🧘", "🏄", "🏊", "🤽", "🚣", "🧗", "🚴", "🚵",
      "🎮", "🕹️", "🎲", "🧩", "🏆", "🥇", "🥈", "🥉",
    ],
  },
  {
    id: "travel",
    label: "Travel",
    icon: "🚗",
    emojis: [
      "🚗", "🚕", "🚙", "🚌", "🚎", "🏎️", "🚓", "🚑",
      "🚒", "🚐", "🛻", "🚚", "🚛", "🚜", "🛴", "🚲",
      "🛵", "🏍️", "🚨", "🚔", "🚍", "🚘", "🚖", "🚡",
      "🚠", "🚟", "🚃", "🚋", "🚄", "🚅", "🚈", "🚂",
      "🚆", "🚇", "🚊", "🚉", "✈️", "🛫", "🛬", "🛩️",
      "💺", "🛰️", "🚀", "🛸", "🚁", "🛶", "⛵", "🚤",
      "🛥️", "🛳️", "⛴️", "🚢", "🚇",
    ],
  },
  {
    id: "objects",
    label: "Objects",
    icon: "💡",
    emojis: [
      "⌚", "📱", "📲", "💻", "⌨️", "🖥️", "🖨️", "🖱️",
      "🕹️", "💽", "💾", "💿", "📀", "📼", "📷", "📸",
      "📹", "🎥", "📽️", "🎞️", "📞", "☎️", "📟", "📠",
      "📺", "📻", "🎙️", "🎚️", "🎛️", "🧭", "⏰", "⏳",
      "📡", "🔋", "🔌", "💡", "🔦", "🕯️", "🪔", "🧯",
      "🛢️", "💸", "💵", "💴", "💶", "💷", "🪙", "💰",
      "💳", "💎", "⚖️", "🧰", "🔧", "🔨", "⚙️", "🧲",
      "🧪", "🔬", "🔭", "💊", "💉", "🩹", "🩺", "📚",
    ],
  },
  {
    id: "symbols",
    label: "Symbols",
    icon: "⭐",
    emojis: [
      "⭐", "🌟", "✨", "⚡", "🔥", "💥", "💫", "🌟",
      "☀️", "🌤️", "⛅", "🌥️", "☁️", "🌦️", "🌧️", "⛈️",
      "🌩️", "🌨️", "❄️", "☃️", "⛄", "💨", "💧", "💦",
      "☔", "🌊", "🌫️", "🌈", "🌪️", "🫧", "♻️", "✅",
      "❌", "❓", "❗", "💬", "💭", "➡️", "⬅️", "⬆️",
      "⬇️", "🔔", "🔕", "📢", "📣", "🔒", "🔓", "💤",
    ],
  },
  {
    id: "flags",
    label: "Flags",
    icon: "🚩",
    emojis: [
      "🇺🇸", "🇬🇧", "🇧🇩", "🇮🇳", "🇵🇰", "🇯🇵", "🇰🇷", "🇨🇳",
      "🇩🇪", "🇫🇷", "🇮🇹", "🇪🇸", "🇧🇷", "🇲🇽", "🇳🇬", "🇰🇪",
      "🇨🇦", "🇦🇺", "🇳🇿", "🇮🇪", "🇳🇱", "🇧🇪", "🇸🇪", "🇳🇴",
      "🇩🇰", "🇵🇱", "🇺🇦", "🇹🇷", "🇸🇦", "🇦🇪", "🇦🇷", "🇨🇱",
      "🇵🇹", "🇬🇷", "🇷🇺", "🇮🇩", "🇲🇾", "🇸🇬", "🇹🇭", "🇻🇳",
      "🚩", "🏳️", "🏴", "🏴‍☠️",
    ],
  },
];

const RECENT_KEY = "cryo_emoji_recent";
const RECENT_MAX = 24;

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((e): e is string => typeof e === "string") : [];
  } catch {
    return [];
  }
}

function saveRecent(emojis: string[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(emojis.slice(0, RECENT_MAX)));
  } catch {
    /* storage may be unavailable — fail silently */
  }
}

/** Most recently tapped emojis, newest first. */
export function getRecentEmojis(): string[] {
  return loadRecent();
}

/** Remember an emoji tap so it appears in the recents row. */
export function recordEmoji(emoji: string): void {
  saveRecent([emoji, ...loadRecent().filter((e) => e !== emoji)]);
}