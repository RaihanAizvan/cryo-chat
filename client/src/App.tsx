import { useEffect, useRef } from "react";
import { useChatRoom } from "./hooks/useChatRoom";
import { LandingScreen } from "./components/landing/LandingScreen";
import { ChatRoom } from "./components/chat/ChatRoom";
import { Modal } from "./components/ui/Modal";
import { IconAlertTriangle } from "./components/ui/Icon";
import { AdminApp } from "./admin/AdminApp";

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
  // The /admin route renders the admin console instead of the chat app.
  return window.location.pathname.startsWith("/admin") ? <AdminRoute /> : <ChatApp />;
}

function AdminRoute() {
  return (
    <div className="mx-auto min-h-full bg-base text-ink">
      <AdminApp />
    </div>
  );
}

function ChatApp() {
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

      {/* Alert shown when the room the user was in gets closed or expires. */}
      {state.alert && (
        <Modal onClose={actions.dismissAlert} title="Room alert">
          <div className="flex flex-col items-center gap-2 px-2 pb-1 pt-3 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/15 text-rose-400">
              <IconAlertTriangle width={24} height={24} />
            </span>
            <h2 className="text-lg font-semibold tracking-tight text-ink">
              {state.alert.title}
            </h2>
            <p className="text-sm leading-relaxed text-ink-muted">
              {state.alert.message}
            </p>
            <button
              onClick={actions.dismissAlert}
              autoFocus
              className="mt-4 w-full rounded-2xl bg-accent py-3 text-[15px] font-semibold text-white transition-transform active:scale-[0.99]"
            >
              Got it
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
