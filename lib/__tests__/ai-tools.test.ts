import { describe, it, expect } from 'vitest';
import { runAdvisorTool, ADVISOR_TOOLS, type ToolEnv } from '../ai/tools';
import type { Account, Transaction } from '@/types';
import { DEFAULT_TAX_SETTINGS } from '@/lib/utils';

const NOW = new Date(2026, 6, 15); // Jul 15, 2026
const acct = (id: string, type: Account['type'], balance: number): Account => ({ id, name: id.toUpperCase(), type, institution: 'Bank', balance, last4: '9876', color: '#000', createdAt: '2026-01-01' });
const tx = (date: string, amount: number, type: Transaction['type'], category: string, description: string, account = 'chk', toAccount?: string): Transaction =>
  ({ id: `${date}-${description}`, date, description, amount, type, category, account, toAccount });

const env: ToolEnv = {
  now: NOW,
  fundings: [],
  data: {
    paychecks: [], bills: [], budgets: [], goals: [], netWorthHistory: [], settings: DEFAULT_TAX_SETTINGS,
    accounts: [acct('chk', 'checking', 3000), acct('sav', 'savings', 5000)],
    transactions: [
      tx('2026-05-01', 3800, 'income', 'Salary', 'ACME PAYROLL'),
      tx('2026-06-01', 4000, 'income', 'Salary', 'ACME PAYROLL'),
      tx('2026-07-01', 4000, 'income', 'Salary', 'ACME PAYROLL'),
      tx('2026-06-05', 100, 'expense', 'Food', 'Joes Diner 1234'),
      tx('2026-07-05', 150, 'expense', 'Food', 'JOES DINER 5678'),
      tx('2026-07-06', 60, 'expense', 'Fun', 'Cinema'),
      tx('2026-06-10', 500, 'transfer', 'Transfer', 'to savings', 'chk', 'sav'),
      tx('2025-01-10', 999, 'expense', 'Food', 'Too old'),
    ],
  },
};
const run = (name: string, input: unknown = {}) => JSON.parse(runAdvisorTool(name, input, env));

describe('advisor tools', () => {
  it('monthly_history returns parallel arrays, transfers excluded', () => {
    const r = run('monthly_history', { months: 2 });
    expect(r.months).toEqual(['2026-06', '2026-07']);
    expect(r.income).toEqual([4000, 4000]);
    expect(r.spending).toEqual([100, 210]);
    expect(r.savingsRatePct).toEqual([98, 95]);
  });

  it('clamps bad month counts instead of failing', () => {
    expect(run('monthly_history', { months: 9999 }).months).toHaveLength(24);
    expect(run('monthly_history', { months: -3 }).months).toHaveLength(1);
    expect(run('monthly_history', { months: 'x' }).months).toHaveLength(12);
  });

  it('category_trend: one category (case-insensitive) or the top ones', () => {
    expect(run('category_trend', { category: 'food', months: 2 }).categories).toEqual({ Food: [100, 150] });
    expect(Object.keys(run('category_trend', { months: 2 }).categories)).toEqual(['Food', 'Fun']);
  });

  it('top_merchants groups by normalized name, never leaks digits or old rows', () => {
    const r = run('top_merchants', { months: 3 });
    expect(r.merchants[0]).toEqual({ merchant: 'joes diner', total: 250, purchases: 2 });
    expect(JSON.stringify(r)).not.toMatch(/1234|5678|Too old/);
  });

  it('account_flows tracks money in/out and transfers, with no account numbers', () => {
    const r = run('account_flows', { months: 2 });
    const chk = r.accounts.find((a: { name: string }) => a.name === 'CHK');
    const sav = r.accounts.find((a: { name: string }) => a.name === 'SAV');
    expect(chk).toMatchObject({ in: [4000, 4000], out: [100, 210], transfersOut: [500, 0] });
    expect(sav).toMatchObject({ balance: 5000, transfersIn: [500, 0] });
    expect(JSON.stringify(r)).not.toContain('9876');
  });

  it('cash_flow_outlook projects and finds the stale savings account', () => {
    const r = run('cash_flow_outlook');
    expect(r.total.next6Months).toHaveLength(6);
    expect(r.longestUntouchedSavings.account).toBe('SAV');
  });

  it('unknown tools and garbage input return an error string, never throw', () => {
    expect(run('nope')).toEqual({ error: 'unknown_tool' });
    expect(() => runAdvisorTool('monthly_history', null, env)).not.toThrow();
  });

  it('declares exactly the tools the runner handles', () => {
    for (const t of ADVISOR_TOOLS) expect(run(t.name)).not.toEqual({ error: 'unknown_tool' });
  });
});
