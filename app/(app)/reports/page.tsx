'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { RefreshCw, AlertCircle, BarChart3, TrendingUp, TrendingDown, DollarSign, Calendar } from 'lucide-react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { FitText } from '@/components/ui/FitText';
import { formatCurrency } from '@/lib/utils';
import type { Transaction } from '@/types';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { useTranslation } from '@/lib/i18n/context';

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

function fmt(v: number) {
  if (Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(0)}k`;
  return `$${v.toFixed(0)}`;
}

export default function ReportsPage() {
  const { t } = useTranslation();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const ready = useChartReady();

  const load = useCallback(async () => {
    setError(false);
    setLoading(true);
    try {
      const res = await fetch('/api/transactions');
      if (!res.ok) throw new Error();
      setTransactions(await res.json());
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

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-5 sm:space-y-7 pb-28 md:pb-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-4xl font-extrabold tracking-tight text-slate-900">{t('reports.title')}</h1>
          <p className="text-slate-500 text-sm font-medium mt-1">{t('reports.subtitle')}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex bg-white border border-slate-200 rounded-2xl overflow-hidden">
            {years.map((y) => (
              <button
                key={y}
                onClick={() => setSelectedYear(y)}
                className={`px-4 py-2.5 text-sm font-bold transition-all duration-200 ${selectedYear === y ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:text-slate-900'}`}
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
          {[...Array(4)].map((_, i) => <div key={i} className="h-24 rounded-3xl bg-slate-100 animate-pulse" />)}
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-14 h-14 rounded-full bg-rose-50 flex items-center justify-center mb-4"><AlertCircle className="w-7 h-7 text-rose-400" /></div>
          <p className="text-slate-700 font-bold text-base mb-1">{t('reports.errorTitle')}</p>
          <Button variant="secondary" onClick={load} className="mt-4">{t('common.tryAgain')}</Button>
        </div>
      ) : (
        <>
          {/* Summary stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card className="border-emerald-100 min-w-0">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 rounded-xl bg-emerald-50"><TrendingUp className="w-4 h-4 text-emerald-600" /></div>
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">{t('reports.totalIncome')}</p>
              </div>
              <FitText maxSize={24} minSize={13} className="font-extrabold text-emerald-600">{formatCurrency(yearIncome)}</FitText>
            </Card>
            <Card className="border-rose-100 min-w-0">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 rounded-xl bg-rose-50"><TrendingDown className="w-4 h-4 text-rose-600" /></div>
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">{t('reports.totalSpent')}</p>
              </div>
              <FitText maxSize={24} minSize={13} className="font-extrabold text-rose-600">{formatCurrency(yearExpense)}</FitText>
            </Card>
            <Card className={`min-w-0 ${yearSavings >= 0 ? 'border-indigo-100' : 'border-rose-100'}`}>
              <div className="flex items-center gap-3 mb-2">
                <div className={`p-2 rounded-xl ${yearSavings >= 0 ? 'bg-indigo-50' : 'bg-rose-50'}`}><DollarSign className={`w-4 h-4 ${yearSavings >= 0 ? 'text-indigo-600' : 'text-rose-600'}`} /></div>
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">{t('reports.netSaved')}</p>
              </div>
              <FitText maxSize={24} minSize={13} className={`font-extrabold ${yearSavings >= 0 ? 'text-indigo-600' : 'text-rose-600'}`}>{formatCurrency(yearSavings)}</FitText>
            </Card>
            <Card className="min-w-0">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 rounded-xl bg-purple-50"><BarChart3 className="w-4 h-4 text-purple-600" /></div>
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">{t('reports.savingsRate')}</p>
              </div>
              <FitText maxSize={24} minSize={13} className={`font-extrabold ${savingsRate >= 20 ? 'text-emerald-600' : savingsRate >= 10 ? 'text-indigo-600' : 'text-rose-600'}`}>{`${savingsRate.toFixed(1)}%`}</FitText>
            </Card>
          </div>

          {/* Highlights */}
          {(bestSavingsMonth || highestSpendMonth) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {bestSavingsMonth && (
                <div className="flex items-center gap-4 p-4 rounded-2xl bg-emerald-50 border border-emerald-100">
                  <div className="p-2.5 rounded-xl bg-white shadow-sm"><Calendar className="w-5 h-5 text-emerald-600" /></div>
                  <div>
                    <p className="text-xs font-bold text-emerald-700 uppercase tracking-wider">{t('reports.bestSavingsMonth')}</p>
                    <p className="text-base font-extrabold text-emerald-900">{bestSavingsMonth.month} · {formatCurrency(bestSavingsMonth.income - bestSavingsMonth.expenses)} {t('reports.saved')}</p>
                  </div>
                </div>
              )}
              {highestSpendMonth && (
                <div className="flex items-center gap-4 p-4 rounded-2xl bg-rose-50 border border-rose-100">
                  <div className="p-2.5 rounded-xl bg-white shadow-sm"><Calendar className="w-5 h-5 text-rose-600" /></div>
                  <div>
                    <p className="text-xs font-bold text-rose-700 uppercase tracking-wider">{t('reports.highestSpendMonth')}</p>
                    <p className="text-base font-extrabold text-rose-900">{highestSpendMonth.month} · {formatCurrency(highestSpendMonth.expenses)} {t('reports.spent')}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Monthly cash flow chart */}
          <Card>
            <CardHeader>
              <CardTitle>{t('reports.monthlyCashFlow', { year: selectedYear })}</CardTitle>
            </CardHeader>
            <div className="h-64 w-full mt-4">
              {!ready ? <div className="w-full h-full rounded-2xl bg-slate-100 animate-pulse" /> : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }} barGap={4}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 11, fontWeight: 600 }} axisLine={false} tickLine={false} dy={10} />
                    <YAxis tick={{ fill: '#64748b', fontSize: 11, fontWeight: 600 }} axisLine={false} tickLine={false} tickFormatter={fmt} width={52} />
                    <Tooltip formatter={(v) => formatCurrency(Number(v))} cursor={{ fill: '#f8fafc' }} contentStyle={{ border: '1px solid #e2e8f0', borderRadius: 16, fontSize: 13, fontWeight: 700 }} />
                    <Bar dataKey="income" name="Income" fill="#10b981" radius={[6, 6, 0, 0]} maxBarSize={28} />
                    <Bar dataKey="expenses" name="Expenses" fill="#f43f5e" radius={[6, 6, 0, 0]} maxBarSize={28} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </Card>

          {/* Category breakdown + Top merchants */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Card>
              <CardHeader><CardTitle>{t('reports.spendingByCategory')}</CardTitle></CardHeader>
              {categoryData.length === 0 ? (
                <p className="text-slate-400 font-medium text-sm py-8 text-center">{t('reports.noExpenseData', { year: selectedYear })}</p>
              ) : (
                <div className="mt-4 space-y-3 max-h-72 overflow-y-auto hide-scrollbar pr-1">
                  {categoryData.map((c) => {
                    const pct = yearExpense > 0 ? (c.value / yearExpense) * 100 : 0;
                    return (
                      <div key={c.name}>
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2">
                            <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: CATEGORY_COLORS[c.name] ?? DEFAULT_COLOR }} />
                            <span className="text-sm font-bold text-slate-800">{c.name}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-slate-400">{pct.toFixed(0)}%</span>
                            <span className="text-sm font-extrabold text-slate-900 w-20 text-right">{formatCurrency(c.value)}</span>
                          </div>
                        </div>
                        <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-700"
                            style={{ width: `${pct}%`, backgroundColor: CATEGORY_COLORS[c.name] ?? DEFAULT_COLOR }}
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
                <p className="text-slate-400 font-medium text-sm py-8 text-center">{t('reports.noMerchantData', { year: selectedYear })}</p>
              ) : (
                <div className="mt-4 space-y-2 max-h-72 overflow-y-auto hide-scrollbar pr-1">
                  {topMerchants.map((m, i) => (
                    <div key={m.name} className="flex items-center justify-between p-3 rounded-2xl hover:bg-slate-50 transition-colors">
                      <div className="flex items-center gap-3">
                        <span className="w-6 h-6 rounded-lg bg-slate-100 flex items-center justify-center text-xs font-extrabold text-slate-500 shrink-0">{i + 1}</span>
                        <div>
                          <p className="text-sm font-bold text-slate-900 capitalize">{m.name}</p>
                          <p className="text-xs font-medium text-slate-500">{m.count} {t('reports.transactions')}</p>
                        </div>
                      </div>
                      <span className="text-sm font-extrabold text-slate-900">{formatCurrency(m.total)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          {/* Monthly table */}
          <Card>
            <CardHeader><CardTitle>{t('reports.monthlyBreakdown')}</CardTitle></CardHeader>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left py-2 px-3 text-xs font-bold text-slate-500 uppercase tracking-wider">{t('reports.tableMonth')}</th>
                    <th className="text-right py-2 px-3 text-xs font-bold text-emerald-600 uppercase tracking-wider">{t('reports.tableIncome')}</th>
                    <th className="text-right py-2 px-3 text-xs font-bold text-rose-600 uppercase tracking-wider">{t('reports.tableSpent')}</th>
                    <th className="text-right py-2 px-3 text-xs font-bold text-slate-600 uppercase tracking-wider">{t('reports.tableSaved')}</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyData.map((m) => {
                    const saved = m.income - m.expenses;
                    const hasData = m.income > 0 || m.expenses > 0;
                    return (
                      <tr key={m.month} className={`border-b border-slate-50 hover:bg-slate-50 transition-colors ${!hasData ? 'opacity-30' : ''}`}>
                        <td className="py-2.5 px-3 font-bold text-slate-700 whitespace-nowrap">{m.month}</td>
                        <td className="py-2.5 px-3 text-right font-bold text-emerald-600 whitespace-nowrap">{m.income > 0 ? formatCurrency(m.income) : '—'}</td>
                        <td className="py-2.5 px-3 text-right font-bold text-rose-600 whitespace-nowrap">{m.expenses > 0 ? formatCurrency(m.expenses) : '—'}</td>
                        <td className={`py-2.5 px-3 text-right font-extrabold whitespace-nowrap ${!hasData ? 'text-slate-300' : saved >= 0 ? 'text-indigo-600' : 'text-rose-600'}`}>
                          {hasData ? formatCurrency(saved) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="border-t-2 border-slate-200 bg-slate-50">
                    <td className="py-2.5 px-3 font-extrabold text-slate-900 whitespace-nowrap">{t('reports.tableTotal')}</td>
                    <td className="py-2.5 px-3 text-right font-extrabold text-emerald-700 whitespace-nowrap">{formatCurrency(yearIncome)}</td>
                    <td className="py-2.5 px-3 text-right font-extrabold text-rose-700 whitespace-nowrap">{formatCurrency(yearExpense)}</td>
                    <td className={`py-2.5 px-3 text-right font-extrabold whitespace-nowrap ${yearSavings >= 0 ? 'text-indigo-700' : 'text-rose-700'}`}>{formatCurrency(yearSavings)}</td>
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
