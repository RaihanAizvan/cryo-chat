import { useCallback, useState } from "react";
import type { AdminMessage, AdminRoomDetail, AdminRoomSummary } from "@cryo/shared";
import { avatarColor } from "@cryo/shared";
import { adminApi } from "../adminApi";
import { Badge, Card, CardHeader, DangerButton, EmptyState, ErrorBanner, Pagination, Spinner } from "../components";
import { usePoll } from "../usePoll";
import { usePagination } from "../usePagination";
import { fmtDuration, fmtExpiry, fmtNum, fmtTime, shortId } from "../format";
import { IconBack, IconRefresh } from "../../components/ui/Icon";

const POLL = 5000;

const KIND_LABEL: Record<string, string> = {
  system: "system",
  image: "image",
  gif: "gif",
  sticker: "sticker",
  voice: "voice",
};

export function AdminRoomDetail({ roomId, onBack }: { roomId: string; onBack: () => void }) {
  const room = usePoll<AdminRoomDetail | null>(
    useCallback(async () => {
      try {
        return await adminApi.room(roomId);
      } catch {
        return null;
      }
    }, [roomId]),
    POLL,
  );
  const messages = usePoll<AdminMessage[]>(
    useCallback(() => adminApi.roomMessages(roomId), [roomId]),
    POLL,
  );
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [flash, setFlash] = useState<string | null>(null);

  const messagePager = usePagination(messages.data ?? [], 200, roomId);
  const memberPager = usePagination(
    (room.data?.participants as AdminRoomDetail["participants"] | undefined) ?? [],
    50,
    roomId,
  );

  const working = (key: string) => busy[key] === true;

  const run = async (key: string, fn: () => Promise<unknown>, okMessage: string) => {
    setBusy((b) => ({ ...b, [key]: true }));
    try {
      await fn();
      setFlash(okMessage);
      room.reload();
      messages.reload();
      window.setTimeout(() => setFlash(null), 2500);
    } finally {
      setBusy((b) => ({ ...b, [key]: false }));
    }
  };

  if (room.loading && !room.data) return <Spinner />;

  if (!room.data) {
    return (
      <div className="flex flex-col gap-3">
        <button
          onClick={onBack}
          className="flex w-fit items-center gap-1.5 text-sm text-ink-muted transition-colors hover:text-ink"
        >
          <IconBack width={16} height={16} />
          All rooms
        </button>
        <Card>
          <EmptyState label="This room is gone or expired." />
        </Card>
      </div>
    );
  }

  const r: AdminRoomSummary & { participants?: AdminRoomDetail["participants"] } = room.data;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 rounded-xl border border-base-border2 bg-base-raised px-2.5 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:text-ink"
          >
            <IconBack width={14} height={14} />
            Rooms
          </button>
          <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-ink">
            {r.code}
            {r.persistent && <Badge tone="accent">reserved</Badge>}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {flash && (
            <span className="text-xs text-emerald-400" aria-live="polite">
              {flash}
            </span>
          )}
          <button
            onClick={() => {
              room.reload();
              messages.reload();
            }}
            className="flex items-center gap-1.5 rounded-xl border border-base-border2 bg-base-raised px-3 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:text-ink"
          >
            <IconRefresh width={13} height={13} />
            Refresh
          </button>
        </div>
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-ink-faint">Id</div>
            <div className="mt-0.5 font-mono text-xs text-ink-muted">{shortId(r.id)}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-ink-faint">Created</div>
            <div className="mt-0.5 tabular-nums text-ink-muted">{fmtTime(r.createdAt)}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-ink-faint">Expires</div>
            <div className="mt-0.5 tabular-nums text-ink-muted">
              {r.persistent ? "never" : fmtExpiry(r.expiresAt)}
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-ink-faint">Life</div>
            <div className="mt-0.5 tabular-nums text-ink-muted">
              {r.participantCount} member{r.participantCount === 1 ? "" : "s"} ·{" "}
              {fmtNum(r.messageCount)} msgs
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 border-t border-base-border pt-3">
          <DangerButton
            label="Clear messages"
            busyLabel="Clearing…"
            confirmLabel="Clear?"
            busy={working("clear")}
            onConfirm={() => run("clear", () => adminApi.clearRoom(roomId), "Room cleared")}
          />
          <DangerButton
            label="Close room"
            busyLabel="Closing…"
            confirmLabel="Close?"
            busy={working("close")}
            onConfirm={() => run("close", () => adminApi.closeRoom(roomId), "Room closed · kicked everyone")}
          />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Members"
          subtitle="kick removes · ban blocks re-entry · unban restores"
          right={
            <span className="text-xs tabular-nums text-ink-faint">
              {r.participantCount} online
            </span>
          }
        />
        {room.error ? (
          <div className="p-4">
            <ErrorBanner message={room.error} onRetry={room.reload} />
          </div>
        ) : (r.participants ?? []).length === 0 ? (
          <EmptyState label="No members right now." />
        ) : (
          <>
            <div className="max-h-[280px] divide-y divide-base-border overflow-y-auto px-2">
              {memberPager.slice.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between gap-3 px-2 py-2.5"
                >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-[#0a0a0c]"
                    style={{ backgroundColor: avatarColor(p.color) }}
                  >
                    {p.name.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium" style={{ color: avatarColor(p.color) }}>
                      {p.name}
                    </div>
                    <div className="truncate font-mono text-[11px] text-ink-faint">
                      {shortId(p.id)} · joined {fmtTime(p.joinedAt)}
                    </div>
                  </div>
                  <span className="ml-1 flex shrink-0 gap-1">
                    {p.id === r.hostId && <Badge tone="accent">host</Badge>}
                    {p.banned ? <Badge tone="rose">banned</Badge> : <Badge tone="green">in room</Badge>}
                  </span>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  {p.banned ? (
                    <button
                      onClick={() =>
                        void run(
                          `unban:${p.id}`,
                          () => adminApi.unbanUser(p.id),
                          "Identity unbanned",
                        )
                      }
                      disabled={working(`unban:${p.id}`)}
                      className="rounded-lg border border-emerald-500/30 px-2 py-1 text-[11px] font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/10 disabled:opacity-50"
                    >
                      {working(`unban:${p.id}`) ? "Unbanning…" : "Unban"}
                    </button>
                  ) : (
                    <>
                      <DangerButton
                        label="Kick"
                        busyLabel="Kicking…"
                        confirmLabel="Kick?"
                        busy={working(`kick:${p.id}`)}
                        onConfirm={() =>
                          run(`kick:${p.id}`, () => adminApi.kick(roomId, p.id), "Member kicked")
                        }
                      />
                      <DangerButton
                        label="Kick + ban"
                        busyLabel="Banning…"
                        confirmLabel="Ban?"
                        busy={working(`ban:${p.id}`)}
                        onConfirm={() =>
                          run(
                            `ban:${p.id}`,
                            () => adminApi.kick(roomId, p.id, true),
                            "Member kicked and identity banned",
                          )
                        }
                      />
                    </>
                  )}
                </div>
              </div>
            ))}
            </div>
            <Pagination
              page={memberPager.page}
              pageCount={memberPager.pageCount}
              total={memberPager.total}
              pageSize={50}
              onPage={memberPager.setPage}
            />
          </>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Message log"
          subtitle="newest last · contents of what was sent"
          right={
            <span className="text-xs tabular-nums text-ink-faint">
              {messages.data ? messages.data.length : "…"} messages
            </span>
          }
        />
        {messages.loading && !messages.data ? (
          <Spinner label="Loading log…" />
        ) : messages.error ? (
          <div className="p-4">
            <ErrorBanner message={messages.error} onRetry={messages.reload} />
          </div>
        ) : (messages.data ?? []).length === 0 ? (
          <EmptyState label="No messages in this room." />
        ) : (
          <>
            <div className="divide-y divide-base-border px-2">
              {messagePager.slice.map((m) => (
                <div key={m.id} className="flex gap-3 px-2 py-2.5">
                  <div className="mt-0.5 shrink-0 text-[11px] tabular-nums text-ink-faint">
                    {fmtTime(m.sentAt)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-medium" style={{ color: avatarColor(m.color) }}>
                        {m.name}
                      </span>
                      <Badge tone="faint" className="capitalize">
                        {m.kind === "system" ? "system" : (KIND_LABEL[m.attachmentType ?? ""] ?? "text")}
                      </Badge>
                    </div>
                    {m.attachmentType ? (
                      <div className="mt-0.5 text-sm text-ink-muted">
                        {m.attachmentType === "voice"
                          ? `Voice note${m.attachmentDuration ? ` · ${fmtDuration(m.attachmentDuration)}` : ""}`
                          : `${m.attachmentName ?? m.attachmentType ?? "Attachment"}`}
                        {m.text && <span className="text-ink-faint"> — {m.text}</span>}
                      </div>
                    ) : (
                      <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-ink">
                        {m.text}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <Pagination
              page={messagePager.page}
              pageCount={messagePager.pageCount}
              total={messagePager.total}
              pageSize={200}
              onPage={messagePager.setPage}
            />
          </>
        )}
      </Card>
    </div>
  );
}