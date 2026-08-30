/**
 * Lightweight user preferences persisted on-device (localStorage).
 */

const DISPLAY_NAME_KEY = "cryo_display_name";

/** The last display name the user chose, null if never customized. */
export function getStoredDisplayName(): string | null {
  try {
    const v = localStorage.getItem(DISPLAY_NAME_KEY);
    return v && v.trim() ? v : null;
  } catch {
    return null;
  }
}

export function setStoredDisplayName(name: string | null): void {
  try {
    if (name && name.trim()) {
      localStorage.setItem(DISPLAY_NAME_KEY, name.trim());
    } else {
      localStorage.removeItem(DISPLAY_NAME_KEY);
    }
  } catch {
    /* storage may be unavailable (private mode) — fail silently */
  }
}