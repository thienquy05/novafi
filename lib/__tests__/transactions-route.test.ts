import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Account, Funding, Transaction } from '@/types';

// Mock ONLY the Google Sheets layer + auth — everything else (the route logic,
// the cache, and the real balance math in lib/calculations) runs for real, so
// these tests exercise the actual add/edit/delete flow end-to-end minus Google.
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/sheets', () => ({
  getTransactions: vi.fn(),
  addTransaction: vi.fn(),
  addTransactions: vi.fn(),
  deleteTransaction: vi.fn(),
  updateTransaction: vi.fn(),
  getAccounts: vi.fn(),
  persistChangedAccounts: vi.fn(),
  getFundings: vi.fn().mockResolvedValue([]),
  upsertFunding: vi.fn(),
}));

import { auth } from '@/lib/auth';
import * as sheets from '@/lib/sheets';
import { setCache, getCache, clearCache } from '@/lib/cache';
import { GET, POST, PUT, DELETE } from '@/app/api/transactions/route';

const SESSION = { accessToken: 'tok', spreadsheetId: 'sheet1', user: {} };

function makeAccount(o: Partial<Account> & { id: string; type: Account['type']; balance: number }): Account {
  return { name: 'Acct', institution: '', last4: '', color: '#000', createdAt: '2026-01-01', ...o };
}
function makeTx(o: Partial<Transaction> & { id: string }): Transaction {
  return { date: '2026-06-05', description: '', amount: 0, type: 'expense', category: 'Food', account: 'a1', createdAt: '2026-06-05T00:00:00Z', ...o };
}
function req(method: string, body?: unknown) {
  return new Request('http://test/api/transactions', {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as Parameters<typeof POST>[0];
}

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  clearCache();
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(SESSION);
});

describe('GET /api/transactions (cachedGet)', () => {
  it('401s without a session token', async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET(req('GET'));
    expect(res.status).toBe(401);
  });

  it('returns transactions and caches them (second call skips Sheets)', async () => {
    const txs = [makeTx({ id: 't1', amount: 10 })];
    (sheets.getTransactions as ReturnType<typeof vi.fn>).mockResolvedValue(txs);

    const res1 = await GET(req('GET'));
    expect(await res1.json()).toEqual(txs);
    await GET(req('GET'));
    expect(sheets.getTransactions).toHaveBeenCalledTimes(1); // served from cache the 2nd time
  });
});

describe('POST /api/transactions (add → returns recomputed balances)', () => {
  it('applies an expense, returns authoritative accounts, and invalidates caches', async () => {
    (sheets.getAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeAccount({ id: 'a1', type: 'checking', balance: 100 }),
    ]);
    setCache('dashboard:sheet1', 'stale'); // should be cleared by the write

    const tx = makeTx({ id: 't1', amount: 30, type: 'expense', account: 'a1' });
    const res = await POST(req('POST', tx));
    const data = await res.json();

    expect(data.ok).toBe(true);
    expect(data.accounts).toEqual([expect.objectContaining({ id: 'a1', balance: 70 })]); // 100 − 30
    expect(sheets.addTransaction).toHaveBeenCalledWith('tok', 'sheet1', tx); // ledger row written first
    expect(sheets.persistChangedAccounts).toHaveBeenCalledTimes(1);
    expect(getCache('dashboard:sheet1')).toBeNull(); // TX_CACHES invalidated
  });
});

describe('PUT /api/transactions (edit → reverse old, apply new)', () => {
  it('rebuilds the balance from the amount change', async () => {
    // a1 currently reflects the original −30 expense (started at 100).
    (sheets.getAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeAccount({ id: 'a1', type: 'checking', balance: 70 }),
    ]);
    const original = makeTx({ id: 't1', amount: 30, type: 'expense', account: 'a1' });
    const updated = makeTx({ id: 't1', amount: 50, type: 'expense', account: 'a1' });

    const res = await PUT(req('PUT', { original, updated }));
    const data = await res.json();

    // reverse 30 (70→100), apply 50 (100→50)
    expect(data.accounts).toEqual([expect.objectContaining({ id: 'a1', balance: 50 })]);
    expect(sheets.updateTransaction).toHaveBeenCalledWith('tok', 'sheet1', updated);
  });
});

describe('DELETE /api/transactions (delete → reverse balance)', () => {
  it('reverses the deleted expense and returns restored balances', async () => {
    const existing = makeTx({ id: 't1', amount: 30, type: 'expense', account: 'a1' });
    (sheets.getTransactions as ReturnType<typeof vi.fn>).mockResolvedValue([existing]);
    (sheets.getAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeAccount({ id: 'a1', type: 'checking', balance: 70 }),
    ]);

    const res = await DELETE(req('DELETE', { id: 't1' }));
    const data = await res.json();

    expect(data.accounts).toEqual([expect.objectContaining({ id: 'a1', balance: 100 })]); // 70 + 30 back
    expect(sheets.deleteTransaction).toHaveBeenCalledWith('tok', 'sheet1', 't1');
  });

  it('still 200s (no balance change) when the id is unknown', async () => {
    (sheets.getTransactions as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const accts = [makeAccount({ id: 'a1', type: 'checking', balance: 100 })];
    (sheets.getAccounts as ReturnType<typeof vi.fn>).mockResolvedValue(accts);

    const res = await DELETE(req('DELETE', { id: 'missing' }));
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.accounts).toEqual(accts); // unchanged
    expect(sheets.persistChangedAccounts).not.toHaveBeenCalled();
  });
});

describe('funding pool reconciliation (linked cash rows edited/deleted here)', () => {
  function makePool(o: Partial<Funding> = {}): Funding {
    return {
      id: 'f1', description: 'Trip', account: 'a1', date: '2026-06-01',
      participants: [
        { name: 'Me', contributed: 100, isMe: true },
        { name: 'Alex', contributed: 200, isMe: false },
      ],
      totalContributed: 300, spent: 100,
      contributionTxId: 'ctx1', spendTxIds: ['stx1'], closed: false,
      ...o,
    };
  }
  const fundingTx = (o: Partial<Transaction> & { id: string }) =>
    makeTx({ category: 'Funding', ...o });

  beforeEach(() => {
    (sheets.getAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeAccount({ id: 'a1', type: 'checking', balance: 500 }),
    ]);
  });

  it('PUT on a pool spend row mirrors the amount change into spent', async () => {
    (sheets.getFundings as ReturnType<typeof vi.fn>).mockResolvedValue([makePool()]);
    setCache('funding:sheet1', 'stale');

    const original = fundingTx({ id: 'stx1', amount: 100 });
    const updated = fundingTx({ id: 'stx1', amount: 80 });
    await PUT(req('PUT', { original, updated }));

    expect(sheets.upsertFunding).toHaveBeenCalledWith('tok', 'sheet1',
      expect.objectContaining({ id: 'f1', spent: 80, spendTxIds: ['stx1'] }));
    expect(getCache('funding:sheet1')).toBeNull(); // funding cache invalidated
  });

  it('PUT on the contribution row rescales others shares + the pool total', async () => {
    (sheets.getFundings as ReturnType<typeof vi.fn>).mockResolvedValue([makePool()]);

    const original = fundingTx({ id: 'ctx1', amount: 200, type: 'transfer', account: '', toAccount: 'a1' });
    const updated = { ...original, amount: 100 };
    await PUT(req('PUT', { original, updated }));

    expect(sheets.upsertFunding).toHaveBeenCalledWith('tok', 'sheet1',
      expect.objectContaining({
        totalContributed: 200, // my 100 + others 100
        participants: [
          { name: 'Me', contributed: 100, isMe: true },
          { name: 'Alex', contributed: 100, isMe: false },
        ],
      }));
  });

  it('DELETE of a pool spend row unlinks it and backs out its amount', async () => {
    const tx = fundingTx({ id: 'stx1', amount: 100 });
    (sheets.getTransactions as ReturnType<typeof vi.fn>).mockResolvedValue([tx]);
    (sheets.getFundings as ReturnType<typeof vi.fn>).mockResolvedValue([makePool()]);

    await DELETE(req('DELETE', { id: 'stx1' }));

    expect(sheets.upsertFunding).toHaveBeenCalledWith('tok', 'sheet1',
      expect.objectContaining({ id: 'f1', spent: 0, spendTxIds: [] }));
  });

  it('splitting a pool spend row (POST replaceId) is a removal for the pool', async () => {
    const tx = fundingTx({ id: 'stx1', amount: 100 });
    (sheets.getTransactions as ReturnType<typeof vi.fn>).mockResolvedValue([tx]);
    (sheets.getFundings as ReturnType<typeof vi.fn>).mockResolvedValue([makePool()]);

    const splits = [
      makeTx({ id: 's1', amount: 60, splitGroupId: 'g1' }),
      makeTx({ id: 's2', amount: 40, splitGroupId: 'g1' }),
    ];
    await POST(req('POST', { splits, replaceId: 'stx1' }));

    expect(sheets.upsertFunding).toHaveBeenCalledWith('tok', 'sheet1',
      expect.objectContaining({ id: 'f1', spent: 0, spendTxIds: [] }));
  });

  it('non-funding edits and deletes never read or write pools', async () => {
    const original = makeTx({ id: 't1', amount: 30 }); // category Food
    await PUT(req('PUT', { original, updated: { ...original, amount: 50 } }));

    (sheets.getTransactions as ReturnType<typeof vi.fn>).mockResolvedValue([original]);
    await DELETE(req('DELETE', { id: 't1' }));

    expect(sheets.getFundings).not.toHaveBeenCalled();
    expect(sheets.upsertFunding).not.toHaveBeenCalled();
  });

  it('funding-category rows not linked to any pool leave pools untouched', async () => {
    (sheets.getFundings as ReturnType<typeof vi.fn>).mockResolvedValue([makePool()]);
    const original = fundingTx({ id: 'loose', amount: 10 });
    await PUT(req('PUT', { original, updated: { ...original, amount: 20 } }));

    expect(sheets.getFundings).toHaveBeenCalled(); // category matched → checked
    expect(sheets.upsertFunding).not.toHaveBeenCalled(); // …but nothing linked
  });
});
