import { useEffect, useRef } from "react";
import type { RoomRef, RoomStatus } from "@cryo/shared";
import { socket } from "../lib/store";
import { useRoomHistory, applyRoomStatus } from "../lib/roomHistory";

const POLL_MS = 15_000;

/**
 * Keeps the home screen honest. Polls the server every ~15s for the current
 * status of every saved room (open/closed/expired + live participant counts)
 * while connected, so a just-closed lobby stops showing "Active" and the
 * number of people in a room stays accurate and dynamic.
 */
export function useRoomStatusPoller(): void {
  const history = useRoomHistory();
  const refsRef = useRef<RoomRef[]>([]);

  useEffect(() => {
    refsRef.current = history.map((e) => ({ code: e.code, roomId: e.id }));
  }, [history]);

  useEffect(() => {
    const onResult = (data: { statuses: RoomStatus[] }) => {
      if (Array.isArray(data?.statuses)) applyRoomStatus(data.statuses);
    };
    socket.on("room:status:result", onResult);

    const poll = () => {
      if (!socket.connected) return;
      const refs = refsRef.current.slice(0, 30);
      if (refs.length === 0) return;
      socket.emit("room:status", { refs });
    };
    poll();
    const id = setInterval(poll, POLL_MS);

    return () => {
      socket.off("room:status:result", onResult);
      clearInterval(id);
    };
  }, []);
}