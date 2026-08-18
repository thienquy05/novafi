import type { Account, Bill, Goal, Transaction, PaycheckEntry, TaxSettings } from '@/types';
import {
  calcMonthIncome,
  calcMonthExpense,
  calcSavingsRate,
  calcSafeToSpend,
  calcSafeToSpendDaily,
  calcProjectedSpend,
  calcSpendableCash,
  detectSubscriptions,
  buildCreditReport,
  calcPaydownToTarget,
  daysUntilStatement,
  myBillShare,
  roundCents,
  CREDIT_UTIL_TARGET,
  buildBucketSnapshot,
} from './calculations';

// ── Money-flow insights ─────────────────────────────────────────────────────
// A small rule engine that turns the ledger into a handful of prioritized,
// plain-language nudges about where the user's money is flowing. Modeled on
// lib/notifications.ts: pure, localized through a `tr` callback, and every
// number is produced by the SAME shared calculators the pages use — so an
// insight can never disagree with the screen it links to.
//
// Each insight carries a STABLE id derived from what it describes, so the UI
// could later persist read/dismissed state the way the notification bell does.

export type InsightKind =
  | 'cashflow'
  | 'spike'
  | 'crunch'
  | 'opportunity'
  | 'subscriptions'
  | 'credit'
  | 'goal'
  | 'budgetRule'
  | 'win';

/** Visual tone, mapped onto the design system's card accents. */
export type InsightTone = 'emerald' | 'indigo' | 'amber' | 'rose' | 'purple';

export interface Insight {
  id: string;
  kind: InsightKind;
  tone: InsightTone;
  title: string;
  body: string;
  /** Deep link to the page where the user can act on it. */
  href: string;
  /** Higher surfaces first. Urgent (rose) > heads-up (amber) > info > wins. */
  priority: number;
}

export interface InsightContext {
  now: Date;
  /** YYYY-MM of the current month. */
  monthKey: string;
  /** YYYY-MM of the previous month. */
  prevMonthKey: string;
  daysInMonth: number;
  daysElapsed: number;
  /** Localized string lookup, e.g. (k, p) => t(k, lang, p). */
  tr: (key: string, params?: Record<string, string | number>) => string;
  /** Currency formatter, e.g. formatCurrency. */
  fmt: (n: number) => string;
}

export interface InsightData {
  accounts: Account[];
  transactions: Transaction[];
  bills: Bill[];
  goals: Goal[];
  paychecks: PaycheckEntry[];
  settings: TaxSettings;
}

/** The in/out/kept strip the widget shows above the insight cards. */
export interface MoneyFlowSummary {
  income: number;
  spending: number;
  kept: number; // income − spending (can be negative)
  keptPct: number; // clamped savings rate, 0–100
}

export function buildMoneyFlowSummary(transactions: Transaction[], monthKey: string): MoneyFlowSummary {
  const income = calcMonthIncome(transactions, monthKey);
  const spending = calcMonthExpense(transactions, monthKey);
  return {
    income: roundCents(income),
    spending: roundCents(spending),
    kept: roundCents(income - spending),
    keptPct: calcSavingsRate(income, spending),
  };
}

// Thresholds — deliberately conservative so the widget only speaks up when it
// has something worth saying.
const SPIKE_RATIO = 1.35; // category ≥ 35% above its 3-month average…
const SPIKE_MIN_DOLLARS = 50; // …and at least $50 over it
const OPPORTUNITY_MIN = 100; // projected month-end surplus worth moving
const SUBSCRIPTION_INCOME_SHARE = 8; // % of monthly income before we flag creep
const GOAL_BEHIND_TOLERANCE = 0.9; // <90% of the on-pace amount counts as behind

/** Average spend per category over the N full months before `monthKey`. */
function categoryMonthlyAverages(
  transactions: Transaction[],
  now: Date,
  monthsBack = 3,
): Record<string, number> {
  const keys: string[] = [];
  for (let i = 1; i <= monthsBack; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const totals: Record<string, number> = {};
  for (const tx of transactions) {
    if (tx.type !== 'expense') continue;
    if (!keys.some((k) => tx.date.startsWith(k))) continue;
    totals[tx.category] = (totals[tx.category] ?? 0) + tx.amount;
  }
  const avg: Record<string, number> = {};
  for (const [cat, total] of Object.entries(totals)) avg[cat] = total / monthsBack;
  return avg;
}

export function buildInsights(data: InsightData, ctx: InsightContext): Insight[] {
  const { accounts, transactions, bills, goals, paychecks, settings } = data;
  const { now, monthKey, prevMonthKey, daysInMonth, daysElapsed, tr, fmt } = ctx;
  const items: Insight[] = [];
  const daysLeft = Math.max(0, daysInMonth - daysElapsed);

  const flow = buildMoneyFlowSummary(transactions, monthKey);
  const prevFlow = buildMoneyFlowSummary(transactions, prevMonthKey);

  // 1. Cash-flow pulse — the "how is my money flowing" headline. Rendered when
  //    there's income to talk about; compares kept-% with last month when both
  //    months have income so the copy has a direction, not just a number.
  if (flow.income > 0) {
    let body: string;
    if (flow.kept < 0) {
      body = tr('insights.pulseNegativeBody', { over: fmt(Math.abs(flow.kept)) });
    } else if (prevFlow.income > 0) {
      const delta = flow.keptPct - prevFlow.keptPct;
      body =
        Math.abs(delta) < 1
          ? tr('insights.pulseSteadyBody', { kept: fmt(flow.kept), pct: flow.keptPct.toFixed(0) })
          : delta > 0
            ? tr('insights.pulseUpBody', { kept: fmt(flow.kept), pct: flow.keptPct.toFixed(0), delta: delta.toFixed(0) })
            : tr('insights.pulseDownBody', { kept: fmt(flow.kept), pct: flow.keptPct.toFixed(0), delta: Math.abs(delta).toFixed(0) });
    } else {
      body = tr('insights.pulseSteadyBody', { kept: fmt(Math.max(0, flow.kept)), pct: flow.keptPct.toFixed(0) });
    }
    items.push({
      id: `cashflow:${monthKey}`,
      kind: 'cashflow',
      tone: flow.kept < 0 ? 'rose' : 'indigo',
      title: tr('insights.pulseTitle'),
      body,
      href: '/transactions',
      priority: flow.kept < 0 ? 90 : 40,
    });
  }

  // 2. Month-end crunch — remaining bills vs the checking cash on hand, with a
  //    concrete daily guide when things are tight. Same math as the dashboard's
  //    Safe-to-Spend KPI (calcSpendableCash / calcSafeToSpend).
  const upcomingBills = bills.filter((b) => {
    if (!b.isActive) return false;
    const due = new Date(b.nextDue + 'T00:00:00');
    return due.getFullYear() === now.getFullYear() && due.getMonth() === now.getMonth() && due.getDate() >= now.getDate();
  });
  const upcomingTotal = roundCents(upcomingBills.reduce((s, b) => s + myBillShare(b), 0));
  if (upcomingTotal > 0) {
    const leftToSpend = calcSafeToSpend(calcSpendableCash(accounts), upcomingTotal);
    if (leftToSpend < 0) {
      items.push({
        id: `crunch:${monthKey}`,
        kind: 'crunch',
        tone: 'rose',
        title: tr('insights.crunchTitle'),
        body: tr('insights.crunchShortBody', { bills: fmt(upcomingTotal), short: fmt(Math.abs(leftToSpend)) }),
        href: '/bills',
        priority: 100,
      });
    } else if (daysLeft > 0 && leftToSpend < upcomingTotal * 0.5) {
      const daily = calcSafeToSpendDaily(leftToSpend, daysLeft + 1);
      items.push({
        id: `crunch:${monthKey}`,
        kind: 'crunch',
        tone: 'amber',
        title: tr('insights.tightTitle'),
        body: tr('insights.tightBody', { bills: fmt(upcomingTotal), daily: fmt(daily) }),
        href: '/bills',
        priority: 80,
      });
    }
  }

  // 3. Category spike — one category running well above its own 3-month rhythm.
  const averages = categoryMonthlyAverages(transactions, now);
  let spike: { category: string; spent: number; avg: number } | null = null;
  const monthByCategory: Record<string, number> = {};
  for (const tx of transactions) {
    if (tx.type === 'expense' && tx.date.startsWith(monthKey)) {
      monthByCategory[tx.category] = (monthByCategory[tx.category] ?? 0) + tx.amount;
    }
  }
  for (const [cat, spent] of Object.entries(monthByCategory)) {
    const avg = averages[cat] ?? 0;
    if (avg <= 0) continue;
    if (spent >= avg * SPIKE_RATIO && spent - avg >= SPIKE_MIN_DOLLARS) {
      // Keep the category that's over by the most dollars.
      if (!spike || spent - avg > spike.spent - spike.avg) spike = { category: cat, spent, avg };
    }
  }
  if (spike) {
    const pct = Math.round(((spike.spent - spike.avg) / spike.avg) * 100);
    items.push({
      id: `spike:${monthKey}:${spike.category}`,
      kind: 'spike',
      tone: 'amber',
      title: tr('insights.spikeTitle', { category: spike.category }),
      body: tr('insights.spikeBody', { category: spike.category, spent: fmt(roundCents(spike.spent)), pct, avg: fmt(roundCents(spike.avg)) }),
      href: '/reports',
      priority: 60,
    });
  }

  // 4. Credit nudge — worst card over the recommended utilization, with the
  //    exact pay-down amount and a statement-aware note when the close date is
  //    near (paying before it lowers what gets REPORTED).
  const credit = buildCreditReport(accounts);
  const worst = credit.cards
    .filter((c) => c.util !== null && c.util > CREDIT_UTIL_TARGET)
    .sort((a, b) => (b.util ?? 0) - (a.util ?? 0))[0];
  if (worst && worst.account.creditLimit) {
    const paydown = calcPaydownToTarget(worst.account.balance, worst.account.creditLimit, CREDIT_UTIL_TARGET);
    if (paydown > 0) {
      const stmtDays = daysUntilStatement(worst.account.statementDay, now);
      const base = tr('insights.creditBody', {
        name: worst.account.name,
        util: Math.round(worst.util ?? 0),
        paydown: fmt(paydown),
        target: CREDIT_UTIL_TARGET,
      });
      const body = stmtDays !== null && stmtDays <= 7
        ? `${base} ${tr('insights.creditStatementNote', { days: stmtDays })}`
        : base;
      items.push({
        id: `credit:${worst.account.id}`,
        kind: 'credit',
        tone: (worst.util ?? 0) >= 50 ? 'rose' : 'amber',
        title: tr('insights.creditTitle', { name: worst.account.name }),
        body,
        href: '/credit',
        priority: (worst.util ?? 0) >= 50 ? 85 : 65,
      });
    }
  }

  // 5. Subscription creep — recurring charges eating a meaningful slice of income.
  const subs = detectSubscriptions(transactions, now).filter((s) => s.isActive);
  const subsMonthly = roundCents(subs.reduce((s, x) => s + x.monthlyAmount, 0));
  if (flow.income > 0 && subs.length >= 2) {
    const share = (subsMonthly / flow.income) * 100;
    if (share >= SUBSCRIPTION_INCOME_SHARE) {
      items.push({
        id: `subs:${monthKey}`,
        kind: 'subscriptions',
        tone: 'purple',
        title: tr('insights.subsTitle'),
        body: tr('insights.subsBody', { total: fmt(subsMonthly), n: subs.length, pct: share.toFixed(0) }),
        href: '/subscriptions',
        priority: 50,
      });
    }
  }

  // 6. Savings opportunity — projected month-end surplus worth putting to work.
  //    Only meaningful with some month elapsed (run-rate needs data) and no
  //    crunch already flagged.
  const hasCrunch = items.some((i) => i.kind === 'crunch');
  if (!hasCrunch && flow.income > 0 && daysElapsed >= 7) {
    const projected = calcProjectedSpend(flow.spending, daysElapsed, daysInMonth);
    const surplus = roundCents(flow.income - projected - upcomingTotal);
    if (surplus >= OPPORTUNITY_MIN) {
      const goal = goals.length > 0 ? goals[0] : null;
      items.push({
        id: `opportunity:${monthKey}`,
        kind: 'opportunity',
        tone: 'emerald',
        title: tr('insights.opportunityTitle'),
        body: goal
          ? tr('insights.opportunityGoalBody', { surplus: fmt(surplus), goal: goal.name })
          : tr('insights.opportunityBody', { surplus: fmt(surplus) }),
        href: goal ? '/planning' : '/savings',
        priority: 45,
      });
    }
  }

  // 7. Goal momentum — the goal furthest behind its deadline pace (or a win when
  //    one is ahead). Pace = share of time elapsed between "way back" and the
  //    deadline; we approximate the start as 12 months before the deadline when
  //    no better anchor exists, which keeps the check simple and stable.
  const dated = goals.filter((g) => g.deadline && g.targetAmount > 0 && g.currentAmount < g.targetAmount);
  let worstGoal: { goal: Goal; needPerMonth: number } | null = null;
  for (const g of dated) {
    const deadline = new Date(g.deadline + 'T00:00:00');
    const monthsLeft = (deadline.getFullYear() - now.getFullYear()) * 12 + (deadline.getMonth() - now.getMonth());
    if (monthsLeft <= 0) continue; // past-due goals are the planning page's business
    const remaining = g.targetAmount - g.currentAmount;
    const needPerMonth = roundCents(remaining / monthsLeft);
    // Behind pace = what's still needed per month exceeds an even 12-month split
    // of the whole target by a tolerance — i.e. the runway is getting steep.
    const evenSplit = g.targetAmount / 12;
    if (needPerMonth > evenSplit / GOAL_BEHIND_TOLERANCE) {
      if (!worstGoal || needPerMonth > worstGoal.needPerMonth) worstGoal = { goal: g, needPerMonth };
    }
  }
  if (worstGoal) {
    items.push({
      id: `goal:${worstGoal.goal.id}`,
      kind: 'goal',
      tone: 'indigo',
      title: tr('insights.goalTitle', { goal: worstGoal.goal.name }),
      body: tr('insights.goalBody', {
        goal: worstGoal.goal.name,
        need: fmt(worstGoal.needPerMonth),
        date: worstGoal.goal.deadline,
      }),
      href: '/planning',
      priority: 35,
    });
  }

  // 8. 50/30/20 drift — the single worst bucket, but only when it's off by enough
  //    to be worth acting on in BOTH relative and absolute terms. A user with
  //    unassigned categories gets no verdict, since the bars can't be trusted yet.
  const ruleSnapshot = buildBucketSnapshot({
    transactions, accounts, goals, paychecks, monthKey, settings,
  });
  if (ruleSnapshot.hasIncome && ruleSnapshot.hasAssignments) {
    const worst = [...ruleSnapshot.bars].sort(
      (a, b) => Math.abs(b.deltaAmount) - Math.abs(a.deltaAmount),
    )[0];
    const offBy = Math.abs(worst.deltaAmount);
    if (Math.abs(worst.deltaPct) >= BUCKET_DRIFT_MIN_PCT && offBy >= BUCKET_DRIFT_MIN_DOLLARS) {
      // Overspending needs/wants is bad; overshooting SAVINGS is a win.
      const overspending = worst.bucket === 'savings' ? worst.deltaAmount < 0 : worst.deltaAmount > 0;
      const label = tr(`insights.bucket_${worst.bucket}`);
      items.push({
        id: `bucketDrift:${monthKey}:${worst.bucket}`,
        kind: 'budgetRule',
        tone: overspending ? 'amber' : 'emerald',
        title: overspending
          ? tr('insights.bucketDriftTitle', { bucket: label })
          : tr('insights.bucketDriftWinTitle', { bucket: label }),
        body: tr(overspending ? 'insights.bucketDriftOverBody' : 'insights.bucketDriftWinBody', {
          bucket: label,
          actual: worst.actualPct.toFixed(0),
          target: String(worst.targetPct),
          amount: fmt(offBy),
        }),
        href: '/planning',
        priority: 55,
      });
    }
  }

  // 9. Win — celebrate a genuinely strong month (kept ≥ 20% and not sliding).
  if (flow.income > 0 && flow.keptPct >= 20 && flow.kept > 0 && (prevFlow.income === 0 || flow.keptPct >= prevFlow.keptPct)) {
    items.push({
      id: `win:${monthKey}`,
      kind: 'win',
      tone: 'emerald',
      title: tr('insights.winTitle'),
      body: tr('insights.winBody', { pct: flow.keptPct.toFixed(0), kept: fmt(flow.kept) }),
      href: '/reports',
      priority: 30,
    });
  }

  return items.sort((a, b) => b.priority - a.priority);
}

// A 50/30/20 bucket has to miss its target by BOTH of these to be worth a card —
// percentage alone would nag a low-income month over a few dollars, dollars alone
// would nag a high earner over a rounding error.
const BUCKET_DRIFT_MIN_PCT = 5;
const BUCKET_DRIFT_MIN_DOLLARS = 50;

/** The widget surfaces at most this many cards — guidance, not a feed. */
export const MAX_SURFACED_INSIGHTS = 4;

export function topInsights(data: InsightData, ctx: InsightContext, max = MAX_SURFACED_INSIGHTS): Insight[] {
  return buildInsights(data, ctx).slice(0, max);
}
