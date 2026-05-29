import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getCache, setCache, invalidateCache, clearCache, CACHE_TTL } from '@/lib/cache';

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
});
