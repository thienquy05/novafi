import type { DashboardData } from '@/lib/sheets';
import type { Insight } from '@/lib/insights';
import type { Funding, Split } from '@/types';
import { calcOwedToYou } from '@/lib/receivables';
import {
  aggregateCategoryTotals,
  calcEmergencyFundMonths,
  calcMonthExpense,
  calcMonthIncome,
  calcNetWorth,
  calcSavingsRate,
  detectSubscriptions,
  myBillShare,
  roundCents,
} from '@/lib/calculations';

// The ONLY data the advisor sends to Claude: aggregates from the same shared
// calculators the pages use. Never transaction descriptions, merchants or
// account numbers (asserted in lib/__tests__/ai-context.test.ts).

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const dateKey = (d: Date) => `${monthKey(d)}-${String(d.getDate()).padStart(2, '0')}`;

/** Reads beyond the shared dashboard batch (same cache keys as the dashboard). */
export type AdvisorExtras = { fundings: Funding[]; splits: Split[] };

export function buildAdvisorContext(data: DashboardData, now: Date, insights: Insight[], { fundings, splits }: AdvisorExtras) {
  const { transactions: txs, accounts, bills, budgets, goals, settings, netWorthHistory } = data;

  const months = Array.from({ length: 6 }, (_, i) => monthKey(new Date(now.getFullYear(), now.getMonth() - 5 + i, 1)));
  const thisMonth = months[5];
  const prev3 = months.slice(2, 5);

  const monthly = months.map((month) => {
    const income = roundCents(calcMonthIncome(txs, month));
    const spending = roundCents(calcMonthExpense(txs, month));
    return { month, income, spending, savingsRatePct: Math.round(calcSavingsRate(income, spending)) };
  });

  const current = aggregateCategoryTotals(txs, thisMonth);
  const avg: Record<string, number> = {};
  for (const m of prev3) {
    for (const [cat, v] of Object.entries(aggregateCategoryTotals(txs, m))) avg[cat] = (avg[cat] ?? 0) + v / 3;
  }
  const categories = [...new Set([...Object.keys(current), ...Object.keys(avg)])]
    .map((category) => ({ category, thisMonth: current[category] ?? 0, avg3mo: roundCents(avg[category] ?? 0) }))
    .sort((a, b) => b.thisMonth + b.avg3mo - (a.thisMonth + a.avg3mo))
    .slice(0, 12);

  const avgMonthlySpend = monthly.slice(2, 5).reduce((s, m) => s + m.spending, 0) / 3;
  const cash = accounts
    .filter((a) => a.type === 'checking' || a.type === 'savings' || a.type === 'cash')
    .reduce((s, a) => s + a.balance, 0);

  const in30 = dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 30));
  const subs = detectSubscriptions(txs, now, settings?.dismissedSubscriptions ?? []).filter((s) => s.isActive);

  return {
    today: dateKey(now),
    monthly,
    categoriesThisMonthVs3moAvg: categories,
    budgets: budgets.map((b) => ({ category: b.category, limit: b.amount, period: b.period, spentThisMonth: current[b.category] ?? 0 })),
    netWorth: {
      // Same basis as the dashboard: money held for others in funding pools is netted out.
      total: calcNetWorth(accounts, fundings, 'total'),
      liquid: calcNetWorth(accounts, fundings, 'liquid'),
      history: [...netWorthHistory]
        .sort((a, b) => a.month.localeCompare(b.month))
        .slice(-6)
        .map((s) => ({ month: s.month, netWorth: s.netWorth })),
    },
    // Owed back by others (splits + open funding tabs) — like the dashboard, NOT part of net worth.
    owedToYou: calcOwedToYou(splits, fundings).total,
    cashOnHand: roundCents(cash),
    emergencyFundMonths: Math.round(calcEmergencyFundMonths(cash, avgMonthlySpend) * 10) / 10,
    billsNext30Days: bills
      .filter((b) => b.isActive && b.nextDue <= in30)
      .map((b) => ({ name: b.name, amount: myBillShare(b), dueDate: b.nextDue, frequency: b.frequency })),
    subscriptions: { count: subs.length, monthlyTotal: roundCents(subs.reduce((s, x) => s + x.monthlyAmount, 0)) },
    goals: goals.map((g) => ({ name: g.name, target: g.targetAmount, saved: g.currentAmount, deadline: g.deadline })),
    appInsights: insights.map((i) => ({ id: i.id, kind: i.kind, title: i.title, body: i.body })),
  };
}

export type AdvisorContext = ReturnType<typeof buildAdvisorContext>;

// ── Material-change fingerprint (when the smart text must be regenerated) ────
// Smart text is NOT time-based: it is regenerated only when something material
// changes. Every amount is bucketed to 2 significant figures (≈5% steps:
// $4,321 → 4300, $125,000 → 130,000), numbers inside insight text included, and
// the date is left out. So a $3 coffee doesn't rewrite the copy, but a real swing
// — or a new/cleared warning (insight ids) — does. The prompt asks Claude to
// quote amounts at the same precision, so cached text never shows a stale figure.

const sig2 = (n: number) => (n === 0 ? 0 : Number(n.toPrecision(2)));

function bucket(v: unknown): unknown {
  if (typeof v === 'number') return sig2(v);
  if (typeof v === 'string') return v.replace(/-?\d[\d,]*(?:\.\d+)?/g, (m) => String(sig2(Number(m.replace(/,/g, '')))));
  if (Array.isArray(v)) return v.map(bucket);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, bucket(x)]));
  return v;
}

export function materialFingerprint(context: AdvisorContext): string {
  const { today: _today, ...rest } = context;
  void _today;
  return JSON.stringify(bucket(rest));
}
