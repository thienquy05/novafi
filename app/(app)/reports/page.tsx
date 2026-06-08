'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { RefreshCw, AlertCircle, BarChart3, TrendingUp, TrendingDown, DollarSign, Calendar } from 'lucide-react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { FitText } from '@/components/ui/FitText';
import { formatCurrency, formatAxisCurrency } from '@/lib/utils';
import type { Transaction, Budget } from '@/types';
import { calcSpendingPace } from '@/lib/calculations';
import { SpendingPaceWidget } from '../dashboard/DashboardCharts';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { useTranslation } from '@/lib/i18n/context';
import { useIsDark } from '@/hooks/useIsDark';
import { motion, useReducedMotion } from 'framer-motion';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const CATEGORY_COLORS: Record<string, string> = {
  Food: '#f59e0b', Grocery: '#10b981', Entertainment: '#8b5cf6',
  Bills: '#ef4444', Shopping: '#06b6d4', Transportation: '#6366f1',
  Health: '#ec4899', Transfer: '#64748b', Other: '#94a3b8',
};
const DEFAULT_COLOR = '#6366f1';

function useChartReady() {
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); }, []);
  return ready;
}

export default function ReportsPage() {
  const { t } = useTranslation();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const ready = useChartReady();
  const reduced = useReducedMotion();
  const c = useIsDark()
    ? { grid: '#334155', axis: '#94a3b8', cursor: 'rgba(148, 163, 184, 0.08)', tip: { background: '#1e293b', color: '#f1f5f9', border: '1px solid #334155' } }
    : { grid: '#e2e8f0', axis: '#64748b', cursor: '#f8fafc', tip: { background: '#ffffff', color: '#0f172a', border: '1px solid #e2e8f0' } };

  const load = useCallback(async () => {
    setError(false);
    setLoading(true);
    try {
      const [txRes, bRes] = await Promise.all([fetch('/api/transactions'), fetch('/api/budgets')]);
      if (!txRes.ok) throw new Error();
      setTransactions(await txRes.json());
      setBudgets(bRes.ok ? await bRes.json() : []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Derive available years (memoized so it only recalculates when transactions change)
  const years = useMemo(() => {
    const y = [...new Set(transactions.map((tx) => Number(tx.date.slice(0, 4))))].sort((a, b) => b - a);
    if (y.length === 0) y.push(new Date().getFullYear());
    return y;
  }, [transactions]);

  // All derived data in a single pass over the selected year's transactions
  const reportData = useMemo(() => {
    const yearStr = String(selectedYear);
    const monthTotals: Array<{ income: number; expenses: number }> =
      Array.from({ length: 12 }, () => ({ income: 0, expenses: 0 }));
    const categorySpend: Record<string, number> = {};
    const merchantSpend: Record<string, { total: number; count: number }> = {};
    let yearIncome = 0, yearExpense = 0;

    for (const tx of transactions) {
      if (!tx.date.startsWith(yearStr)) continue;
      const monthIdx = Number(tx.date.slice(5, 7)) - 1;
      if (tx.type === 'income') {
        monthTotals[monthIdx].income += tx.amount;
        yearIncome += tx.amount;
      } else if (tx.type === 'expense') {
        monthTotals[monthIdx].expenses += tx.amount;
        yearExpense += tx.amount;
        categorySpend[tx.category] = (categorySpend[tx.category] ?? 0) + tx.amount;
        if (tx.description) {
          const key = tx.description.toLowerCase().trim();
          if (!merchantSpend[key]) merchantSpend[key] = { total: 0, count: 0 };
          merchantSpend[key].total += tx.amount;
          merchantSpend[key].count += 1;
        }
      }
    }

    const monthlyData = MONTH_NAMES.map((month, i) => ({ month, ...monthTotals[i] }));
    const categoryData = Object.entries(categorySpend)
      .sort((a, b) => b[1] - a[1])
      .map(([name, value]) => ({ name, value }));
    const topMerchants = Object.entries(merchantSpend)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 10)
      .map(([name, { total, count }]) => ({ name, total, count }));

    const yearSavings = yearIncome - yearExpense;
    const savingsRate = yearIncome > 0 ? (yearSavings / yearIncome) * 100 : 0;

    const monthsWithData = monthlyData.filter((m) => m.income > 0 || m.expenses > 0);
    const bestSavingsMonth = monthsWithData.length > 0
      ? monthsWithData.reduce((best, m) => (m.income - m.expenses) > (best.income - best.expenses) ? m : best, monthsWithData[0])
      : null;
    const highestSpendMonth = monthsWithData.length > 0
      ? monthsWithData.reduce((worst, m) => m.expenses > worst.expenses ? m : worst, monthsWithData[0])
      : null;

    return { yearIncome, yearExpense, yearSavings, savingsRate, monthlyData, categoryData, topMerchants, bestSavingsMonth, highestSpendMonth };
  }, [transactions, selectedYear]);

  const { yearIncome, yearExpense, yearSavings, savingsRate, monthlyData, categoryData, topMerchants, bestSavingsMonth, highestSpendMonth } = reportData;

  // Spending pace — always reflects the current month regardless of selected year
  const { spendingPace, paceDaysLeft } = useMemo(() => {
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const daysElapsed = now.getDate();
    const categorySpend: Record<string, number> = {};
    for (const tx of transactions) {
      if (tx.type === 'expense' && tx.date.startsWith(monthKey)) {
        categorySpend[tx.category] = (categorySpend[tx.category] ?? 0) + tx.amount;
      }
    }
    return {
      spendingPace: calcSpendingPace(budgets, categorySpend, daysElapsed, daysInMonth),
      paceDaysLeft: daysInMonth - daysElapsed,
    };
  }, [transactions, budgets]);

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-5 sm:space-y-7 pb-28 md:pb-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-4xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">{t('reports.title')}</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm font-medium mt-1">{t('reports.subtitle')}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden">
            {years.map((y) => (
              <button
                key={y}
                onClick={() => setSelectedYear(y)}
                className={`px-4 py-2.5 text-sm font-bold transition-all duration-200 ${selectedYear === y ? 'bg-indigo-600 text-white' : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100'}`}
              >
                {y}
              </button>
            ))}
          </div>
          <Button variant="secondary" onClick={load} className="shadow-sm">
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => <div key={i} className="h-24 rounded-3xl bg-slate-100 dark:bg-slate-700 animate-pulse" />)}
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-14 h-14 rounded-full bg-rose-50 dark:bg-rose-900/30 flex items-center justify-center mb-4"><AlertCircle className="w-7 h-7 text-rose-400" /></div>
          <p className="text-slate-700 dark:text-slate-300 font-bold text-base mb-1">{t('reports.errorTitle')}</p>
          <Button variant="secondary" onClick={load} className="mt-4">{t('common.tryAgain')}</Button>
        </div>
      ) : (
        <>
          {/* Summary stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card className="border-emerald-100 dark:border-emerald-800/50 min-w-0">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-900/30"><TrendingUp className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /></div>
                <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t('reports.totalIncome')}</p>
              </div>
              <FitText maxSize={24} minSize={13} className="font-extrabold text-emerald-600 dark:text-emerald-400">{formatCurrency(yearIncome)}</FitText>
            </Card>
            <Card className="border-rose-100 dark:border-rose-800/50 min-w-0">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 rounded-xl bg-rose-50 dark:bg-rose-900/30"><TrendingDown className="w-4 h-4 text-rose-600 dark:text-rose-400" /></div>
                <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t('reports.totalSpent')}</p>
              </div>
              <FitText maxSize={24} minSize={13} className="font-extrabold text-rose-600 dark:text-rose-400">{formatCurrency(yearExpense)}</FitText>
            </Card>
            <Card className={`min-w-0 ${yearSavings >= 0 ? 'border-indigo-100 dark:border-indigo-800/50' : 'border-rose-100 dark:border-rose-800/50'}`}>
              <div className="flex items-center gap-3 mb-2">
                <div className={`p-2 rounded-xl ${yearSavings >= 0 ? 'bg-indigo-50 dark:bg-indigo-900/30' : 'bg-rose-50 dark:bg-rose-900/30'}`}><DollarSign className={`w-4 h-4 ${yearSavings >= 0 ? 'text-indigo-600 dark:text-indigo-400' : 'text-rose-600 dark:text-rose-400'}`} /></div>
                <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t('reports.netSaved')}</p>
              </div>
              <FitText maxSize={24} minSize={13} className={`font-extrabold ${yearSavings >= 0 ? 'text-indigo-600 dark:text-indigo-400' : 'text-rose-600 dark:text-rose-400'}`}>{formatCurrency(yearSavings)}</FitText>
            </Card>
            <Card className="min-w-0">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 rounded-xl bg-purple-50 dark:bg-purple-900/30"><BarChart3 className="w-4 h-4 text-purple-600 dark:text-purple-400" /></div>
                <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t('reports.savingsRate')}</p>
              </div>
              <FitText maxSize={24} minSize={13} className={`font-extrabold ${savingsRate >= 20 ? 'text-emerald-600 dark:text-emerald-400' : savingsRate >= 10 ? 'text-indigo-600 dark:text-indigo-400' : 'text-rose-600 dark:text-rose-400'}`}>{`${savingsRate.toFixed(1)}%`}</FitText>
            </Card>
          </div>

          {/* Highlights */}
          {(bestSavingsMonth || highestSpendMonth) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {bestSavingsMonth && (
                <div className="flex items-center gap-4 p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-100 dark:border-emerald-800/50">
                  <div className="p-2.5 rounded-xl bg-white dark:bg-slate-800 shadow-sm"><Calendar className="w-5 h-5 text-emerald-600 dark:text-emerald-400" /></div>
                  <div>
                    <p className="text-xs font-bold text-emerald-700 dark:text-emerald-300 uppercase tracking-wider">{t('reports.bestSavingsMonth')}</p>
                    <p className="text-base font-extrabold text-emerald-900">{bestSavingsMonth.month} · {formatCurrency(bestSavingsMonth.income - bestSavingsMonth.expenses)} {t('reports.saved')}</p>
                  </div>
                </div>
              )}
              {highestSpendMonth && (
                <div className="flex items-center gap-4 p-4 rounded-2xl bg-rose-50 dark:bg-rose-900/30 border border-rose-100 dark:border-rose-800/50">
                  <div className="p-2.5 rounded-xl bg-white dark:bg-slate-800 shadow-sm"><Calendar className="w-5 h-5 text-rose-600 dark:text-rose-400" /></div>
                  <div>
                    <p className="text-xs font-bold text-rose-700 dark:text-rose-300 uppercase tracking-wider">{t('reports.highestSpendMonth')}</p>
                    <p className="text-base font-extrabold text-rose-900">{highestSpendMonth.month} · {formatCurrency(highestSpendMonth.expenses)} {t('reports.spent')}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Spending pace (current month) */}
          {spendingPace.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-xl bg-amber-50 dark:bg-amber-900/30 border border-amber-100 dark:border-amber-800/50">
                    <TrendingUp className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div>
                    <CardTitle>{t('dashboard.spendingPace')}</CardTitle>
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5">{t('dashboard.spendingPaceSubtitle')}</p>
                  </div>
                </div>
              </CardHeader>
              <div className="mt-4">
                <SpendingPaceWidget data={spendingPace} daysLeft={paceDaysLeft} />
              </div>
            </Card>
          )}

          {/* Monthly cash flow chart */}
          <Card>
            <CardHeader>
              <CardTitle>{t('reports.monthlyCashFlow', { year: selectedYear })}</CardTitle>
            </CardHeader>
            <figure className="h-64 w-full mt-4" role="img" aria-label={t('reports.monthlyCashFlow', { year: selectedYear })}>
              {!ready ? <div className="w-full h-full rounded-2xl bg-slate-100 dark:bg-slate-700 animate-pulse" /> : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }} barGap={4}>
                    <CartesianGrid strokeDasharray="3 3" stroke={c.grid} vertical={false} />
                    <XAxis dataKey="month" tick={{ fill: c.axis, fontSize: 11, fontWeight: 600 }} axisLine={false} tickLine={false} dy={10} />
                    <YAxis tick={{ fill: c.axis, fontSize: 11, fontWeight: 600 }} axisLine={false} tickLine={false} tickFormatter={formatAxisCurrency} width={52} />
                    <Tooltip formatter={(v) => formatCurrency(Number(v))} cursor={{ fill: c.cursor }} contentStyle={{ ...c.tip, borderRadius: 16, fontSize: 13, fontWeight: 700 }} itemStyle={{ color: c.tip.color }} labelStyle={{ color: c.tip.color }} />
                    <Bar dataKey="income" name="Income" fill="#10b981" radius={[6, 6, 0, 0]} maxBarSize={28} isAnimationActive={!reduced} />
                    <Bar dataKey="expenses" name="Expenses" fill="#f43f5e" radius={[6, 6, 0, 0]} maxBarSize={28} isAnimationActive={!reduced} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </figure>
          </Card>

          {/* Category breakdown + Top merchants */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Card>
              <CardHeader><CardTitle>{t('reports.spendingByCategory')}</CardTitle></CardHeader>
              {categoryData.length === 0 ? (
                <p className="text-slate-400 dark:text-slate-500 font-medium text-sm py-8 text-center">{t('reports.noExpenseData', { year: selectedYear })}</p>
              ) : (
                <div className="mt-4 space-y-3 max-h-72 overflow-y-auto hide-scrollbar pr-1">
                  {categoryData.map((c) => {
                    const pct = yearExpense > 0 ? (c.value / yearExpense) * 100 : 0;
                    return (
                      <div key={c.name}>
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2">
                            <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: CATEGORY_COLORS[c.name] ?? DEFAULT_COLOR }} />
                            <span className="text-sm font-bold text-slate-800 dark:text-slate-200">{c.name}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-slate-400 dark:text-slate-500">{pct.toFixed(0)}%</span>
                            <span className="text-sm font-extrabold text-slate-900 dark:text-slate-100 w-20 text-right">{formatCurrency(c.value)}</span>
                          </div>
                        </div>
                        <div className="w-full bg-slate-100 dark:bg-slate-700 rounded-full h-1.5 overflow-hidden">
                          <motion.div
                            className="h-full rounded-full"
                            initial={{ width: 0 }}
                            animate={{ width: `${pct}%` }}
                            transition={{ duration: reduced ? 0 : 0.7, ease: 'easeOut' }}
                            style={{ backgroundColor: CATEGORY_COLORS[c.name] ?? DEFAULT_COLOR }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

            <Card>
              <CardHeader><CardTitle>{t('reports.topMerchants')}</CardTitle></CardHeader>
              {topMerchants.length === 0 ? (
                <p className="text-slate-400 dark:text-slate-500 font-medium text-sm py-8 text-center">{t('reports.noMerchantData', { year: selectedYear })}</p>
              ) : (
                <figure
                  className="w-full mt-4"
                  style={{ height: Math.max(160, topMerchants.length * 38) }}
                  role="img"
                  aria-label={t('reports.topMerchants')}
                >
                  {!ready ? <div className="w-full h-full rounded-2xl bg-slate-100 dark:bg-slate-700 animate-pulse" /> : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={topMerchants} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={c.grid} horizontal={false} />
                        <XAxis type="number" tickFormatter={formatAxisCurrency} tick={{ fill: c.axis, fontSize: 11, fontWeight: 600 }} axisLine={false} tickLine={false} />
                        <YAxis
                          type="category"
                          dataKey="name"
                          width={96}
                          tick={{ fill: c.axis, fontSize: 11, fontWeight: 700 }}
                          axisLine={false}
                          tickLine={false}
                          tickFormatter={(s: string) => {
                            const cap = s.charAt(0).toUpperCase() + s.slice(1);
                            return cap.length > 14 ? `${cap.slice(0, 13)}…` : cap;
                          }}
                        />
                        <Tooltip
                          cursor={{ fill: c.cursor }}
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            const d = payload[0].payload as { name: string; total: number; count: number };
                            return (
                              <div className="rounded-2xl px-4 py-3 shadow-xl" style={{ ...c.tip }}>
                                <p className="text-sm font-bold capitalize" style={{ color: c.tip.color }}>{d.name}</p>
                                <p className="text-base font-extrabold" style={{ color: c.tip.color }}>{formatCurrency(d.total)}</p>
                                <p className="text-xs font-medium" style={{ color: c.axis }}>{d.count} {t('reports.transactions')}</p>
                              </div>
                            );
                          }}
                        />
                        <Bar dataKey="total" fill="#6366f1" radius={[0, 5, 5, 0]} maxBarSize={22} isAnimationActive={!reduced} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </figure>
              )}
            </Card>
          </div>

          {/* Monthly table */}
          <Card>
            <CardHeader><CardTitle>{t('reports.monthlyBreakdown')}</CardTitle></CardHeader>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-700/60">
                    <th className="text-left py-2 px-3 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t('reports.tableMonth')}</th>
                    <th className="text-right py-2 px-3 text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">{t('reports.tableIncome')}</th>
                    <th className="text-right py-2 px-3 text-xs font-bold text-rose-600 dark:text-rose-400 uppercase tracking-wider">{t('reports.tableSpent')}</th>
                    <th className="text-right py-2 px-3 text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">{t('reports.tableSaved')}</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyData.map((m) => {
                    const saved = m.income - m.expenses;
                    const hasData = m.income > 0 || m.expenses > 0;
                    return (
                      <tr key={m.month} className={`border-b border-slate-50 dark:border-slate-700/60 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors ${!hasData ? 'opacity-30' : ''}`}>
                        <td className="py-2.5 px-3 font-bold text-slate-700 dark:text-slate-300 whitespace-nowrap">{m.month}</td>
                        <td className="py-2.5 px-3 text-right font-bold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">{m.income > 0 ? formatCurrency(m.income) : '—'}</td>
                        <td className="py-2.5 px-3 text-right font-bold text-rose-600 dark:text-rose-400 whitespace-nowrap">{m.expenses > 0 ? formatCurrency(m.expenses) : '—'}</td>
                        <td className={`py-2.5 px-3 text-right font-extrabold whitespace-nowrap ${!hasData ? 'text-slate-300 dark:text-slate-600' : saved >= 0 ? 'text-indigo-600 dark:text-indigo-400' : 'text-rose-600 dark:text-rose-400'}`}>
                          {hasData ? formatCurrency(saved) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="border-t-2 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/50">
                    <td className="py-2.5 px-3 font-extrabold text-slate-900 dark:text-slate-100 whitespace-nowrap">{t('reports.tableTotal')}</td>
                    <td className="py-2.5 px-3 text-right font-extrabold text-emerald-700 dark:text-emerald-300 whitespace-nowrap">{formatCurrency(yearIncome)}</td>
                    <td className="py-2.5 px-3 text-right font-extrabold text-rose-700 dark:text-rose-300 whitespace-nowrap">{formatCurrency(yearExpense)}</td>
                    <td className={`py-2.5 px-3 text-right font-extrabold whitespace-nowrap ${yearSavings >= 0 ? 'text-indigo-700 dark:text-indigo-300' : 'text-rose-700 dark:text-rose-300'}`}>{formatCurrency(yearSavings)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
