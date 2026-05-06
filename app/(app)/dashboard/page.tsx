import { auth } from '@/lib/auth';
import { getPaychecks, getTransactions, getAccounts, getBills, getBudgets, getGoals, getNetWorthHistory, appendNetWorthSnapshot } from '@/lib/sheets';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { TrendingUp, TrendingDown, DollarSign, Calendar, PiggyBank, ArrowUpRight, ArrowDownRight, Wallet, BarChart3, ArrowLeftRight } from 'lucide-react';
import { SpendingPieChart, MonthlyBarChart, BudgetBars, SpendingAlerts, GoalsSummary, NetWorthTrendChart } from './DashboardCharts';
import { QuickAddTransaction } from './QuickAddTransaction';
import type { NetWorthPoint } from './DashboardCharts';

export const dynamic = 'force-dynamic';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.accessToken || !session.spreadsheetId) return null;

  const [paychecks, transactions, accounts, bills, budgets, goals, netWorthHistory] = await Promise.all([
    getPaychecks(session.accessToken, session.spreadsheetId),
    getTransactions(session.accessToken, session.spreadsheetId),
    getAccounts(session.accessToken, session.spreadsheetId),
    getBills(session.accessToken, session.spreadsheetId),
    getBudgets(session.accessToken, session.spreadsheetId),
    getGoals(session.accessToken, session.spreadsheetId),
    getNetWorthHistory(session.accessToken, session.spreadsheetId),
  ]);

  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const monthTx = transactions.filter((t) => t.date.startsWith(thisMonth));
  const monthIncome = monthTx.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const monthSpending = monthTx.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);

  // Net worth
  const netWorth = accounts.reduce((sum, a) => {
    return sum + (a.type === 'credit' || a.type === 'loan' ? -a.balance : a.balance);
  }, 0);

  // Savings
  const totalSaved = accounts.filter((a) => a.type === 'savings').reduce((s, a) => s + a.balance, 0);

  // Net worth snapshot — record once per calendar month (fire-and-forget)
  const currentMonthKey = thisMonth; // already computed above as YYYY-MM
  const alreadySnapped = netWorthHistory.some((s) => s.month === currentMonthKey);
  if (!alreadySnapped) {
    appendNetWorthSnapshot(session.accessToken, session.spreadsheetId, {
      id: `nw_${Date.now()}`,
      date: now.toISOString().split('T')[0],
      month: currentMonthKey,
      netWorth,
    }).catch(() => { /* non-critical */ });
  }

  // Build chart-ready net worth series (sorted chronologically)
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

  // Savings rate this month
  const savingsRate = monthIncome > 0 ? Math.max(0, ((monthIncome - monthSpending) / monthIncome) * 100) : 0;

  // Last paycheck net
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

  // Budget vs actual this month
  const budgetData = budgets.map((b) => {
    const spent = monthTx
      .filter((t) => t.type === 'expense' && t.category === b.category)
      .reduce((s, t) => s + t.amount, 0);
    const budget = b.period === 'monthly' ? b.amount
      : b.period === 'weekly' ? b.amount * 4.33
      : b.amount / 12;
    return { category: b.category, budget, spent };
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

  const stats = [
    {
      label: 'Net Worth',
      value: formatCurrency(netWorth),
      icon: Wallet,
      color: netWorth >= 0 ? 'text-emerald-600' : 'text-rose-600',
      bg: netWorth >= 0 ? 'bg-emerald-50' : 'bg-rose-50',
      border: netWorth >= 0 ? 'border-emerald-100' : 'border-rose-100',
    },
    {
      label: 'Last Paycheck',
      value: lastPaycheck ? formatCurrency(lastPaycheck.netAmount) : formatCurrency(0),
      icon: DollarSign,
      color: 'text-indigo-600',
      bg: 'bg-indigo-50',
      border: 'border-indigo-100',
    },
    {
      label: 'Month Spending',
      value: formatCurrency(monthSpending),
      icon: TrendingDown,
      color: 'text-rose-600',
      bg: 'bg-rose-50',
      border: 'border-rose-100',
    },
    {
      label: 'Total Savings',
      value: formatCurrency(totalSaved),
      icon: PiggyBank,
      color: totalSaved >= 0 ? 'text-purple-600' : 'text-rose-600',
      bg: totalSaved >= 0 ? 'bg-purple-50' : 'bg-rose-50',
      border: totalSaved >= 0 ? 'border-purple-100' : 'border-rose-100',
    },
  ];

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8 pb-24 md:pb-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-2">
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-slate-900">Overview</h1>
          <p className="text-slate-500 text-base font-medium">
            Welcome back, <span className="text-slate-900 font-bold">{session.user?.name?.split(' ')[0]}</span>. Your savings rate is{' '}
            <span className={`font-bold ${savingsRate >= 20 ? 'text-emerald-600' : savingsRate >= 10 ? 'text-amber-600' : 'text-rose-600'}`}>
              {savingsRate.toFixed(0)}%
            </span>{' '}
            this month.
          </p>
        </div>
        <div className="hidden md:block">
          <QuickAddTransaction accounts={accounts} />
        </div>
      </div>

      {/* Spending Alerts */}
      <SpendingAlerts data={budgetData} />

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        {stats.map(({ label, value, icon: Icon, color, bg, border }) => (
          <Card key={label} className={`border ${border} hover:border-slate-300`}>
            <div className="flex items-center gap-4 mb-4">
              <div className={`p-3 rounded-2xl ${bg}`}>
                <Icon className={`w-6 h-6 ${color}`} />
              </div>
              <p className="text-sm font-bold text-slate-500">{label}</p>
            </div>
            <div>
              <p className="text-3xl font-extrabold text-slate-900 tracking-tight">{value}</p>
            </div>
          </Card>
        ))}
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
              <p className="text-sm font-medium text-slate-500 mt-0.5">Monthly snapshot — one data point recorded per visit</p>
            </div>
          </div>
        </CardHeader>
        <div className="mt-2">
          <NetWorthTrendChart data={netWorthPoints} />
        </div>
      </Card>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="min-h-[400px] flex flex-col">
          <CardHeader>
            <div>
              <CardTitle>Spending Analysis</CardTitle>
              <p className="text-sm font-medium text-slate-500 mt-1">Where your money went this month</p>
            </div>
            <div className="text-right">
              <span className="text-2xl font-extrabold text-slate-900">{formatCurrency(monthSpending)}</span>
            </div>
          </CardHeader>
          <div className="flex-1 flex items-center justify-center">
            <SpendingPieChart data={categoryData} />
          </div>
        </Card>

        <Card className="min-h-[400px] flex flex-col">
          <CardHeader>
            <div>
              <CardTitle>Cash Flow</CardTitle>
              <p className="text-sm font-medium text-slate-500 mt-1">Income vs Expenses over 6 months</p>
            </div>
          </CardHeader>
          <div className="flex-1">
            <MonthlyBarChart data={monthlyData} />
          </div>
        </Card>
      </div>

      {/* Budget + Goals row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-indigo-50 border border-indigo-100">
                <BarChart3 className="w-5 h-5 text-indigo-600" />
              </div>
              <CardTitle>Budget Progress</CardTitle>
            </div>
            <a href="/planning" className="text-sm font-bold text-indigo-600 hover:text-indigo-500 transition-colors bg-indigo-50 px-3 py-1.5 rounded-lg">Manage</a>
          </CardHeader>
          <div className="mt-4">
            <BudgetBars data={budgetData} />
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
            <a href="/planning" className="text-sm font-bold text-purple-600 hover:text-purple-500 transition-colors bg-purple-50 px-3 py-1.5 rounded-lg">Manage</a>
          </CardHeader>
          <div className="mt-4">
            <GoalsSummary data={goalData} />
          </div>
        </Card>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Upcoming Bills */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-amber-50 border border-amber-100">
                <Calendar className="w-5 h-5 text-amber-600" />
              </div>
              <CardTitle>Upcoming Bills</CardTitle>
            </div>
          </CardHeader>
          <div className="mt-2">
            {upcomingBills.length === 0 ? (
              <div className="group flex items-center justify-between p-4 rounded-2xl bg-slate-50 border border-slate-100">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full flex items-center justify-center bg-slate-200 text-slate-400">
                    <Calendar className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-base text-slate-900 font-bold">No upcoming bills</p>
                    <p className="text-sm text-slate-500 mt-0.5 font-medium">You&apos;re all caught up</p>
                  </div>
                </div>
                <span className="text-lg font-extrabold text-slate-400">{formatCurrency(0)}</span>
              </div>
            ) : (
              <div className="space-y-3">
                {upcomingBills.map((bill) => {
                  const daysUntil = Math.ceil(
                    (new Date(bill.nextDue).getTime() - now.getTime()) / 86400000
                  );
                  const isUrgent = daysUntil <= 3;
                  return (
                    <div key={bill.id} className="group flex items-center justify-between p-4 rounded-2xl hover:bg-slate-50 transition-colors border border-transparent hover:border-slate-100">
                      <div className="flex items-center gap-4">
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center ${isUrgent ? 'bg-rose-100 text-rose-600' : 'bg-slate-100 text-slate-600'}`}>
                          <Calendar className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="text-base text-slate-900 font-bold">{bill.name}</p>
                          <p className="text-sm font-medium text-slate-500 mt-0.5">
                            {daysUntil === 0 ? 'Due Today' : `Due in ${daysUntil} day${daysUntil !== 1 ? 's' : ''}`} · {formatDate(bill.nextDue)}
                          </p>
                        </div>
                      </div>
                      <span className={`text-lg font-extrabold ${isUrgent ? 'text-rose-600' : 'text-slate-900'}`}>
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
              <CardTitle>Recent Transactions</CardTitle>
            </div>
            <a href="/transactions" className="text-sm font-bold text-slate-500 hover:text-slate-900 transition-colors">View All →</a>
          </CardHeader>
          <div className="mt-2">
            {recentTx.length === 0 ? (
              <div className="group flex items-center justify-between p-4 rounded-2xl bg-slate-50 border border-slate-100">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full flex items-center justify-center bg-slate-200 text-slate-400">
                    <ArrowLeftRight className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-base text-slate-900 font-bold">No transactions</p>
                    <p className="text-sm text-slate-500 mt-0.5 font-medium">Add one to get started</p>
                  </div>
                </div>
                <span className="text-lg font-extrabold text-slate-400">{formatCurrency(0)}</span>
              </div>
            ) : (
              <div className="space-y-3">
                {recentTx.map((tx) => {
                  const isIncome = tx.type === 'income';
                  return (
                    <div key={tx.id} className="group flex items-center justify-between p-4 rounded-2xl hover:bg-slate-50 transition-colors border border-transparent hover:border-slate-100">
                      <div className="flex items-center gap-4">
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center ${isIncome ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'}`}>
                          {isIncome ? <ArrowUpRight className="w-5 h-5" /> : <ArrowDownRight className="w-5 h-5" />}
                        </div>
                        <div>
                          <p className="text-base text-slate-900 font-bold">{tx.description || '—'}</p>
                          <p className="text-sm font-medium text-slate-500 mt-0.5">{tx.category} · {formatDate(tx.date)}</p>
                        </div>
                      </div>
                      <span className={`text-lg font-extrabold ${isIncome ? 'text-emerald-600' : 'text-slate-900'}`}>
                        {isIncome ? '+' : '-'}{formatCurrency(tx.amount)}
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