'use client';
import { useEffect, useState } from 'react';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  ComposedChart, BarChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  AreaChart, Area, ReferenceLine, Legend,
} from 'recharts';
import { AlertTriangle, TrendingUp, TrendingDown, Sparkles, DollarSign, Target, Zap } from 'lucide-react';
import type { SpendingPaceItem } from '@/lib/calculations';
import { formatCurrency } from '@/lib/utils';
import { motion } from 'framer-motion';
import { useTranslation } from '@/lib/i18n/context';
import { useIsDark } from '@/hooks/useIsDark';

/** Theme-aware colors for recharts SVG props (set via JS, not Tailwind). */
const CHART = {
  light: { grid: '#e2e8f0', axis: '#64748b', cursor: '#f8fafc', track: '#f1f5f9', cursorStroke: '#cbd5e1' },
  dark:  { grid: '#334155', axis: '#94a3b8', cursor: 'rgba(148, 163, 184, 0.08)', track: '#334155', cursorStroke: '#475569' },
} as const;

/** Defers chart rendering until the component is mounted in the browser.
 *  Prevents the recharts "width(-1) height(-1)" warning caused by
 *  ResponsiveContainer measuring before the DOM is painted. */
function useChartReady() {
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); }, []);
  return ready;
}

const CATEGORY_COLORS: Record<string, string> = {
  Food: '#f59e0b',
  Grocery: '#10b981',
  Entertainment: '#8b5cf6',
  Bills: '#ef4444',
  Shopping: '#06b6d4',
  Transportation: '#6366f1',
  Health: '#ec4899',
  Transfer: '#64748b',
  Other: '#94a3b8',
};

const DEFAULT_COLOR = '#6366f1';

export type CategoryData = { name: string; value: number };
export type MonthlyData = { month: string; income: number; expenses: number; net?: number };
export type BudgetData = { category: string; budget: number; spent: number; prevMonthSpent?: number; rolledOver?: number };
export type GoalData = { id: string; name: string; icon: string; current: number; target: number; deadline: string };
export type NetWorthPoint = { month: string; label: string; netWorth: number };
export type HealthScoreData = {
  score: number;
  savingsRate: number;
  emergencyFundMonths: number;
  overBudgetCount: number;
  budgetCount: number;
  /** Debt-to-Income ratio (total debt ÷ annualized monthly income). */
  dti: number;
  /** Avg MoM net worth growth % over recent snapshots. null = insufficient history. */
  netWorthTrendPct: number | null;
  /** Spending coefficient of variation over the last 3 months. null = insufficient data. */
  spendingCv: number | null;
  /** Per-component breakdown so the card can show actual point values. */
  breakdown: {
    savings: number;
    emergency: number;
    budget: number;
    dti: number;
    trend: number;
    volatility: number;
  };
};

function CustomTooltip({ active, payload }: { active?: boolean; payload?: { name: string; value: number }[] }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl px-4 py-3 text-sm shadow-xl">
      <p className="text-slate-500 dark:text-slate-400 font-bold mb-1">{payload[0].name}</p>
      <p className="text-slate-900 dark:text-slate-100 font-extrabold text-lg">{formatCurrency(payload[0].value)}</p>
    </div>
  );
}

function BarTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; fill: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl px-4 py-3 text-sm shadow-xl space-y-2">
      <p className="text-slate-500 dark:text-slate-400 font-bold pb-2 border-b border-slate-100 dark:border-slate-700/60">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center justify-between gap-6">
          <span style={{ color: p.fill }} className="font-bold">{p.name}</span>
          <span className="text-slate-900 dark:text-slate-100 font-extrabold">{formatCurrency(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

// ── Savings Rate Gauge ────────────────────────────────────────────────────────

/** Compact radial gauge that visualizes the savings rate instead of a flat number. */
export function SavingsRateGauge({ value, note }: { value: number; note?: string }) {
  const ready = useChartReady();
  const c = useIsDark() ? CHART.dark : CHART.light;
  const pct = Math.max(0, Math.min(100, value));
  const color = value >= 20 ? '#10b981' : value >= 10 ? '#6366f1' : value >= 1 ? '#f59e0b' : '#f43f5e';
  const R = 28;
  const C = 2 * Math.PI * R;

  return (
    <div className="flex items-center gap-3 mt-0.5">
      <div className="relative w-[68px] h-[68px] shrink-0">
        <svg viewBox="0 0 68 68" className="w-full h-full -rotate-90">
          <circle cx="34" cy="34" r={R} fill="none" stroke={c.track} strokeWidth="7" />
          <motion.circle
            cx="34"
            cy="34"
            r={R}
            fill="none"
            stroke={color}
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={C}
            initial={{ strokeDashoffset: C }}
            animate={{ strokeDashoffset: ready ? C - (pct / 100) * C : C }}
            transition={{ duration: 1, ease: 'easeOut' }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-base font-extrabold tracking-tight" style={{ color }}>{value.toFixed(0)}%</span>
        </div>
      </div>
      {note && <p className="text-xs font-medium text-slate-400 dark:text-slate-500 leading-snug flex-1 min-w-0">{note}</p>}
    </div>
  );
}

// ── Health Banner ─────────────────────────────────────────────────────────────

export function HealthBanner({
  monthIncome,
  monthSpending,
  safeToSpend,
  daysLeft,
  daysInMonth,
  overBudgetCount,
}: {
  monthIncome: number;
  monthSpending: number;
  safeToSpend: number;
  daysLeft: number;
  daysInMonth: number;
  overBudgetCount: number;
}) {
  const { t } = useTranslation();
  const savingsRate = monthIncome > 0 ? Math.max(0, ((monthIncome - monthSpending) / monthIncome) * 100) : 0;

  type Status = 'great' | 'good' | 'warning' | 'danger' | 'neutral';
  const status: Status =
    monthIncome === 0 ? 'neutral'
    : monthSpending > monthIncome ? 'danger'
    : overBudgetCount > 0 || savingsRate < 5 ? 'warning'
    : savingsRate < 15 ? 'good'
    : 'great';

  const configs = {
    great: {
      bg: 'bg-emerald-50 dark:bg-emerald-900/30 border-emerald-200 dark:border-emerald-800/50',
      iconBg: 'bg-emerald-100 dark:bg-emerald-900/40',
      iconColor: 'text-emerald-600 dark:text-emerald-400',
      titleColor: 'text-emerald-800 dark:text-emerald-300',
      pillBg: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300',
      title: t('charts.greatShape'),
      Icon: TrendingUp,
    },
    good: {
      bg: 'bg-indigo-50 dark:bg-indigo-900/30 border-indigo-200 dark:border-indigo-800/50',
      iconBg: 'bg-indigo-100 dark:bg-indigo-900/40',
      iconColor: 'text-indigo-600 dark:text-indigo-400',
      titleColor: 'text-indigo-800 dark:text-indigo-300',
      pillBg: 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300',
      title: t('charts.lookingGood'),
      Icon: TrendingUp,
    },
    warning: {
      bg: 'bg-amber-50 dark:bg-amber-900/30 border-amber-200 dark:border-amber-800/50',
      iconBg: 'bg-amber-100 dark:bg-amber-900/40',
      iconColor: 'text-amber-600 dark:text-amber-400',
      titleColor: 'text-amber-800 dark:text-amber-300',
      pillBg: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
      title: t('charts.watchSpending'),
      Icon: AlertTriangle,
    },
    danger: {
      bg: 'bg-rose-50 dark:bg-rose-900/30 border-rose-200 dark:border-rose-800/50',
      iconBg: 'bg-rose-100 dark:bg-rose-900/40',
      iconColor: 'text-rose-600 dark:text-rose-400',
      titleColor: 'text-rose-800 dark:text-rose-300',
      pillBg: 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300',
      title: t('charts.overBudget'),
      Icon: AlertTriangle,
    },
    neutral: {
      bg: 'bg-slate-50 dark:bg-slate-700/50 border-slate-200 dark:border-slate-700',
      iconBg: 'bg-slate-100 dark:bg-slate-700',
      iconColor: 'text-slate-400 dark:text-slate-500',
      titleColor: 'text-slate-700 dark:text-slate-300',
      pillBg: 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400',
      title: t('charts.setUpIncome'),
      Icon: DollarSign,
    },
  };

  const cfg = configs[status];
  const { Icon } = cfg;

  // Flexible, situation-aware title instead of a single fixed "already over".
  const overByPct = monthIncome > 0 ? (monthSpending - monthIncome) / monthIncome : 0;
  const title =
    status === 'danger'
      ? overByPct < 0.1 ? t('charts.overSlight')
        : overByPct < 0.3 ? t('charts.overModerate')
        : t('charts.overHeavy')
      : status === 'great'
      ? savingsRate >= 30 ? t('charts.thriving') : cfg.title
      : cfg.title;

  const cashFlow = monthIncome - monthSpending;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex items-center gap-4 px-5 py-4 rounded-3xl border ${cfg.bg}`}
    >
      <div className={`p-2.5 rounded-2xl shrink-0 ${cfg.iconBg}`}>
        <Icon className={`w-5 h-5 ${cfg.iconColor}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
          <p className={`text-base font-extrabold ${cfg.titleColor}`}>{title}</p>
          {monthIncome > 0 && (
            <span className={`text-xs font-bold px-2 py-0.5 rounded-lg ${cfg.pillBg}`}>
              {savingsRate.toFixed(0)}% saved
            </span>
          )}
          {overBudgetCount > 0 && (
            <span className="text-xs font-bold px-2 py-0.5 rounded-lg bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300">
              {overBudgetCount} over budget
            </span>
          )}
        </div>
        {monthIncome === 0 ? (
          <p className="text-sm font-medium text-slate-600 dark:text-slate-300">{t('charts.recordPaycheckHint')}</p>
        ) : monthSpending > monthIncome ? (
          <p className="text-sm font-medium text-slate-600 dark:text-slate-300">{t('charts.overIncome', { amount: formatCurrency(monthSpending - monthIncome) })}</p>
        ) : (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-medium text-slate-600 dark:text-slate-300">
            <span><span className="font-bold text-slate-900 dark:text-slate-100">{formatCurrency(cashFlow)}</span> {t('charts.netLabel')}</span>
            <span className="text-slate-300 dark:text-slate-600">·</span>
            <span><span className="font-bold text-slate-900 dark:text-slate-100">{formatCurrency(safeToSpend)}</span> {t('charts.afterBills')}</span>
          </div>
        )}
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-extrabold text-slate-900 dark:text-slate-100">{daysLeft}d left</p>
        <div className="w-16 bg-slate-200 dark:bg-slate-600 rounded-full h-1.5 mt-1">
          <div
            className={`h-1.5 rounded-full transition-all ${cfg.iconColor.replace('text-', 'bg-')}`}
            style={{ width: `${Math.round(((daysInMonth - daysLeft) / daysInMonth) * 100)}%` }}
          />
        </div>
      </div>
    </motion.div>
  );
}

// ── Spending Pie Chart ────────────────────────────────────────────────────────

export function SpendingPieChart({ data }: { data: CategoryData[] }) {
  const { t } = useTranslation();
  const isEmpty = data.length === 0;
  const cleanData = data.map(d => ({ ...d, name: d.name.replace(/^categories\./, '') }));
  const displayData = isEmpty ? [{ name: t('charts.noExpenseData'), value: 1 }] : cleanData;
  const ready = useChartReady();
  const c = useIsDark() ? CHART.dark : CHART.light;
  const categoryTotal = data.reduce((s, d) => s + d.value, 0);
  const tCategory = (name: string) => { const k = `categories.${name}`; const r = t(k); return r === k ? name : r; };

  return (
    <div className="flex flex-col md:flex-row items-center gap-8 w-full">
      <div className="w-full md:w-56 h-56 relative">
        {!ready ? <div className="w-full h-full rounded-full bg-slate-100 dark:bg-slate-700 animate-pulse" /> : <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={displayData}
              cx="50%"
              cy="50%"
              innerRadius={65}
              outerRadius={90}
              paddingAngle={isEmpty ? 0 : 4}
              dataKey="value"
              stroke="none"
              cornerRadius={isEmpty ? 0 : 6}
            >
              {displayData.map((entry) => (
                <Cell
                  key={entry.name}
                  fill={isEmpty ? c.track : (CATEGORY_COLORS[entry.name] ?? DEFAULT_COLOR)}
                  className="hover:opacity-80 transition-opacity duration-300 cursor-pointer"
                />
              ))}
            </Pie>
            {!isEmpty && <Tooltip content={<CustomTooltip />} cursor={{ fill: 'transparent' }} />}
          </PieChart>
        </ResponsiveContainer>}
        {isEmpty && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-slate-400 dark:text-slate-500 font-bold text-lg">{formatCurrency(0)}</span>
          </div>
        )}
      </div>
      <div className="flex-1 space-y-3 w-full max-h-56 overflow-y-auto hide-scrollbar pr-2">
        {isEmpty ? (
          <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-700/50 border border-slate-100 dark:border-slate-700/60">
            <div className="w-3 h-3 rounded-full shrink-0 bg-slate-300" />
            <span className="text-sm font-bold text-slate-500 dark:text-slate-400 flex-1">{t('charts.noExpenseData')}</span>
            <span className="text-sm font-extrabold text-slate-400 dark:text-slate-500">{formatCurrency(0)}</span>
          </div>
        ) : (
          cleanData.map((entry, i) => {
            const pct = categoryTotal > 0 ? (entry.value / categoryTotal) * 100 : 0;
            return (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                key={entry.name}
                className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
              >
                <div
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: CATEGORY_COLORS[entry.name] ?? DEFAULT_COLOR }}
                />
                <span className="text-sm font-bold text-slate-700 dark:text-slate-300 flex-1 truncate">{tCategory(entry.name)}</span>
                <span className="text-xs text-slate-400 dark:text-slate-500 font-bold bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded-md">{pct.toFixed(0)}%</span>
                <span className="text-sm font-extrabold text-slate-900 dark:text-slate-100 w-20 text-right">{formatCurrency(entry.value)}</span>
              </motion.div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── Monthly Cash Flow Bar Chart ───────────────────────────────────────────────

export function MonthlyBarChart({ data }: { data: MonthlyData[] }) {
  const { t } = useTranslation();
  const isEmpty = data.every(d => d.income === 0 && d.expenses === 0);
  const ready = useChartReady();
  const c = useIsDark() ? CHART.dark : CHART.light;
  const hasNet = data.some((d) => d.net !== undefined);

  return (
    <div className="h-64 w-full mt-4">
      {!ready ? <div className="w-full h-full rounded-2xl bg-slate-100 dark:bg-slate-700 animate-pulse" /> : <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }} barGap={6}>
          <CartesianGrid strokeDasharray="3 3" stroke={c.grid} vertical={false} />
          <XAxis
            dataKey="month"
            tick={{ fill: c.axis, fontSize: 12, fontWeight: 600 }}
            axisLine={false}
            tickLine={false}
            dy={10}
          />
          <YAxis
            tick={{ fill: c.axis, fontSize: 12, fontWeight: 600 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
            width={60}
          />
          {!isEmpty && <Tooltip content={<BarTooltip />} cursor={{ fill: c.cursor }} />}
          {hasNet && <ReferenceLine y={0} stroke={c.grid} strokeDasharray="4 4" />}
          <Bar dataKey="income" name={t('common.income')} fill="#10b981" radius={[6, 6, 0, 0]} maxBarSize={32} />
          <Bar dataKey="expenses" name={t('common.expenses')} fill="#f43f5e" radius={[6, 6, 0, 0]} maxBarSize={32} />
          {hasNet && (
            <Line
              type="monotone"
              dataKey="net"
              name={t('common.netSavings')}
              stroke="#6366f1"
              strokeWidth={2.5}
              dot={{ r: 3, fill: '#6366f1', strokeWidth: 0 }}
              activeDot={{ r: 5 }}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>}
    </div>
  );
}

// ── Budget Bars ───────────────────────────────────────────────────────────────

export function BudgetBars({ data, daysLeft, daysElapsed, showMoM, totalSpend }: { data: BudgetData[]; daysLeft?: number; daysElapsed?: number; showMoM?: boolean; totalSpend?: number }) {
  const { t } = useTranslation();

  if (data.length === 0) {
    return (
      <div className="text-slate-500 dark:text-slate-400 text-sm py-8 text-center bg-slate-50 dark:bg-slate-700/50 rounded-2xl border border-slate-100 dark:border-slate-700/60">
        <div className="w-12 h-12 rounded-full bg-white dark:bg-slate-800 flex items-center justify-center mx-auto mb-3 shadow-sm">
          <Sparkles className="w-6 h-6 text-slate-400 dark:text-slate-500" />
        </div>
        <p className="font-bold text-slate-900 dark:text-slate-100 mb-1">{t('charts.noBudgetsSet')}</p>
        <p className="font-medium text-slate-500 dark:text-slate-400 mb-3">{t('charts.setBudgetsToTrack')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {data.map((b, i) => {
        // Usage includes any rolled-over deficit from last month; the cap itself
        // stays fixed. Mirrors the Planning page so summaries agree.
        const rolledOver = b.rolledOver ?? 0;
        const usage = b.spent + rolledOver;
        const pct = b.budget > 0 ? Math.min(100, (usage / b.budget) * 100) : 0;
        const over = usage > b.budget;
        const remaining = b.budget - usage;

        // Projected spend: (spent / daysElapsed) * totalDays, plus carried deficit
        const totalDays = (daysLeft ?? 0) + (daysElapsed ?? 0);
        const projected = daysElapsed && daysElapsed > 0 && totalDays > 0
          ? (b.spent / daysElapsed) * totalDays + rolledOver
          : null;
        const willOvershoot = projected !== null && projected > b.budget && !over;

        return (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            key={b.category}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-slate-800 dark:text-slate-200">{b.category.replace(/^categories\./, '')}</span>
                {totalSpend != null && totalSpend > 0 && b.spent > 0 && (
                  <span className="text-xs font-bold text-slate-400 dark:text-slate-500 bg-slate-50 dark:bg-slate-700/50 px-1.5 py-0.5 rounded-md">
                    {((b.spent / totalSpend) * 100).toFixed(0)}%
                  </span>
                )}
                {rolledOver > 0 && (
                  <span className="text-xs font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 px-1.5 py-0.5 rounded-md">
                    +{formatCurrency(rolledOver)} {t('planning.rolledOver')}
                  </span>
                )}
              </div>
              <div className="text-right">
                <span className={`text-sm font-extrabold ${over ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-slate-100'}`}>
                  {formatCurrency(b.spent)}
                </span>
                <span className="text-xs font-bold text-slate-400 dark:text-slate-500"> / {formatCurrency(b.budget)}</span>
              </div>
            </div>
            <div className="w-full bg-slate-100 dark:bg-slate-700 rounded-full h-2.5 overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(100, pct)}%` }}
                transition={{ duration: 1, ease: 'easeOut' }}
                className={`h-full rounded-full ${over ? 'bg-rose-500' : pct > 80 ? 'bg-amber-500' : 'bg-indigo-500'}`}
              />
            </div>
            <div className="flex items-center justify-between mt-1.5">
              <p className="text-xs font-bold">
                {over ? (
                  <span className="text-rose-600 dark:text-rose-400">{formatCurrency(Math.abs(remaining))} {t('charts.over')}</span>
                ) : (
                  <span className="text-slate-500 dark:text-slate-400">
                    {formatCurrency(remaining)} {t('charts.left')}
                    {daysLeft ? <span className="text-slate-400 dark:text-slate-500"> · {daysLeft}d</span> : null}
                  </span>
                )}
              </p>
              <div className="flex items-center gap-2">
                {showMoM && b.prevMonthSpent !== undefined && (
                  (() => {
                    const diff = b.spent - b.prevMonthSpent;
                    if (Math.abs(diff) < 0.5) return <span className="text-xs font-bold text-slate-400 dark:text-slate-500">{t('charts.sameAsLastMo')}</span>;
                    return (
                      <span className={`text-xs font-bold ${diff > 0 ? 'text-rose-500 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                        {diff > 0 ? '+' : ''}{formatCurrency(diff)} {t('charts.vsLastMo')}
                      </span>
                    );
                  })()
                )}
                {willOvershoot && projected && (
                  <p className="text-xs font-bold text-amber-600 dark:text-amber-400">
                    ~{formatCurrency(projected - b.budget)} {t('charts.overshoot')}
                  </p>
                )}
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

// ── Net Worth Trend Chart ─────────────────────────────────────────────────────

function NetWorthTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const val = payload[0].value;
  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl px-4 py-3 text-sm shadow-xl">
      <p className="text-slate-500 dark:text-slate-400 font-bold mb-1">{label}</p>
      <p className={`font-extrabold text-lg ${val >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
        {formatCurrency(val)}
      </p>
    </div>
  );
}

export function NetWorthTrendChart({ data, projection }: { data: NetWorthPoint[]; projection?: { label: string; netWorth?: number; projected?: number }[] }) {
  const { t } = useTranslation();
  const ready = useChartReady();
  const c = useIsDark() ? CHART.dark : CHART.light;

  if (data.length < 2) {
    return (
      <div className="h-48 flex flex-col items-center justify-center text-center">
        <p className="text-slate-400 dark:text-slate-500 font-bold text-sm">{t('charts.notEnoughData')}</p>
        <p className="text-slate-400 dark:text-slate-500 text-xs mt-1 font-medium">{t('charts.comeBackNextMonth')}</p>
      </div>
    );
  }

  const latest = data[data.length - 1].netWorth;
  const first = data[0].netWorth;
  const delta = latest - first;
  const isPositive = delta >= 0;

  const stroke = isPositive ? '#10b981' : '#f43f5e';
  const fillId = isPositive ? 'nwPositive' : 'nwNegative';

  // Merge history + projection into a single series for the chart
  // History points: { label, netWorth, projected: undefined }
  // Projection points: { label, netWorth: undefined, projected: value }
  // Boundary point (last history): has both so the lines connect
  const lastHistoryPoint = data[data.length - 1];
  const chartData = [
    ...data.map((d) => ({ label: d.label, netWorth: d.netWorth, projected: undefined as number | undefined })),
    ...(projection ?? []).map((p, i) => ({
      label: p.label,
      netWorth: undefined as number | undefined,
      projected: p.projected,
      // First projected point also gets netWorth so lines connect
      ...(i === 0 ? { netWorth: lastHistoryPoint.netWorth } : {}),
    })),
  ];

  return (
    <div className="w-full">
      <div className="flex items-center justify-between gap-3 mb-4 px-2">
        <span className={`text-sm font-extrabold px-3 py-1 rounded-lg ${isPositive ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' : 'bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300'}`}>
          {isPositive ? '+' : ''}{formatCurrency(delta)} {t('charts.since', { label: data[0].label })}
        </span>
        {projection && projection.length > 0 && (
          <span className="text-xs font-bold text-slate-400 dark:text-slate-500 flex items-center gap-1">
            <span className="inline-block w-6 border-t-2 border-dashed border-slate-300 dark:border-slate-600" />
            {t('charts.projected')}
          </span>
        )}
      </div>
      <div className="h-52 w-full">
        {!ready ? <div className="w-full h-full rounded-2xl bg-slate-100 dark:bg-slate-700 animate-pulse" /> : <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 8, right: 10, left: -10, bottom: 0 }}>
            <defs>
              <linearGradient id="nwPositive" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.15} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="nwNegative" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.15} />
                <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={c.grid} vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: c.axis, fontSize: 12, fontWeight: 600 }}
              axisLine={false}
              tickLine={false}
              dy={10}
            />
            <YAxis
              tick={{ fill: c.axis, fontSize: 12, fontWeight: 600 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
              width={56}
            />
            <ReferenceLine y={0} stroke={c.grid} strokeDasharray="4 4" />
            <Tooltip content={<NetWorthTooltip />} cursor={{ stroke: c.cursorStroke, strokeWidth: 1 }} />
            <Area
              type="monotone"
              dataKey="netWorth"
              stroke={stroke}
              strokeWidth={2.5}
              fill={`url(#${fillId})`}
              dot={{ fill: stroke, strokeWidth: 0, r: 4 }}
              activeDot={{ r: 6, fill: stroke, strokeWidth: 0 }}
              connectNulls={false}
            />
            {projection && projection.length > 0 && (
              <Line
                type="monotone"
                dataKey="projected"
                stroke={stroke}
                strokeWidth={2}
                strokeDasharray="6 4"
                dot={false}
                activeDot={{ r: 4, fill: stroke, strokeWidth: 0 }}
                connectNulls
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>}
      </div>
    </div>
  );
}

// ── Emergency Fund Widget ─────────────────────────────────────────────────────

export function EmergencyFundWidget({
  liquidSavings,
  avgMonthlyExpense,
}: {
  liquidSavings: number;
  avgMonthlyExpense: number;
}) {
  const { t } = useTranslation();
  const months = avgMonthlyExpense > 0 ? liquidSavings / avgMonthlyExpense : 0;
  const capped = Math.min(months, 9);
  const pct = (capped / 6) * 100;

  type Status = 'danger' | 'warning' | 'good' | 'great';
  const status: Status = months < 1 ? 'danger' : months < 3 ? 'warning' : months < 6 ? 'good' : 'great';
  const labels: Record<Status, string> = {
    danger: t('charts.atRisk'),
    warning: t('charts.buildingUp'),
    good: t('charts.gettingThere'),
    great: t('charts.fullyFunded'),
  };
  const colors: Record<Status, string> = {
    danger: 'bg-rose-500',
    warning: 'bg-amber-500',
    good: 'bg-indigo-500',
    great: 'bg-emerald-500',
  };
  const textColors: Record<Status, string> = {
    danger: 'text-rose-600 dark:text-rose-400',
    warning: 'text-amber-600 dark:text-amber-400',
    good: 'text-indigo-600 dark:text-indigo-400',
    great: 'text-emerald-600 dark:text-emerald-400',
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/60 p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t('charts.emergencyFund')}</p>
        <span className={`text-xs font-bold px-2 py-0.5 rounded-lg ${textColors[status]} bg-slate-50 dark:bg-slate-700/50`}>
          {labels[status]}
        </span>
      </div>
      <p className={`text-lg font-extrabold tracking-tight ${textColors[status]}`}>
        {months.toFixed(1)} <span className="text-sm font-bold text-slate-400 dark:text-slate-500">{t('charts.moCovered')}</span>
      </p>
      <div className="w-full bg-slate-100 dark:bg-slate-700 rounded-full h-1.5 mt-2 overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(100, pct)}%` }}
          transition={{ duration: 1, ease: 'easeOut' }}
          className={`h-full rounded-full ${colors[status]}`}
        />
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500">0</span>
        <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500">3 mo</span>
        <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500">6 mo</span>
      </div>
      <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500 mt-1">
        {formatCurrency(liquidSavings)} {t('charts.liquid')} · {avgMonthlyExpense > 0 ? `${formatCurrency(avgMonthlyExpense)}/${t('charts.avg')}` : t('charts.noExpenseData')}
      </p>
    </div>
  );
}

// ── Financial Health Score ─────────────────────────────────────────────────────

export function FinancialHealthScore({ data }: { data: HealthScoreData }) {
  const { t } = useTranslation();
  const {
    score, savingsRate, emergencyFundMonths, overBudgetCount, budgetCount,
    dti, netWorthTrendPct, spendingCv, breakdown,
  } = data;

  type Grade = 'A' | 'B' | 'C' | 'D' | 'F';
  const grade: Grade = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : score >= 40 ? 'D' : 'F';
  const gradeColors: Record<Grade, string> = {
    A: 'text-emerald-600 dark:text-emerald-400',
    B: 'text-indigo-600 dark:text-indigo-400',
    C: 'text-amber-600 dark:text-amber-400',
    D: 'text-orange-600 dark:text-orange-400',
    F: 'text-rose-600 dark:text-rose-400',
  };
  const ringColor = score >= 85 ? '#10b981' : score >= 70 ? '#6366f1' : score >= 55 ? '#f59e0b' : score >= 40 ? '#f97316' : '#f43f5e';
  const ringTrack = useIsDark() ? CHART.dark.track : CHART.light.track;

  const fmtDti = (r: number) => {
    if (!isFinite(r)) return 'n/a';
    if (r === 0) return 'None';
    if (r >= 10) return `${r.toFixed(1)}×`;
    return `${(r * 100).toFixed(0)}%`;
  };
  const fmtTrend = (p: number | null) => p === null ? 'n/a' : `${p >= 0 ? '+' : ''}${p.toFixed(1)}%/mo`;
  const fmtCv = (c: number | null) => c === null ? 'n/a' : `±${(c * 100).toFixed(0)}%`;

  const components = [
    { label: t('charts.savingsRate'),      detail: `${savingsRate.toFixed(0)}%`, score: breakdown.savings, max: 25 },
    { label: t('charts.emergencyFund'),    detail: `${emergencyFundMonths.toFixed(1)} mo`, score: breakdown.emergency, max: 20 },
    {
      label: t('charts.budgetControl'),
      detail: budgetCount === 0 ? 'No budgets' : overBudgetCount === 0 ? 'On track' : `${overBudgetCount} over`,
      score: breakdown.budget,
      max: 15,
    },
    { label: t('charts.debtToIncome'),     detail: fmtDti(dti),                 score: breakdown.dti,        max: 20 },
    { label: t('charts.netWorthTrend'),    detail: fmtTrend(netWorthTrendPct),   score: breakdown.trend,      max: 10 },
    { label: t('charts.spendingStability'), detail: fmtCv(spendingCv),           score: breakdown.volatility, max: 10 },
  ];

  return (
    <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700/60 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t('charts.financialHealth')}</p>
          <p className="text-slate-500 dark:text-slate-400 text-xs font-medium mt-0.5">{t('charts.healthScore')}</p>
        </div>
        <div className="text-center">
          <div
            className="relative w-16 h-16 flex items-center justify-center rounded-full"
            style={{
              background: `conic-gradient(${ringColor} ${score * 3.6}deg, ${ringTrack} 0deg)`,
            }}
          >
            <div className="absolute inset-1.5 bg-white dark:bg-slate-800 rounded-full flex flex-col items-center justify-center">
              <span className={`text-lg font-extrabold leading-none ${gradeColors[grade]}`}>{grade}</span>
              <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500">{score}</span>
            </div>
          </div>
        </div>
      </div>
      <div className="space-y-2.5">
        {components.map((c) => {
          const ratio = c.max > 0 ? c.score / c.max : 0;
          const barColor = ratio >= 0.8 ? 'bg-emerald-500' : ratio >= 0.6 ? 'bg-indigo-500' : ratio >= 0.4 ? 'bg-amber-500' : ratio >= 0.2 ? 'bg-orange-500' : 'bg-rose-500';
          return (
            <div key={c.label} className="flex items-center gap-3">
              <span className="text-xs font-bold text-slate-600 dark:text-slate-300 w-32 shrink-0">{c.label}</span>
              <div className="flex-1 bg-slate-100 dark:bg-slate-700 rounded-full h-1.5 overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.round(ratio * 100)}%` }}
                  transition={{ duration: 0.8, ease: 'easeOut' }}
                  className={`h-full rounded-full ${barColor}`}
                />
              </div>
              <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 w-16 text-right shrink-0 whitespace-nowrap">{c.detail}</span>
              <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500 w-10 text-right shrink-0 whitespace-nowrap tabular-nums">{c.score}/{c.max}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Goals Summary ─────────────────────────────────────────────────────────────
export function GoalsSummary({ data }: { data: GoalData[] }) {
  const { t } = useTranslation();

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center bg-slate-50 dark:bg-slate-700/50 rounded-2xl border border-slate-100 dark:border-slate-700/60">
        <div className="w-12 h-12 rounded-full bg-white dark:bg-slate-800 flex items-center justify-center mx-auto mb-3 shadow-sm">
          <Target className="w-6 h-6 text-slate-400 dark:text-slate-500" />
        </div>
        <p className="text-slate-900 dark:text-slate-100 font-bold mb-1">{t('charts.noGoalsYet')}</p>
        <p className="text-slate-500 dark:text-slate-400 font-medium text-sm mb-4">{t('charts.setTargetGoals')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {data.slice(0, 3).map((g, i) => {
        const rawPct = g.target > 0 ? (g.current / g.target) * 100 : 0;
        const pct = Math.max(-100, Math.min(100, rawPct));
        const achieved = g.current >= g.target;
        const negative = g.current < 0;

        // On-track projection based on deadline
        const now = new Date();
        const daysLeft = g.deadline
          ? Math.ceil((new Date(g.deadline).getTime() - now.getTime()) / 86400000)
          : null;
        const remaining = g.target - g.current;
        const monthlyNeeded = daysLeft && daysLeft > 0 && remaining > 0
          ? remaining / (daysLeft / 30.44)
          : null;

        return (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            key={g.id}
            className="flex items-center gap-4 p-4 rounded-2xl bg-slate-50 dark:bg-slate-700/50 border border-slate-100 dark:border-slate-700/60 hover:shadow-sm transition-all"
          >
            <div className="w-12 h-12 rounded-2xl bg-white dark:bg-slate-800 flex items-center justify-center text-2xl shrink-0 shadow-sm border border-slate-100 dark:border-slate-700/60">
              {g.icon}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">{g.name}</span>
                <span className={`text-xs font-extrabold px-2.5 py-1 rounded-lg shrink-0 ml-2 ${achieved ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' : negative ? 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300' : 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300'}`}>
                  {pct.toFixed(0)}%
                </span>
              </div>
              <div className="w-full bg-slate-200 dark:bg-slate-600 rounded-full h-2 overflow-hidden relative">
                {negative ? (
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(100, Math.abs(pct))}%` }}
                    transition={{ duration: 1, ease: 'easeOut' }}
                    className="absolute right-0 top-0 h-full rounded-full bg-rose-500"
                    aria-label="Deficit"
                  />
                ) : (
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.max(0, pct)}%` }}
                    transition={{ duration: 1, ease: 'easeOut' }}
                    className={`h-full rounded-full ${achieved ? 'bg-emerald-500' : 'bg-indigo-500'}`}
                  />
                )}
              </div>
              <div className="flex items-center justify-between mt-1.5">
                <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
                  <span className={negative ? 'text-rose-600 dark:text-rose-400' : 'text-slate-700 dark:text-slate-300'}>{formatCurrency(g.current)}</span> / {formatCurrency(g.target)}
                </p>
                {monthlyNeeded && !achieved && (
                  <p className="text-xs font-bold text-slate-400 dark:text-slate-500">{formatCurrency(monthlyNeeded)}{t('charts.moNeeded')}</p>
                )}
              </div>
            </div>
          </motion.div>
        );
      })}
      {data.length > 3 && (
        <a href="/planning?tab=goals" className="text-sm font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-400 block text-center pt-2 pb-1 transition-colors">
          {t('charts.viewMoreGoals', { n: data.length - 3 })}
        </a>
      )}
    </div>
  );
}

// ── Spending Pace Widget ──────────────────────────────────────────────────────

export function SpendingPaceWidget({ data, daysLeft }: { data: SpendingPaceItem[]; daysLeft: number }) {
  const { t } = useTranslation();
  if (data.length === 0) return null;

  const atRisk = data.filter((d) => d.status === 'atRisk').sort((a, b) => b.overshootAmt - a.overshootAmt);
  const over = data.filter((d) => d.status === 'over');
  const onTrack = data.filter((d) => d.status === 'onTrack');
  const alerts = [...over, ...atRisk];

  return (
    <div className="space-y-3">
      {/* Summary row */}
      <div className="flex items-center gap-2 flex-wrap">
        {alerts.length === 0 ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/30 px-3 py-1.5 rounded-full border border-emerald-100 dark:border-emerald-800/50">
            <Zap className="w-3 h-3" />{t('charts.allOnTrack')}
          </span>
        ) : (
          <>
            {over.length > 0 && (
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-900/30 px-3 py-1.5 rounded-full border border-rose-100 dark:border-rose-800/50">
                <AlertTriangle className="w-3 h-3" />{over.length} {t('charts.overBudget')}
              </span>
            )}
            {atRisk.length > 0 && (
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30 px-3 py-1.5 rounded-full border border-amber-100 dark:border-amber-800/50">
                <TrendingUp className="w-3 h-3" />{atRisk.length} {t('charts.atRisk')}
              </span>
            )}
            {onTrack.length > 0 && (
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-700/50 px-3 py-1.5 rounded-full border border-slate-100 dark:border-slate-700/60">
                <Zap className="w-3 h-3" />{onTrack.length} {t('charts.paceOnTrack')}
              </span>
            )}
          </>
        )}
        <span className="text-xs font-medium text-slate-400 dark:text-slate-500 ml-auto">{daysLeft}d left</span>
      </div>

      {/* Alert list */}
      {alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.slice(0, 4).map((item) => {
            const isOver = item.status === 'over';
            const pct = item.budget > 0 ? Math.min(100, (item.spent / item.budget) * 100) : 0;
            return (
              <div key={item.category} className={`p-3 rounded-2xl border ${isOver ? 'bg-rose-50/60 dark:bg-rose-900/20 border-rose-100 dark:border-rose-800/50' : 'bg-amber-50/60 dark:bg-amber-900/20 border-amber-100 dark:border-amber-800/50'}`}>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{item.category}</p>
                  <div className="text-right">
                    <p className={`text-xs font-extrabold ${isOver ? 'text-rose-600 dark:text-rose-400' : 'text-amber-600 dark:text-amber-400'}`}>
                      {isOver
                        ? `-${formatCurrency(item.spent - item.budget)} over`
                        : `~+${formatCurrency(item.overshootAmt)} projected`}
                    </p>
                  </div>
                </div>
                <div className="w-full bg-white/80 dark:bg-slate-900/40 rounded-full h-1.5 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${isOver ? 'bg-rose-500' : 'bg-amber-500'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="flex items-center justify-between mt-1">
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    {formatCurrency(item.spent)} / {formatCurrency(item.budget)}
                  </p>
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    {formatCurrency(item.pace)}/day
                  </p>
                </div>
              </div>
            );
          })}
          {alerts.length > 4 && (
            <a href="/planning" className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-400 block text-center pt-1 transition-colors">
              +{alerts.length - 4} more → Planning
            </a>
          )}
        </div>
      )}

      {/* On-track list (compact) */}
      {onTrack.length > 0 && alerts.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {onTrack.map((item) => (
            <span key={item.category} className="inline-flex items-center gap-1 text-xs font-bold text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-700/50 px-2.5 py-1 rounded-full border border-slate-100 dark:border-slate-700/60">
              <TrendingDown className="w-2.5 h-2.5 text-emerald-500 dark:text-emerald-400" />{item.category}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
