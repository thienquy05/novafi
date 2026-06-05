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
