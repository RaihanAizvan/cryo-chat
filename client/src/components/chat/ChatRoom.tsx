import { useCallback, useEffect, useState } from "react";
import type { PublicMessage } from "@cryo/shared";
import type { RoomState, RoomActions } from "../../hooks/useChatRoom";
import { useSession } from "../../lib/store";
import { useKeyboardInset } from "../../hooks/useKeyboardInset";
import { ChatHeader } from "./ChatHeader";
import { MessageList } from "./MessageList";
import { MessageComposer } from "./MessageComposer";
import type { MessageAttachment } from "@cryo/shared";
import { ShareRoom } from "./ShareRoom";

interface Props {
  state: RoomState;
  actions: RoomActions;
}

const COMPOSER_MIN_HEIGHT = 66;

export function ChatRoom({ state, actions }: Props) {
  const session = useSession();
  const { room, messages, participants, notice, typingParticipants, seenBy } = state;
  const { inset } = useKeyboardInset();
  const [composerHeight, setComposerHeight] = useState(COMPOSER_MIN_HEIGHT);
  const [replyTarget, setReplyTarget] = useState<PublicMessage | null>(null);

  const onHeightChange = useCallback((h: number) => setComposerHeight(h), []);

  const onSend = useCallback(
    (text: string, attachment?: MessageAttachment, replyTo?: PublicMessage) => {
      actions.sendMessage(text, attachment, replyTo);
      setReplyTarget(null);
    },
    [actions],
  );

  // Read receipts: whenever the room's last message changes, tell everyone
  // how far I've read. This keeps "seen" stable across leave/rejoin — the
  // server remembers my position per participant.
  useEffect(() => {
    if (!room || messages.length === 0) return;
    actions.sendSeen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.id, messages[messages.length - 1]?.id]);

  if (!room) return null;

  const selfId = session.sessionId;
  // Reserve space above the fixed composer: its top edge sits above the
  // keyboard inset and safe area, at the composer's rendered height.
  const topOfComposer = inset + composerHeight;
  const bottomInset = topOfComposer;

  return (
    <div className="flex h-full flex-col">
      <ChatHeader
        room={room}
        participantCount={participants.length}
        participants={participants}
        selfId={selfId}
        notice={notice}
        typing={typingParticipants.length > 0 ? typingParticipants : null}
        onBack={actions.leaveRoom}
        onLeave={actions.leaveRoom}
        onClose={actions.closeRoom}
        onClearChat={actions.clearChat}
        onRenameParticipant={actions.renameParticipant}
      />

      <div className="flex-1 overflow-hidden">
        {messages.length === 0 ? (
          <div
            className="no-scrollbar h-full overflow-y-auto"
            style={{ paddingBottom: bottomInset }}
          >
            <ShareRoom room={room} participants={participants} selfId={selfId} />
          </div>
        ) : (
          <MessageList
            messages={messages}
            selfId={selfId}
            otherIds={participants.filter((p) => p.id !== selfId).map((p) => p.id)}
            seenBy={seenBy}
            bottomInset={bottomInset}
            onReply={setReplyTarget}
          />
        )}
      </div>

      <MessageComposer
        onSend={onSend}
        onHeightChange={onHeightChange}
        onTyping={actions.sendTyping}
        replyTarget={replyTarget}
        onCancelReply={() => setReplyTarget(null)}
      />
    </div>
  );
}
