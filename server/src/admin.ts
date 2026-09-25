/**
 * Admin console API.
 *
 * All routes live under /admin and require the shared admin key (env
 * ADMIN_KEY) sent as the `X-Admin-Key` header. The console reads the same
 * in-memory stores as the app — it is a live view, not a separate backend.
 */

import { timingSafeEqual } from "node:crypto";
import express, { Router, type Express, type Request, type Response } from "express";
import type { Server } from "socket.io";
import type {
  AdminAuditKind,
  AdminRoomDetail,
  AdminRoomSummary,
  AdminSettings,
  AdminSettingsPatch,
  AdminStats,
  AdminUser,
} from "@cryo/shared";
import { config } from "./config.js";
import * as rooms from "./rooms.js";
import * as media from "./media.js";
import * as sessions from "./sessions.js";
import * as audit from "./audit.js";
import * as bans from "./bans.js";
import { getSettings, updateSettings } from "./settings.js";
import { adminRemoveMember, closeRoom } from "./handlers.js";
import * as pack from "./pack.js";

const bootAt = Date.now();

// ---------------------------------------------------------------------------
// Admin key guard
// ---------------------------------------------------------------------------

function anyEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

function adminAuth(req: Request, res: Response, next: () => void): void {
  // The admin SPA shell itself (GET /admin) is served by the static mount that
  // runs after this router — let it through so the app (and its login screen)
  // can load; only the API under /admin requires the key.
  if (req.method === "GET" && (req.path === "/" || req.path === "")) {
    next();
    return;
  }
  if (!config.adminKey) {
    res.status(503).json({ error: "admin_disabled", message: "Set ADMIN_KEY in the server environment to enable the admin console." });
    return;
  }
  const key = req.headers["x-admin-key"];
  if (typeof key !== "string" || !anyEq(key, config.adminKey)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}

// ---------------------------------------------------------------------------
// Serializers
// ---------------------------------------------------------------------------

function roomSummary(r: rooms.Room): AdminRoomSummary {
  return {
    id: r.id,
    code: r.code,
    createdAt: r.createdAt,
    expiresAt: r.persistent ? Number.MAX_SAFE_INTEGER : r.expiresAt,
    persistent: r.persistent,
    hostId: r.hostParticipantId,
    participantCount: r.participants.size,
    messageCount: r.messages.length,
  };
}

function roomDetail(r: rooms.Room): AdminRoomDetail {
  return {
    ...roomSummary(r),
    participants: [...r.participants.values()].map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      joinedAt: p.joinedAt,
      status: "online" as const,
      lastSeenMessageId: p.lastSeenMessageId,
      banned: bans.isBanned(p.id),
    })),
    messages: r.messages.map((m) => ({
      id: m.id,
      participantId: m.participantId,
      name: m.name,
      color: m.color,
      sentAt: m.sentAt,
      kind: m.kind,
      text: m.text,
      attachmentType: m.attachment?.type,
      attachmentName: m.attachment?.name,
      attachmentDuration: m.attachment?.duration,
    })),
  };
}

/** Cluster-wide live rooms (admin views read the shared store, not this
 *  instance's cache only). */
async function liveRoomsCluster(): Promise<rooms.Room[]> {
  return rooms.loadAllRoomsFromStore();
}

function onlineFor(r: rooms.Room, io: Server): number {
  let n = 0;
  for (const sid of r.sockets.keys()) {
    if (io.sockets.sockets.has(sid)) n += 1;
  }
  return n;
}

/** Resolve a session's current room (if any) from live room memberships. */
function liveRoomFor(
  sessionId: string,
  live: rooms.Room[],
): { roomId: string; roomCode: string } | undefined {
  for (const r of live) {
    if (r.participants.has(sessionId)) return { roomId: r.id, roomCode: r.code };
  }
  return undefined;
}

function usersView(live: rooms.Room[]): AdminUser[] {
  const out: AdminUser[] = [];
  for (const s of sessions.allIdentities()) {
    const activity = audit.userStats(s.id);
    const loc = liveRoomFor(s.id, live);
    out.push({
      sessionId: s.id,
      name: s.name,
      color: s.color,
      createdAt: s.createdAt,
      online: Boolean(loc),
      roomId: loc?.roomId,
      roomCode: loc?.roomCode,
      banned: bans.isBanned(s.id),
      messages: activity.messages,
      uploads: activity.uploads,
      lastActiveAt: activity.lastActiveAt,
    });
  }
  return out.sort((a, b) => (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0));
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

/** Mount the admin API on an Express app. */
export function mountAdminRoutes(app: Express, io: Server): void {
  const router = Router();
  router.use(express.json({ limit: "64kb" }));

  // -- stats ---------------------------------------------------------------
  router.get("/stats", async (_req, res) => {
    const lr = await liveRoomsCluster();
    const ms = media.mediaStats();
    const t = audit.totals();
    const online = lr.reduce((acc, r) => acc + onlineFor(r, io), 0);
    const participants = lr.reduce((acc, r) => acc + r.participants.size, 0);
    const stats: AdminStats = {
      liveRooms: lr.length,
      onlineParticipants: online,
      totalParticipants: participants,
      totalSessions: sessions.allIdentities().length,
      totalMessages: t.messages,
      totalUploads: t.uploads,
      mediaBytes: ms.inMemoryBytes,
      mediaFiles: ms.inMemoryFiles + ms.remoteFiles,
      bannedSessions: bans.bannedCount(),
      uptimeSeconds: Math.floor((Date.now() - bootAt) / 1000),
      memoryMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
    };
    res.json(stats);
  });

  // -- rooms ---------------------------------------------------------------
  router.get("/rooms", async (_req, res) => {
    const sum = (await liveRoomsCluster()).map((r) => roomSummary(r));
    sum.sort((a, b) => b.createdAt - a.createdAt);
    res.json({ rooms: sum });
  });

  router.get("/rooms/:id", async (req, res) => {
    const r = await rooms.loadRoomFromStore(req.params.id);
    if (!r || rooms.isExpired(r)) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({ room: roomDetail(r) });
  });

  // Full message log for a room (export).
  router.get("/rooms/:id/messages", async (req, res) => {
    const r = await rooms.loadRoomFromStore(req.params.id);
    if (!r || rooms.isExpired(r)) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({ messages: roomDetail(r).messages });
  });

  // Kick a member (optionally ban by session id).
  router.post("/rooms/:id/kick", async (req, res) => {
    const r = await rooms.loadRoomFromStore(req.params.id);
    if (!r || rooms.isExpired(r)) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const body = (req.body ?? {}) as { participantId?: unknown; ban?: unknown; reason?: unknown };
    const pid = typeof body.participantId === "string" ? body.participantId : "";
    const reason = typeof body.reason === "string" ? body.reason.slice(0, 120) : undefined;
    if (!pid) {
      res.status(400).json({ error: "participantId is required" });
      return;
    }
    const removed = await adminRemoveMember(io, r, pid, reason);
    if (!removed) {
      res.status(404).json({ error: "member_not_found" });
      return;
    }
    if (body.ban === true && bans.ban(pid)) {
      audit.record({
        kind: "member:banned",
        message: `${removed.name} was banned from ${r.code}`,
        actor: "admin",
        sessionId: pid,
        roomId: r.id,
        roomCode: r.code,
      });
      // If they were in other rooms too, drop them everywhere.
      for (const other of await liveRoomsCluster()) {
        if (other.id !== r.id && other.participants.has(pid)) {
          await adminRemoveMember(io, other, pid, "banned");
        }
      }
      res.json({ ok: true, banned: true, participantId: pid });
      return;
    }
    res.json({ ok: true, banned: false, participantId: pid });
  });

  router.post("/rooms/:id/clear", async (req, res) => {
    const r = await rooms.loadRoomFromStore(req.params.id);
    if (!r || rooms.isExpired(r)) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    rooms.clearMessages(r);
    const system = rooms.addSystemMessage(r, "Chat cleared by admin");
    io.to(r.id).emit("message:cleared", {});
    io.to(r.id).emit("message:new", { message: system });
    audit.record({
      kind: "room:cleared",
      message: `Chat in ${r.code} cleared by admin`,
      actor: "admin",
      roomId: r.id,
      roomCode: r.code,
    });
    res.json({ ok: true });
  });

  router.post("/rooms/:id/close", async (req, res) => {
    const r = await rooms.loadRoomFromStore(req.params.id);
    if (!r || rooms.isExpired(r)) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    closeRoom(io, r);
    res.json({ ok: true });
  });

  // -- users ---------------------------------------------------------------
  router.get("/users", async (_req, res) => {
    res.json({ users: usersView(await liveRoomsCluster()) });
  });

  router.post("/users/:id/ban", async (req, res) => {
    const id = req.params.id;
    if (!bans.ban(id)) {
      res.status(409).json({ error: "already_banned" });
      return;
    }
    const session = sessions.identityById(id);
    audit.record({
      kind: "session:banned",
      message: `${session?.name ?? id} was banned`,
      actor: "admin",
      sessionId: id,
    });
    // Drop the session from every room it's in.
    for (const r of await liveRoomsCluster()) {
      if (r.participants.has(id)) await adminRemoveMember(io, r, id, "banned");
    }
    res.json({ ok: true, banned: true });
  });

  router.post("/users/:id/unban", (req, res) => {
    const id = req.params.id;
    if (!bans.unban(id)) {
      res.status(409).json({ error: "not_banned" });
      return;
    }
    audit.record({
      kind: "session:unbanned",
      message: `${sessions.identityById(id)?.name ?? id} was unbanned`,
      actor: "admin",
      sessionId: id,
    });
    res.json({ ok: true, banned: false });
  });

  // Purge an identity entirely (no resume, reflects the session store).
  router.delete("/users/:id", (req, res) => {
    const id = req.params.id;
    if (!sessions.deleteIdentity(id)) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    audit.record({
      kind: "session:banned",
      message: `Session ${id} was purged`,
      actor: "admin",
      sessionId: id,
    });
    res.json({ ok: true });
  });

  // -- audit ---------------------------------------------------------------
  router.get("/audit", (req, res) => {
    const kinds = typeof req.query.kind === "string" ? req.query.kind.split(",") : [];
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
    const since = Number(req.query.since) || undefined;
    const items = audit.query({
      kinds: kinds.length > 0 ? new Set(kinds as AdminAuditKind[]) : undefined,
      limit,
      since,
    });
    res.json({ events: items });
  });

  // -- analytics -----------------------------------------------------------
  router.get("/analytics", (_req, res) => {
    const buckets = audit.series();
    res.json({
      buckets,
      splits: audit.splitsTotals(),
      topRooms: audit.topRooms(10),
    });
  });

  // -- settings ------------------------------------------------------------
  router.get("/settings", (_req, res) => {
    res.json({ settings: settingsView() });
  });

  router.put("/settings", (req, res) => {
    const patch = (req.body ?? {}) as AdminSettingsPatch & Record<string, unknown>;
    const prev = getSettings();
    const result = updateSettings(patch);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    audit.record({
      kind: "settings:update",
      message: "Settings updated",
      actor: "admin",
      detail: JSON.stringify(patch),
    });
    // Push client-relevant feature flags to all connected apps so toggles
    // take effect without a page reload.
    const next = getSettings();
    if (prev.voiceNotesEnabled !== next.voiceNotesEnabled) {
      io.emit("settings:update", { voiceNotesEnabled: next.voiceNotesEnabled });
    }
    res.json({ settings: settingsView() });
  });

  // -- sticker pack --------------------------------------------------------
  router.get("/stickers", (_req, res) => {
    res.json({ enabled: pack.packEnabled(), count: pack.packSize() });
  });

  // Force a re-sync of the in-memory sticker pack from Cloudinary (or the
  // test seam) so stickers added in the dashboard appear immediately instead
  // of on the next interval tick. Reads never spend credits, so this is free.
  router.post("/stickers/sync", async (_req, res) => {
    if (!pack.packEnabled()) {
      res.status(404).json({
        error: "no_pack",
        message: "No sticker pack backend is configured (Cloudinary or STICKER_PACK_TEST_JSON).",
      });
      return;
    }
    const count = await pack.refreshStickerPack();
    audit.record({
      kind: "settings:update",
      message: `Sticker pack re-synced from the backend (${count} stickers)`,
      actor: "admin",
    });
    res.json({ enabled: true, count });
  });

  app.use("/admin", adminAuth, router);
}

function settingsView(): AdminSettings {
  const s = getSettings();
  return {
    maxMessageLength: s.maxMessageLength,
    maxRoomSize: s.maxRoomSize,
    roomTtlMinutes: Math.round(s.roomTtlMs / 60_000),
    messageTtlMinutes: Math.round(s.messageTtlMs / 60_000),
    messageCap: s.messageCap,
    maxSocketsPerIp: s.maxSocketsPerIp,
    messageRateLimit: s.messageRateLimit,
    messageRateWindowSeconds: Math.round(s.messageRateWindowMs / 1000),
    reservedRoomCode: s.reservedRoomCode,
    reservedRoomEnabled: s.reservedRoomEnabled,
    voiceNotesEnabled: s.voiceNotesEnabled,
    adminEnabled: Boolean(config.adminKey),
  };
}