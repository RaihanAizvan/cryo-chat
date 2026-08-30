import { useSyncExternalStore } from "react";

/**
 * Tracks the amount of the layout viewport obscured by the on-screen keyboard
 * on mobile, using the Visual Viewport API. Returns the inset in px (0 when no
 * keyboard is open). Also tracks the visual viewport height so the composer can
 * size itself above the keyboard without layout jumps.
 *
 * The snapshot is cached at module scope (published on each read) so that
 * useSyncExternalStore always receives a reference-stable value between actual
 * changes. Returning a fresh object on every read would re-render forever.
 */

interface KeyboardState {
  inset: number;
  viewportHeight: number;
}

let cached: KeyboardState = { inset: 0, viewportHeight: 0 };

const readVvp = (): KeyboardState => {
  if (typeof window === "undefined" || !window.visualViewport) {
    const vh = window?.innerHeight ?? 0;
    if (cached.viewportHeight !== vh || cached.inset !== 0) {
      cached = { inset: 0, viewportHeight: vh };
    }
    return cached;
  }
  const vv = window.visualViewport;
  const layoutHeight = window.innerHeight;
  const inset = Math.max(0, layoutHeight - (vv.height + (vv.offsetTop || 0)));
  const viewportHeight = vv.height;
  if (cached.inset !== inset || cached.viewportHeight !== viewportHeight) {
    cached = { inset, viewportHeight };
  }
  return cached;
};

const subscribe = (cb: () => void): (() => void) => {
  const vv = window.visualViewport;
  if (!vv) {
    window.addEventListener("resize", cb);
    return () => window.removeEventListener("resize", cb);
  }
  vv.addEventListener("resize", cb);
  vv.addEventListener("scroll", cb);
  return () => {
    vv.removeEventListener("resize", cb);
    vv.removeEventListener("scroll", cb);
  };
};

export function useKeyboardInset(): KeyboardState {
  return useSyncExternalStore(
    subscribe,
    readVvp,
    () => cached,
  );
}

/** True on coarse-pointer (touch) devices — used to pick Enter behavior. */
export function useCoarsePointer(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(pointer: coarse)").matches
  );
}
