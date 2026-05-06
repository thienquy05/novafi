import { auth } from '@/lib/auth';
import { batchGetDashboardData, getNetWorthHistory, appendNetWorthSnapshot } from '@/lib/sheets';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { TrendingUp, TrendingDown, DollarSign, Calendar, PiggyBank, ArrowUpRight, Wallet, BarChart3, ArrowLeftRight } from 'lucide-react';
import { SpendingPieChart, MonthlyBarChart, BudgetBars, GoalsSummary, NetWorthTrendChart, HealthBanner, EmergencyFundWidget, FinancialHealthScore } from './DashboardCharts';
import { QuickAddTransaction } from './QuickAddTransaction';
import { CategoryIconBadge } from '@/components/CategoryIcon';
import type { NetWorthPoint } from './DashboardCharts';
import { getCache, setCache } from '@/lib/cache';

export const dynamic = 'force-dynamic';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pctChange(current: number, prev: number): number | null {
  if (prev === 0) return null;
  return ((current - prev) / prev) * 100;
}

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.accessToken || !session.spreadsheetId) return null;

  const dashKey = `dashboard:${session.spreadsheetId}`;
  const nwhKey  = `nwh:${session.spreadsheetId}`;

  const [dashData, netWorthHistory] = await Promise.all([
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
  ]);

  const { paychecks, transactions, accounts, bills, budgets, goals } = dashData;

  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // This month
  const monthTx = transactions.filter((t) => t.date.startsWith(thisMonth));
  const monthIncome = monthTx.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const monthSpending = monthTx.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);

  // Previous month
  const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthKey = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, '0')}`;
  const prevMonthTx = transactions.filter((t) => t.date.startsWith(prevMonthKey));
  const prevMonthIncome = prevMonthTx.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const prevMonthSpending = prevMonthTx.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);

  // Days info
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysElapsed = now.getDate();
  const daysLeft = daysInMonth - daysElapsed;

  // Net worth
  const netWorth = accounts.reduce((sum, a) => {
    return sum + (a.type === 'credit' || a.type === 'loan' ? -a.balance : a.balance);
  }, 0);
  const totalAssets = accounts.filter((a) => a.type !== 'credit' && a.type !== 'loan').reduce((s, a) => s + a.balance, 0);
  const totalDebt = accounts.filter((a) => (a.type === 'credit' || a.type === 'loan') && a.balance > 0).reduce((s, a) => s + a.balance, 0);
  const totalSaved = accounts.filter((a) => a.type === 'savings').reduce((s, a) => s + a.balance, 0);

  // Net worth snapshot
  const currentMonthKey = thisMonth;
  const alreadySnapped = netWorthHistory.some((s) => s.month === currentMonthKey);
  if (!alreadySnapped) {
    appendNetWorthSnapshot(session.accessToken, session.spreadsheetId, {
      id: `nw_${Date.now()}`,
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
  const savingsRate = monthIncome > 0 ? Math.max(0, ((monthIncome - monthSpending) / monthIncome) * 100) : 0;

  // Last paycheck
  const sorted = [...paychecks].sort((a, b) => b.date.localeCompare(a.date));
  const lastPaycheck = sorted[0];

  // Upcoming bills (next 14 days)
  const upcomingBills = bills
    .filter((b) => {
      if (!b.isActive) return false;
      const due = new Date(b.nextDue);
      const diff = (due.getTime() - now.getTime()) / 86400000;
      return diff >= 0 && diff <= 14;
    })
    .sort((a, b) => a.nextDue.localeCompare(b.nextDue));

  // Bills due this month (for safe-to-spend)
  const billsThisMonth = bills
    .filter((b) => {
      if (!b.isActive) return false;
      const due = new Date(b.nextDue);
      return due.getMonth() === now.getMonth() && due.getFullYear() === now.getFullYear();
    })
    .reduce((s, b) => s + b.amount, 0);

  // Safe to spend
  const safeToSpend = Math.max(0, monthIncome - monthSpending - billsThisMonth);

  // Recent transactions (last 6)
  const recentTx = [...transactions]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 6);

  // Spending by category this month
  const categorySpend: Record<string, number> = {};
  monthTx.filter((t) => t.type === 'expense').forEach((t) => {
    categorySpend[t.category] = (categorySpend[t.category] ?? 0) + t.amount;
  });
  const categoryData = Object.entries(categorySpend)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({ name, value }));

  // Monthly income vs spending (last 6 months)
  const monthlyData = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const mTx = transactions.filter((t) => t.date.startsWith(key));
    return {
      month: MONTH_NAMES[d.getMonth()],
      income: mTx.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0),
      expenses: mTx.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0),
    };
  });

  // Budget vs actual this month + prev month MoM
  const prevMonthCategorySpend: Record<string, number> = {};
  prevMonthTx.filter((t) => t.type === 'expense').forEach((t) => {
    prevMonthCategorySpend[t.category] = (prevMonthCategorySpend[t.category] ?? 0) + t.amount;
  });

  const budgetData = budgets.map((b) => {
    const spent = monthTx
      .filter((t) => t.type === 'expense' && t.category === b.category)
      .reduce((s, t) => s + t.amount, 0);
    const budget = b.period === 'monthly' ? b.amount
      : b.period === 'weekly' ? b.amount * 4.33
      : b.amount / 12;
    return { category: b.category, budget, spent, prevMonthSpent: prevMonthCategorySpend[b.category] ?? 0 };
  });
  const overBudgetCount = budgetData.filter((b) => b.spent > b.budget).length;

  // Emergency fund
  const liquidSavings = accounts
    .filter((a) => a.type === 'checking' || a.type === 'savings')
    .reduce((s, a) => s + a.balance, 0);
  const last3MonthsExpenses = Array.from({ length: 3 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (i + 1), 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return transactions.filter((t) => t.type === 'expense' && t.date.startsWith(key)).reduce((s, t) => s + t.amount, 0);
  });
  const avgMonthlyExpense = last3MonthsExpenses.reduce((s, v) => s + v, 0) / 3;
  const emergencyFundMonths = avgMonthlyExpense > 0 ? liquidSavings / avgMonthlyExpense : 0;

  // Financial health score
  const debtRatio = totalAssets > 0 ? totalDebt / totalAssets : 0;
  const savingsRateScore = savingsRate >= 20 ? 25 : savingsRate >= 10 ? 17 : savingsRate >= 5 ? 10 : savingsRate > 0 ? 5 : 0;
  const emergencyScore = emergencyFundMonths >= 6 ? 25 : emergencyFundMonths >= 3 ? 18 : emergencyFundMonths >= 1 ? 10 : emergencyFundMonths >= 0.5 ? 5 : 0;
  const budgetScore = budgets.length === 0 ? 12 : Math.max(0, 25 - overBudgetCount * 6);
  const debtScore = debtRatio <= 0.1 ? 25 : debtRatio <= 0.3 ? 20 : debtRatio <= 0.5 ? 15 : debtRatio <= 0.75 ? 10 : 5;
  const healthScore = savingsRateScore + emergencyScore + budgetScore + debtScore;

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
  const spendingDelta = pctChange(monthSpending, prevMonthSpending);
  const incomeDelta = pctChange(monthIncome, prevMonthIncome);
  const netWorthDelta = prevNetWorth !== null ? pctChange(netWorth, prevNetWorth) : null;

  const stats = [
    {
      label: 'Net Worth',
      value: formatCurrency(netWorth),
      icon: Wallet,
      color: netWorth >= 0 ? 'text-emerald-600' : 'text-rose-600',
      bg: netWorth >= 0 ? 'bg-emerald-50' : 'bg-rose-50',
      border: netWorth >= 0 ? 'border-emerald-100' : 'border-rose-100',
      delta: netWorthDelta,
      positiveIsGood: true,
    },
    {
      label: 'Month Income',
      value: formatCurrency(monthIncome),
      icon: ArrowUpRight,
      color: 'text-emerald-600',
      bg: 'bg-emerald-50',
      border: 'border-emerald-100',
      delta: incomeDelta,
      positiveIsGood: true,
    },
    {
      label: 'Month Spending',
      value: formatCurrency(monthSpending),
      icon: TrendingDown,
      color: 'text-rose-600',
      bg: 'bg-rose-50',
      border: 'border-rose-100',
      delta: spendingDelta,
      positiveIsGood: false,
    },
    {
      label: 'Safe to Spend',
      value: formatCurrency(safeToSpend),
      icon: PiggyBank,
      color: safeToSpend > 0 ? 'text-indigo-600' : 'text-rose-600',
      bg: safeToSpend > 0 ? 'bg-indigo-50' : 'bg-rose-50',
      border: safeToSpend > 0 ? 'border-indigo-100' : 'border-rose-100',
      delta: null,
      positiveIsGood: true,
    },
  ];

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-5 sm:space-y-7 pb-28 md:pb-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl md:text-4xl font-extrabold tracking-tight text-slate-900">
            Hey, {session.user?.name?.split(' ')[0]} 👋
          </h1>
          <p className="text-slate-500 text-sm md:text-base font-medium">
            {MONTH_NAMES[now.getMonth()]} {now.getFullYear()} · {daysLeft} days left this month
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
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-5">
        {stats.map(({ label, value, icon: Icon, color, bg, border, delta, positiveIsGood }) => (
          <Card key={label} className={`border ${border} hover:border-slate-300`}>
            <div className="flex items-center gap-3 mb-3">
              <div className={`p-2.5 rounded-xl ${bg}`}>
                <Icon className={`w-5 h-5 ${color}`} />
              </div>
              <p className="text-xs font-bold text-slate-500 leading-tight">{label}</p>
            </div>
            <p className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">{value}</p>
            {delta !== null && Math.abs(delta) > 0.5 && (
              <p className={`text-xs font-bold mt-1.5 flex items-center gap-0.5 ${
                (positiveIsGood ? delta > 0 : delta < 0) ? 'text-emerald-600' : 'text-rose-600'
              }`}>
                {delta > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                {Math.abs(delta).toFixed(0)}% vs last mo
              </p>
            )}
          </Card>
        ))}
      </div>

      {/* Assets / Liabilities / Savings / Emergency Fund */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-2xl border border-emerald-100 p-4">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Assets</p>
          <p className="text-lg font-extrabold text-emerald-600 mt-1 tracking-tight">{formatCurrency(totalAssets)}</p>
        </div>
        <div className="bg-white rounded-2xl border border-rose-100 p-4">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Liabilities</p>
          <p className="text-lg font-extrabold text-rose-600 mt-1 tracking-tight">{totalDebt > 0 ? `-${formatCurrency(totalDebt)}` : formatCurrency(0)}</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 p-4">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Savings</p>
          <p className="text-lg font-extrabold text-purple-600 mt-1 tracking-tight">{formatCurrency(totalSaved)}</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 p-4">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Emergency</p>
          <p className={`text-lg font-extrabold mt-1 tracking-tight ${emergencyFundMonths >= 6 ? 'text-emerald-600' : emergencyFundMonths >= 3 ? 'text-indigo-600' : emergencyFundMonths >= 1 ? 'text-amber-600' : 'text-rose-600'}`}>
            {emergencyFundMonths.toFixed(1)} <span className="text-sm font-bold text-slate-400">mo</span>
          </p>
        </div>
      </div>

      {/* Net Worth Trend */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-emerald-50 border border-emerald-100">
              <TrendingUp className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <CardTitle>Net Worth Trend</CardTitle>
              <p className="text-xs font-medium text-slate-500 mt-0.5">Monthly snapshot</p>
            </div>
          </div>
        </CardHeader>
        <div className="mt-2">
          <NetWorthTrendChart data={netWorthPoints} />
        </div>
      </Card>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card className="min-h-[380px] flex flex-col">
          <CardHeader>
            <div>
              <CardTitle>Spending This Month</CardTitle>
              <p className="text-xs font-medium text-slate-500 mt-1">Where your money went</p>
            </div>
            <div className="text-right">
              <span className="text-xl font-extrabold text-slate-900">{formatCurrency(monthSpending)}</span>
            </div>
          </CardHeader>
          <div className="flex-1 flex items-center justify-center">
            <SpendingPieChart data={categoryData} />
          </div>
        </Card>

        <Card className="min-h-[380px] flex flex-col">
          <CardHeader>
            <div>
              <CardTitle>Cash Flow</CardTitle>
              <p className="text-xs font-medium text-slate-500 mt-1">Income vs Expenses — 6 months</p>
            </div>
          </CardHeader>
          <div className="flex-1">
            <MonthlyBarChart data={monthlyData} />
          </div>
        </Card>
      </div>

      {/* Emergency Fund + Health Score row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <EmergencyFundWidget liquidSavings={liquidSavings} avgMonthlyExpense={avgMonthlyExpense} />
        <FinancialHealthScore data={{
          score: healthScore,
          savingsRate,
          emergencyFundMonths,
          overBudgetCount,
          budgetCount: budgets.length,
          debtRatio,
        }} />
      </div>

      {/* Budget + Goals row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-indigo-50 border border-indigo-100">
                <BarChart3 className="w-5 h-5 text-indigo-600" />
              </div>
              <CardTitle>Budget Progress</CardTitle>
            </div>
            <a href="/planning" className="text-xs font-bold text-indigo-600 hover:text-indigo-500 transition-colors bg-indigo-50 px-3 py-1.5 rounded-lg">Manage</a>
          </CardHeader>
          <div className="mt-4">
            <BudgetBars data={budgetData} daysLeft={daysLeft} daysElapsed={daysElapsed} showMoM />
          </div>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-purple-50 border border-purple-100">
                <PiggyBank className="w-5 h-5 text-purple-600" />
              </div>
              <CardTitle>Savings Goals</CardTitle>
            </div>
            <a href="/planning" className="text-xs font-bold text-purple-600 hover:text-purple-500 transition-colors bg-purple-50 px-3 py-1.5 rounded-lg">Manage</a>
          </CardHeader>
          <div className="mt-4">
            <GoalsSummary data={goalData} />
          </div>
        </Card>
      </div>

      {/* Upcoming Bills + Recent Transactions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Upcoming Bills */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-amber-50 border border-amber-100">
                <Calendar className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <CardTitle>Due Soon</CardTitle>
                <p className="text-xs font-medium text-slate-500 mt-0.5">Next 14 days</p>
              </div>
            </div>
            <a href="/bills" className="text-xs font-bold text-slate-500 hover:text-slate-900 transition-colors">View All →</a>
          </CardHeader>
          <div className="mt-2">
            {upcomingBills.length === 0 ? (
              <div className="flex items-center gap-4 p-4 rounded-2xl bg-slate-50 border border-slate-100">
                <div className="w-11 h-11 rounded-full flex items-center justify-center bg-slate-200 text-slate-400">
                  <Calendar className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm text-slate-900 font-bold">No upcoming bills</p>
                  <p className="text-xs text-slate-500 mt-0.5 font-medium">You&apos;re all caught up</p>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {upcomingBills.map((bill) => {
                  const daysUntil = Math.ceil(
                    (new Date(bill.nextDue).getTime() - now.getTime()) / 86400000
                  );
                  const isUrgent = daysUntil <= 3;
                  return (
                    <div key={bill.id} className="flex items-center justify-between p-3.5 rounded-2xl hover:bg-slate-50 transition-colors border border-transparent hover:border-slate-100">
                      <div className="flex items-center gap-3">
                        <div className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 ${isUrgent ? 'bg-rose-100 text-rose-600' : 'bg-slate-100 text-slate-600'}`}>
                          <Calendar className="w-4 h-4" />
                        </div>
                        <div>
                          <p className="text-sm text-slate-900 font-bold">{bill.name}</p>
                          <p className="text-xs font-medium text-slate-500 mt-0.5">
                            {daysUntil === 0 ? 'Due Today' : `${daysUntil}d`} · {formatDate(bill.nextDue)}
                          </p>
                        </div>
                      </div>
                      <span className={`text-sm font-extrabold ${isUrgent ? 'text-rose-600' : 'text-slate-900'}`}>
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
              <div className="p-2 rounded-xl bg-emerald-50 border border-emerald-100">
                <ArrowLeftRight className="w-5 h-5 text-emerald-600" />
              </div>
              <CardTitle>Recent</CardTitle>
            </div>
            <a href="/transactions" className="text-xs font-bold text-slate-500 hover:text-slate-900 transition-colors">View All →</a>
          </CardHeader>
          <div className="mt-2">
            {recentTx.length === 0 ? (
              <div className="flex items-center gap-4 p-4 rounded-2xl bg-slate-50 border border-slate-100">
                <div className="w-11 h-11 rounded-full flex items-center justify-center bg-slate-200 text-slate-400">
                  <ArrowLeftRight className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm text-slate-900 font-bold">No transactions yet</p>
                  <p className="text-xs text-slate-500 mt-0.5 font-medium">Add one to get started</p>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {recentTx.map((tx) => {
                  const isIncome = tx.type === 'income';
                  return (
                    <div key={tx.id} className="flex items-center justify-between p-3.5 rounded-2xl hover:bg-slate-50 transition-colors border border-transparent hover:border-slate-100">
                      <div className="flex items-center gap-3">
                        <CategoryIconBadge
                          category={tx.category}
                          type={tx.type}
                          className="w-11 h-11 rounded-xl"
                        />
                        <div>
                          <p className="text-sm text-slate-900 font-bold">{tx.description || tx.category}</p>
                          <p className="text-xs font-medium text-slate-500 mt-0.5">{tx.category} · {formatDate(tx.date)}</p>
                        </div>
                      </div>
                      <span className={`text-sm font-extrabold ${isIncome ? 'text-emerald-600' : tx.type === 'transfer' ? 'text-blue-600' : 'text-slate-900'}`}>
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
