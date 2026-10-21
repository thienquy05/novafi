import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Fresh module per test (owner/hydration are module state) + an in-memory
// sessionStorage, so we can simulate sign-out → another account signs in.
describe('client cache is scoped to the signed-in user', () => {
  let store: Storage;
  beforeEach(() => {
    vi.resetModules();
    // Object.keys(sessionStorage) must list keys → back it with a plain object.
    const backing: Record<string, string> = {};
    store = new Proxy(backing, {
      get: (t, p) => {
        if (p === 'getItem') return (k: string) => (k in t ? t[k] : null);
        if (p === 'setItem') return (k: string, v: string) => { t[k] = String(v); };
        if (p === 'removeItem') return (k: string) => { delete t[k]; };
        return t[p as string];
      },
    }) as unknown as Storage;
    vi.stubGlobal('sessionStorage', store);
    vi.stubGlobal('window', {});
  });
  afterEach(() => vi.unstubAllGlobals());

  it('serves the mirror to the same owner but wipes it for a different one', async () => {
    store.setItem('nf_store_owner', 'userA');
    store.setItem('nf_store_v1', JSON.stringify({ accounts: { data: [{ id: 'a1' }], ts: Date.now() } }));
    store.setItem('nf_badges_cache_v2', '{"overdueBills":3}');

    const a = await import('@/lib/client/store');
    a.setCacheOwner('userA');
    expect(a.peekCache(['accounts'])).toEqual({ accounts: [{ id: 'a1' }] });

    vi.resetModules();
    const b = await import('@/lib/client/store');
    b.setCacheOwner('userB');
    expect(b.peekCache(['accounts'])).toBeNull();
    expect(store.getItem('nf_badges_cache_v2')).toBeNull();
    expect(store.getItem('nf_store_owner')).toBe('userB');
  });

  it('does not hydrate before the owner is known', async () => {
    store.setItem('nf_store_owner', 'userA');
    store.setItem('nf_store_v1', JSON.stringify({ accounts: { data: [1], ts: Date.now() } }));
    const s = await import('@/lib/client/store');
    expect(s.peekCache(['accounts'])).toBeNull();
  });
});
