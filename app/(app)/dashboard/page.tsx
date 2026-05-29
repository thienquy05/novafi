import { cookies } from 'next/headers';
import { auth } from '@/lib/auth';
import { batchGetDashboardData, getNetWorthHistory, appendNetWorthSnapshot, getSettings } from '@/lib/sheets';
import { formatCurrency, formatDate } from '@/lib/utils';
import {
  calcTraditionalNetWorth, calcLiquidNetWorth, calcTotalAssets, calcTotalDebt, calcLiquidSavings,
  calcMonthIncome, calcMonthExpense, calcSavingsRate, calcSafeToSpend, pctChange as calcPctChange,
  normalizeMonthlyBudget, calcAvgMonthlyExpense, calcEmergencyFundMonths,
  calcSavingsRateScore, calcEmergencyScore, calcBudgetScore,
  calcDebtToIncomeScore, calcDebtToIncomeRatio,
  calcNetWorthTrendScore, calcAvgMomPct,
  calcSpendingVolatilityScore, calcCoefficientOfVariation,
  calcNetWorthProjection,
} from '@/lib/calculations';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { TrendingUp, TrendingDown, Calendar, PiggyBank, ArrowUpRight, Wallet, BarChart3, ArrowLeftRight } from 'lucide-react';
import { SpendingPieChart, BudgetBars, GoalsSummary, NetWorthTrendChart, HealthBanner, EmergencyFundWidget, FinancialHealthScore, SavingsRateGauge } from './DashboardCharts';
import { QuickAddTransaction } from './QuickAddTransaction';
import { CategoryIconBadge } from '@/components/CategoryIcon';
import type { NetWorthPoint } from './DashboardCharts';
import { getCache, setCache } from '@/lib/cache';
import { FitText } from '@/components/ui/FitText';
import { HelpHint } from '@/components/ui/HelpHint';
import { t } from '@/lib/i18n';
import type { Language } from '@/types';

export const dynamic = 'force-dynamic';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];


export default async function DashboardPage() {
  const session = await auth();
  if (!session?.accessToken || !session.spreadsheetId) return null;

  const jar = await cookies();
  const lang: Language = jar.get('nf_lang')?.value === 'vi' ? 'vi' : 'en';

  const dashKey = `dashboard:${session.spreadsheetId}`;
  const nwhKey  = `nwh:${session.spreadsheetId}`;

  const settingsKey = `settings:${session.spreadsheetId}`;
  const [dashData, netWorthHistory, settings] = await Promise.all([
    (async () => {
      const cached = getCache<Awaited<ReturnType<typeof batchGetDashboardData>>>(dashKey);
      if (cached) return cached;
      const fresh = await batchGetDashboardData(session.accessToken, session.spreadsheetId);
      setCache(dashKey, fresh, 45_000);
      return fresh;
    })(),
    (async () => {
      const cached = getCache<Awaited<ReturnType<typeof getNetWorthHistory>>>(nwhKey);
      if (cached) return cached;
      const fresh = await getNetWorthHistory(session.accessToken, session.spreadsheetId);
      setCache(nwhKey, fresh, 45_000);
      return fresh;
    })(),
    (async () => {
      const cached = getCache<Awaited<ReturnType<typeof getSettings>>>(settingsKey);
      if (cached) return cached;
      const fresh = await getSettings(session.accessToken, session.spreadsheetId);
      setCache(settingsKey, fresh, 45_000);
      return fresh;
    })(),
  ]);

  const { transactions, accounts, bills, budgets, goals } = dashData;

  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // This month
  const monthTx = transactions.filter((tx) => tx.date.startsWith(thisMonth));
  const monthIncome = calcMonthIncome(transactions, thisMonth);
  const monthSpending = calcMonthExpense(transactions, thisMonth);

  // Previous month
  const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthKey = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, '0')}`;
  const prevMonthTx = transactions.filter((tx) => tx.date.startsWith(prevMonthKey));
  const prevMonthIncome = calcMonthIncome(transactions, prevMonthKey);
  const prevMonthSpending = calcMonthExpense(transactions, prevMonthKey);

  // Days info
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysElapsed = now.getDate();
  const daysLeft = daysInMonth - daysElapsed;

  // Net worth
  const traditionalNetWorth = calcTraditionalNetWorth(accounts);
  const liquidNetWorth = calcLiquidNetWorth(accounts);
  const excludeLoans = settings.excludeLoansFromNetWorth;
  const netWorth = excludeLoans ? liquidNetWorth : traditionalNetWorth;
  const totalAssets = calcTotalAssets(accounts);
  const totalDebt = calcTotalDebt(accounts);
  const totalLoanDebt = accounts.filter((a) => a.type === 'loan' && a.balance > 0).reduce((s, a) => s + a.balance, 0);
  const totalSaved = accounts.filter((a) => a.type === 'savings').reduce((s, a) => s + a.balance, 0);

  // Net worth snapshot
  const currentMonthKey = thisMonth;
  const alreadySnapped = netWorthHistory.some((s) => s.month === currentMonthKey);
  if (!alreadySnapped) {
    appendNetWorthSnapshot(session.accessToken, session.spreadsheetId, {
      id: `nw_${currentMonthKey}`,
      date: now.toISOString().split('T')[0],
      month: currentMonthKey,
      netWorth,
    }).catch(() => {});
  }

  // Build chart-ready net worth series
  const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const netWorthPoints: NetWorthPoint[] = [...netWorthHistory]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((s) => {
      const [yr, mo] = s.month.split('-');
      return {
        month: s.month,
        label: `${MONTH_SHORT[Number(mo) - 1]} '${yr.slice(2)}`,
        netWorth: s.netWorth,
      };
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

  // Bills due this month (all, for safe-to-spend; includes already-passed due dates)
  const billsThisMonth = bills
    .filter((b) => {
      if (!b.isActive) return false;
      const due = new Date(b.nextDue + 'T00:00:00');
      return due.getMonth() === now.getMonth() && due.getFullYear() === now.getFullYear();
    })
    .reduce((s, b) => s + b.amount, 0);

  // Total remaining bills this month (rest-of-month forecast)
  const upcomingBillsTotal = upcomingBills.reduce((s, b) => s + b.amount, 0);

  // Safe to spend
  const safeToSpend = calcSafeToSpend(monthIncome, monthSpending, billsThisMonth);

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

  // Budget vs actual this month — reuse categorySpend (already computed above)
  const prevMonthCategorySpend: Record<string, number> = {};
  prevMonthTx.filter((tx) => tx.type === 'expense').forEach((tx) => {
    prevMonthCategorySpend[tx.category] = (prevMonthCategorySpend[tx.category] ?? 0) + tx.amount;
  });

  const budgetData = budgets.map((b) => ({
    category: b.category,
    budget: normalizeMonthlyBudget(b.amount, b.period),
    spent: categorySpend[b.category] ?? 0,
    prevMonthSpent: prevMonthCategorySpend[b.category] ?? 0,
  }));
  const overBudgetCount = budgetData.filter((b) => b.spent > b.budget).length;

  // Net worth projection (6 months forward based on avg MoM rate)
  const projectedValues = calcNetWorthProjection(netWorthPoints, 6);
  const netWorthProjection = projectedValues.map((projected, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() + i + 1, 1);
    return {
      label: `${MONTH_NAMES[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`,
      projected,
    };
  });

  // Total spend this month for category %
  const totalMonthSpend = Object.values(categorySpend).reduce((s, v) => s + v, 0);

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

  // Net worth trend: avg MoM % across last up-to-4 snapshots
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
  const healthScore = savingsRateScore + emergencyScore + budgetScore + dtiScore + trendScore + volatilityScore;

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

  // MoM deltas
  const spendingDelta = calcPctChange(monthSpending, prevMonthSpending);
  const incomeDelta = calcPctChange(monthIncome, prevMonthIncome);
  const netWorthDelta = prevNetWorth !== null ? calcPctChange(netWorth, prevNetWorth) : null;

  const stats = [
    {
      label: excludeLoans ? t('dashboard.liquidNetWorth', lang) : t('dashboard.netWorth', lang),
      value: formatCurrency(netWorth),
      icon: Wallet,
      color: netWorth >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
      bg: netWorth >= 0 ? 'bg-emerald-50 dark:bg-emerald-900/30' : 'bg-rose-50 dark:bg-rose-900/30',
      border: netWorth >= 0 ? 'border-emerald-100 dark:border-emerald-800/50' : 'border-rose-100 dark:border-rose-800/50',
      delta: netWorthDelta,
      positiveIsGood: true,
      annotation: excludeLoans && totalLoanDebt > 0 ? t('dashboard.loansExcl', lang) : null,
      viz: null as number | null,
    },
    {
      label: t('dashboard.monthIncome', lang),
      value: formatCurrency(monthIncome),
      icon: ArrowUpRight,
      color: 'text-emerald-600 dark:text-emerald-400',
      bg: 'bg-emerald-50 dark:bg-emerald-900/30',
      border: 'border-emerald-100 dark:border-emerald-800/50',
      delta: incomeDelta,
      positiveIsGood: true,
      annotation: null,
      viz: null,
    },
    {
      label: t('dashboard.monthSpending', lang),
      value: formatCurrency(monthSpending),
      icon: TrendingDown,
      color: 'text-rose-600 dark:text-rose-400',
      bg: 'bg-rose-50 dark:bg-rose-900/30',
      border: 'border-rose-100 dark:border-rose-800/50',
      delta: spendingDelta,
      positiveIsGood: false,
      annotation: null,
      viz: null,
    },
    {
      label: t('dashboard.safeToSpend', lang),
      value: formatCurrency(safeToSpend),
      icon: PiggyBank,
      color: safeToSpend > 0 ? 'text-indigo-600 dark:text-indigo-400' : 'text-rose-600 dark:text-rose-400',
      bg: safeToSpend > 0 ? 'bg-indigo-50 dark:bg-indigo-900/30' : 'bg-rose-50 dark:bg-rose-900/30',
      border: safeToSpend > 0 ? 'border-indigo-100 dark:border-indigo-800/50' : 'border-rose-100 dark:border-rose-800/50',
      delta: null,
      positiveIsGood: true,
      annotation: null,
      viz: null,
    },
    {
      label: t('dashboard.savingsRateKPI', lang),
      value: `${savingsRate.toFixed(0)}%`,
      icon: TrendingUp,
      color: savingsRate >= 20 ? 'text-emerald-600 dark:text-emerald-400' : savingsRate >= 10 ? 'text-indigo-600 dark:text-indigo-400' : 'text-amber-600 dark:text-amber-400',
      bg: savingsRate >= 20 ? 'bg-emerald-50 dark:bg-emerald-900/30' : savingsRate >= 10 ? 'bg-indigo-50 dark:bg-indigo-900/30' : 'bg-amber-50 dark:bg-amber-900/30',
      border: savingsRate >= 20 ? 'border-emerald-100 dark:border-emerald-800/50' : savingsRate >= 10 ? 'border-indigo-100 dark:border-indigo-800/50' : 'border-amber-100 dark:border-amber-800/50',
      delta: null,
      positiveIsGood: true,
      annotation: t('dashboard.savingsRateKPINote', lang),
      viz: savingsRate,
    },
  ];

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-5 sm:space-y-7 pb-28 md:pb-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl md:text-4xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">
            {t('dashboard.greeting', lang, { name: session.user?.name?.split(' ')[0] ?? '' })}
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm md:text-base font-medium">
            {t('dashboard.monthSummary', lang, { month: MONTH_NAMES[now.getMonth()], year: now.getFullYear(), daysLeft })}
          </p>
        </div>
        <div className="hidden md:block">
          <QuickAddTransaction accounts={accounts} />
        </div>
      </div>

      {/* Health Banner */}
      <HealthBanner
        monthIncome={monthIncome}
        monthSpending={monthSpending}
        safeToSpend={safeToSpend}
        daysLeft={daysLeft}
        daysInMonth={daysInMonth}
        overBudgetCount={overBudgetCount}
      />

      {/* Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
        {stats.map(({ label, value, icon: Icon, color, bg, border, delta, positiveIsGood, annotation, viz }, idx) => (
          <Card key={label} className={`border ${border} hover:border-slate-300 dark:hover:border-slate-600 ${idx === stats.length - 1 && stats.length % 2 !== 0 ? 'col-span-2 sm:col-span-1' : ''}`}>
            <div className="flex items-center gap-3 mb-3">
              <div className={`p-2.5 rounded-xl ${bg}`}>
                <Icon className={`w-5 h-5 ${color}`} />
              </div>
              <p className="text-xs font-bold text-slate-500 dark:text-slate-400 leading-tight">{label}</p>
            </div>
            {viz !== null ? (
              <SavingsRateGauge value={viz} note={annotation ?? undefined} />
            ) : (
              <>
                <FitText maxSize={28} minSize={13} className="font-extrabold text-slate-900 dark:text-slate-100 mt-0.5">{value}</FitText>
                {delta !== null && Math.abs(delta) > 0.5 && (
                  <p className={`text-xs font-bold mt-1.5 flex items-center gap-0.5 ${
                    (positiveIsGood ? delta > 0 : delta < 0) ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                  }`}>
                    {delta > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                    {Math.abs(delta).toFixed(0)}{t('dashboard.vsLastMonth', lang)}
                  </p>
                )}
                {annotation && (
                  <p className="text-xs font-medium text-slate-400 dark:text-slate-500 mt-1.5">{annotation}</p>
                )}
              </>
            )}
          </Card>
        ))}
      </div>

      {/* Assets / Liabilities / Savings / Emergency Fund */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-emerald-100 dark:border-emerald-800/50 p-4">
          <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t('common.assets', lang)}</p>
          <FitText maxSize={18} minSize={11} className="font-extrabold text-emerald-600 dark:text-emerald-400 mt-1">{formatCurrency(totalAssets)}</FitText>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-rose-100 dark:border-rose-800/50 p-4">
          <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t('common.liabilities', lang)}</p>
          <FitText maxSize={18} minSize={11} className="font-extrabold text-rose-600 dark:text-rose-400 mt-1">{totalDebt > 0 ? `-${formatCurrency(totalDebt)}` : formatCurrency(0)}</FitText>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/60 p-4">
          <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t('dashboard.savings', lang)}</p>
          <FitText maxSize={18} minSize={11} className="font-extrabold text-purple-600 dark:text-purple-400 mt-1">{formatCurrency(totalSaved)}</FitText>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/60 p-4">
          <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t('dashboard.emergency', lang)}</p>
          <p className={`text-lg font-extrabold mt-1 tracking-tight ${emergencyFundMonths >= 6 ? 'text-emerald-600 dark:text-emerald-400' : emergencyFundMonths >= 3 ? 'text-indigo-600 dark:text-indigo-400' : emergencyFundMonths >= 1 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'}`}>
            {emergencyFundMonths.toFixed(1)} <span className="text-sm font-bold text-slate-400 dark:text-slate-500">mo</span>
          </p>
        </div>
      </div>

      {/* Net Worth Trend */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-100 dark:border-emerald-800/50">
              <TrendingUp className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <CardTitle>{t('dashboard.netWorthTrend', lang)}</CardTitle>
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5">{t('dashboard.monthlySnapshot', lang)}</p>
            </div>
          </div>
        </CardHeader>
        <div className="mt-2">
          <NetWorthTrendChart data={netWorthPoints} projection={netWorthProjection.length > 0 ? netWorthProjection : undefined} />
        </div>
      </Card>

      {/* Spending breakdown */}
      <Card className="min-h-[380px] flex flex-col">
        <CardHeader>
          <div>
            <CardTitle>{t('dashboard.spendingThisMonth', lang)}</CardTitle>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-1">{t('dashboard.whereMoneyWent', lang)}</p>
          </div>
          <div className="text-right">
            <span className="text-xl font-extrabold text-slate-900 dark:text-slate-100">{formatCurrency(monthSpending)}</span>
          </div>
        </CardHeader>
        <div className="flex-1 flex items-center justify-center">
          <SpendingPieChart data={categoryData} />
        </div>
      </Card>

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
          breakdown: {
            savings: savingsRateScore,
            emergency: emergencyScore,
            budget: budgetScore,
            dti: dtiScore,
            trend: trendScore,
            volatility: volatilityScore,
          },
        }} />
      </div>

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
            <a href="/planning" className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-400 transition-colors bg-indigo-50 dark:bg-indigo-900/30 px-3 py-1.5 rounded-lg">{t('common.manage', lang)}</a>
          </CardHeader>
          <div className="mt-4">
            <BudgetBars data={budgetData} daysLeft={daysLeft} daysElapsed={daysElapsed} showMoM totalSpend={totalMonthSpend} />
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
            <a href="/planning" className="text-xs font-bold text-purple-600 dark:text-purple-400 hover:text-purple-500 dark:hover:text-purple-400 transition-colors bg-purple-50 dark:bg-purple-900/30 px-3 py-1.5 rounded-lg">{t('common.manage', lang)}</a>
          </CardHeader>
          <div className="mt-4">
            <GoalsSummary data={goalData} />
          </div>
        </Card>
      </div>

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
              <a href="/bills" className="inline-block mt-1 text-xs font-bold text-amber-600 dark:text-amber-400 hover:text-amber-500 dark:hover:text-amber-400 transition-colors bg-amber-50 dark:bg-amber-900/30 px-3 py-1.5 rounded-lg">{t('common.viewAll', lang)}</a>
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
                {upcomingBills.map((bill) => {
                  const dueDate = new Date(bill.nextDue + 'T00:00:00');
                  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                  const daysUntil = Math.round((dueDate.getTime() - todayMidnight.getTime()) / 86400000);
                  const isUrgent = daysUntil <= 3;
                  return (
                    <div key={bill.id} className="flex items-center justify-between p-3.5 rounded-2xl hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors border border-transparent hover:border-slate-100 dark:hover:border-slate-700/60">
                      <div className="flex items-center gap-3">
                        <div className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 ${isUrgent ? 'bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-400' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}>
                          <Calendar className="w-4 h-4" />
                        </div>
                        <div>
                          <p className="text-sm text-slate-900 dark:text-slate-100 font-bold">{bill.name}</p>
                          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5">
                            {daysUntil === 0 ? t('dashboard.dueToday', lang) : `${daysUntil}d`} · {formatDate(bill.nextDue)}
                          </p>
                        </div>
                      </div>
                      <span className={`text-sm font-extrabold ${isUrgent ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-slate-100'}`}>
                        {formatCurrency(bill.amount)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Card>

        {/* Recent Transactions */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-100 dark:border-emerald-800/50">
                <ArrowLeftRight className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <CardTitle>{t('dashboard.recent', lang)}</CardTitle>
            </div>
            <a href="/transactions" className="text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:text-emerald-500 dark:hover:text-emerald-400 transition-colors bg-emerald-50 dark:bg-emerald-900/30 px-3 py-1.5 rounded-lg">{t('common.viewAll', lang)}</a>
          </CardHeader>
          <div className="mt-2">
            {recentTx.length === 0 ? (
              <div className="flex items-center gap-4 p-4 rounded-2xl bg-slate-50 dark:bg-slate-700/50 border border-slate-100 dark:border-slate-700/60">
                <div className="w-11 h-11 rounded-full flex items-center justify-center bg-slate-200 dark:bg-slate-600 text-slate-400 dark:text-slate-500">
                  <ArrowLeftRight className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm text-slate-900 dark:text-slate-100 font-bold">{t('dashboard.noTransactions', lang)}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-medium">{t('dashboard.addOneToStart', lang)}</p>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {recentTx.map((tx) => {
                  const isIncome = tx.type === 'income';
                  return (
                    <div key={tx.id} className="flex items-center justify-between p-3.5 rounded-2xl hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors border border-transparent hover:border-slate-100 dark:hover:border-slate-700/60">
                      <div className="flex items-center gap-3">
                        <CategoryIconBadge
                          category={tx.category}
                          type={tx.type}
                          className="w-11 h-11 rounded-xl"
                        />
                        <div>
                          <p className="text-sm text-slate-900 dark:text-slate-100 font-bold">{tx.description || tx.category}</p>
                          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5">{tx.category} · {formatDate(tx.date)}</p>
                        </div>
                      </div>
                      <span className={`text-sm font-extrabold ${isIncome ? 'text-emerald-600 dark:text-emerald-400' : tx.type === 'transfer' ? 'text-blue-600 dark:text-blue-400' : 'text-slate-900 dark:text-slate-100'}`}>
                        {isIncome ? '+' : tx.type === 'transfer' ? '' : '-'}{formatCurrency(tx.amount)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Mobile FAB */}
      <div className="fixed bottom-20 right-4 z-50 md:hidden">
        <QuickAddTransaction accounts={accounts} isFab />
      </div>
    </div>
  );
}
