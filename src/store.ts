import { useCallback, useEffect, useState } from 'preact/hooks';
import { APP, DATA } from './config';
import { fetchLiveRaw, normalizeCatalog } from './data/catalog';
import type { BuildsFile, Catalog, StatsSnapshot } from './data/types';
import { emptyDraft, type DraftState } from './engine/draft';

const key = (k: string) => `${APP.storagePrefix}:${k}`;
export function load<T>(k: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key(k));
    return v ? { ...fallback, ...JSON.parse(v) } : fallback;
  } catch { return fallback; }
}
export function save(k: string, v: unknown) {
  try { localStorage.setItem(key(k), JSON.stringify(v)); } catch { /* storage full or blocked */ }
}

/** usePersisted: state mirrored to localStorage. */
export function usePersisted<T extends object>(k: string, init: T): [T, (u: T | ((p: T) => T)) => void] {
  const [v, setV] = useState<T>(() => load(k, init));
  const set = useCallback((u: T | ((p: T) => T)) => {
    setV((p) => {
      const n = typeof u === 'function' ? (u as (p: T) => T)(p) : u;
      save(k, n);
      return n;
    });
  }, [k]);
  return [v, set];
}

export const useDraft = () => usePersisted<DraftState>('draft', emptyDraft());

// ---- Catalog --------------------------------------------------------------
interface SavedCatalog { fetchedAt: string; raw: Parameters<typeof normalizeCatalog>[0] }

function readSaved(): SavedCatalog | null {
  try {
    const s = localStorage.getItem(key('catalog'));
    return s ? (JSON.parse(s) as SavedCatalog) : null;
  } catch { return null; }
}

export interface CatalogState {
  catalog: Catalog | null;
  error: string | null;
  refreshing: boolean;
  refresh: () => Promise<void>;
}

export function useCatalog(): CatalogState {
  const [catalog, setCatalog] = useState<Catalog | null>(() => {
    const s = readSaved();
    return s ? normalizeCatalog(s.raw, s.fetchedAt, 'saved') : null;
  });
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const raw = await fetchLiveRaw();
      const fetchedAt = new Date().toISOString();
      try { localStorage.setItem(key('catalog'), JSON.stringify({ fetchedAt, raw })); } catch { /* too big: SW cache still has it */ }
      setCatalog(normalizeCatalog(raw, fetchedAt, 'live'));
      setError(null);
    } catch (e) {
      setError(`Couldn't reach the catalog (${(e as Error).message}). Using the last copy.`);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!catalog) {
        try {
          const r = await fetch(`${import.meta.env.BASE_URL}catalog-snapshot.json`);
          const j = await r.json();
          if (!cancelled) setCatalog((c) => c ?? normalizeCatalog(j, j.fetchedAt, 'bundled'));
        } catch { /* fall through to live */ }
      }
      const saved = readSaved();
      const stale = !saved || Date.now() - Date.parse(saved.fetchedAt) > DATA.catalogMaxAgeMs;
      if (stale && navigator.onLine !== false) refresh();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { catalog, error, refreshing, refresh };
}

// ---- Stats snapshot: published daily next to the app -----------------------
export function useStats(): StatsSnapshot | null {
  const [s, setS] = useState<StatsSnapshot | null>(null);
  useEffect(() => {
    let off = false;
    fetch(`${import.meta.env.BASE_URL}data/stats-latest.json`, { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!off && j) setS(j as StatsSnapshot); })
      .catch(() => { /* offline and never cached */ });
    return () => { off = true; };
  }, []);
  return s;
}

// ---- Recommended kits: curated snapshot next to the app --------------------
export function useBuilds(): BuildsFile | null {
  const [s, setS] = useState<BuildsFile | null>(null);
  useEffect(() => {
    let off = false;
    fetch(`${import.meta.env.BASE_URL}data/builds.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!off && j) setS(j as BuildsFile); })
      .catch(() => { /* offline and never cached */ });
    return () => { off = true; };
  }, []);
  return s;
}
