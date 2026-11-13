import { describe, it, expect } from 'vitest';
import { runAdvisorTool, ADVISOR_TOOLS, maskDigits, nameMatches, type ToolEnv } from '../ai/tools';
import type { Account, Bill, Funding, Loan, Split, Transaction } from '@/types';
import { DEFAULT_TAX_SETTINGS } from '@/lib/utils';

const NOW = new Date(2026, 6, 15); // Jul 15, 2026
const acct = (id: string, type: Account['type'], balance: number): Account => ({ id, name: id.toUpperCase(), type, institution: 'Bank', balance, last4: '9876', color: '#000', createdAt: '2026-01-01' });
const tx = (date: string, amount: number, type: Transaction['type'], category: string, description: string, account = 'chk', toAccount?: string): Transaction =>
  ({ id: `${date}-${description}`, date, description, amount, type, category, account, toAccount });

const loan = (contactName: string, direction: Loan['direction'], principal: number, repaidAmount = 0, settled = false): Loan =>
  ({ id: `l-${contactName}-${principal}`, direction, contactId: 'c1', contactName, account: 'chk', category: '', principal, repaidAmount, date: '2026-06-01', note: 'rent help', settled, settledDate: '', principalTxId: '', repaymentTxIds: [] });
const split = (contactName: string, amount: number, repaidAmount = 0, billId = 'b1'): Split =>
  ({ id: `s-${contactName}-${amount}`, billId, billName: 'Internet', contactId: 'c1', contactName, amount, category: 'Utilities', account: 'chk', date: '2026-07-02', settled: false, settledDate: '', repaidAmount, repaymentTxIds: [] });
const tab: Funding = {
  id: 'f1', description: 'Da Lat trip', account: 'chk', date: '2026-07-03', kind: 'virtual', totalContributed: 300, spent: 300,
  participants: [{ id: 'p0', name: '', contributed: 100, isMe: true }, { id: 'p1', name: 'quy', contributed: 100, isMe: false }, { id: 'p2', name: 'Lan', contributed: 100, isMe: false }],
  contributionTxId: '', spendTxIds: [], repayments: [{ id: 'r1', participant: 'quy', participantId: 'p1', amount: 40, account: 'chk', date: '2026-07-10' }], closed: false,
};
const bill: Bill = { id: 'b1', name: 'Internet', amount: 60, frequency: 'monthly', nextDue: '2026-08-02', account: 'chk', category: 'Utilities', isActive: true, splitParticipants: [{ contactId: 'c1', amount: 30 }] };

const env: ToolEnv = {
  now: NOW,
  fundings: [tab],
  loans: [loan('Quý Phạm', 'lent', 200, 50), loan('Quý Phạm', 'borrowed', 30), { ...loan('Đạt', 'lent', 80, 80, true), contactId: 'c9' }],
  splits: [split('Quý Phạm', 30), split('Lan', 25, 25)],
  contacts: [{ id: 'c1', name: 'Quý Phạm', createdAt: '2026-01-01' }],
  data: {
    paychecks: [], bills: [bill], budgets: [], goals: [], netWorthHistory: [], settings: DEFAULT_TAX_SETTINGS,
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
const spotify = [
  tx('2026-05-20', 11.99, 'expense', 'Subscriptions', 'SPOTIFY USA 4412345'),
  tx('2026-06-20', 11.99, 'expense', 'Subscriptions', 'SPOTIFY USA 4412345'),
  tx('2026-07-14', 12.99, 'expense', 'Subscriptions', 'Spotify Premium'),
];
const runFind = (input: unknown = {}) =>
  JSON.parse(runAdvisorTool('find_transactions', input, { ...env, data: { ...env.data, transactions: [...env.data.transactions, ...spotify] } }));

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

  it('nameMatches: accent-insensitive word prefixes (Vietnamese)', () => {
    expect(nameMatches('Quý Phạm', 'Quy')).toBe(true);
    expect(nameMatches('Quý Phạm', 'pham q')).toBe(true);
    expect(nameMatches('Đạt', 'dat')).toBe(true);
    expect(nameMatches('Quý Phạm', 'Quang')).toBe(false);
    expect(nameMatches('Quý Phạm', '  ')).toBe(false);
  });

  it('people_owed merges loans, splits, group tabs per person by accent-folded name', () => {
    const r = run('people_owed', { name: 'Quy' });
    // "Quý Phạm" (loan + split) and the tab's "quy" both match; full names differ so they stay separate rows.
    expect(r.people.map((x: { name: string }) => x.name)).toEqual(['Quý Phạm', 'quy']);
    const p = r.people[0];
    expect(p.name).toBe('Quý Phạm');
    expect(p.theyOweMe).toBe(180); // loan 150 left + split 30
    expect(p.iOweThem).toBe(30);
    expect(p.net).toBe(150);
    expect(r.upcomingSplitBills).toEqual([{ person: 'Quý Phạm', bill: 'Internet', nextDue: '2026-08-02', frequency: 'monthly', theirShare: 30 }]);
  });

  it('people_owed overview: open balances only, settled people dropped', () => {
    const r = run('people_owed');
    const names = r.people.map((p: { name: string }) => p.name);
    expect(names).not.toContain('Đạt');
    expect(r.people.find((p: { name: string }) => p.name === 'Lan')).toMatchObject({ theyOweMe: 100, items: [{ source: 'group_tab', remaining: 100 }] });
    expect(r.totals.theyOweMe).toBe(340); // 180 Quý + 60 quy tab + 100 Lan
  });

  it('people_owed with a name includes settled history and suggests people when none match', () => {
    expect(run('people_owed', { name: 'dat' }).people[0]).toMatchObject({ name: 'Đạt', theyOweMe: 0, items: [{ source: 'loan', paidBack: 80, remaining: 0 }] });
    const miss = run('people_owed', { name: 'Zed' });
    expect(miss.people).toEqual([]);
    expect(miss.knownPeople).toContain('Quý Phạm');
  });

  it('find_transactions: per-month totals over the range, rows only for the last 2 months, digits masked', () => {
    const r = runFind({ query: 'spotify', months: 3 });
    expect(r.months).toEqual(['2026-05', '2026-06', '2026-07']);
    expect(r.spending).toEqual([11.99, 11.99, 12.99]);
    expect(r.totalSpending).toBe(36.97);
    expect(r.matches).toBe(3);
    expect(r.transactions.map((t: { date: string }) => t.date)).toEqual(['2026-07-14', '2026-06-20']);
    expect(JSON.stringify(r)).not.toContain('4412345');
  });

  it('find_transactions with no filter lists the latest rows incl. transfers, never older than 2 months', () => {
    const r = runFind();
    expect(r.transactions[0]).toMatchObject({ date: '2026-07-14', account: 'CHK' });
    expect(r.transactions.some((t: { type: string }) => t.type === 'transfer')).toBe(true);
    expect(r.transactions.every((t: { date: string }) => t.date >= '2026-06-01')).toBe(true);
  });

  it('people_owed keeps different contacts apart even when their names fold the same', () => {
    const r = JSON.parse(runAdvisorTool('people_owed', { name: 'hoa' }, {
      ...env, contacts: [], splits: [], fundings: [], data: { ...env.data, bills: [] },
      loans: [{ ...loan('Hòa', 'lent', 100), contactId: 'a' }, { ...loan('Hoa', 'lent', 200), contactId: 'b' }],
    }));
    expect(r.people.map((p: { theyOweMe: number }) => p.theyOweMe)).toEqual([200, 100]);
  });

  it('people_owed finds a renamed contact by the new and the old name', () => {
    const renamed = { ...env, contacts: [{ id: 'c1', name: 'Quý Nguyễn', createdAt: '' }] };
    for (const name of ['nguyen', 'pham']) {
      expect(JSON.parse(runAdvisorTool('people_owed', { name }, renamed)).people[0]).toMatchObject({ name: 'Quý Nguyễn', theyOweMe: 180 });
    }
  });

  it('people_owed totals cover everyone even when the list is cut, and warns on failed reads', () => {
    const many = Array.from({ length: 31 }, (_, i) => ({ ...loan(`P${i}`, 'lent', 10), contactId: `c${i}` }));
    const r = JSON.parse(runAdvisorTool('people_owed', {}, { ...env, loans: many, splits: [], fundings: [], unavailable: ['loans'] }));
    expect(r.people).toHaveLength(30);
    expect(r.morePeopleNotShown).toBe(1);
    expect(r.totals.theyOweMe).toBe(310);
    expect(r.warning).toMatch(/loans/);
  });

  it('maskDigits hides formatted number runs but keeps short numbers', () => {
    expect(maskDigits('Acct 123-456-789 ok')).toBe('Acct … ok');
    expect(maskDigits('card 4412 3456 7890 1234')).toBe('card …');
    expect(maskDigits('Pho 24')).toBe('Pho 24');
  });

  it('unknown tools and garbage input return an error string, never throw', () => {
    expect(run('nope')).toEqual({ error: 'unknown_tool' });
    expect(() => runAdvisorTool('monthly_history', null, env)).not.toThrow();
  });

  it('declares exactly the tools the runner handles', () => {
    for (const t of ADVISOR_TOOLS) expect(run(t.name)).not.toEqual({ error: 'unknown_tool' });
  });
});
