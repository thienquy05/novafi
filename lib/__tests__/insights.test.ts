import { describe, it, expect } from 'vitest';
import { buildInsights, buildMoneyFlowSummary, topInsights, type InsightContext, type InsightData } from '../insights';
import type { Account, Bill, Goal, Transaction, TaxSettings } from '@/types';
import { DEFAULT_TAX_SETTINGS } from '@/lib/utils';

// ── Fixtures ─────────────────────────────────────────────────────────────────
// Anchored to July 2026 (mid-month) so month keys and day math are stable.
const NOW = new Date(2026, 6, 15); // Jul 15, 2026
const MONTH = '2026-07';
const PREV = '2026-06';

const ctx: InsightContext = {
  now: NOW,
  monthKey: MONTH,
  prevMonthKey: PREV,
  daysInMonth: 31,
  daysElapsed: 15,
  tr: (key, params) => `${key}|${JSON.stringify(params ?? {})}`,
  fmt: (n) => `$${n}`,
};

let seq = 0;
const tx = (over: Partial<Transaction>): Transaction => ({
  id: `tx${++seq}`,
  date: `${MONTH}-05`,
  description: 'test',
  amount: 100,
  type: 'expense',
  category: 'Food',
  account: 'chk',
  ...over,
});

const account = (over: Partial<Account>): Account => ({
  id: 'chk',
  name: 'Checking',
  type: 'checking',
  institution: '',
  balance: 5000,
  last4: '',
  color: '#000',
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

const bill = (over: Partial<Bill>): Bill => ({
  id: `b${++seq}`,
  name: 'Rent',
  amount: 100,
  frequency: 'monthly',
  nextDue: `${MONTH}-25`,
  account: 'chk',
  category: 'Bills',
  isActive: true,
  ...over,
});

const goal = (over: Partial<Goal>): Goal => ({
  id: `g${++seq}`,
  name: 'Trip',
  targetAmount: 1200,
  currentAmount: 0,
  deadline: '2026-09-15',
  icon: '🎯',
  ...over,
});

const data = (over: Partial<InsightData> = {}): InsightData => ({
  accounts: [account({})],
  transactions: [],
  bills: [],
  goals: [],
  paychecks: [],
  settings: DEFAULT_TAX_SETTINGS as TaxSettings,
  ...over,
});

const kinds = (items: ReturnType<typeof buildInsights>) => items.map((i) => i.kind);

// ── Money-flow summary ───────────────────────────────────────────────────────

describe('buildMoneyFlowSummary', () => {
  it('sums this month and derives kept + clamped keep rate', () => {
    const txs = [
      tx({ type: 'income', amount: 2000, category: 'Paycheck' }),
      tx({ amount: 500 }),
      tx({ amount: 250, date: `${PREV}-10` }), // other month — excluded
    ];
    const flow = buildMoneyFlowSummary(txs, MONTH);
    expect(flow.income).toBe(2000);
    expect(flow.spending).toBe(500);
    expect(flow.kept).toBe(1500);
    expect(flow.keptPct).toBe(75);
  });

  it('clamps the keep rate at 0 when overspending (matches calcSavingsRate)', () => {
    const flow = buildMoneyFlowSummary([
      tx({ type: 'income', amount: 100 }),
      tx({ amount: 300 }),
    ], MONTH);
    expect(flow.kept).toBe(-200);
    expect(flow.keptPct).toBe(0);
  });
});

// ── Rules ────────────────────────────────────────────────────────────────────

describe('buildInsights', () => {
  it('is empty-safe with no data', () => {
    expect(buildInsights(data(), ctx)).toEqual([]);
  });

  it('emits an urgent cash-flow pulse when spending passes income', () => {
    const items = buildInsights(data({
      transactions: [tx({ type: 'income', amount: 100 }), tx({ amount: 400 })],
    }), ctx);
    const pulse = items.find((i) => i.kind === 'cashflow');
    expect(pulse).toBeDefined();
    expect(pulse!.tone).toBe('rose');
    expect(pulse!.body).toContain('insights.pulseNegativeBody');
    expect(pulse!.id).toBe(`cashflow:${MONTH}`);
  });

  it('flags a month-end crunch when remaining bills exceed checking cash', () => {
    const items = buildInsights(data({
      accounts: [account({ balance: 100 })],
      bills: [bill({ amount: 600 })],
    }), ctx);
    const crunch = items.find((i) => i.kind === 'crunch');
    expect(crunch).toBeDefined();
    expect(crunch!.tone).toBe('rose');
    expect(crunch!.priority).toBe(100);
    expect(crunch!.href).toBe('/bills');
  });

  it('downgrades to a "tight month" heads-up when cash covers bills with little slack', () => {
    // leftToSpend = 700 − 600 = 100, under half the bill total → amber guide.
    const items = buildInsights(data({
      accounts: [account({ balance: 700 })],
      bills: [bill({ amount: 600 })],
    }), ctx);
    const crunch = items.find((i) => i.kind === 'crunch');
    expect(crunch).toBeDefined();
    expect(crunch!.tone).toBe('amber');
    expect(crunch!.body).toContain('insights.tightBody');
  });

  it('spots a category spike vs its own 3-month average', () => {
    const txs: Transaction[] = [];
    // $100/month of Dining for the prior 3 months…
    for (const m of ['2026-04', '2026-05', '2026-06']) {
      txs.push(tx({ date: `${m}-10`, amount: 100, category: 'Dining' }));
    }
    // …and $300 this month (3× the average, $200 over).
    txs.push(tx({ date: `${MONTH}-08`, amount: 300, category: 'Dining' }));
    const items = buildInsights(data({ transactions: txs }), ctx);
    const spike = items.find((i) => i.kind === 'spike');
    expect(spike).toBeDefined();
    expect(spike!.id).toBe(`spike:${MONTH}:Dining`);
    expect(spike!.href).toBe('/reports');
  });

  it('stays quiet about categories within their normal rhythm', () => {
    const txs: Transaction[] = [];
    for (const m of ['2026-04', '2026-05', '2026-06']) {
      txs.push(tx({ date: `${m}-10`, amount: 100, category: 'Dining' }));
    }
    txs.push(tx({ date: `${MONTH}-08`, amount: 110, category: 'Dining' })); // +10% only
    const items = buildInsights(data({ transactions: txs }), ctx);
    expect(kinds(items)).not.toContain('spike');
  });

  it('nudges the worst credit card over the recommended utilization', () => {
    const items = buildInsights(data({
      accounts: [
        account({}),
        account({ id: 'cc', name: 'Sapphire', type: 'credit', balance: 800, creditLimit: 1000 }),
      ],
    }), ctx);
    const credit = items.find((i) => i.kind === 'credit');
    expect(credit).toBeDefined();
    expect(credit!.id).toBe('credit:cc');
    expect(credit!.tone).toBe('rose'); // 80% ≥ 50 → urgent
    expect(credit!.href).toBe('/credit');
    // Pay-down to 30% of a $1000 limit from $800 owed = $500.
    expect(credit!.body).toContain('$500');
  });

  it('celebrates a surplus month with a savings opportunity', () => {
    const items = buildInsights(data({
      transactions: [
        tx({ type: 'income', amount: 3000 }),
        tx({ amount: 300 }), // run-rate ≈ $620/mo → big surplus
      ],
    }), ctx);
    const opp = items.find((i) => i.kind === 'opportunity');
    expect(opp).toBeDefined();
    expect(opp!.tone).toBe('emerald');
    expect(opp!.href).toBe('/savings');
  });

  it('routes the opportunity toward a goal when one exists', () => {
    const items = buildInsights(data({
      transactions: [tx({ type: 'income', amount: 3000 }), tx({ amount: 300 })],
      goals: [goal({})],
    }), ctx);
    const opp = items.find((i) => i.kind === 'opportunity');
    expect(opp).toBeDefined();
    expect(opp!.href).toBe('/planning');
    expect(opp!.body).toContain('insights.opportunityGoalBody');
  });

  it('suppresses the opportunity while a crunch is active', () => {
    const items = buildInsights(data({
      accounts: [account({ balance: 100 })],
      bills: [bill({ amount: 600 })],
      transactions: [tx({ type: 'income', amount: 3000 }), tx({ amount: 300 })],
    }), ctx);
    expect(kinds(items)).toContain('crunch');
    expect(kinds(items)).not.toContain('opportunity');
  });

  it('flags a goal whose runway has gotten steep', () => {
    // $1200 target, $0 saved, 2 months left → $600/mo needed ≫ even split $100/mo.
    const g = goal({});
    const items = buildInsights(data({ goals: [g] }), ctx);
    const gi = items.find((i) => i.kind === 'goal');
    expect(gi).toBeDefined();
    expect(gi!.id).toBe(`goal:${g.id}`);
    expect(gi!.href).toBe('/planning');
  });

  it('awards a win for a ≥20% keep rate that is not sliding', () => {
    const items = buildInsights(data({
      transactions: [
        tx({ type: 'income', amount: 1000 }),
        tx({ amount: 400 }),
        // Last month kept less (50% → 60% now), so this month counts as a win.
        tx({ type: 'income', amount: 1000, date: `${PREV}-05` }),
        tx({ amount: 500, date: `${PREV}-10` }),
      ],
    }), ctx);
    const win = items.find((i) => i.kind === 'win');
    expect(win).toBeDefined();
    expect(win!.tone).toBe('emerald');
  });

  it('sorts urgent first and topInsights caps the list', () => {
    const items = buildInsights(data({
      accounts: [
        account({ balance: 100 }),
        account({ id: 'cc', name: 'Card', type: 'credit', balance: 900, creditLimit: 1000 }),
      ],
      bills: [bill({ amount: 600 })],
      transactions: [tx({ type: 'income', amount: 100 }), tx({ amount: 400 })],
      goals: [goal({})],
    }), ctx);
    // crunch (100) must lead; priorities must be non-increasing.
    expect(items[0].kind).toBe('crunch');
    for (let i = 1; i < items.length; i++) {
      expect(items[i - 1].priority).toBeGreaterThanOrEqual(items[i].priority);
    }
    const top = topInsights(data({
      accounts: [
        account({ balance: 100 }),
        account({ id: 'cc', name: 'Card', type: 'credit', balance: 900, creditLimit: 1000 }),
      ],
      bills: [bill({ amount: 600 })],
      transactions: [tx({ type: 'income', amount: 100 }), tx({ amount: 400 })],
      goals: [goal({})],
    }), ctx);
    expect(top.length).toBeLessThanOrEqual(4);
  });
});
