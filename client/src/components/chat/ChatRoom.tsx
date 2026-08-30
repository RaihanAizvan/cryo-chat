import { useCallback, useState } from "react";
import type { RoomState, RoomActions } from "../../hooks/useChatRoom";
import { useSession } from "../../lib/store";
import { useKeyboardInset } from "../../hooks/useKeyboardInset";
import { ChatHeader } from "./ChatHeader";
import { MessageList } from "./MessageList";
import { MessageComposer } from "./MessageComposer";
import { ShareRoom } from "./ShareRoom";

interface Props {
  state: RoomState;
  actions: RoomActions;
}

const COMPOSER_MIN_HEIGHT = 66;

export function ChatRoom({ state, actions }: Props) {
  const session = useSession();
  const { room, messages, participants, notice } = state;
  const { inset } = useKeyboardInset();
  const [composerHeight, setComposerHeight] = useState(COMPOSER_MIN_HEIGHT);

  const onHeightChange = useCallback((h: number) => setComposerHeight(h), []);

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
        notice={notice}
        onBack={actions.leaveRoom}
        onLeave={actions.leaveRoom}
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
          <MessageList messages={messages} selfId={selfId} bottomInset={bottomInset} />
        )}
      </div>

      <MessageComposer onSend={actions.sendMessage} onHeightChange={onHeightChange} />
    </div>
  );
}
