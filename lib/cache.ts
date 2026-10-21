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

type Entry<T> = { data: T; expires: number; createdAt: number };
const store = new Map<string, Entry<unknown>>();
/** In-flight fetches per key so concurrent misses share one Sheets round trip. */
const inflight = new Map<string, { promise: Promise<unknown>; startedAt: number }>();

/**
 * `notBefore` (ms epoch) treats any entry created earlier as a miss. Routes pass
 * the caller's last-write time (the `nf_wv` cookie, see lib/apiRoute.ts) so a
 * user never reads a pre-write snapshot from ANOTHER serverless instance, whose
 * cache this instance's invalidateCache() can't reach.
 */
export function getCache<T>(key: string, notBefore = 0): T | null {
  const entry = store.get(key) as Entry<T> | undefined;
  if (!entry || Date.now() > entry.expires) {
    store.delete(key);
    return null;
  }
  if (entry.createdAt <= notBefore) return null;
  return entry.data;
}

/**
 * `fetchedAt` should be when the underlying read STARTED (defaults to now): a
 * read that began before a write but finished after it must still count as
 * pre-write data for the `notBefore` check above.
 */
export function setCache<T>(key: string, data: T, ttlMs: number = CACHE_TTL.MEDIUM, fetchedAt = Date.now()): void {
  store.set(key, { data, expires: Date.now() + ttlMs, createdAt: fetchedAt });
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
  notBefore = 0,
): Promise<T> {
  const cached = getCache<T>(key, notBefore);
  if (cached !== null) return cached;
  // Join an in-flight read for the same key if it started after the caller's
  // last write — e.g. the dashboard render and the Money Flow request landing
  // together on a cold instance share one Sheets round trip.
  const pending = inflight.get(key);
  if (pending && pending.startedAt > notBefore) return pending.promise as Promise<T>;

  const startedAt = Date.now();
  const slot: { promise: Promise<unknown>; startedAt: number } = { promise: Promise.resolve(), startedAt };
  const promise = fetcher().then((fresh) => {
    // Only cache if no invalidation detached this read while it was running —
    // otherwise it would re-store pre-write data.
    if (inflight.get(key) === slot) setCache(key, fresh, ttlMs, startedAt);
    return fresh;
  });
  slot.promise = promise;
  inflight.set(key, slot);
  try {
    return await promise;
  } finally {
    if (inflight.get(key)?.promise === promise) inflight.delete(key);
  }
}

/** Invalidate all keys that start with the given prefix (e.g. `"accounts:userId"`). */
export function invalidateCache(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
  // A read already in flight would repopulate with pre-write data; detach it so
  // the next caller starts a fresh one.
  for (const key of inflight.keys()) {
    if (key.startsWith(prefix)) inflight.delete(key);
  }
}

/**
 * Views computed from many sheets at once — the dashboard payload (also served to
 * the Money Flow modal), and the badges/notification-bell payload. Almost any
 * write can move them, and a route forgetting one left Home or the bell stale
 * until the TTL ran out, so every invalidateMany() stales them unconditionally.
 * Writes are rare next to reads, so the extra refetch is cheap.
 */
export const DERIVED_CACHES = ['dashboard', 'badges'] as const;

/**
 * Invalidate several per-user resource caches at once. Replaces the repeated
 * `invalidateCache('accounts:'+id); invalidateCache('dashboard:'+id); …` clusters
 * that mutating routes hand-wrote. Pass the bare resource names; the per-user
 * suffix is appended here. See the `*_CACHES` groups below for the common sets.
 */
export function invalidateMany(spreadsheetId: string, resources: readonly string[]): void {
  for (const r of new Set([...resources, ...DERIVED_CACHES])) invalidateCache(`${r}:${spreadsheetId}`);
}

/**
 * Named cache groups — the set of resource caches a given mutation stales.
 * Only the groups that are invalidated uniformly across all of a route's handlers
 * live here; routes with conditional/partial invalidation (loans, paychecks,
 * splits non-create, budget reorder) pass an explicit array to invalidateMany so
 * their exact semantics are preserved at the call site.
 */
export const TX_CACHES = ['transactions', 'accounts', 'dashboard', 'badges'] as const; // transactions route, split create
// Account edits include credit-card balance/limit/statement changes, which move
// the creditAlerts badge — so 'badges' must stale too.
export const ACCOUNT_CACHES = ['accounts', 'dashboard', 'badges'] as const;
export const BILL_CACHES = ['bills', 'dashboard', 'badges'] as const;
export const BUDGET_CACHES = ['budgets', 'dashboard', 'badges'] as const; // budget create/delete
export const GOAL_CACHES = ['goals', 'dashboard'] as const;
// Updating an investment account's current value changes its balance, so it
// stales accounts + the dashboard (net worth) + badges. (Contributions are
// plain transfers and go through the transactions route's own invalidation.)
export const INVESTMENT_CACHES = ['accounts', 'dashboard', 'badges'] as const;

/** Clears the entire cache. Primarily for test isolation. */
export function clearCache(): void {
  store.clear();
  inflight.clear();
}
