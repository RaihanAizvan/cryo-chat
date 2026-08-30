/**
 * Socket.IO singleton and lightweight external stores for connection/session
 * state. Uses useSyncExternalStore — no state-management library needed.
 */

import { useSyncExternalStore } from "react";
import { io, type Socket } from "socket.io-client";
import type { AvatarColor } from "@cryo/shared";
import { getStoredDisplayName } from "./prefs";

// When VITE_SERVER_URL is set (e.g. Vercel frontend + external backend), the
// client connects there; otherwise it falls back to the same-origin proxy.
const serverUrl = import.meta.env.VITE_SERVER_URL?.trim();
export const socket: Socket = io(serverUrl || "/", {
  autoConnect: false,
  path: "/socket.io",
});

export type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "disconnected";

type Listener = () => void;

class ExternalStore<T> {
  private value: T;
  private listeners = new Set<Listener>();

  constructor(initial: T) {
    this.value = initial;
  }

  get(): T {
    return this.value;
  }

  set(next: T): void {
    this.value = next;
    for (const l of this.listeners) l();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

interface SessionState {
  connected: boolean;
  sessionId: string | null;
  name: string | null;
  color: AvatarColor;
}

const connectionStatus = new ExternalStore<ConnectionStatus>("connecting");
const session = new ExternalStore<SessionState>({
  connected: socket.connected,
  sessionId: null,
  name: null,
  color: 0,
});

socket.on("connect", () => {
  connectionStatus.set("connected");
  session.set({ ...session.get(), connected: true });
});

socket.on("disconnect", () => {
  connectionStatus.set("disconnected");
  session.set({ ...session.get(), connected: false });
});

socket.on("connect_error", () => {
  if (!socket.connected) {
    connectionStatus.set("reconnecting");
  }
});

socket.on("reconnect_attempt", () => connectionStatus.set("reconnecting"));
socket.on("reconnect", () => connectionStatus.set("connected"));

socket.on("session:init", (data) => {
  session.set({
    connected: true,
    sessionId: data.sessionId,
    name: data.name,
    color: data.color,
  });
  connectionStatus.set("connected");

  // A display name the user saved earlier takes precedence over the random
  // one the server just assigned.
  const stored = getStoredDisplayName();
  if (stored) socket.emit("session:name", { name: stored });
});

socket.on("session:name:updated", (data) => {
  session.set({ ...session.get(), name: data.name });
});

function useStore<T>(store: ExternalStore<T>): T {
  const getSnapshot = store.get.bind(store);
  return useSyncExternalStore(store.subscribe.bind(store), getSnapshot, getSnapshot);
}

export function useConnectionStatus(): ConnectionStatus {
  return useStore(connectionStatus);
}

export function useSession(): SessionState {
  return useStore(session);
}

export function updateDisplayName(name: string): void {
  socket.emit("session:name", { name });
}

export function connectAndInit(): void {
  if (!socket.connected && !socket.active) {
    socket.connect();
  }
}
