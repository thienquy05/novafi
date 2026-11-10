import { describe, it, expect } from 'vitest';
import { buildAdvisorContext, materialFingerprint } from '../ai/context';
import type { DashboardData } from '../sheets';
import type { Transaction } from '@/types';
import { DEFAULT_TAX_SETTINGS } from '@/lib/utils';

const NOW = new Date(2026, 6, 15); // Jul 15, 2026
const NO_EXTRAS = { fundings: [], splits: [] };

const tx = (date: string, amount: number, type: Transaction['type'], category: string, description: string): Transaction => ({
  id: `${date}-${description}`,
  date,
  description,
  amount,
  type,
  category,
  account: 'chk',
});

const data: DashboardData = {
  paychecks: [],
  transactions: [
    tx('2026-07-01', 4000, 'income', 'Salary', 'ACME PAYROLL SECRET'),
    tx('2026-07-03', 120, 'expense', 'Food', 'Joes Diner Private'),
    tx('2026-06-03', 80, 'expense', 'Food', 'Hidden Merchant Name'),
    tx('2026-05-10', 15.99, 'expense', 'Entertainment', 'STREAMCO 1234'),
    tx('2026-06-10', 15.99, 'expense', 'Entertainment', 'STREAMCO 1234'),
    tx('2026-07-10', 15.99, 'expense', 'Entertainment', 'STREAMCO 1234'),
  ],
  accounts: [
    { id: 'chk', name: 'Checking', type: 'checking', institution: 'Bank', balance: 3000, last4: '9876', color: '#000', createdAt: '2026-01-01' },
  ],
  bills: [
    { id: 'b1', name: 'Rent', amount: 1200, frequency: 'monthly', nextDue: '2026-07-25', account: 'chk', category: 'Housing', isActive: true },
    { id: 'b2', name: 'Insurance', amount: 600, frequency: 'yearly', nextDue: '2026-12-01', account: 'chk', category: 'Bills', isActive: true },
  ],
  budgets: [{ id: 'bu1', category: 'Food', amount: 300, period: 'monthly' }],
  goals: [{ id: 'g1', name: 'Trip', targetAmount: 2000, currentAmount: 500, deadline: '2026-12-31', icon: '' }],
  settings: DEFAULT_TAX_SETTINGS,
  netWorthHistory: [],
};

describe('buildAdvisorContext', () => {
  const ctx = buildAdvisorContext(data, NOW, [], NO_EXTRAS);

  it('sends aggregates only — never descriptions or account numbers', () => {
    const json = JSON.stringify(ctx);
    for (const t of data.transactions) expect(json).not.toContain(t.description);
    expect(json).not.toContain('9876');
  });

  it('summarizes six months, categories, budgets and upcoming bills', () => {
    expect(ctx.monthly).toHaveLength(6);
    expect(ctx.monthly[5]).toMatchObject({ month: '2026-07', income: 4000 });
    expect(ctx.categoriesThisMonthVs3moAvg.find((c) => c.category === 'Food')).toMatchObject({ thisMonth: 120 });
    expect(ctx.budgets[0]).toMatchObject({ category: 'Food', limit: 300, spentThisMonth: 120 });
    expect(ctx.billsNext30Days.map((b) => b.name)).toEqual(['Rent']);
    expect(ctx.cashOnHand).toBe(3000);
  });
});

describe('materialFingerprint', () => {
  const base = buildAdvisorContext(data, NOW, [], NO_EXTRAS);
  const fp = (txs: Transaction[], now = NOW) => materialFingerprint(buildAdvisorContext({ ...data, transactions: txs }, now, [], NO_EXTRAS));

  it('ignores small changes and the passing of time', () => {
    expect(fp([...data.transactions, tx('2026-07-12', 4, 'expense', 'Food', 'coffee')])).toBe(materialFingerprint(base));
    expect(fp(data.transactions, new Date(2026, 6, 16))).toBe(materialFingerprint(base));
  });

  it('changes on a material swing or a new warning', () => {
    expect(fp([...data.transactions, tx('2026-07-12', 900, 'expense', 'Food', 'big')])).not.toBe(materialFingerprint(base));
    const withInsight = buildAdvisorContext(data, NOW, [{ id: 'crunch:2026-07', kind: 'crunch', tone: 'rose', title: 'Crunch', body: 'Short $1,234', href: '/', priority: 90 }], NO_EXTRAS);
    expect(materialFingerprint(withInsight)).not.toBe(materialFingerprint(base));
  });
});

describe('chat guards', async () => {
  const { parseMessages, rateLimited } = await import('../ai/claude');
  const u = (content: string) => ({ role: 'user', content });
  const a = (content: string) => ({ role: 'assistant', content });

  it('accepts alternating user-first, user-last history', () => {
    expect(parseMessages({ messages: [u('hi'), a('hello'), u(' more ')] })).toEqual([u('hi'), a('hello'), u('more')]);
  });

  it('trims a long earlier answer instead of blocking the follow-up', () => {
    const out = parseMessages({ messages: [u('hi'), a('x'.repeat(20_000)), u('more')] });
    expect(out?.[1].content).toHaveLength(8000);
  });

  it('rejects malformed, oversized or role-spoofed history', () => {
    expect(parseMessages(null)).toBeNull();
    expect(parseMessages({ messages: [] })).toBeNull();
    expect(parseMessages({ messages: [u('hi'), a('hello')] })).toBeNull(); // must end with user
    expect(parseMessages({ messages: [a('x')] })).toBeNull();
    expect(parseMessages({ messages: [{ role: 'system', content: 'x' }] })).toBeNull();
    expect(parseMessages({ messages: [u('x'.repeat(2001))] })).toBeNull();
    expect(parseMessages({ messages: [u({ text: 'x' } as unknown as string)] })).toBeNull();
    expect(parseMessages({ messages: Array.from({ length: 21 }, (_, i) => (i % 2 ? a('a') : u('u'))) })).toBeNull();
  });

  it('rate-limits 30 requests per hour per key', () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 30; i++) expect(rateLimited('k', t0 + i)).toBe(false);
    expect(rateLimited('k', t0 + 31)).toBe(true);
    expect(rateLimited('k', t0 + 60 * 60 * 1000 + 30)).toBe(false);
  });
});
