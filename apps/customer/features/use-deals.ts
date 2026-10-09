'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from '@dealdash/app-shell';
import type { DealCard } from '@dealdash/validation';

type Query = Record<string, string | number | undefined | null>;

/** Paged list of deal cards from a customer API list route (cursor paging, "show more", retry). */
export function useDealList<T extends { id: string } = DealCard>(
  path: string,
  query: Query,
  enabled = true,
) {
  const { call } = useApi();
  const [items, setItems] = useState<T[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const seq = useRef(0);
  const key = JSON.stringify(query);

  const load = useCallback(async () => {
    if (!enabled) return;
    const mine = ++seq.current;
    setLoading(true);
    setFailed(false);
    const res = await call<T[]>('GET', path, { query: JSON.parse(key) as Query });
    if (mine !== seq.current) return;
    setLoading(false);
    if (!res.ok) {
      setFailed(true);
      return;
    }
    setItems(res.data ?? []);
    setNext(res.nextCursor);
  }, [call, path, key, enabled]);

  useEffect(() => {
    void load();
  }, [load]);

  const more = useCallback(async () => {
    if (!next) return;
    setLoadingMore(true);
    const res = await call<T[]>('GET', path, {
      query: { ...(JSON.parse(key) as Query), cursor: next },
    });
    setLoadingMore(false);
    if (res.ok) {
      setItems((cur) => [
        ...cur,
        ...(res.data ?? []).filter((d) => !cur.some((c) => c.id === d.id)),
      ]);
      setNext(res.nextCursor);
    }
  }, [call, path, key, next]);

  const patch = useCallback(
    (deal: T) => setItems((cur) => cur.map((d) => (d.id === deal.id ? deal : d))),
    [],
  );
  return { items, hasMore: !!next, loading, loadingMore, failed, reload: load, more, patch };
}
