import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ensureResources, peekCache, isFresh, invalidateClientCache,
  subscribeCache, __setFetcherForTests, __resetCacheForTests, CLIENT_CACHE_TTL,
} from '@/lib/client/store';
import type { BatchData, BatchKey } from '@/lib/client/api';

// Minimal stand-ins; the cache treats values opaquely so shape doesn't matter.
const acct = (id: string) => ({ id }) as unknown as BatchData['accounts'][number];

function fakeData(partial: Partial<BatchData>): BatchData {
  return {
    accounts: [], transactions: [], bills: [], paychecks: [], budgets: [],
    goals: [], contacts: [], splits: [], loans: [], funding: [], settings: {} as BatchData['settings'],
    ...partial,
  };
}

describe('client store', () => {
  beforeEach(() => { __resetCacheForTests(); });

  it('fetches only missing keys and caches them', async () => {
    const fetcher = vi.fn(async (keys: readonly BatchKey[]) => {
      const out = {} as Record<string, unknown>;
      for (const k of keys) out[k] = fakeData({})[k];
      out.accounts = [acct('a')];
      return out as Pick<BatchData, BatchKey>;
    });
    const restore = __setFetcherForTests(fetcher);

    const r1 = await ensureResources(['accounts']);
    expect(r1.accounts).toEqual([acct('a')]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(['accounts']);

    // Second call within TTL → served from cache, no new fetch.
    const r2 = await ensureResources(['accounts']);
    expect(r2.accounts).toEqual([acct('a')]);
    expect(fetcher).toHaveBeenCalledTimes(1);

    restore();
  });

  it('only requests the keys that are missing', async () => {
    const fetcher = vi.fn(async (keys: readonly BatchKey[]) => {
      const out = {} as Record<string, unknown>;
      for (const k of keys) out[k] = [{ id: k }];
      return out as Pick<BatchData, BatchKey>;
    });
    const restore = __setFetcherForTests(fetcher);

    await ensureResources(['accounts']);
    await ensureResources(['accounts', 'bills']); // accounts cached → only bills fetched
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenLastCalledWith(['bills']);

    restore();
  });

  it('dedupes concurrent fetches of the same key', async () => {
    let calls = 0;
    const fetcher = vi.fn(async (keys: readonly BatchKey[]) => {
      calls++;
      await new Promise((r) => setTimeout(r, 5));
      const out = {} as Record<string, unknown>;
      for (const k of keys) out[k] = [{ id: k }];
      return out as Pick<BatchData, BatchKey>;
    });
    const restore = __setFetcherForTests(fetcher);

    const [a, b] = await Promise.all([
      ensureResources(['accounts']),
      ensureResources(['accounts']),
    ]);
    expect(a.accounts).toEqual(b.accounts);
    expect(calls).toBe(1); // single round trip shared by both callers

    restore();
  });

  it('force refetches even when fresh', async () => {
    const fetcher = vi.fn(async (keys: readonly BatchKey[]) => {
      const out = {} as Record<string, unknown>;
      for (const k of keys) out[k] = [{ id: k }];
      return out as Pick<BatchData, BatchKey>;
    });
    const restore = __setFetcherForTests(fetcher);

    await ensureResources(['accounts']);
    await ensureResources(['accounts'], { force: true });
    expect(fetcher).toHaveBeenCalledTimes(2);

    restore();
  });

  it('peekCache returns null until all keys are present, then the data', async () => {
    const fetcher = __setFetcherForTests(async (keys) => {
      const out = {} as Record<string, unknown>;
      for (const k of keys) out[k] = [{ id: k }];
      return out as Pick<BatchData, BatchKey>;
    });
    expect(peekCache(['accounts', 'bills'])).toBeNull();
    await ensureResources(['accounts']);
    expect(peekCache(['accounts', 'bills'])).toBeNull(); // bills still missing
    await ensureResources(['bills']);
    expect(peekCache(['accounts', 'bills'])).not.toBeNull();
    fetcher();
  });

  it('invalidate clears keys and triggers a refetch', async () => {
    const fetcher = vi.fn(async (keys: readonly BatchKey[]) => {
      const out = {} as Record<string, unknown>;
      for (const k of keys) out[k] = [{ id: k }];
      return out as Pick<BatchData, BatchKey>;
    });
    const restore = __setFetcherForTests(fetcher);

    await ensureResources(['accounts']);
    invalidateClientCache('accounts');
    expect(peekCache(['accounts'])).toBeNull();
    await ensureResources(['accounts']);
    expect(fetcher).toHaveBeenCalledTimes(2);

    restore();
  });

  it('invalidate with no args clears everything', async () => {
    const restore = __setFetcherForTests(async (keys) => {
      const out = {} as Record<string, unknown>;
      for (const k of keys) out[k] = [{ id: k }];
      return out as Pick<BatchData, BatchKey>;
    });
    await ensureResources(['accounts', 'bills']);
    invalidateClientCache();
    expect(peekCache(['accounts'])).toBeNull();
    expect(peekCache(['bills'])).toBeNull();
    restore();
  });

  it('isFresh respects the TTL window', async () => {
    const restore = __setFetcherForTests(async (keys) => {
      const out = {} as Record<string, unknown>;
      for (const k of keys) out[k] = [{ id: k }];
      return out as Pick<BatchData, BatchKey>;
    });
    const now = 1_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    await ensureResources(['accounts']);
    expect(isFresh(['accounts'])).toBe(true);
    vi.spyOn(Date, 'now').mockReturnValue(now + CLIENT_CACHE_TTL + 1);
    expect(isFresh(['accounts'])).toBe(false);
    vi.restoreAllMocks();
    restore();
  });

  it('notifies subscribers on set and invalidate', async () => {
    const restore = __setFetcherForTests(async (keys) => {
      const out = {} as Record<string, unknown>;
      for (const k of keys) out[k] = [{ id: k }];
      return out as Pick<BatchData, BatchKey>;
    });
    const fn = vi.fn();
    const unsub = subscribeCache(fn);
    await ensureResources(['accounts']);
    expect(fn).toHaveBeenCalledTimes(1);
    invalidateClientCache('accounts');
    expect(fn).toHaveBeenCalledTimes(2);
    unsub();
    invalidateClientCache('bills');
    expect(fn).toHaveBeenCalledTimes(2); // unsubscribed → no further calls
    restore();
  });
});
