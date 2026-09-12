import { useEffect, useState } from "react";

/**
 * Poll a fetcher on an interval. Returns { data, error, loading, reload }.
 * `error` carries a message; request errors are normalized to strings.
 */
export function usePoll<T>(fetcher: () => Promise<T>, intervalMs: number): {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetcher()
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Request failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetcher, tick]);

  useEffect(() => {
    if (intervalMs <= 0) return;
    const id = window.setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);

  const reload = () => setTick((t) => t + 1);
  return { data, error, loading, reload };
}