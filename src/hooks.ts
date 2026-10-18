import { useCallback, useEffect, useRef, useState } from "react";

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

// Results are tagged with the inputs they were loaded for, so the render right after the inputs
// change never sees the previous request's data (e.g. the last episode's stream URL).
export function useAsync<T>(load: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [nonce, setNonce] = useState(0);
  const key = JSON.stringify([...deps, nonce]);
  const [state, setState] = useState<{ key: string | null; data: T | null; error: string | null; loading: boolean }>({
    key: null,
    data: null,
    error: null,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;
    load().then(
      (data) => !cancelled && setState({ key, data, error: null, loading: false }),
      (err: unknown) => !cancelled && setState({ key, data: null, error: String((err as Error)?.message ?? err), loading: false }),
    );
    return () => {
      cancelled = true;
    };
  }, [key]);

  const current = state.key === key;
  return {
    data: current ? state.data : null,
    error: current ? state.error : null,
    loading: !current || state.loading,
    reload: () => setNonce((n) => n + 1),
  };
}

// Page-numbered loading that matches the app's PagingSources: start at page 1,
// keep requesting page + 1 until a page comes back empty.
export function usePaged<T extends { id: number }>(loadPage: (page: number) => Promise<T[]>, deps: unknown[]) {
  const [items, setItems] = useState<T[]>([]);
  const [page, setPage] = useState(1);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const loadRef = useRef(loadPage);
  loadRef.current = loadPage;

  const fetchPage = useCallback((p: number, gen: number) => {
    setLoading(true);
    setError(null);
    loadRef.current(p).then(
      (next) => {
        if (gen !== generation.current) return;
        setItems((prev) => {
          const seen = new Set(prev.map((x) => x.id));
          return p === 1 ? next : [...prev, ...next.filter((x) => !seen.has(x.id))];
        });
        setPage(p + 1);
        setDone(next.length === 0);
        setLoading(false);
      },
      (err: unknown) => {
        if (gen !== generation.current) return;
        setError(String((err as Error)?.message ?? err));
        setLoading(false);
      },
    );
  }, []);

  const reset = useCallback(() => {
    const gen = ++generation.current;
    setItems([]);
    setPage(1);
    setDone(false);
    fetchPage(1, gen);
  }, [fetchPage]);

  useEffect(reset, deps);

  const loadMore = useCallback(() => {
    if (!loading && !done && !error) fetchPage(page, generation.current);
  }, [loading, done, error, page, fetchPage]);

  const retry = useCallback(() => {
    if (!loading) fetchPage(page, generation.current);
  }, [loading, page, fetchPage]);

  return { items, loading, done, error, loadMore, retry, reset };
}
