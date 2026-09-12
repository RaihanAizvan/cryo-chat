/**
 * Typed client for the /admin API. The admin key lives in sessionStorage so it
 * survives soft reloads but is wiped when the tab closes.
 */

import type {
  AdminAnalytics,
  AdminAuditEvent,
  AdminAuditKind,
  AdminRoomDetail,
  AdminRoomSummary,
  AdminSettings,
  AdminSettingsPatch,
  AdminStats,
  AdminUser,
} from "@cryo/shared";

const KEY_STORE = "cryo_admin_key";

const serverUrl = (import.meta.env.VITE_SERVER_URL as string | undefined)?.trim() ?? "";

export type AdminErrorKind = "unauthorized" | "disabled" | "http" | "network";

export class AdminApiError extends Error {
  constructor(
    message: string,
    public readonly kind: AdminErrorKind,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "AdminApiError";
  }
}

export function getAdminKey(): string {
  try {
    return sessionStorage.getItem(KEY_STORE) ?? "";
  } catch {
    return "";
  }
}

export function setAdminKey(key: string): void {
  try {
    sessionStorage.setItem(KEY_STORE, key);
  } catch {
    /* private mode */
  }
}

export function clearAdminKey(): void {
  try {
    sessionStorage.removeItem(KEY_STORE);
  } catch {
    /* private mode */
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const key = getAdminKey();
  const headers: Record<string, string> = {
    "x-admin-key": key,
    ...(init.body ? { "content-type": "application/json" } : {}),
  };
  let res: Response;
  try {
    res = await fetch(`${serverUrl}/admin${path}`, {
      ...init,
      headers: { ...headers, ...(init.headers as Record<string, string>) },
    });
  } catch {
    throw new AdminApiError("Can't reach the server.", "network");
  }
  if (res.status === 401) throw new AdminApiError("Wrong admin key.", "unauthorized");
  if (res.status === 503) {
    throw new AdminApiError("Admin console is disabled (set ADMIN_KEY on the server).", "disabled");
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new AdminApiError(body.error ?? `Request failed (${res.status}).`, "http", res.status);
  }
  return (await res.json()) as T;
}

export const adminApi = {
  ping: () => request<{ ok: boolean }>("/stats").then(() => true),

  stats: () => request<AdminStats>("/stats"),

  rooms: () => request<{ rooms: AdminRoomSummary[] }>("/rooms").then((r) => r.rooms),

  room: (id: string) =>
    request<{ room: AdminRoomDetail }>(`/rooms/${encodeURIComponent(id)}`).then((r) => r.room),

  roomMessages: (id: string) =>
    request<{ messages: AdminRoomDetail["messages"] }>(
      `/rooms/${encodeURIComponent(id)}/messages`,
    ).then((r) => r.messages),

  kick: (roomId: string, participantId: string, ban?: boolean, reason?: string) =>
    request<{ ok: boolean; banned: boolean; participantId: string }>(
      `/rooms/${encodeURIComponent(roomId)}/kick`,
      {
        method: "POST",
        body: JSON.stringify({ participantId, ban: Boolean(ban), reason }),
      },
    ),

  clearRoom: (roomId: string) =>
    request<{ ok: boolean }>(`/rooms/${encodeURIComponent(roomId)}/clear`, { method: "POST" }),

  closeRoom: (roomId: string) =>
    request<{ ok: boolean }>(`/rooms/${encodeURIComponent(roomId)}/close`, { method: "POST" }),

  users: () => request<{ users: AdminUser[] }>("/users").then((r) => r.users),

  banUser: (sessionId: string) =>
    request<{ ok: boolean }>(`/users/${encodeURIComponent(sessionId)}/ban`, { method: "POST" }),

  unbanUser: (sessionId: string) =>
    request<{ ok: boolean }>(`/users/${encodeURIComponent(sessionId)}/unban`, { method: "POST" }),

  purgeUser: (sessionId: string) =>
    request<{ ok: boolean }>(`/users/${encodeURIComponent(sessionId)}`, { method: "DELETE" }),

  audit: (opts: { kinds?: AdminAuditKind[]; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (opts.kinds?.length) params.set("kind", opts.kinds.join(","));
    if (opts.limit) params.set("limit", String(opts.limit));
    const qs = params.toString();
    return request<{ events: AdminAuditEvent[] }>(`/audit${qs ? `?${qs}` : ""}`).then(
      (r) => r.events,
    );
  },

  analytics: () => request<AdminAnalytics>("/analytics"),

  settings: () => request<{ settings: AdminSettings }>("/settings").then((r) => r.settings),

  updateSettings: (patch: AdminSettingsPatch) =>
    request<{ settings: AdminSettings }>("/settings", {
      method: "PUT",
      body: JSON.stringify(patch),
    }).then((r) => r.settings),
};