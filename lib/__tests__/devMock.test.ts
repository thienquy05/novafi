import { describe, it, expect, beforeAll, vi } from 'vitest';

// Runs the REAL lib/sheets.ts read/write functions against the in-memory mock
// (lib/devMock.ts) — an integration check of parsing + writes, using the
// extreme test profile (huge numbers, long names, >2,000 transactions).
let sheets: typeof import('@/lib/sheets');
let mock: typeof import('@/lib/devMock');
const SID = 'mock-extreme';

beforeAll(async () => {
  vi.stubEnv('NOVAFI_MOCK', '1');
  vi.stubEnv('NODE_ENV', 'test');
  mock = await import('@/lib/devMock');
  sheets = await import('@/lib/sheets');
  mock.resetMockBooks();
});

describe('dev mock Sheets (extreme profile)', () => {
  it('parses every tab with extreme values intact', async () => {
    const data = await sheets.batchGetDashboardData('mock', SID);
    expect(data.transactions.length).toBeGreaterThan(2000);
    const chk = data.accounts.find((a) => a.id === 'chk')!;
    expect(chk.balance).toBe(9876543210.99);
    expect(chk.name.length).toBeGreaterThan(60);
    expect(data.accounts.find((a) => a.id === 'cc1')).toMatchObject({ dueDay: 25, minPayment: 375, creditLimit: 25000 });
    expect(data.settings.displayName).toContain('Nguyễn');
    expect(data.netWorthHistory[0].liquid).toBeGreaterThan(0);
    expect(data.transactions.some((t) => (t.tags ?? []).includes('Japan trip 2026 with the whole extended family'))).toBe(true);
  });

  it('editing a row past the first 2,000 updates it in place (no duplicate)', async () => {
    const before = await sheets.getTransactions('mock', SID);
    const target = before[2100];
    await sheets.updateTransaction('mock', SID, { ...target, description: 'edited', tags: ['x'] });
    const after = await sheets.getTransactions('mock', SID);
    expect(after).toHaveLength(before.length);
    expect(after.filter((t) => t.id === target.id)).toEqual([expect.objectContaining({ description: 'edited', tags: ['x'] })]);
  });

  it('net-worth snapshot upserts one row per month', async () => {
    const snap = { id: 'nw_2099-01', date: '2099-01-02', month: '2099-01', netWorth: 1, creditUtil: null, total: 1, liquid: 2 };
    await sheets.upsertNetWorthSnapshot('mock', SID, snap);
    await sheets.upsertNetWorthSnapshot('mock', SID, { ...snap, netWorth: 5, total: 5 });
    const rows = (await sheets.getNetWorthHistory('mock', SID)).filter((s) => s.month === '2099-01');
    expect(rows).toEqual([expect.objectContaining({ netWorth: 5, total: 5, liquid: 2 })]);
  });

  it('settings lists round-trip (dismissals, layout, notification prefs)', async () => {
    const s = await sheets.getSettings('mock', SID);
    await sheets.saveSettings('mock', SID, { ...s, dismissedSubscriptions: ['chick fil a'], dashboardLayout: ['-credit'], budgetAlertPct: 80, billReminderDays: 3 });
    expect(await sheets.getSettings('mock', SID)).toMatchObject({ dismissedSubscriptions: ['chick fil a'], dashboardLayout: ['-credit'], budgetAlertPct: 80, billReminderDays: 3 });
  });

  it('missing tabs are created on demand', async () => {
    expect(await sheets.getContacts('mock', SID)).toEqual([]);
  });
});
