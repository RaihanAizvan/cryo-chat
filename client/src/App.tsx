import { useEffect, useRef } from "react";
import { useChatRoom } from "./hooks/useChatRoom";
import { LandingScreen } from "./components/landing/LandingScreen";
import { ChatRoom } from "./components/chat/ChatRoom";

/** Pull an optional room id from the /r/:id deep-link. */
function deepLinkRoomId(): string | null {
  const m = window.location.pathname.match(/^\/r\/([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

export function App() {
  const [state, actions] = useChatRoom();
  const autoJoined = useRef(false);

  // Auto-join room when arriving via a shared link.
  useEffect(() => {
    if (autoJoined.current) return;
    const roomId = deepLinkRoomId();
    if (roomId) {
      autoJoined.current = true;
      // Give the socket a moment to handshake before joining.
      const t = window.setTimeout(() => actions.joinRoom(roomId), 120);
      return () => window.clearTimeout(t);
    }
    autoJoined.current = true;
  }, [actions.joinRoom]);

  return (
    <div className="mx-auto flex h-full flex-col overflow-y-auto md:max-w-3xl">
      {state.room ? (
        <ChatRoom state={state} actions={actions} />
      ) : (
        <LandingScreen state={state} actions={actions} />
      )}
    </div>
  );
}
