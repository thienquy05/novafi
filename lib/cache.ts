/**
 * Tiny in-process TTL cache for API routes.
 * Prevents hammering Google Sheets on every client navigation.
 * Per-user keys prevent cross-user data leakage.
 *
 * ── Serverless (Vercel) note ──────────────────────────────────────────────────
 * On Vercel each lambda instance has its own module memory, so this Map is
 * per-instance: a write on instance A clears A's cache, but instance B may still
 * serve a cached value until it expires. We therefore treat the cache purely as a
 * short-lived read throttle and BOUND staleness with conservative TTLs (see
 * CACHE_TTL). Balance-critical data (transactions, accounts) uses the shortest
 * TTL so the cross-instance stale window after a mutation is small; stable data
 * (bills, budgets, goals) can live longer. Mutating routes still call
 * invalidateCache() so the instance that handled the write is immediately fresh.
 */

/** Centralized TTLs (ms). Tune freshness-vs-Sheets-load here in one place. */
export const CACHE_TTL = {
  /** Balance-critical, mutates often — keep the stale window small on serverless. */
  SHORT: 15_000,
  /** Stable-ish reference data. */
  MEDIUM: 30_000,
  /** Rarely-changing data. */
  LONG: 60_000,
} as const;

type Entry<T> = { data: T; expires: number };
const store = new Map<string, Entry<unknown>>();

export function getCache<T>(key: string): T | null {
  const entry = store.get(key) as Entry<T> | undefined;
  if (!entry || Date.now() > entry.expires) {
    store.delete(key);
    return null;
  }
  return entry.data;
}

export function setCache<T>(key: string, data: T, ttlMs: number = CACHE_TTL.MEDIUM): void {
  store.set(key, { data, expires: Date.now() + ttlMs });
}

/** Invalidate all keys that start with the given prefix (e.g. `"accounts:userId"`). */
export function invalidateCache(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

/** Clears the entire cache. Primarily for test isolation. */
export function clearCache(): void {
  store.clear();
}
