/**
 * Shareable URL for a room. Persistent rooms are best shared by their stable
 * code URL (/9999), which keeps working even after the room has been closed
 * and recreated; ephemeral rooms use a fresh invite link (/r/<id>).
 */
export function roomShareLink(room: {
  id: string;
  code: string;
  persistent: boolean;
}): string {
  const base = window.location.origin;
  return room.persistent ? `${base}/${room.code}` : `${base}/r/${room.id}`;
}