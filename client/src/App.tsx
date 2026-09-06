import { useEffect, useRef } from "react";
import { useChatRoom } from "./hooks/useChatRoom";
import { LandingScreen } from "./components/landing/LandingScreen";
import { ChatRoom } from "./components/chat/ChatRoom";

/**
 * Pull a room target from the URL:
 *  - /r/:id  -> a full room id (shared link)
 *  - /<code> -> a 4-digit numeric join code, e.g. /9999 for the special room
 */
function deepLinkTarget(): { code: string } | { roomId: string } | null {
  const r = window.location.pathname.match(/^\/r\/([A-Za-z0-9]+)/);
  if (r) return { roomId: r[1] };
  const code = window.location.pathname.match(/^\/(\d{4})$/);
  if (code) return { code: code[1] };
  return null;
}

export function App() {
  const [state, actions] = useChatRoom();
  const autoJoined = useRef(false);

  // Auto-join room when arriving via a shared link or the special code URL.
  useEffect(() => {
    if (autoJoined.current) return;
    const target = deepLinkTarget();
    if (target) {
      autoJoined.current = true;
      // Give the socket a moment to handshake before joining.
      const t = window.setTimeout(
        () => actions.joinRoom("roomId" in target ? target.roomId : target.code),
        120,
      );
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
