import { Fragment } from 'react';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { auth } from '@/lib/auth';
import { after } from 'next/server';
import { upsertNetWorthSnapshot } from '@/lib/sheets';
import { getDashboardData, parseWriteVersion, WRITE_VERSION_COOKIE } from '@/lib/apiRoute';
import { formatCurrency, formatDate, zonedNow, monthShort } from '@/lib/utils';
import {
  calcNetWorth, buildNetWorthSeries, calcCashFlowProjection, type NetWorthBasis, calcTotalAssets, calcTotalDebt, calcLiquidSavings,
  calcMonthIncome, calcMonthExpense, calcSavingsRate, calcSafeToSpend, calcSafeToSpendDaily, calcSpendableCash, pctChange as calcPctChange,
  normalizeMonthlyBudget, calcAvgMonthlyExpense, calcEmergencyFundMonths, calcProjectedSpend,
  calcSavingsRateScore, calcEmergencyScore, calcBudgetScore,
  calcDebtToIncomeScore, calcDebtToIncomeRatio,
  calcNetWorthTrendScore, calcAvgMomPct,
  calcSpendingVolatilityScore, calcCoefficientOfVariation,
  myBillShare, calcRolloverDeficit, calcLongestUntouchedSavings, calcPredictionReadiness,
  buildCreditReport, CREDIT_UTIL_TARGET, CREDIT_UTIL_IDEAL, composeHealthScore, daysUntilStatement,
  calcFundingHeldByAccount,
} from '@/lib/calculations';
import { Card, CardHeader, CardTitle, CardIcon, type CardTone } from '@/components/ui/Card';
import { ChevronLeft, ChevronRight, TrendingUp, TrendingDown, Calendar, PiggyBank, Wallet, BarChart3, ArrowLeftRight, Flame, CalendarDays, CreditCard, Target } from 'lucide-react';
import { SpendingPieChart, BudgetBars, BudgetVsActualChart, MonthlyBarChart, GoalsSummary, NetWorthTrendChart, HealthBanner, EmergencyFundWidget, FinancialHealthScore, SavingsRateGauge } from './DashboardCharts';
import { RecentTransactions } from './RecentTransactions';
import { FundingWidget } from './FundingWidget';
import type { NetWorthPoint } from './DashboardCharts';
import { AnimatedNumber } from '@/components/ui/AnimatedNumber';
import { RollingNumber } from '@/components/ui/RollingNumber';
import { StaggerReveal } from '@/components/ui/Reveal';
import { Sparkline } from '@/components/ui/Sparkline';
import { Celebrations } from './Celebrations';
import { AutoRefreshOnFocus } from '@/components/AutoRefreshOnFocus';
import { PullToRefresh } from '@/components/PullToRefresh';
import { DashboardCustomizer } from './DashboardCustomizer';
import { FirstRunChecklist, type ChecklistStep } from './FirstRunChecklist';
import { resolveDashboardLayout, ONBOARD_COOKIE, type DashboardCardId } from '@/lib/dashboardLayout';
import { SpendingHeatmap } from './SpendingHeatmap';
import { HelpHint } from '@/components/ui/HelpHint';
import { t } from '@/lib/i18n';
import type { Language } from '@/types';

export const dynamic = 'force-dynamic';

// Last snapshot written per sheet+month on this instance. The cached dashboard
// payload still holds the pre-write row until it expires, so without this every
// render in that window would rewrite the same value.
const savedSnapshots = new Map<string, string>();
const snapshotSignature = (s: { netWorth: number; total?: number | null; liquid?: number | null; creditUtil?: number | null }) =>
  [s.netWorth, s.total ?? '', s.liquid ?? '', s.creditUtil ?? ''].join('|');

// Credit-utilization status → bar/text colors (literal Tailwind classes, v4).
const CREDIT_STATUS_BAR: Record<string, string> = {
  excellent: 'bg-emerald-500', good: 'bg-emerald-500', fair: 'bg-amber-500',
  high: 'bg-orange-500', maxed: 'bg-rose-500', over: 'bg-rose-600',
};
const CREDIT_STATUS_TEXT: Record<string, string> = {
  excellent: 'text-emerald-600 dark:text-emerald-400', good: 'text-emerald-600 dark:text-emerald-400',
  fair: 'text-amber-600 dark:text-amber-400', high: 'text-orange-600 dark:text-orange-400',
  maxed: 'text-rose-600 dark:text-rose-400', over: 'text-rose-600 dark:text-rose-400',
};


export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const session = await auth();
  if (!session?.accessToken || !session.spreadsheetId) return null;

  const jar = await cookies();
  const lang: Language = jar.get('nf_lang')?.value === 'vi' ? 'vi' : 'en';

  // One cached Sheets round trip for the whole dashboard (was three: dashboard
  // batch + net-worth history + settings). batchGetDashboardData now folds
  // Settings and NetWorthHistory into a single batchGet.
  const dashData = await getDashboardData(
    session.accessToken,
    session.spreadsheetId,
    parseWriteVersion(jar.get(WRITE_VERSION_COOKIE)?.value),
  );

  const { transactions, accounts, bills, budgets, goals, settings, netWorthHistory } = dashData;

  // Anchor "now" to the user's chosen time zone (settings.timeZone), not the
  // server's UTC clock. This is what kept the dashboard's month/day math a few
  // hours out of step with the rest of the app, which runs in the browser zone.
  const now = zonedNow(settings.timeZone);
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // This month
  const monthTx = transactions.filter((tx) => tx.date.startsWith(thisMonth));
  const monthIncome = calcMonthIncome(transactions, thisMonth);
  const monthSpending = calcMonthExpense(transactions, thisMonth);

  // Previous month
  const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthKey = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, '0')}`;
  const prevMonthTx = transactions.filter((tx) => tx.date.startsWith(prevMonthKey));

  // Days info
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysElapsed = now.getDate();
  const daysLeft = daysInMonth - daysElapsed;

  // Prediction readiness — forward-looking forecasts (projected spend, net-worth
  // projection) stay hidden until there are enough months of history to be
  // meaningful, replaced by a "gathering data" hint. See calcPredictionReadiness.
  const readiness = calcPredictionReadiness(transactions);

  // Projected month-end spend — extrapolate the current run-rate across the whole
  // month. Shown on the "Spending This Month" card so the headline number is a
  // forward-looking forecast (the donut already shows what's spent so far). Only
  // surfaced once we have enough history.
  const projectedSpend = calcProjectedSpend(monthSpending, daysElapsed, daysInMonth);

  // Net worth — funding pools hold OTHER people's cash in real accounts, so that
  // money inflates the raw balances but isn't the user's. Subtract the per-account
  // "held for others" amounts everywhere wealth is summed (net worth, assets,
  // savings) so a pool only ever shows up as money flow, never as net worth.
  const fundingHeldByAccount = calcFundingHeldByAccount(transactions);
  const fundingHeld = Object.values(fundingHeldByAccount).reduce((s, n) => s + n, 0);
  // One definition (calcNetWorth) for the hero, the trend chart, the forecast and
  // the Accounts page; both bases are kept so a saved snapshot never mixes them.
  const excludeLoans = settings.excludeLoansFromNetWorth;
  const basis: NetWorthBasis = excludeLoans ? 'liquid' : 'total';
  const totalNetWorth = calcNetWorth(accounts, transactions, 'total');
  const liquidNetWorth = calcNetWorth(accounts, transactions, 'liquid');
  const netWorth = basis === 'liquid' ? liquidNetWorth : totalNetWorth;
  const totalAssets = calcTotalAssets(accounts) - fundingHeld;
  const totalDebt = calcTotalDebt(accounts);
  const totalLoanDebt = accounts.filter((a) => a.type === 'loan' && a.balance > 0).reduce((s, a) => s + a.balance, 0);
  const totalSaved = accounts
    .filter((a) => a.type === 'savings')
    .reduce((s, a) => s + a.balance - (fundingHeldByAccount[a.id] ?? 0), 0);

  // Smart Credit Report (dashboard surface): overall utilization + the single
  // worst over-target card, so the dashboard can show an actionable next step.
  const creditReport = buildCreditReport(accounts);
  const worstCard = creditReport.cards
    .filter((c) => c.util !== null && c.paydownToTarget > 0)
    .sort((a, b) => (b.util! - a.util!))[0] ?? null;
  // Statement-aware nudge: if the worst card's statement closes soon, paying it
  // down before then is what lowers the *reported* utilization.
  const worstStmtDays = worstCard ? daysUntilStatement(worstCard.account.statementDay, now) : null;
  const worstStmtSoon = worstStmtDays !== null && worstStmtDays <= 7;
  // Top cards (highest utilization first) for the dashboard's brief breakdown.
  const creditCardsByUtil = creditReport.cards
    .filter((c) => c.util !== null)
    .sort((a, b) => (b.util! - a.util!));

  // Net worth snapshot — this month's row is kept current (upserted after the
  // response is sent, via after(), so a slow Sheets write never delays the page
  // and isn't cut off when the serverless function freezes). Only written when
  // the value actually changed.
  const currentMonthKey = thisMonth;
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const snapshot = {
    id: `nw_${currentMonthKey}`,
    date: todayIso,
    month: currentMonthKey,
    netWorth,
    creditUtil: creditReport.overallUtil, // Smart Credit Report trend
    total: totalNetWorth,
    liquid: liquidNetWorth,
  };
  const storedSnapshot = netWorthHistory.filter((s) => s.month === currentMonthKey).at(-1);
  const sig = snapshotSignature(snapshot);
  const savedKey = `${session.spreadsheetId}:${currentMonthKey}`;
  if ((!storedSnapshot || snapshotSignature(storedSnapshot) !== sig) && savedSnapshots.get(savedKey) !== sig) {
    savedSnapshots.set(savedKey, sig);
    const { accessToken, spreadsheetId } = session;
    after(() => upsertNetWorthSnapshot(accessToken, spreadsheetId, snapshot).catch(() => { savedSnapshots.delete(savedKey); }));
  }

  // Credit-utilization trend: saved monthly values for past months, ending with
  // this month's live value.
  const utilTrend = (() => {
    const pts = [...netWorthHistory]
      .filter((s) => s.month !== currentMonthKey && typeof s.creditUtil === 'number')
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((s) => s.creditUtil as number);
    if (creditReport.overallUtil !== null) pts.push(creditReport.overallUtil);
    return pts.slice(-6);
  })();

  // Month-by-month net worth ending at today's live value (saved months are
  // 'actual', gaps are 'estimated' from transactions) — see buildNetWorthSeries.
  const netWorthPoints: NetWorthPoint[] = buildNetWorthSeries({
    liveNetWorth: netWorth,
    transactions,
    accounts,
    snapshots: netWorthHistory,
    basis,
    now,
  }).map((p) => {
    const [yr, mo] = p.month.split('-');
    return { month: p.month, label: `${monthShort(Number(mo) - 1, lang)} '${yr.slice(2)}`, netWorth: p.netWorth, kind: p.kind };
  });

  const prevNetWorth = netWorthPoints.length >= 2 ? netWorthPoints[netWorthPoints.length - 2].netWorth : null;

  // Savings rate
  const savingsRate = calcSavingsRate(monthIncome, monthSpending);

  // Bills due rest of this month (for forecasting widget)
  const upcomingBills = bills
    .filter((b) => {
      if (!b.isActive) return false;
      const due = new Date(b.nextDue + 'T00:00:00');
      return (
        due.getFullYear() === now.getFullYear() &&
        due.getMonth() === now.getMonth() &&
        due.getDate() >= now.getDate()
      );
    })
    .sort((a, b) => a.nextDue.localeCompare(b.nextDue));

  // Total remaining bills this month (rest-of-month forecast) — your share only.
  const upcomingBillsTotal = upcomingBills.reduce((s, b) => s + myBillShare(b), 0);

  // Safe to spend — forward-looking daily allowance based on the cash you actually
  // have on hand. `calcSpendableCash` is your liquid checking balance right now
  // (already reflects every deposit and withdrawal), so the figure is correct
  // regardless of whether payday has landed or how much carried over from last
  // month. From it we subtract the bills STILL due this month, then spread the
  // leftover across the days left so the KPI answers "how much can I spend per day
  // for the rest of the month and still cover my bills".
  const spendableCash = calcSpendableCash(accounts);
  const leftToSpend = calcSafeToSpend(spendableCash, upcomingBillsTotal);
  const daysRemaining = daysLeft + 1; // include today, so it's never 0
  const dailySafeToSpend = calcSafeToSpendDaily(leftToSpend, daysRemaining);
  const overspent = leftToSpend < 0;

  // Recent transactions (last 6)
  const recentTx = [...transactions]
    .sort((a, b) => {
      const dateCmp = b.date.localeCompare(a.date);
      if (dateCmp !== 0) return dateCmp;
      return (b.createdAt ?? b.id).localeCompare(a.createdAt ?? a.id);
    })
    .slice(0, 6);

  // Spending by category this month
  const categorySpend: Record<string, number> = {};
  monthTx.filter((tx) => tx.type === 'expense').forEach((tx) => {
    categorySpend[tx.category] = (categorySpend[tx.category] ?? 0) + tx.amount;
  });
  const categoryData = Object.entries(categorySpend)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({ name, value }));

  // Single pass over all transactions grouped by YYYY-MM — used for monthly chart,
  // emergency fund, health score income/expense arrays (avoids 12+ redundant scans)
  const monthlyTotals: Record<string, { income: number; expense: number }> = {};
  for (const tx of transactions) {
    const key = tx.date.slice(0, 7);
    if (!monthlyTotals[key]) monthlyTotals[key] = { income: 0, expense: 0 };
    if (tx.type === 'income') monthlyTotals[key].income += tx.amount;
    else if (tx.type === 'expense') monthlyTotals[key].expense += tx.amount;
  }

  // Last 6 months income vs expenses for the dashboard cash-flow chart
  const cashFlowData = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const income = monthlyTotals[key]?.income ?? 0;
    const expenses = monthlyTotals[key]?.expense ?? 0;
    return { month: monthShort(d.getMonth(), lang), key, income, expenses, net: income - expenses };
  });

  // Budget vs actual this month — reuse categorySpend (already computed above)
  const prevMonthCategorySpend: Record<string, number> = {};
  prevMonthTx.filter((tx) => tx.type === 'expense').forEach((tx) => {
    prevMonthCategorySpend[tx.category] = (prevMonthCategorySpend[tx.category] ?? 0) + tx.amount;
  });

  // When rollover is on, last month's overspend carries into this month's usage
  // (the cap stays fixed) — same model as the Planning page, so the dashboard
  // summary matches it. `rolledOver` is 0 when the toggle is off.
  const budgetData = budgets.map((b) => {
    const monthly = normalizeMonthlyBudget(b.amount, b.period);
    const prevSpent = prevMonthCategorySpend[b.category] ?? 0;
    return {
      category: b.category,
      budget: monthly,
      spent: categorySpend[b.category] ?? 0,
      prevMonthSpent: prevSpent,
      rolledOver: settings.budgetRollover ? calcRolloverDeficit(monthly, prevSpent) : 0,
    };
  });
  const overBudgetCount = budgetData.filter((b) => b.spent + b.rolledOver > b.budget).length;
  // Dashboard shows the full overview chart but trims the detailed per-category
  // cards to the 3 highest-usage categories (full list lives on the Planning page).
  const topBudgetData = [...budgetData]
    .sort((a, b) => (b.spent + b.rolledOver) - (a.spent + a.rolledOver))
    .slice(0, 3);

  // Longest-untouched savings account — surfaced as a gentle nudge when a savings
  // account hasn't received a deposit in a while (≥45 days).
  const staleSavings = calcLongestUntouchedSavings(accounts, transactions, now);
  const showStaleSavings = staleSavings !== null && staleSavings.daysSince >= 45;

  // Net worth forecast — cash-flow model (today + typical monthly net flow, loan
  // paydown on the liquid basis). See calcCashFlowProjection.
  const forecast = calcCashFlowProjection({ liveNetWorth: netWorth, transactions, accounts, basis, now });
  const netWorthProjection = (forecast?.values ?? []).map((projected, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() + i + 1, 1);
    return {
      label: `${monthShort(d.getMonth(), lang)} '${String(d.getFullYear()).slice(2)}`,
      projected,
    };
  });
  const forecastAssumption = forecast
    ? t('charts.projectedAssumption', lang, {
        amount: `${forecast.monthlyChange >= 0 ? '+' : '−'}${formatCurrency(Math.abs(forecast.monthlyChange))}`,
        n: forecast.basedOnMonths,
      })
    : undefined;

  // Total spend this month for category %. Includes every category's rolled-over
  // deficit so each category's "% of spend" share is measured against the same
  // effective usage its amount/bar reflect (matches the Planning page).
  const totalMonthSpend =
    Object.values(categorySpend).reduce((s, v) => s + v, 0) +
    budgetData.reduce((s, b) => s + b.rolledOver, 0);

  // Emergency fund — pull from precomputed monthlyTotals instead of rescanning
  const liquidSavings = calcLiquidSavings(accounts);
  const last3MonthsExpenses = Array.from({ length: 3 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (i + 1), 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return monthlyTotals[key]?.expense ?? 0;
  });
  const avgMonthlyExpense = calcAvgMonthlyExpense(last3MonthsExpenses);
  const emergencyFundMonths = calcEmergencyFundMonths(liquidSavings, avgMonthlyExpense);

  // Financial health score — income array from same precomputed map
  const last3MonthsIncome = Array.from({ length: 3 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (i + 1), 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return monthlyTotals[key]?.income ?? 0;
  });
  const avgMonthlyIncome = calcAvgMonthlyExpense(last3MonthsIncome); // reuse arithmetic mean helper
  const dti = calcDebtToIncomeRatio(totalDebt, avgMonthlyIncome);

  // Net worth trend: avg MoM % across the last up-to-4 months of the series
  const recentNetWorth = netWorthPoints.slice(-4).map((p) => p.netWorth);
  const netWorthTrendPct = calcAvgMomPct(recentNetWorth);

  // Spending stability: coefficient of variation of last 3 months' expenses
  const spendingCv = calcCoefficientOfVariation(last3MonthsExpenses);

  const savingsRateScore = calcSavingsRateScore(savingsRate);
  const emergencyScore = calcEmergencyScore(emergencyFundMonths);
  const budgetScore = calcBudgetScore(budgets.length, overBudgetCount);
  const dtiScore = calcDebtToIncomeScore(dti);
  const trendScore = calcNetWorthTrendScore(netWorthTrendPct);
  const volatilityScore = calcSpendingVolatilityScore(spendingCv);
  // 7-factor composite (now includes credit utilization). composeHealthScore
  // rescales the six existing sub-scores to the new weights and returns a
  // breakdown whose integers sum exactly to the score.
  const { score: healthScore, breakdown: healthBreakdown } = composeHealthScore({
    savingsScore: savingsRateScore,
    emergencyScore,
    budgetScore,
    dtiScore,
    trendScore,
    volatilityScore,
    creditUtil: creditReport.overallUtil,
  });

  // Goals summary
  const goalData = goals.map((g) => {
    const linked = g.linkedAccountId ? accounts.find((a) => a.id === g.linkedAccountId) : null;
    return {
      id: g.id,
      name: g.name,
      icon: g.icon,
      current: linked ? linked.balance : g.currentAmount,
      target: g.targetAmount,
      deadline: g.deadline,
    };
  });

  // MoM delta (net worth hero)
  const netWorthDelta = prevNetWorth !== null ? calcPctChange(netWorth, prevNetWorth) : null;

  // ── Sparkline trend: last 6 months of the net-worth series (hero) ─────────
  const netWorthSpark = netWorthPoints.slice(-6).map((p) => p.netWorth);

  // ── Calendar: per-day spend, income, and bills due this month ─────────────
  const dailySpend: Record<string, number> = {};
  const dailyIncome: Record<string, number> = {};
  for (const tx of monthTx) {
    if (tx.type === 'expense') dailySpend[tx.date] = (dailySpend[tx.date] ?? 0) + tx.amount;
    else if (tx.type === 'income') dailyIncome[tx.date] = (dailyIncome[tx.date] ?? 0) + tx.amount;
  }
  // Bills due this month (past + upcoming), your share only — surfaced on the
  // calendar so cash-flow crunch days are visible before they arrive.
  const dailyBills: Record<string, { name: string; amount: number }[]> = {};
  for (const b of bills) {
    if (!b.isActive) continue;
    if (!b.nextDue.startsWith(thisMonth)) continue;
    (dailyBills[b.nextDue] ??= []).push({ name: b.name, amount: myBillShare(b) });
  }
  // The "This Month" card group can browse back to a past month (?m=YYYY-MM):
  // calendar + where-the-money-went for that month. Everything else on Home
  // (net worth, safe-to-spend, budgets…) stays live.
  const { m: requestedMonth } = await searchParams;
  const calMonth = requestedMonth && /^\d{4}-\d{2}$/.test(requestedMonth) && requestedMonth < thisMonth ? requestedMonth : thisMonth;
  const isCalPast = calMonth !== thisMonth;
  const [calY, calM] = calMonth.split('-').map(Number);
  const calDaysInMonth = new Date(calY, calM, 0).getDate();
  const calSpend: Record<string, number> = isCalPast ? {} : dailySpend;
  const calIncome: Record<string, number> = isCalPast ? {} : dailyIncome;
  const calCategorySpend: Record<string, number> = isCalPast ? {} : categorySpend;
  if (isCalPast) {
    for (const tx of transactions) {
      if (!tx.date.startsWith(calMonth)) continue;
      if (tx.type === 'expense') {
        calSpend[tx.date] = (calSpend[tx.date] ?? 0) + tx.amount;
        calCategorySpend[tx.category] = (calCategorySpend[tx.category] ?? 0) + tx.amount;
      } else if (tx.type === 'income') calIncome[tx.date] = (calIncome[tx.date] ?? 0) + tx.amount;
    }
  }
  const calCategoryData = isCalPast
    ? Object.entries(calCategorySpend).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value }))
    : categoryData;
  const calSpentTotal = Object.values(calCategorySpend).reduce((s, v) => s + v, 0);
  const shiftMonth = (key: string, d: number) => {
    const [y, mo] = key.split('-').map(Number);
    const x = new Date(y, mo - 1 + d, 1);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`;
  };
  const prevCalMonth = shiftMonth(calMonth, -1);
  const nextCalMonth = shiftMonth(calMonth, 1);
  const calLabel = `${monthShort(calM - 1, lang)} ${calY}`;
  const heatmapDays = Array.from({ length: calDaysInMonth }, (_, i) => {
    const date = `${calMonth}-${String(i + 1).padStart(2, '0')}`;
    return { date, total: calSpend[date] ?? 0, income: calIncome[date] ?? 0, bills: isCalPast ? [] : dailyBills[date] ?? [] };
  });

  // ── Hero money-flow line: daily running net worth across THIS month ───────
  // The hero number is the live net worth; rather than a frozen 6-month snapshot
  // line, the sparkline reconstructs how today's value was reached by walking
  // each day's income − expense — so the line climbs on pay days and dips on
  // spend days and lands exactly on the current amount. We anchor the start of
  // the month at (netWorth − net flow so far) so the curve ends at "now". Falls
  // back to the monthly snapshot trend when there's been no movement yet (a flat
  // line this early in the month would say nothing).
  const moneyFlowSpark = (() => {
    let running = 0;
    let moved = false;
    const cumulative: number[] = [];
    for (let d = 1; d <= daysElapsed; d++) {
      const date = `${thisMonth}-${String(d).padStart(2, '0')}`;
      if (dailyIncome[date] || dailySpend[date]) moved = true;
      running += (dailyIncome[date] ?? 0) - (dailySpend[date] ?? 0);
      cumulative.push(running);
    }
    if (!moved) return null;
    const startBalance = netWorth - running; // balance at the first of the month
    return [startBalance, ...cumulative.map((c) => startBalance + c)];
  })();

  // ── No-spend streak: consecutive days up to today with zero expense ───────
  const expenseDates = new Set(
    transactions.filter((tx) => tx.type === 'expense' && tx.amount > 0).map((tx) => tx.date),
  );
  let noSpendStreak = 0;
  if (expenseDates.size > 0) {
    const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    for (let i = 0; i < 45; i++) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
      if (expenseDates.has(key)) break;
      noSpendStreak++;
      cursor.setDate(cursor.getDate() - 1);
    }
  }

  // Goals already hit — fed to the celebration watcher.
  const achievedGoals = goalData
    .filter((g) => g.target > 0 && g.current >= g.target)
    .map((g) => ({ id: g.id, name: g.name }));

  // ── KPI bento data ─────────────────────────────────────────────────────────
  const heroStat = {
    label: excludeLoans ? t('dashboard.liquidNetWorth', lang) : t('dashboard.netWorth', lang),
    icon: Wallet,
    tone: (netWorth >= 0 ? 'emerald' : 'rose') as CardTone,
    rawValue: netWorth,
    valueColor: netWorth >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
    delta: netWorthDelta,
    positiveIsGood: true,
    annotation: [
      excludeLoans && totalLoanDebt > 0 ? t('dashboard.loansExcl', lang) : null,
      fundingHeld > 0 ? t('dashboard.fundingExcluded', lang, { amount: formatCurrency(fundingHeld) }) : null,
    ].filter(Boolean).join(' · ') || null,
    // Prefer the live intra-month money-flow line; fall back to the monthly
    // snapshot trend when this month has no income/expense activity yet.
    spark: moneyFlowSpark ?? (netWorthSpark.length >= 2 ? netWorthSpark : null),
  };
  const HeroIcon = heroStat.icon;

  const smallStats = [
    {
      key: 'safe',
      label: t('dashboard.safeToSpend', lang),
      icon: PiggyBank,
      tone: (overspent ? 'rose' : 'indigo') as CardTone,
      rawValue: overspent ? leftToSpend : dailySafeToSpend,
      kind: 'currency' as const,
      suffix: overspent ? '' : t('dashboard.perDay', lang),
      valueColor: overspent ? 'text-rose-600 dark:text-rose-400' : 'text-indigo-600 dark:text-indigo-400',
      delta: null as number | null,
      positiveIsGood: true,
      annotation: (overspent
        ? t('dashboard.safeToSpendOver', lang)
        : t('dashboard.safeToSpendNote', lang, { total: formatCurrency(leftToSpend), days: daysRemaining })) as string | null,
      spark: null as number[] | null,
      gauge: null as number | null,
    },
    {
      key: 'savings',
      label: t('dashboard.savingsRateKPI', lang),
      icon: TrendingUp,
      tone: (savingsRate >= 20 ? 'emerald' : savingsRate >= 10 ? 'indigo' : 'amber') as CardTone,
      rawValue: savingsRate,
      kind: 'percent' as const,
      suffix: '',
      valueColor: '',
      delta: null,
      positiveIsGood: true,
      annotation: t('dashboard.savingsRateKPINote', lang),
      spark: null,
      gauge: savingsRate,
    },
  ];

  // Card groups below the KPI bento, keyed for the customizable Home layout
  // (lib/dashboardLayout.ts). Rendered in the user's saved order.
  const sections: Record<DashboardCardId, React.ReactNode> = {
    calendar: (
      <>
        {/* This Month — calendar (when) + category breakdown (what). The calendar's
            footer carries the month's income / spending / net, so it replaces the
            old income & spending KPI tiles. */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <Card className="min-h-[380px] flex flex-col">
            <CardHeader>
              <div className="flex items-center gap-3">
                <CardIcon tone="indigo">
                  <CalendarDays className="w-5 h-5" />
                </CardIcon>
                <div>
                  <CardTitle>{t('dashboard.spendingCalendar', lang)}</CardTitle>
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5">{t('dashboard.spendingCalendarSub', lang)}</p>
                </div>
              </div>
              {/* ‹ month › — browse past months' calendar + breakdown */}
              <div className="flex items-center gap-0.5 shrink-0">
                <Link href={`/dashboard?m=${prevCalMonth}`} scroll={false} aria-label={t('dashboard.prevMonth', lang)} className="hit-area h-8 w-8 rounded-lg flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700">
                  <ChevronLeft className="w-4 h-4" />
                </Link>
                <span className="text-xs font-bold text-slate-700 dark:text-slate-200 min-w-[4.5rem] text-center">{calLabel}</span>
                {isCalPast ? (
                  <Link href={nextCalMonth >= thisMonth ? '/dashboard' : `/dashboard?m=${nextCalMonth}`} scroll={false} aria-label={t('dashboard.nextMonth', lang)} className="hit-area h-8 w-8 rounded-lg flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700">
                    <ChevronRight className="w-4 h-4" />
                  </Link>
                ) : (
                  <span className="h-8 w-8 flex items-center justify-center text-slate-300 dark:text-slate-600" aria-hidden><ChevronRight className="w-4 h-4" /></span>
                )}
              </div>
            </CardHeader>
            <div className="flex-1 mt-1">
              <SpendingHeatmap days={heatmapDays} todayIso={todayIso} />
            </div>
          </Card>

          <Card className="min-h-[380px] flex flex-col">
            <CardHeader>
              <div>
                <CardTitle>{t('dashboard.spendingThisMonth', lang)}</CardTitle>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-1">{t('dashboard.whereMoneyWent', lang)}</p>
              </div>
              <div className="text-right">
                <span className="text-xl font-extrabold text-slate-900 dark:text-slate-100 font-display">{formatCurrency(isCalPast ? calSpentTotal : readiness.ready ? projectedSpend : monthSpending)}</span>
                <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mt-0.5">{isCalPast ? `${t('dashboard.spentInMonth', lang)} · ${calLabel}` : readiness.ready ? t('dashboard.projectedSpend', lang) : t('dashboard.spentSoFar', lang)}</p>
              </div>
            </CardHeader>
            <div className="flex-1 flex items-center justify-center">
              <SpendingPieChart data={calCategoryData} month={calMonth} />
            </div>
          </Card>
        </div>
      </>
    ),
    balances: (
      <>
        {/* Assets / Liabilities / Savings / Emergency Fund */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-emerald-100 dark:border-emerald-800/50 p-4">
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t('common.assets', lang)}</p>
            <AnimatedNumber value={totalAssets} kind="currency" maxSize={18} minSize={11} className="font-display font-extrabold text-emerald-600 dark:text-emerald-400 mt-1" />
          </div>
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-rose-100 dark:border-rose-800/50 p-4">
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t('common.liabilities', lang)}</p>
            <AnimatedNumber value={totalDebt > 0 ? -totalDebt : 0} kind="currency" maxSize={18} minSize={11} className="font-display font-extrabold text-rose-600 dark:text-rose-400 mt-1" />
          </div>
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/60 p-4">
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t('dashboard.savings', lang)}</p>
            <AnimatedNumber value={totalSaved} kind="currency" maxSize={18} minSize={11} className="font-display font-extrabold text-purple-600 dark:text-purple-400 mt-1" />
          </div>
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/60 p-4">
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t('dashboard.emergency', lang)}</p>
            <p className={`text-lg font-extrabold mt-1 tracking-tight ${emergencyFundMonths >= 6 ? 'text-emerald-600 dark:text-emerald-400' : emergencyFundMonths >= 3 ? 'text-indigo-600 dark:text-indigo-400' : emergencyFundMonths >= 1 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'}`}>
              {emergencyFundMonths.toFixed(1)} <span className="text-sm font-bold text-slate-400 dark:text-slate-500">{t('charts.monthsShort', lang)}</span>
            </p>
          </div>
        </div>
      </>
    ),
    credit: (
      <>
        {/* Credit Utilization — a big-but-brief summary; full detail lives on
            /credit. Only shown when at least one card has a limit set. */}
        {creditReport.hasLimits && creditReport.overallUtil !== null && creditReport.overallStatus !== null && (() => {
          const util = creditReport.overallUtil;
          const status = creditReport.overallStatus;
          const over = util > CREDIT_UTIL_TARGET;
          // One actionable line: statement-aware if a close is imminent, else a
          // paydown target, else a positive note.
          const nudge =
            over && worstCard && worstStmtSoon && worstStmtDays !== null
              ? { tone: 'amber', text: t('credit.payBeforeStmt', lang, { amount: formatCurrency(worstCard.paydownToTarget), card: worstCard.account.name, days: worstStmtDays, pct: CREDIT_UTIL_TARGET }) }
              : over && worstCard
              ? { tone: 'amber', text: t('credit.payToTargetCard', lang, { amount: formatCurrency(worstCard.paydownToTarget), card: worstCard.account.name, pct: CREDIT_UTIL_TARGET }) }
              : util <= CREDIT_UTIL_IDEAL
              ? { tone: 'emerald', text: t('credit.atIdeal', lang) }
              : { tone: 'emerald', text: t('credit.underTarget', lang, { pct: CREDIT_UTIL_TARGET }) };
          return (
            <Card tone={over ? 'rose' : 'emerald'}>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <CardIcon tone={over ? 'rose' : 'emerald'}>
                    <CreditCard className="w-5 h-5" />
                  </CardIcon>
                  <div>
                    <CardTitle>{t('dashboard.creditUtil', lang)}</CardTitle>
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5">{t('credit.overallSub', lang)}</p>
                  </div>
                </div>
                <a href="/credit" className="whitespace-nowrap text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-400 transition-colors bg-indigo-50 dark:bg-indigo-900/30 px-3 py-1.5 rounded-lg">{t('common.manage', lang)}</a>
              </CardHeader>

              <div className="mt-2 grid grid-cols-1 lg:grid-cols-2 gap-5 lg:gap-8">
                {/* Left: overall utilization + trend */}
                <div className="space-y-3">
                  <div className="flex items-end justify-between gap-3">
                    <div className="flex items-baseline gap-2">
                      <span className={`text-4xl font-extrabold font-display ${CREDIT_STATUS_TEXT[status]}`}>{Math.round(util)}%</span>
                      <span className={`text-sm font-bold ${CREDIT_STATUS_TEXT[status]}`}>{t(`credit.status.${status}`, lang)}</span>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">{t('credit.owedOfLimit', lang, { balance: formatCurrency(creditReport.totalBalance), limit: formatCurrency(creditReport.totalLimit) })}</p>
                      <p className="text-xs font-medium text-slate-400 dark:text-slate-500 mt-0.5">{t('credit.availableLine', lang, { amount: formatCurrency(creditReport.totalAvailable) })}</p>
                    </div>
                  </div>
                  {/* Utilization bar with a marker at the 30% recommended cap */}
                  <div className="relative h-3 w-full rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                    <div className={`h-full rounded-full ${CREDIT_STATUS_BAR[status]}`} style={{ width: `${Math.min(100, util)}%` }} />
                    <div className="absolute top-0 bottom-0 w-px bg-slate-500/70 dark:bg-slate-300/60" style={{ left: `${CREDIT_UTIL_TARGET}%` }} aria-hidden />
                  </div>
                  {utilTrend.length >= 2 && (
                    <div className={CREDIT_STATUS_TEXT[status]}>
                      <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 mb-1">{t('credit.trendLabel', lang)}</p>
                      <Sparkline data={utilTrend} height={28} strokeWidth={2} />
                    </div>
                  )}
                  <p className={`text-sm font-semibold flex items-center gap-2 ${nudge.tone === 'amber' ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
                    <Target className="w-4 h-4 shrink-0" />
                    {nudge.text}
                  </p>
                </div>

                {/* Right: brief per-card breakdown (highest utilization first) */}
                <div className="space-y-2.5">
                  {creditCardsByUtil.slice(0, 3).map((c) => (
                    <div key={c.account.id} className="flex items-center gap-3">
                      <span className="text-xs font-bold text-slate-700 dark:text-slate-200 w-28 sm:w-32 shrink-0 truncate">{c.account.name}</span>
                      <div className="flex-1 relative h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                        <div className={`h-full rounded-full ${CREDIT_STATUS_BAR[c.status!]}`} style={{ width: `${Math.min(100, c.util!)}%` }} />
                        <div className="absolute top-0 bottom-0 w-px bg-slate-500/60 dark:bg-slate-300/50" style={{ left: `${CREDIT_UTIL_TARGET}%` }} aria-hidden />
                      </div>
                      <span className={`text-xs font-extrabold w-10 text-right shrink-0 tabular-nums ${CREDIT_STATUS_TEXT[c.status!]}`}>{Math.round(c.util!)}%</span>
                    </div>
                  ))}
                  {creditCardsByUtil.length > 3 && (
                    <a href="/credit" className="block text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline pt-1">
                      {t('credit.viewMoreCards', lang, { n: creditCardsByUtil.length - 3 })}
                    </a>
                  )}
                </div>
              </div>
            </Card>
          );
        })()}
      </>
    ),
    netWorth: (
      <>
        {/* Net Worth Trend */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-100 dark:border-emerald-800/50">
                <TrendingUp className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <CardTitle>{t('dashboard.netWorthTrend', lang)}</CardTitle>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5">{t(basis === 'liquid' ? 'dashboard.netWorthSubLiquid' : 'dashboard.netWorthSubTotal', lang)}</p>
              </div>
            </div>
          </CardHeader>
          <div className="mt-2">
            <NetWorthTrendChart
              data={netWorthPoints}
              projection={readiness.ready && netWorthProjection.length > 0 ? netWorthProjection : undefined}
              assumption={forecastAssumption}
            />
          </div>
        </Card>
      </>
    ),
    cashFlow: (
      <>
        {/* Monthly Cash Flow */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <CardIcon tone="indigo">
                <BarChart3 className="w-5 h-5" />
              </CardIcon>
              <div>
                <CardTitle>{t('dashboard.cashFlow', lang)}</CardTitle>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5">{t('dashboard.cashFlowSubtitle', lang)}</p>
              </div>
            </div>
          </CardHeader>
          <MonthlyBarChart data={cashFlowData} />
        </Card>
      </>
    ),
    health: (
      <>
        {/* Emergency Fund + Health Score row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <EmergencyFundWidget liquidSavings={liquidSavings} avgMonthlyExpense={avgMonthlyExpense} />
          <FinancialHealthScore data={{
            score: healthScore,
            savingsRate,
            emergencyFundMonths,
            overBudgetCount,
            budgetCount: budgets.length,
            dti,
            netWorthTrendPct,
            spendingCv,
            creditUtil: creditReport.overallUtil,
            breakdown: healthBreakdown,
          }} />
        </div>
      </>
    ),
    budgetsGoals: (
      <>
        {/* Budget + Goals row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-100 dark:border-indigo-800/50">
                  <BarChart3 className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                </div>
                <CardTitle>{t('dashboard.budgetProgress', lang)}</CardTitle>
                <HelpHint label="What do these badges mean?" align="left">
                  <p className="font-bold mb-2">Reading the badges</p>
                  <ul className="space-y-1.5 list-none">
                    <li>
                      <span className="font-bold text-amber-300">~$X overshoot</span> — at your current daily pace,
                      you&apos;re projected to spend $X over the budget by month-end.
                    </li>
                    <li>
                      <span className="font-bold text-emerald-300">On pace</span> — pace stays inside the cap if today&apos;s rate holds.
                    </li>
                    <li>
                      <span className="font-bold text-rose-300">$X over</span> — you&apos;ve already exceeded the budget this month.
                    </li>
                    <li>
                      <span className="font-bold text-slate-300 dark:text-slate-600">+$X vs last mo</span> — month-over-month change in spending.
                    </li>
                  </ul>
                  <p className="mt-2 text-slate-300 dark:text-slate-600">Projection = (spent ÷ days elapsed) × days in month.</p>
                </HelpHint>
              </div>
              <a href="/planning" className="whitespace-nowrap text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-400 transition-colors bg-indigo-50 dark:bg-indigo-900/30 px-3 py-1.5 rounded-lg">{t('common.manage', lang)}</a>
            </CardHeader>
            <div className="mt-4">
              <BudgetVsActualChart data={budgetData} />
              <BudgetBars data={topBudgetData} daysLeft={daysLeft} daysElapsed={daysElapsed} showMoM totalSpend={totalMonthSpend} />
              {budgetData.length > 3 && (
                <a href="/planning" className="block text-center text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-400 transition-colors pt-3">
                  {t('dashboard.moreBudgetCategories', lang, { n: budgetData.length - 3 })}
                </a>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-purple-50 dark:bg-purple-900/30 border border-purple-100 dark:border-purple-800/50">
                  <PiggyBank className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                </div>
                <CardTitle>{t('dashboard.savingsGoals', lang)}</CardTitle>
              </div>
              <a href="/planning" className="whitespace-nowrap text-xs font-bold text-purple-600 dark:text-purple-400 hover:text-purple-500 dark:hover:text-purple-400 transition-colors bg-purple-50 dark:bg-purple-900/30 px-3 py-1.5 rounded-lg">{t('common.manage', lang)}</a>
            </CardHeader>
            <div className="mt-4">
              <GoalsSummary data={goalData} />
              {showStaleSavings && staleSavings && (
                <div className="mt-4 flex items-center gap-3 p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800/40">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400">
                    <Calendar className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-amber-800 dark:text-amber-300 truncate">
                      {t('dashboard.staleSavingsTitle', lang, { name: staleSavings.account.name })}
                    </p>
                    <p className="text-xs font-medium text-amber-700/80 dark:text-amber-400/80 mt-0.5">
                      {staleSavings.lastDeposit
                        ? t('dashboard.staleSavingsBody', lang, { days: staleSavings.daysSince })
                        : t('dashboard.staleSavingsNever', lang)}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </Card>
        </div>
      </>
    ),
    billsRecent: (
      <>
        {/* Upcoming Bills + Recent Transactions */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Bill Forecast */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-amber-50 dark:bg-amber-900/30 border border-amber-100 dark:border-amber-800/50">
                  <Calendar className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <CardTitle>{t('dashboard.billForecast', lang)}</CardTitle>
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5">{t('dashboard.billForecastSubtitle', lang, { daysLeft })}</p>
                </div>
              </div>
              <div className="text-right">
                {upcomingBillsTotal > 0 && (
                  <p className="text-base font-extrabold text-amber-600 dark:text-amber-400">{formatCurrency(upcomingBillsTotal)}</p>
                )}
                <a href="/bills" className="inline-block whitespace-nowrap mt-1 text-xs font-bold text-amber-600 dark:text-amber-400 hover:text-amber-500 dark:hover:text-amber-400 transition-colors bg-amber-50 dark:bg-amber-900/30 px-3 py-1.5 rounded-lg">{t('common.viewAll', lang)}</a>
              </div>
            </CardHeader>
            <div className="mt-2">
              {upcomingBills.length === 0 ? (
                <div className="flex items-center gap-4 p-4 rounded-2xl bg-slate-50 dark:bg-slate-700/50 border border-slate-100 dark:border-slate-700/60">
                  <div className="w-11 h-11 rounded-full flex items-center justify-center bg-slate-200 dark:bg-slate-600 text-slate-400 dark:text-slate-500">
                    <Calendar className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-sm text-slate-900 dark:text-slate-100 font-bold">{t('dashboard.noUpcomingBills', lang)}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-medium">{t('dashboard.allCaughtUp', lang)}</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {upcomingBills.slice(0, 3).map((bill) => {
                    const dueDate = new Date(bill.nextDue + 'T00:00:00');
                    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                    const daysUntil = Math.round((dueDate.getTime() - todayMidnight.getTime()) / 86400000);
                    const isUrgent = daysUntil <= 3;
                    return (
                      <div key={bill.id} className="flex items-center justify-between p-3.5 rounded-2xl hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors border border-transparent hover:border-slate-100 dark:hover:border-slate-700/60">
                        <div className="flex items-center gap-3">
                          <div className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 ${isUrgent ? 'bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-400 pulse-glow' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}>
                            <Calendar className="w-4 h-4" />
                          </div>
                          <div>
                            <p className="text-sm text-slate-900 dark:text-slate-100 font-bold">{bill.name}</p>
                            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5">
                              {daysUntil === 0 ? t('dashboard.dueToday', lang) : `${daysUntil}d`} · {formatDate(bill.nextDue, lang)}
                            </p>
                          </div>
                        </div>
                        <span className={`text-sm font-extrabold ${isUrgent ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-slate-100'}`}>
                          {formatCurrency(myBillShare(bill))}
                        </span>
                      </div>
                    );
                  })}
                  {upcomingBills.length > 3 && (
                    <a href="/bills" className="block text-center text-xs font-bold text-amber-600 dark:text-amber-400 hover:text-amber-500 dark:hover:text-amber-400 transition-colors pt-1.5">
                      {t('dashboard.moreUpcomingBills', lang, { n: upcomingBills.length - 3 })}
                    </a>
                  )}
                </div>
              )}
            </div>
          </Card>

          {/* Group Money widget — outstanding tabs & vault progress (client-fetched) */}
          <FundingWidget />

          {/* Recent Transactions */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-100 dark:border-emerald-800/50">
                  <ArrowLeftRight className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <CardTitle>{t('dashboard.recent', lang)}</CardTitle>
              </div>
              <a href="/transactions" className="whitespace-nowrap text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:text-emerald-500 dark:hover:text-emerald-400 transition-colors bg-emerald-50 dark:bg-emerald-900/30 px-3 py-1.5 rounded-lg">{t('common.viewAll', lang)}</a>
            </CardHeader>
            <div className="mt-2">
              <RecentTransactions
                items={recentTx.map((tx) => ({
                  id: tx.id,
                  date: tx.date,
                  description: tx.description,
                  amount: tx.amount,
                  type: tx.type,
                  category: tx.category,
                }))}
                emptyTitle={t('dashboard.noTransactions', lang)}
                emptySub={t('dashboard.addOneToStart', lang)}
              />
            </div>
          </Card>
        </div>
      </>
    ),
  };
  const dashboardLayout = resolveDashboardLayout(settings.dashboardLayout);

  const onboardingSteps: ChecklistStep[] = [
    { key: 'account', label: t('dashboard.onboardAccount', lang), done: accounts.length > 0, href: '/accounts' },
    { key: 'transaction', label: t('dashboard.onboardTransaction', lang), done: transactions.length > 0, href: '/transactions' },
    { key: 'budget', label: t('dashboard.onboardBudget', lang), done: budgets.length > 0, href: '/planning' },
    { key: 'goal', label: t('dashboard.onboardGoal', lang), done: goals.length > 0, href: '/planning' },
  ];

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto pb-28 md:pb-8">
      {/* Server-rendered page: re-pull on tab focus + every 60s so a dashboard
          left open stays live like every client page. */}
      <AutoRefreshOnFocus />
      <PullToRefresh />
      <Celebrations savingsRate={savingsRate} healthScore={healthScore} achievedGoals={achievedGoals} creditUtil={creditReport.overallUtil} />

      <StaggerReveal className="space-y-5 sm:space-y-7">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl md:text-4xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100 font-display">
            {t('dashboard.greeting', lang, { name: settings.displayName?.trim() || session.user?.name?.split(' ')[0] || '' })}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-slate-500 dark:text-slate-400 text-sm md:text-base font-medium">
              {t('dashboard.monthSummary', lang, { month: monthShort(now.getMonth(), lang), year: now.getFullYear(), daysLeft })}
            </p>
            {noSpendStreak >= 2 && (
              <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 border border-amber-100 dark:border-amber-800/50 px-2.5 py-1 rounded-full">
                <Flame className="w-3.5 h-3.5" />
                {t('dashboard.noSpendStreak', lang, { n: noSpendStreak })}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* First-run checklist — only while a setup step is open and not hidden */}
      {onboardingSteps.some((s) => !s.done) && jar.get(ONBOARD_COOKIE)?.value !== '1' && (
        <FirstRunChecklist steps={onboardingSteps} />
      )}

      {/* Health Banner */}
      <HealthBanner
        monthIncome={monthIncome}
        monthSpending={monthSpending}
        daysLeft={daysLeft}
        daysInMonth={daysInMonth}
        overBudgetCount={overBudgetCount}
        creditAlerts={creditReport.cardsOverTarget}
      />

      {/* Money Flow now lives in a modal behind the header icon next to the bell
          (components/MoneyFlowButton.tsx), reachable from every page. Overdraft
          risks likewise live in the notification center (the bell). */}

      {/* Predictions are gated until there's enough history to be meaningful. */}
      {!readiness.ready && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60">
          <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400">
            <BarChart3 className="w-4 h-4" />
          </div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {t('dashboard.predictionsLocked', lang, { needed: readiness.monthsNeeded, have: readiness.months, required: readiness.required })}
          </p>
        </div>
      )}

      {/* KPI Bento — Net Worth hero + Safe-to-Spend + Savings Rate (income &
          spending now live in the calendar's monthly summary below) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Net Worth hero */}
        <Card
          tone={heroStat.tone}
          className="col-span-2 bento-hero flex flex-col justify-between gap-4 overflow-hidden"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <CardIcon tone={heroStat.tone}>
                <HeroIcon className="w-5 h-5" />
              </CardIcon>
              <div>
                <p className="text-xs font-bold text-slate-500 dark:text-slate-400 leading-tight">{heroStat.label}</p>
                {heroStat.annotation && (
                  <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500 mt-0.5">{heroStat.annotation}</p>
                )}
              </div>
            </div>
            {heroStat.delta !== null && Math.abs(heroStat.delta) > 0.5 && (
              <span
                className={`text-xs font-bold flex items-center gap-0.5 px-2 py-1 rounded-lg shrink-0 ${
                  (heroStat.positiveIsGood ? heroStat.delta > 0 : heroStat.delta < 0)
                    ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/30'
                    : 'text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-900/30'
                }`}
              >
                {heroStat.delta > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                {Math.abs(heroStat.delta).toFixed(0)}{t('dashboard.vsLastMonth', lang)}
              </span>
            )}
          </div>
          <RollingNumber
            value={heroStat.rawValue}
            maxSize={46}
            minSize={26}
            className={`font-display font-extrabold ${heroStat.valueColor}`}
          />
          {heroStat.spark && (
            <div className={heroStat.valueColor}>
              <Sparkline data={heroStat.spark} height={42} strokeWidth={2.5} animate />
            </div>
          )}
        </Card>

        {/* Four KPI tiles */}
        {smallStats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.key} tone={stat.tone} className="col-span-1 flex flex-col">
              <div className="flex items-center gap-2.5 mb-2.5">
                <CardIcon tone={stat.tone}>
                  <Icon className="w-4 h-4" />
                </CardIcon>
                <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 leading-tight">{stat.label}</p>
              </div>
              {stat.gauge !== null ? (
                <SavingsRateGauge value={stat.gauge} note={stat.annotation ?? undefined} />
              ) : (
                <>
                  <AnimatedNumber
                    value={stat.rawValue}
                    kind={stat.kind}
                    suffix={stat.suffix}
                    maxSize={26}
                    minSize={13}
                    className={`font-display font-extrabold ${stat.valueColor || 'text-slate-900 dark:text-slate-100'}`}
                  />
                  {stat.delta !== null && Math.abs(stat.delta) > 0.5 && (
                    <p
                      className={`text-xs font-bold mt-1.5 flex items-center gap-0.5 ${
                        (stat.positiveIsGood ? stat.delta > 0 : stat.delta < 0)
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {stat.delta > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                      {Math.abs(stat.delta).toFixed(0)}{t('dashboard.vsLastMonth', lang)}
                    </p>
                  )}
                  {stat.annotation && (
                    <p className="text-xs font-medium text-slate-400 dark:text-slate-500 mt-1.5 leading-snug">{stat.annotation}</p>
                  )}
                  {stat.spark && (
                    <div className={`mt-auto pt-3 ${stat.valueColor}`}>
                      <Sparkline data={stat.spark} height={22} strokeWidth={2} />
                    </div>
                  )}
                </>
              )}
            </Card>
          );
        })}
      </div>

      {dashboardLayout.filter((c) => c.visible).map((c) => <Fragment key={c.id}>{sections[c.id]}</Fragment>)}

      <DashboardCustomizer layout={dashboardLayout} />

      </StaggerReveal>
    </div>
  );
}
