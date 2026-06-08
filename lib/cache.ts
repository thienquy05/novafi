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

/**
 * Get-or-populate: return the cached value if fresh, otherwise run `fetcher`,
 * cache its result, and return it. Collapses the repeated
 *   const c = getCache(k); if (c) return c; const f = await fetch(); setCache(k, f); return f;
 * pattern that every cached GET route and the dashboard server component used to
 * hand-roll. `null` is a valid cached value only if `fetcher` never returns it;
 * cache misses are represented by getCache returning null, so callers should not
 * cache a literal `null`.
 */
export async function cachedOrFetch<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const cached = getCache<T>(key);
  if (cached !== null) return cached;
  const fresh = await fetcher();
  setCache(key, fresh, ttlMs);
  return fresh;
}

/** Invalidate all keys that start with the given prefix (e.g. `"accounts:userId"`). */
export function invalidateCache(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

/**
 * Invalidate several per-user resource caches at once. Replaces the repeated
 * `invalidateCache('accounts:'+id); invalidateCache('dashboard:'+id); …` clusters
 * that mutating routes hand-wrote. Pass the bare resource names; the per-user
 * suffix is appended here. See the `*_CACHES` groups below for the common sets.
 */
export function invalidateMany(spreadsheetId: string, resources: readonly string[]): void {
  for (const r of resources) invalidateCache(`${r}:${spreadsheetId}`);
}

/**
 * Named cache groups — the set of resource caches a given mutation stales.
 * Only the groups that are invalidated uniformly across all of a route's handlers
 * live here; routes with conditional/partial invalidation (loans, paychecks,
 * splits non-create, budget reorder) pass an explicit array to invalidateMany so
 * their exact semantics are preserved at the call site.
 */
export const TX_CACHES = ['transactions', 'accounts', 'dashboard', 'badges'] as const; // transactions route, split create
export const ACCOUNT_CACHES = ['accounts', 'dashboard'] as const;
export const BILL_CACHES = ['bills', 'dashboard', 'badges'] as const;
export const BUDGET_CACHES = ['budgets', 'dashboard', 'badges'] as const; // budget create/delete
export const GOAL_CACHES = ['goals', 'dashboard'] as const;

/** Clears the entire cache. Primarily for test isolation. */
export function clearCache(): void {
  store.clear();
}
