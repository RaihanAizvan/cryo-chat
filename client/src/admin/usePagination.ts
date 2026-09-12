import { useEffect, useMemo, useState } from "react";

/**
 * Client-side pagination for admin list views.
 *
 * Returns a page-sized slice plus nav helpers. The page is reset to 0 whenever
 * `resetKey` changes (e.g. a filter/search string), and clamped if the source
 * list shrinks below the current page (e.g. after a poll).
 */
export function usePagination<T>(
  items: readonly T[] | T[],
  pageSize: number,
  resetKey: unknown = "",
): {
  page: number;
  pageCount: number;
  total: number;
  slice: T[];
  setPage: (p: number) => void;
} {
  const [page, setPage] = useState(0);

  useEffect(() => {
    setPage(0);
  }, [resetKey]);

  const pageCount = useMemo(() => Math.max(1, Math.ceil(items.length / pageSize)), [items, pageSize]);
  const safe = Math.min(page, pageCount - 1);

  const slice = useMemo(
    () => (items as T[]).slice(safe * pageSize, (safe + 1) * pageSize),
    [items, safe, pageSize],
  );

  return { page: safe, pageCount, total: items.length, slice, setPage };
}