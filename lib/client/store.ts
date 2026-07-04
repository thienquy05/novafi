'use client';
import { loadBatch, type BatchData, type BatchKey } from './api';

/**
 * Client-side stale-while-revalidate cache for the batch resources.
 *
 * ── Why this exists ───────────────────────────────────────────────────────────
 * The API routes already throttle Google Sheets with a server-side TTL cache
 * (lib/cache.ts). But every page is a fresh `'use client'` component that, on
 * mount, set `loading=true`, flashed skeletons, and re-fetched `/api/*` — so
 * switching sections *visibly reloaded every number* even when the server
 * answered instantly from memory. This module holds the last-loaded data in
 * module memory (surviving client-side navigation) plus a sessionStorage mirror
 * (surviving a full reload), so a revisit renders cached numbers immediately and
 * only revalidates in the background.
 *
 * Mirrors the existing sessionStorage pattern in `useCategories`/`Sidebar`,
 * generalized over the batch API. Pure cache logic (freshness, dedup, merge) is
 * node-testable; browser APIs (sessionStorage) are guarded so it no-ops on the
 * server and in tests.
 */

type Entry = { data: unknown; ts: number };

const PERSIST_KEY = 'nf_store_v1';

/** Default freshness window. A revalidation throttle, not a correctness boundary —
 * mutations clear the cache explicitly via invalidateClientCache(). */
export const CLIENT_CACHE_TTL = 30_000;

const mem = new Map<BatchKey, Entry>();
const subs = new Set<() => void>();
/** In-flight fetches keyed per-resource so overlapping page loads dedupe. */
const inflight = new Map<BatchKey, Promise<void>>();

// The fetcher is injectable so the cache can be exercised in node tests without
// a real network. Production uses the one-round-trip batch loader.
type Fetcher = <K extends BatchKey>(keys: readonly K[]) => Promise<Pick<BatchData, K>>;
let fetcher: Fetcher = loadBatch;

/** Test seam: swap the network fetcher. Returns a restore fn. */
export function __setFetcherForTests(f: Fetcher): () => void {
  const prev = fetcher;
  fetcher = f;
  return () => { fetcher = prev; };
}

function notify(): void {
  for (const fn of subs) fn();
}

function persist(): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    const obj: Record<string, Entry> = {};
    for (const [k, v] of mem) obj[k] = v;
    sessionStorage.setItem(PERSIST_KEY, JSON.stringify(obj));
  } catch { /* quota / unavailable — cache simply doesn't survive reload */ }
}

let hydrated = false;
/** Lazily restore the sessionStorage mirror into module memory, once per session. */
function hydrate(): void {
  if (hydrated) return;
  hydrated = true;
  if (typeof sessionStorage === 'undefined') return;
  try {
    const raw = sessionStorage.getItem(PERSIST_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw) as Record<string, Entry>;
    for (const k of Object.keys(obj)) mem.set(k as BatchKey, obj[k]);
  } catch { /* corrupt mirror — ignore, will refetch */ }
}

/**
 * Synchronously read cached data for a key set, or null if ANY key is missing.
 * Used to seed a page's initial state so the first render shows real numbers
 * (no skeleton) when we've loaded before. Does not consider freshness — a
 * background revalidation runs alongside.
 */
export function peekCache<K extends BatchKey>(keys: readonly K[]): Pick<BatchData, K> | null {
  hydrate();
  const out = {} as Record<string, unknown>;
  for (const k of keys) {
    const e = mem.get(k);
    if (!e) return null;
    out[k] = e.data;
  }
  return out as Pick<BatchData, K>;
}

/** True only when every requested key is present and within `ttl`. */
export function isFresh(keys: readonly BatchKey[], ttl = CLIENT_CACHE_TTL): boolean {
  hydrate();
  const now = Date.now();
  return keys.every((k) => {
    const e = mem.get(k);
    return e != null && now - e.ts < ttl;
  });
}

/**
 * Return the requested resources, fetching only the keys that are missing/stale
 * (or all of them when `force`). Concurrent calls for the same key share one
 * network round trip. Always resolves to the latest cached values.
 */
export async function ensureResources<K extends BatchKey>(
  keys: readonly K[],
  opts: { force?: boolean; ttl?: number } = {},
): Promise<Pick<BatchData, K>> {
  hydrate();
  const ttl = opts.ttl ?? CLIENT_CACHE_TTL;
  const now = Date.now();
  const need: BatchKey[] = [];
  const awaiting: Promise<unknown>[] = [];

  for (const k of keys) {
    const e = mem.get(k);
    const fresh = e != null && now - e.ts < ttl;
    if (!opts.force && fresh) continue;
    const pending = inflight.get(k);
    if (pending) { awaiting.push(pending); continue; }
    need.push(k);
  }

  if (need.length > 0) {
    const p = (async () => {
      const data = await fetcher(need);
      const ts = Date.now();
      for (const k of need) (mem.set(k, { data: (data as Record<string, unknown>)[k], ts }));
      persist();
      notify();
    })();
    for (const k of need) inflight.set(k, p);
    // Clear the in-flight markers once settled (success or failure) so a later
    // call can retry; failures propagate to the caller via Promise.all below.
    const settle = p.finally(() => {
      for (const k of need) if (inflight.get(k) === p) inflight.delete(k);
    });
    awaiting.push(settle);
  }

  await Promise.all(awaiting);

  const out = {} as Record<string, unknown>;
  for (const k of keys) {
    const e = mem.get(k);
    if (e) out[k] = e.data;
  }
  return out as Pick<BatchData, K>;
}

/**
 * Drop cached resources after a mutation so the next read refetches. Call with
 * no args to clear everything (the safe default when a write may cross-affect
 * several resources — e.g. a transaction touches accounts, dashboard, badges).
 */
export function invalidateClientCache(...keys: BatchKey[]): void {
  hydrate();
  if (keys.length === 0) mem.clear();
  else for (const k of keys) mem.delete(k);
  persist();
  notify();
}

/** Subscribe to cache changes (set/invalidate). Returns an unsubscribe fn. */
export function subscribeCache(fn: () => void): () => void {
  subs.add(fn);
  return () => { subs.delete(fn); };
}

// Derived-warning caches live OUTSIDE this store (sessionStorage-backed — the
// sidebar badges and the notification bell). Any write can change what they
// warn about, so the same global guard busts them and pings their listeners.
// Centralized here so no mutation path can ever forget to dispatch.
export const BADGES_CACHE_KEY = 'nf_badges_cache_v2';
export const NOTIFICATIONS_CACHE_KEY = 'nf_notifications_cache_v1';
export const BADGES_INVALID_EVENT = 'novafi:badges-invalid';
export const NOTIFICATIONS_INVALID_EVENT = 'novafi:notifications-invalid';

function invalidateDerivedWarnings(): void {
  try {
    sessionStorage.removeItem(BADGES_CACHE_KEY);
    sessionStorage.removeItem(NOTIFICATIONS_CACHE_KEY);
  } catch { /* sessionStorage unavailable */ }
  window.dispatchEvent(new CustomEvent(BADGES_INVALID_EVENT));
  window.dispatchEvent(new CustomEvent(NOTIFICATIONS_INVALID_EVENT));
}

/**
 * Install a one-time global guard so writes keep every page correct without each
 * mutation handler touching the cache: after any successful mutating request to
 * our own API (POST/PUT/PATCH/DELETE on `/api/*`, excluding the auth endpoints),
 * drop the client read-cache so the next navigation refetches fresh data — and
 * bust the badge/notification caches so their bells refetch too. Read navigation
 * between sections stays cache-served; a write is the only thing that busts it.
 * Idempotent and browser-only.
 */
let guardInstalled = false;
export function installCacheInvalidation(): void {
  if (guardInstalled || typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  guardInstalled = true;
  const orig = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const res = await orig(input, init);
    try {
      const method = (
        init?.method ??
        (typeof input === 'object' && input instanceof Request ? input.method : 'GET')
      ).toUpperCase();
      if (res.ok && method !== 'GET' && method !== 'HEAD') {
        const url =
          typeof input === 'string' ? input
          : input instanceof URL ? input.href
          : input.url;
        if (url.includes('/api/') && !url.includes('/api/auth')) {
          invalidateClientCache();
          invalidateDerivedWarnings();
        }
      }
    } catch { /* cache bookkeeping must never break the request */ }
    return res;
  };
}

/** Test helper: wipe all in-memory state (does not touch sessionStorage). */
export function __resetCacheForTests(): void {
  mem.clear();
  inflight.clear();
  subs.clear();
  hydrated = true; // skip sessionStorage hydration in node tests
}
