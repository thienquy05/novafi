'use client';
import { useEffect, useState } from 'react';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  AreaChart, Area, ReferenceLine,
} from 'recharts';
import { AlertTriangle, TrendingUp, Sparkles, DollarSign, Target } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { motion } from 'framer-motion';

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
export type MonthlyData = { month: string; income: number; expenses: number };
export type BudgetData = { category: string; budget: number; spent: number };
export type GoalData = { id: string; name: string; icon: string; current: number; target: number; deadline: string };
export type NetWorthPoint = { month: string; label: string; netWorth: number };

function CustomTooltip({ active, payload }: { active?: boolean; payload?: { name: string; value: number }[] }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-2xl px-4 py-3 text-sm shadow-xl">
      <p className="text-slate-500 font-bold mb-1">{payload[0].name}</p>
      <p className="text-slate-900 font-extrabold text-lg">{formatCurrency(payload[0].value)}</p>
    </div>
  );
}

function BarTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; fill: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-2xl px-4 py-3 text-sm shadow-xl space-y-2">
      <p className="text-slate-500 font-bold pb-2 border-b border-slate-100">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center justify-between gap-6">
          <span style={{ color: p.fill }} className="font-bold">{p.name}</span>
          <span className="text-slate-900 font-extrabold">{formatCurrency(p.value)}</span>
        </div>
      ))}
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
      bg: 'bg-emerald-50 border-emerald-200',
      iconBg: 'bg-emerald-100',
      iconColor: 'text-emerald-600',
      titleColor: 'text-emerald-800',
      pillBg: 'bg-emerald-100 text-emerald-700',
      title: 'Great shape',
      Icon: TrendingUp,
    },
    good: {
      bg: 'bg-indigo-50 border-indigo-200',
      iconBg: 'bg-indigo-100',
      iconColor: 'text-indigo-600',
      titleColor: 'text-indigo-800',
      pillBg: 'bg-indigo-100 text-indigo-700',
      title: 'Looking good',
      Icon: TrendingUp,
    },
    warning: {
      bg: 'bg-amber-50 border-amber-200',
      iconBg: 'bg-amber-100',
      iconColor: 'text-amber-600',
      titleColor: 'text-amber-800',
      pillBg: 'bg-amber-100 text-amber-700',
      title: 'Watch spending',
      Icon: AlertTriangle,
    },
    danger: {
      bg: 'bg-rose-50 border-rose-200',
      iconBg: 'bg-rose-100',
      iconColor: 'text-rose-600',
      titleColor: 'text-rose-800',
      pillBg: 'bg-rose-100 text-rose-700',
      title: 'Over budget',
      Icon: AlertTriangle,
    },
    neutral: {
      bg: 'bg-slate-50 border-slate-200',
      iconBg: 'bg-slate-100',
      iconColor: 'text-slate-400',
      titleColor: 'text-slate-700',
      pillBg: 'bg-slate-100 text-slate-500',
      title: 'Set up income',
      Icon: DollarSign,
    },
  };

  const cfg = configs[status];
  const { Icon } = cfg;

  const cashFlow = monthIncome - monthSpending;
  const subtitle =
    monthIncome === 0
      ? 'Record a paycheck to track your monthly cash flow'
      : monthSpending > monthIncome
      ? `${formatCurrency(monthSpending - monthIncome)} over income — check your budgets`
      : `${formatCurrency(cashFlow)} net · ${formatCurrency(safeToSpend)} free after bills`;

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
          <p className={`text-base font-extrabold ${cfg.titleColor}`}>{cfg.title}</p>
          {monthIncome > 0 && (
            <span className={`text-xs font-bold px-2 py-0.5 rounded-lg ${cfg.pillBg}`}>
              {savingsRate.toFixed(0)}% saved
            </span>
          )}
          {overBudgetCount > 0 && (
            <span className="text-xs font-bold px-2 py-0.5 rounded-lg bg-rose-100 text-rose-700">
              {overBudgetCount} over budget
            </span>
          )}
        </div>
        <p className="text-sm font-medium text-slate-600 truncate">{subtitle}</p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-extrabold text-slate-900">{daysLeft}d left</p>
        <div className="w-16 bg-slate-200 rounded-full h-1.5 mt-1">
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
  const isEmpty = data.length === 0;
  const displayData = isEmpty ? [{ name: 'No Spending', value: 1 }] : data;
  const ready = useChartReady();

  return (
    <div className="flex flex-col md:flex-row items-center gap-8 w-full">
      <div className="w-full md:w-56 h-56 relative">
        {!ready ? <div className="w-full h-full rounded-full bg-slate-100 animate-pulse" /> : <ResponsiveContainer width="100%" height="100%">
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
                  fill={isEmpty ? '#f1f5f9' : (CATEGORY_COLORS[entry.name] ?? DEFAULT_COLOR)}
                  className="hover:opacity-80 transition-opacity duration-300 cursor-pointer"
                />
              ))}
            </Pie>
            {!isEmpty && <Tooltip content={<CustomTooltip />} cursor={{ fill: 'transparent' }} />}
          </PieChart>
        </ResponsiveContainer>}
        {isEmpty && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-slate-400 font-bold text-lg">{formatCurrency(0)}</span>
          </div>
        )}
      </div>
      <div className="flex-1 space-y-3 w-full max-h-56 overflow-y-auto hide-scrollbar pr-2">
        {isEmpty ? (
          <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100">
            <div className="w-3 h-3 rounded-full shrink-0 bg-slate-300" />
            <span className="text-sm font-bold text-slate-500 flex-1">No Spending</span>
            <span className="text-sm font-extrabold text-slate-400">{formatCurrency(0)}</span>
          </div>
        ) : (
          data.map((entry, i) => {
            const total = data.reduce((s, d) => s + d.value, 0);
            const pct = total > 0 ? (entry.value / total) * 100 : 0;
            return (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                key={entry.name}
                className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-slate-50 transition-colors"
              >
                <div
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: CATEGORY_COLORS[entry.name] ?? DEFAULT_COLOR }}
                />
                <span className="text-sm font-bold text-slate-700 flex-1 truncate">{entry.name}</span>
                <span className="text-xs text-slate-400 font-bold bg-slate-100 px-2 py-0.5 rounded-md">{pct.toFixed(0)}%</span>
                <span className="text-sm font-extrabold text-slate-900 w-20 text-right">{formatCurrency(entry.value)}</span>
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
  const isEmpty = data.every(d => d.income === 0 && d.expenses === 0);
  const ready = useChartReady();

  return (
    <div className="h-64 w-full mt-4">
      {!ready ? <div className="w-full h-full rounded-2xl bg-slate-100 animate-pulse" /> : <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }} barGap={6}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis
            dataKey="month"
            tick={{ fill: '#64748b', fontSize: 12, fontWeight: 600 }}
            axisLine={false}
            tickLine={false}
            dy={10}
          />
          <YAxis
            tick={{ fill: '#64748b', fontSize: 12, fontWeight: 600 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
            width={60}
          />
          {!isEmpty && <Tooltip content={<BarTooltip />} cursor={{ fill: '#f8fafc' }} />}
          <Bar dataKey="income" name="Income" fill="#10b981" radius={[6, 6, 0, 0]} maxBarSize={32} />
          <Bar dataKey="expenses" name="Expenses" fill="#f43f5e" radius={[6, 6, 0, 0]} maxBarSize={32} />
        </BarChart>
      </ResponsiveContainer>}
    </div>
  );
}

// ── Budget Bars ───────────────────────────────────────────────────────────────

export function BudgetBars({ data, daysLeft, daysElapsed }: { data: BudgetData[]; daysLeft?: number; daysElapsed?: number }) {
  if (data.length === 0) {
    return (
      <div className="text-slate-500 text-sm py-8 text-center bg-slate-50 rounded-2xl border border-slate-100">
        <div className="w-12 h-12 rounded-full bg-white flex items-center justify-center mx-auto mb-3 shadow-sm">
          <Sparkles className="w-6 h-6 text-slate-400" />
        </div>
        <p className="font-bold text-slate-900 mb-1">No budgets set</p>
        <p className="font-medium text-slate-500 mb-3">Set budgets to track your spending.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {data.map((b, i) => {
        const pct = b.budget > 0 ? Math.min(100, (b.spent / b.budget) * 100) : 0;
        const over = b.spent > b.budget;
        const remaining = b.budget - b.spent;

        // Projected spend: (spent / daysElapsed) * totalDays
        const totalDays = (daysLeft ?? 0) + (daysElapsed ?? 0);
        const projected = daysElapsed && daysElapsed > 0 && totalDays > 0
          ? (b.spent / daysElapsed) * totalDays
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
              <span className="text-sm font-bold text-slate-800">{b.category}</span>
              <div className="text-right">
                <span className={`text-sm font-extrabold ${over ? 'text-rose-600' : 'text-slate-900'}`}>
                  {formatCurrency(b.spent)}
                </span>
                <span className="text-xs font-bold text-slate-400"> / {formatCurrency(b.budget)}</span>
              </div>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
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
                  <span className="text-rose-600">{formatCurrency(Math.abs(remaining))} over</span>
                ) : (
                  <span className="text-slate-500">
                    {formatCurrency(remaining)} left
                    {daysLeft ? <span className="text-slate-400"> · {daysLeft}d</span> : null}
                  </span>
                )}
              </p>
              {willOvershoot && projected && (
                <p className="text-xs font-bold text-amber-600">
                  ~{formatCurrency(projected - b.budget)} overshoot
                </p>
              )}
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
    <div className="bg-white border border-slate-200 rounded-2xl px-4 py-3 text-sm shadow-xl">
      <p className="text-slate-500 font-bold mb-1">{label}</p>
      <p className={`font-extrabold text-lg ${val >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
        {formatCurrency(val)}
      </p>
    </div>
  );
}

export function NetWorthTrendChart({ data }: { data: NetWorthPoint[] }) {
  const ready = useChartReady();

  if (data.length < 2) {
    return (
      <div className="h-48 flex flex-col items-center justify-center text-center">
        <p className="text-slate-400 font-bold text-sm">Not enough data yet</p>
        <p className="text-slate-400 text-xs mt-1 font-medium">Come back next month to see your trend.</p>
      </div>
    );
  }

  const latest = data[data.length - 1].netWorth;
  const first = data[0].netWorth;
  const delta = latest - first;
  const isPositive = delta >= 0;

  const stroke = isPositive ? '#10b981' : '#f43f5e';
  const fillId = isPositive ? 'nwPositive' : 'nwNegative';

  return (
    <div className="w-full">
      <div className="flex items-center justify-end gap-3 mb-4 pr-2">
        <span className={`text-sm font-extrabold px-3 py-1 rounded-lg ${isPositive ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
          {isPositive ? '+' : ''}{formatCurrency(delta)} since {data[0].label}
        </span>
      </div>
      <div className="h-52 w-full">
        {!ready ? <div className="w-full h-full rounded-2xl bg-slate-100 animate-pulse" /> : <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 10, left: -10, bottom: 0 }}>
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
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: '#64748b', fontSize: 12, fontWeight: 600 }}
              axisLine={false}
              tickLine={false}
              dy={10}
            />
            <YAxis
              tick={{ fill: '#64748b', fontSize: 12, fontWeight: 600 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
              width={56}
            />
            <ReferenceLine y={0} stroke="#e2e8f0" strokeDasharray="4 4" />
            <Tooltip content={<NetWorthTooltip />} cursor={{ stroke: '#e2e8f0', strokeWidth: 1 }} />
            <Area
              type="monotone"
              dataKey="netWorth"
              stroke={stroke}
              strokeWidth={2.5}
              fill={`url(#${fillId})`}
              dot={{ fill: stroke, strokeWidth: 0, r: 4 }}
              activeDot={{ r: 6, fill: stroke, strokeWidth: 0 }}
            />
          </AreaChart>
        </ResponsiveContainer>}
      </div>
    </div>
  );
}

// ── Goals Summary ─────────────────────────────────────────────────────────────
export function GoalsSummary({ data }: { data: GoalData[] }) {
  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center bg-slate-50 rounded-2xl border border-slate-100">
        <div className="w-12 h-12 rounded-full bg-white flex items-center justify-center mx-auto mb-3 shadow-sm">
          <Target className="w-6 h-6 text-slate-400" />
        </div>
        <p className="text-slate-900 font-bold mb-1">No savings goals yet</p>
        <p className="text-slate-500 font-medium text-sm mb-4">Set a target to track your progress.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {data.slice(0, 3).map((g, i) => {
        const pct = g.target > 0 ? Math.min(100, (g.current / g.target) * 100) : 0;
        const achieved = g.current >= g.target;

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
            className="flex items-center gap-4 p-4 rounded-2xl bg-slate-50 border border-slate-100 hover:shadow-sm transition-all"
          >
            <div className="w-12 h-12 rounded-2xl bg-white flex items-center justify-center text-2xl shrink-0 shadow-sm border border-slate-100">
              {g.icon}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-bold text-slate-900 truncate">{g.name}</span>
                <span className={`text-xs font-extrabold px-2.5 py-1 rounded-lg shrink-0 ml-2 ${achieved ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-100 text-indigo-700'}`}>
                  {pct.toFixed(0)}%
                </span>
              </div>
              <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 1, ease: 'easeOut' }}
                  className={`h-full rounded-full ${achieved ? 'bg-emerald-500' : 'bg-indigo-500'}`}
                />
              </div>
              <div className="flex items-center justify-between mt-1.5">
                <p className="text-xs font-bold text-slate-500">
                  <span className="text-slate-700">{formatCurrency(g.current)}</span> / {formatCurrency(g.target)}
                </p>
                {monthlyNeeded && !achieved && (
                  <p className="text-xs font-bold text-slate-400">{formatCurrency(monthlyNeeded)}/mo needed</p>
                )}
              </div>
            </div>
          </motion.div>
        );
      })}
      {data.length > 3 && (
        <a href="/planning?tab=goals" className="text-sm font-bold text-indigo-600 hover:text-indigo-500 block text-center pt-2 pb-1 transition-colors">
          View {data.length - 3} more goals →
        </a>
      )}
    </div>
  );
}
