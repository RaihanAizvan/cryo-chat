import type { MessageReply, PublicMessage } from "@cryo/shared";

/**
 * Build a client-side `MessageReply` snapshot from a message already on screen.
 * Used for the optimistic bubble so the quote renders instantly; the server
 * resolves its own canonical version when it processes the send.
 */
export function replySnapshot(m: PublicMessage): MessageReply {
  const reply: MessageReply = {
    messageId: m.id,
    participantId: m.participantId,
    name: m.name,
    text: m.text ?? "",
    viewOnce: Boolean(m.attachment?.viewOnce),
  };
  if (m.attachment && !m.attachment.viewOnce) {
    reply.attachment = {
      type: m.attachment.type,
      mediaId: m.attachment.mediaId,
      name: m.attachment.name,
    };
  }
  return reply;
}