import { describe, expect, it, vi } from 'vitest';
import type { Account, Funding, Transaction } from '@/types';
import {
  buildNetWorthSeries, calcCashFlowProjection, calcFundingHeldByAccount, calcNetWorth,
  cardPaymentStatus, daysUntilStatement, detectSubscriptions, merchantMatches, roundCents,
} from '@/lib/calculations';
import { buildNotifications } from '@/lib/notifications';
import { formatCompact, formatCurrency, matchesRange, parseTagInput, today, zonedNow } from '@/lib/utils';
import { resolveDashboardLayout } from '@/lib/dashboardLayout';
import { buildMoneyFlowSummary } from '@/lib/insights';

const account = (id: string, type: Account['type'], balance: number, extra: Partial<Account> = {}): Account =>
  ({ id, type, balance, name: id, institution: '', last4: '', color: '#000', createdAt: '2026-01-01', ...extra });
const tx = (id: string, date: string, type: Transaction['type'], amount: number, extra: Partial<Transaction> = {}): Transaction =>
  ({ id, date, type, amount, description: 'Merchant', category: 'Other', account: 'checking', ...extra });

// These cases exercise public calculation contracts without changing the production fixture.
describe('extreme financial inputs', () => {
  it('keeps trillion-scale assets, 9,876,543,210.99 debt and negative balances signed', () => {
    const accounts = [account('checking', 'checking', 1e12), account('loan', 'loan', 9876543210.99), account('cash', 'cash', -50)];
    expect(calcNetWorth(accounts, [], 'total')).toBe(990123456739.01);
    expect(calcNetWorth(accounts, [], 'liquid')).toBe(999999999950);
    expect(calcNetWorth([], [], 'total')).toBe(0);
  });

  it('keeps integer dollar values near Number.MAX_SAFE_INTEGER finite', () => {
    const value = Number.MAX_SAFE_INTEGER - 100;
    expect(calcNetWorth([account('checking', 'checking', value)], [], 'total')).toBe(value);
    expect(formatCurrency(value)).toContain('9,007,199,254,740,891');
  });

  it('rounds binary floating cents and funding transfers by account', () => {
    expect(roundCents(0.1 + 0.2)).toBe(0.3);
    // 0.1 + 0.2 from others, 0.1 spent → 0.2 left, all others' money.
    const pool: Funding = {
      id: 'f', description: 'Pool', account: 'checking', date: '2026-01-01', kind: 'real', poolAccountId: 'checking',
      participants: [{ name: 'A', contributed: 0.1, isMe: false }, { name: 'B', contributed: 0.2, isMe: false }],
      totalContributed: 0.1 + 0.2, spent: 0.1, contributionTxId: '', spendTxIds: [], repayments: [], closed: false,
    };
    expect(calcFundingHeldByAccount([pool])).toEqual({ checking: 0.2 });
    expect(calcNetWorth([account('checking', 'checking', 1)], [pool], 'total')).toBe(0.8);
  });

  it('returns empty history and no projection without transactions', () => {
    const now = new Date(2024, 1, 29);
    expect(buildNetWorthSeries({ liveNetWorth: -1e12, transactions: [], accounts: [], snapshots: [], basis: 'total', now }))
      .toEqual([{ month: '2024-02', netWorth: -1e12, kind: 'live' }]);
    expect(calcCashFlowProjection({ liveNetWorth: 0, transactions: [], accounts: [], basis: 'total', now })).toBeNull();
  });

  it('walks across leap February and keeps the live month anchored', () => {
    const series = buildNetWorthSeries({
      liveNetWorth: 100, accounts: [], snapshots: [], basis: 'total', now: new Date(2024, 2, 31),
      transactions: [tx('jan', '2024-01-31', 'income', 10), tx('feb', '2024-02-29', 'expense', 25), tx('mar', '2024-03-31', 'income', 5)],
    });
    expect(series).toEqual([
      { month: '2024-01', netWorth: 120, kind: 'estimated' },
      { month: '2024-02', netWorth: 95, kind: 'estimated' },
      { month: '2024-03', netWorth: 100, kind: 'live' },
    ]);
  });

  it('uses complete months for a negative cash-flow projection', () => {
    const result = calcCashFlowProjection({ liveNetWorth: -100, basis: 'total', accounts: [], now: new Date(2024, 2, 31), months: 2,
      transactions: [tx('jan', '2024-01-31', 'expense', 10), tx('feb', '2024-02-29', 'expense', 20), tx('mar', '2024-03-01', 'income', 1e12)],
    });
    expect(result).toMatchObject({ monthlyChange: -15, basedOnMonths: 2, values: [-115, -130] });
  });

  it('clamps day 31 to a 30-day month and statement day 29 to leap February', () => {
    const card = account('card', 'credit', 100, { dueDay: 31, statementDay: 29, minPayment: 25 });
    expect(cardPaymentStatus(card, [], new Date(2024, 3, 1))).toMatchObject({ dueDate: '2024-03-31', status: 'overdue' });
    expect(daysUntilStatement(29, new Date(2024, 1, 28))).toBe(1);
    expect(daysUntilStatement(29, new Date(2023, 1, 28))).toBe(0);
    expect(cardPaymentStatus(account('card', 'credit', 100, { dueDay: 31, statementDay: 15 }), [], new Date(2024, 3, 20))?.dueDate).toBe('2024-04-30');
  });

  it('does not double-count same-day subscription charges as cycles', () => {
    const rows = [
      tx('a', '2024-01-31', 'expense', 10, { description: 'NETFLIX' }),
      tx('b', '2024-01-31', 'expense', 10, { description: 'NETFLIX' }),
      tx('c', '2024-02-29', 'expense', 10, { description: 'NETFLIX' }),
      tx('d', '2024-03-31', 'expense', 10, { description: 'NETFLIX' }),
    ];
    expect(detectSubscriptions(rows, new Date(2024, 3, 1))[0]).toMatchObject({ occurrences: 3, firstDate: '2024-01-31', lastDate: '2024-03-31' });
  });

  it('matches long Vietnamese and emoji merchant names without accepting a different word', () => {
    const name = `Cửa hàng Nguyễn 🐟 ${'đặc biệt '.repeat(55)}`;
    expect(name.length).toBeGreaterThan(500);
    expect(merchantMatches(name, name)).toBe(true);
    expect(merchantMatches(name, 'Completely unrelated')).toBe(false);
  });

  it('parses 500-character tags, Unicode, emoji, pipe and duplicate comma entries', () => {
    const long = 'x'.repeat(500);
    expect(parseTagInput(` ${long}, Nguyễn 🐟|trip,nguyễn 🐟trip,,${long}`)).toEqual([long, 'Nguyễn 🐟trip']);
  });

  it('keeps date and amount range bounds inclusive at extreme values', () => {
    const row = { date: '2024-02-29', amount: 9876543210.99 };
    expect(matchesRange(row, { from: '2024-02-29', to: '2024-02-29', min: '0', max: '9876543210.99' })).toBe(true);
    expect(matchesRange(row, { from: '2024-03-01', to: '', min: '', max: '' })).toBe(false);
  });

  it('formats zero, negative cents and large compact amounts', () => {
    expect(formatCurrency(0)).toBe('$0.00');
    expect(formatCurrency(-0.01, true)).toBe('-$0.01');
    expect(formatCompact(-9876543210.99)).toBe('-$9876.54M');
  });

  it('resolves layout duplicates and unknown names once', () => {
    const layout = resolveDashboardLayout(['-credit', 'credit', 'unknown', 'netWorth']);
    expect(layout.filter((item) => item.id === 'credit')).toEqual([{ id: 'credit', visible: false }]);
    expect(layout).toHaveLength(8);
  });

  it('mutes notifications even for a negative account', () => {
    const data = { accounts: [account('checking', 'checking', -1e12)], bills: [], budgets: [], transactions: [] };
    const ctx = { now: new Date(2024, 1, 29), monthKey: '2024-02', tr: (key: string) => key, fmt: formatCurrency };
    expect(buildNotifications(data, ctx).some((note) => note.type === 'overdraft')).toBe(true);
    expect(buildNotifications(data, ctx, { mutedNotifications: ['overdraft'] }).some((note) => note.type === 'overdraft')).toBe(false);
  });

  // Was a bug (found by Codex): roundCents kept negative zero → "-$0.00". Fixed in roundCents.
  it('summarizes duplicate same-day cents without losing the kept amount', () => {
    const rows = [tx('a', '2024-02-29', 'income', 0.3), tx('b', '2024-02-29', 'expense', 0.1), tx('c', '2024-02-29', 'expense', 0.2)];
    expect(buildMoneyFlowSummary(rows, '2024-02')).toMatchObject({ income: 0.3, spending: 0.3, kept: 0 });
  });

  it('converts one instant into different calendar days across time zones', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2024-03-01T01:30:00Z'));
      expect(today('UTC')).toBe('2024-03-01');
      expect(today('America/New_York')).toBe('2024-02-29');
      expect(zonedNow('America/New_York').getDate()).toBe(29);
    } finally { vi.useRealTimers(); }
  });

  it('detects subscriptions in 20,000 rows within one second', () => {
    const rows = Array.from({ length: 20_000 }, (_, i) =>
      tx(`tx${i}`, `2024-${String((i % 12) + 1).padStart(2, '0')}-15`, 'expense', 10 + (i % 7), { description: `Merchant ${i % 200}` }));
    const start = performance.now();
    const result = detectSubscriptions(rows, new Date(2024, 11, 31));
    expect(performance.now() - start).toBeLessThan(1_000);
    expect(Array.isArray(result)).toBe(true);
  });
});
