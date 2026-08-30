import { useEffect, useState } from "react";

/**
 * Returns the current time (epoch ms), re-rendering on the given interval.
 * Used for live countdowns and "time ago" labels that should feel alive.
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return now;
}
