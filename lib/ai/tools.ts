import type Anthropic from '@anthropic-ai/sdk';
import type { DashboardData } from '@/lib/sheets';
import {
  aggregateMonthlyTotals,
  calcCashFlowProjection,
  calcLongestUntouchedSavings,
  calcNetWorth,
  calcSavingsRate,
  normalizeMerchant,
} from '@/lib/calculations';
import type { Funding } from '@/types';

// On-demand, read-only tools for the Nova chat. The always-sent snapshot stays
// small (lib/ai/context.ts); Nova calls these only when a question needs more
// history. Everything returns compact aggregates from the same calculators the
// pages use — whole dollars, months as parallel arrays (fewer tokens than rows).
// Merchant NAMES are allowed (user's choice) but never raw descriptions, ids,
// dates of single purchases or account numbers.

export type ToolEnv = { data: DashboardData; fundings: Funding[]; now: Date };

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const usd = (n: number) => Math.round(n);
const clamp = (v: unknown, lo: number, hi: number, dflt: number) =>
  Math.min(hi, Math.max(lo, Number.isFinite(Number(v)) && v != null ? Math.floor(Number(v)) : dflt));

/** Oldest → newest month keys ending at the current month. */
function lastMonths(now: Date, n: number): string[] {
  return Array.from({ length: n }, (_, i) => monthKey(new Date(now.getFullYear(), now.getMonth() - (n - 1) + i, 1)));
}

const MONTHS_DESC = 'How many months back, including the current (partial) month.';

export const ADVISOR_TOOLS = [
  {
    name: 'monthly_history',
    description: 'Income, spending, net and savings rate per month. Use for trends, "how have I been doing", seasonal patterns.',
    input_schema: { type: 'object', properties: { months: { type: 'integer', description: `${MONTHS_DESC} Default 12, max 24.` } } },
  },
  {
    name: 'category_trend',
    description: 'Spending per month for one category, or for the top 8 categories when none is given.',
    input_schema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Exact category name; omit for the top 8.' },
        months: { type: 'integer', description: `${MONTHS_DESC} Default 6, max 12.` },
      },
    },
  },
  {
    name: 'top_merchants',
    description: 'Biggest spending merchants (name, total, number of purchases) over a period. Use for "where does my money go".',
    input_schema: {
      type: 'object',
      properties: {
        months: { type: 'integer', description: `${MONTHS_DESC} Default 3, max 12.` },
        limit: { type: 'integer', description: 'Default 10, max 20.' },
      },
    },
  },
  {
    name: 'account_flows',
    description: 'Per account: current balance and money in, out, transfers in and transfers out per month. Use for savings history, where cash moves, and money-flow questions.',
    input_schema: { type: 'object', properties: { months: { type: 'integer', description: `${MONTHS_DESC} Default 6, max 12.` } } },
  },
  {
    name: 'cash_flow_outlook',
    description: 'Projected net worth for the next 6 months from the recent average monthly savings (total and liquid basis), plus the savings account that has gone longest without a deposit.',
    input_schema: { type: 'object', properties: {} },
  },
] satisfies Anthropic.Beta.BetaTool[];

function monthlyHistory(env: ToolEnv, input: Record<string, unknown>) {
  const months = lastMonths(env.now, clamp(input.months, 1, 24, 12));
  const byMonth = new Map(aggregateMonthlyTotals(env.data.transactions).map((m) => [m.monthKey, m]));
  const rows = months.map((m) => byMonth.get(m));
  return {
    months,
    income: rows.map((r) => usd(r?.income ?? 0)),
    spending: rows.map((r) => usd(r?.expense ?? 0)),
    net: rows.map((r) => usd(r?.net ?? 0)),
    savingsRatePct: rows.map((r) => Math.round(calcSavingsRate(r?.income ?? 0, r?.expense ?? 0))),
  };
}

function categoryTrend(env: ToolEnv, input: Record<string, unknown>) {
  const months = lastMonths(env.now, clamp(input.months, 1, 12, 6));
  const idx = new Map(months.map((m, i) => [m, i]));
  const wanted = typeof input.category === 'string' ? input.category.trim().toLowerCase() : '';
  const series = new Map<string, number[]>();
  for (const t of env.data.transactions) {
    const i = idx.get(t.date.slice(0, 7));
    if (t.type !== 'expense' || i === undefined) continue;
    if (wanted && t.category.toLowerCase() !== wanted) continue;
    const arr = series.get(t.category) ?? new Array(months.length).fill(0);
    arr[i] += t.amount;
    series.set(t.category, arr);
  }
  const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);
  const top = [...series.entries()].sort((a, b) => sum(b[1]) - sum(a[1])).slice(0, wanted ? 1 : 8);
  return { months, categories: Object.fromEntries(top.map(([c, a]) => [c, a.map(usd)])) };
}

function topMerchants(env: ToolEnv, input: Record<string, unknown>) {
  const months = new Set(lastMonths(env.now, clamp(input.months, 1, 12, 3)));
  const limit = clamp(input.limit, 1, 20, 10);
  const byMerchant = new Map<string, { total: number; count: number }>();
  for (const t of env.data.transactions) {
    if (t.type !== 'expense' || !months.has(t.date.slice(0, 7))) continue;
    const name = normalizeMerchant(t.description).slice(0, 40) || t.category.toLowerCase();
    const row = byMerchant.get(name) ?? { total: 0, count: 0 };
    row.total += t.amount;
    row.count += 1;
    byMerchant.set(name, row);
  }
  return {
    merchants: [...byMerchant.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, limit)
      .map(([merchant, r]) => ({ merchant, total: usd(r.total), purchases: r.count })),
  };
}

function accountFlows(env: ToolEnv, input: Record<string, unknown>) {
  const months = lastMonths(env.now, clamp(input.months, 1, 12, 6));
  const idx = new Map(months.map((m, i) => [m, i]));
  const blank = () => new Array<number>(months.length).fill(0);
  const flows = new Map(env.data.accounts.filter((a) => a.type !== 'pool').map((a) => [a.id, { in: blank(), out: blank(), xferIn: blank(), xferOut: blank() }]));
  for (const t of env.data.transactions) {
    const i = idx.get(t.date.slice(0, 7));
    if (i === undefined) continue;
    if (t.type === 'income') { const f = flows.get(t.account); if (f) f.in[i] += t.amount; }
    else if (t.type === 'expense') { const f = flows.get(t.account); if (f) f.out[i] += t.amount; }
    else {
      const from = flows.get(t.account);
      const to = t.toAccount ? flows.get(t.toAccount) : undefined;
      if (from) from.xferOut[i] += t.amount;
      if (to) to.xferIn[i] += t.amount;
    }
  }
  return {
    months,
    accounts: env.data.accounts
      .filter((a) => flows.has(a.id))
      .map((a) => {
        const f = flows.get(a.id)!;
        return { name: a.name, type: a.type, balance: usd(a.balance), in: f.in.map(usd), out: f.out.map(usd), transfersIn: f.xferIn.map(usd), transfersOut: f.xferOut.map(usd) };
      }),
  };
}

function cashFlowOutlook(env: ToolEnv) {
  const { data, fundings, now } = env;
  const project = (basis: 'total' | 'liquid') =>
    calcCashFlowProjection({ liveNetWorth: calcNetWorth(data.accounts, fundings, basis), transactions: data.transactions, accounts: data.accounts, basis, now });
  const fmt = (f: ReturnType<typeof project>) => (f ? { monthlyChange: usd(f.monthlyChange), next6Months: f.values.map(usd), basedOnMonths: f.basedOnMonths } : null);
  const stale = calcLongestUntouchedSavings(data.accounts, data.transactions, now);
  return {
    total: fmt(project('total')),
    liquid: fmt(project('liquid')),
    longestUntouchedSavings: stale ? { account: stale.account.name, lastDeposit: stale.lastDeposit, daysSince: stale.daysSince } : null,
  };
}

/** Runs one tool; always returns a compact JSON string (errors included) so a bad call never breaks the chat. */
export function runAdvisorTool(name: string, input: unknown, env: ToolEnv): string {
  const args = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  try {
    switch (name) {
      case 'monthly_history': return JSON.stringify(monthlyHistory(env, args));
      case 'category_trend': return JSON.stringify(categoryTrend(env, args));
      case 'top_merchants': return JSON.stringify(topMerchants(env, args));
      case 'account_flows': return JSON.stringify(accountFlows(env, args));
      case 'cash_flow_outlook': return JSON.stringify(cashFlowOutlook(env));
      default: return JSON.stringify({ error: 'unknown_tool' });
    }
  } catch {
    return JSON.stringify({ error: 'tool_failed' });
  }
}
