/**
 * Tiny in-process TTL cache for API routes.
 * Prevents hammering Google Sheets on every client navigation.
 * Per-user keys prevent cross-user data leakage.
 */

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

export function setCache<T>(key: string, data: T, ttlMs = 30_000): void {
  store.set(key, { data, expires: Date.now() + ttlMs });
}

/** Invalidate all keys that start with the given prefix (e.g. `"accounts:userId"`). */
export function invalidateCache(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}
