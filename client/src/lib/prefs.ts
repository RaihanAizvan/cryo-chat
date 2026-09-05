/**
 * Lightweight user preferences persisted on-device (localStorage).
 */

const DISPLAY_NAME_KEY = "cryo_display_name";
const SESSION_ID_KEY = "cryo_session_id";

/** A stable anonymous identity reused across reconnects/room changes. */
export function getStoredSessionId(): string | null {
  try {
    const v = localStorage.getItem(SESSION_ID_KEY);
    return v && v.trim() ? v : null;
  } catch {
    return null;
  }
}

export function setStoredSessionId(id: string | null): void {
  try {
    if (id && id.trim()) {
      localStorage.setItem(SESSION_ID_KEY, id.trim());
    } else {
      localStorage.removeItem(SESSION_ID_KEY);
    }
  } catch {
    /* storage may be unavailable (private mode) — fail silently */
  }
}

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