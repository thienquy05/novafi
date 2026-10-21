import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getCache, setCache, invalidateCache, invalidateMany, cachedOrFetch, clearCache, CACHE_TTL } from '@/lib/cache';

describe('cache', () => {
  beforeEach(() => {
    clearCache();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-29T00:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns cached data before the TTL elapses', () => {
    setCache('k', { a: 1 }, 1000);
    vi.advanceTimersByTime(500);
    expect(getCache('k')).toEqual({ a: 1 });
  });

  it('expires data after the TTL', () => {
    setCache('k', { a: 1 }, 1000);
    vi.advanceTimersByTime(1001);
    expect(getCache('k')).toBeNull();
  });

  it('returns null for unknown keys', () => {
    expect(getCache('missing')).toBeNull();
  });

  it('invalidates by key prefix', () => {
    setCache('accounts:user1', [1]);
    setCache('accounts:user2', [2]);
    setCache('transactions:user1', [3]);
    invalidateCache('accounts:');
    expect(getCache('accounts:user1')).toBeNull();
    expect(getCache('accounts:user2')).toBeNull();
    expect(getCache('transactions:user1')).toEqual([3]);
  });

  it('clearCache empties the store', () => {
    setCache('a', 1);
    setCache('b', 2);
    clearCache();
    expect(getCache('a')).toBeNull();
    expect(getCache('b')).toBeNull();
  });

  it('exposes ordered TTL tiers', () => {
    expect(CACHE_TTL.SHORT).toBeLessThan(CACHE_TTL.MEDIUM);
    expect(CACHE_TTL.MEDIUM).toBeLessThan(CACHE_TTL.LONG);
  });

  it('invalidateMany clears each named resource for a spreadsheet, leaving others', () => {
    setCache('accounts:sheetA', [1]);
    setCache('dashboard:sheetA', [2]);
    setCache('bills:sheetA', [3]);
    setCache('accounts:sheetB', [4]);
    invalidateMany('sheetA', ['accounts', 'dashboard']);
    expect(getCache('accounts:sheetA')).toBeNull();
    expect(getCache('dashboard:sheetA')).toBeNull();
    expect(getCache('bills:sheetA')).toEqual([3]);   // not in the list
    expect(getCache('accounts:sheetB')).toEqual([4]); // different spreadsheet
  });
});

describe('cachedOrFetch', () => {
  beforeEach(() => {
    clearCache();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-29T00:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('returns the cached value without invoking the fetcher on a hit', async () => {
    setCache('k', { a: 1 }, 1000);
    const fetcher = vi.fn(async () => ({ a: 2 }));
    const result = await cachedOrFetch('k', 1000, fetcher);
    expect(result).toEqual({ a: 1 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('invokes the fetcher on a miss and caches the result under the given TTL', async () => {
    const fetcher = vi.fn(async () => ({ a: 2 }));
    const first = await cachedOrFetch('k', 1000, fetcher);
    expect(first).toEqual({ a: 2 });
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Within TTL → served from cache, fetcher not called again.
    vi.advanceTimersByTime(500);
    await cachedOrFetch('k', 1000, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);

    // After TTL → fetched again.
    vi.advanceTimersByTime(600);
    await cachedOrFetch('k', 1000, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe('cross-instance freshness + coalescing', () => {
  beforeEach(() => {
    clearCache();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-29T00:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('treats entries fetched at or before the caller\'s last write as a miss', () => {
    const t0 = Date.now();
    setCache('k', 'pre-write', 60_000, t0);
    expect(getCache('k', t0)).toBeNull();          // write landed at the same instant
    expect(getCache('k', t0 - 1)).toBe('pre-write'); // entry is newer than the write
    expect(getCache('k')).toBe('pre-write');         // no write cookie → normal hit
  });

  it('stamps entries with the fetch START time, not the finish time', async () => {
    let resolve!: (v: string) => void;
    const p = cachedOrFetch('k', 60_000, () => new Promise<string>((r) => { resolve = r; }));
    const startedAt = Date.now();
    vi.advanceTimersByTime(1000);
    const writeAt = Date.now();                       // write lands mid-fetch
    resolve('maybe-pre-write');
    await p;
    expect(getCache('k', writeAt)).toBeNull();        // must not be trusted as post-write
    expect(getCache('k', startedAt - 1)).toBe('maybe-pre-write');
  });

  it('coalesces concurrent misses into one fetch', async () => {
    const fetcher = vi.fn(async () => 'v');
    const [a, b] = await Promise.all([
      cachedOrFetch('k', 1000, fetcher),
      cachedOrFetch('k', 1000, fetcher),
    ]);
    expect(a).toBe('v');
    expect(b).toBe('v');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not join an in-flight read that started before the caller\'s write', async () => {
    let resolveFirst!: (v: string) => void;
    const first = cachedOrFetch('k', 1000, () => new Promise<string>((r) => { resolveFirst = r; }));
    vi.advanceTimersByTime(10);
    const second = cachedOrFetch('k', 1000, async () => 'fresh', Date.now() - 1);
    resolveFirst('stale');
    expect(await first).toBe('stale');
    expect(await second).toBe('fresh');
  });

  it('an invalidation mid-fetch stops the old read from re-caching pre-write data', async () => {
    let resolve!: (v: string) => void;
    const p = cachedOrFetch('dashboard:s1', 1000, () => new Promise<string>((r) => { resolve = r; }));
    invalidateMany('s1', ['accounts']);
    resolve('pre-write');
    await p;
    expect(getCache('dashboard:s1')).toBeNull();
  });

  it('invalidateMany always stales the derived dashboard + badges views', () => {
    setCache('dashboard:s1', 1);
    setCache('badges:s1', 2);
    setCache('contacts:s1', 3);
    invalidateMany('s1', ['contacts']); // a write that never listed them
    expect(getCache('dashboard:s1')).toBeNull();
    expect(getCache('badges:s1')).toBeNull();
    expect(getCache('contacts:s1')).toBeNull();
  });
});
