import { describe, it, expect, vi, beforeEach } from 'vitest';

// Validate the /api/batch endpoint's cache-reuse + new settings/loans keys
// without touching Google: mock auth + the sheets batch reader, keep the route
// + cache real.
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/sheets', () => ({
  batchGetSheets: vi.fn(),
  BATCH_KEYS: ['accounts', 'transactions', 'bills', 'paychecks', 'budgets', 'goals', 'contacts', 'splits', 'loans', 'settings'],
}));

import { auth } from '@/lib/auth';
import * as sheets from '@/lib/sheets';
import { setCache, clearCache } from '@/lib/cache';
import { GET } from '@/app/api/batch/route';
import { NextRequest } from 'next/server';

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;
const mockBatch = sheets.batchGetSheets as unknown as ReturnType<typeof vi.fn>;

function req(keys: string) {
  return new NextRequest(`http://test/api/batch?keys=${keys}`);
}

beforeEach(() => {
  clearCache();
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ accessToken: 'tok', spreadsheetId: 'sheet1', user: {} });
});

describe('GET /api/batch', () => {
  it('401s without a session', async () => {
    mockAuth.mockResolvedValue(null);
    expect((await GET(req('accounts'))).status).toBe(401);
  });

  it('400s when no valid keys are requested', async () => {
    expect((await GET(req('bogus'))).status).toBe(400);
  });

  it('fetches the new settings + loans keys and returns them', async () => {
    mockBatch.mockResolvedValue({ settings: { language: 'en' }, loans: [{ id: 'l1' }] });
    const data = await (await GET(req('settings,loans'))).json();
    expect(data.settings).toEqual({ language: 'en' });
    expect(data.loans).toEqual([{ id: 'l1' }]);
    expect(mockBatch).toHaveBeenCalledWith('tok', 'sheet1', ['settings', 'loans']);
  });

  it('serves cached keys from cache and only fetches the misses', async () => {
    setCache('accounts:sheet1', [{ id: 'a1' }]); // already cached
    mockBatch.mockResolvedValue({ settings: { language: 'vi' } });

    const data = await (await GET(req('accounts,settings'))).json();
    expect(data.accounts).toEqual([{ id: 'a1' }]);   // from cache
    expect(data.settings).toEqual({ language: 'vi' }); // fetched
    expect(mockBatch).toHaveBeenCalledWith('tok', 'sheet1', ['settings']); // only the miss
  });
});
