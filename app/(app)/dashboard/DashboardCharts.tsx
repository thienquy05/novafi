'use client';
import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, TrendingUp, Sparkles, DollarSign, Target, CreditCard } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { HEALTH_WEIGHTS, calcSavingsRate } from '@/lib/calculations';
import { animate, motion, useReducedMotion } from 'framer-motion';
import { useTranslation } from '@/lib/i18n/context';
import { useIsDark } from '@/hooks/useIsDark';
import { HelpHint } from '@/components/ui/HelpHint';
import { NovaAvatar } from './NovaAvatar';

/** Theme-aware colors for recharts SVG props (set via JS, not Tailwind). */
export const CHART = {
  light: { grid: '#e2e8f0', axis: '#64748b', cursor: '#f8fafc', track: '#f1f5f9', cursorStroke: '#cbd5e1' },
  dark:  { grid: '#334155', axis: '#94a3b8', cursor: 'rgba(148, 163, 184, 0.08)', track: '#334155', cursorStroke: '#475569' },
} as const;

/** Defers chart rendering until the component is mounted in the browser.
 *  Prevents the recharts "width(-1) height(-1)" warning caused by
 *  ResponsiveContainer measuring before the DOM is painted. */
export function useChartReady() {
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); }, []);
  return ready;
}

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
  /** Overall credit utilization %, or null when no card has a limit set. */
  creditUtil: number | null;
  /** Per-component breakdown so the card can show actual point values. */
  breakdown: {
    savings: number;
    emergency: number;
    credit: number;
    budget: number;
    dti: number;
    trend: number;
    volatility: number;
  };
};

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
  daysLeft,
  daysInMonth,
  overBudgetCount,
  creditAlerts = 0,
}: {
  monthIncome: number;
  monthSpending: number;
  daysLeft: number;
  daysInMonth: number;
  overBudgetCount: number;
  creditAlerts?: number; // # of credit cards over the recommended 30% utilization
}) {
  const { t } = useTranslation();
  const savingsRate = calcSavingsRate(monthIncome, monthSpending);

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
      barColor: 'bg-emerald-500',
      titleColor: 'text-emerald-800 dark:text-emerald-300',
      pillBg: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300',
      title: t('charts.greatShape'),
      Icon: TrendingUp,
    },
    good: {
      bg: 'bg-indigo-50 dark:bg-indigo-900/30 border-indigo-200 dark:border-indigo-800/50',
      iconBg: 'bg-indigo-100 dark:bg-indigo-900/40',
      iconColor: 'text-indigo-600 dark:text-indigo-400',
      barColor: 'bg-indigo-500',
      titleColor: 'text-indigo-800 dark:text-indigo-300',
      pillBg: 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300',
      title: t('charts.lookingGood'),
      Icon: TrendingUp,
    },
    warning: {
      bg: 'bg-amber-50 dark:bg-amber-900/30 border-amber-200 dark:border-amber-800/50',
      iconBg: 'bg-amber-100 dark:bg-amber-900/40',
      iconColor: 'text-amber-600 dark:text-amber-400',
      barColor: 'bg-amber-500',
      titleColor: 'text-amber-800 dark:text-amber-300',
      pillBg: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
      title: t('charts.watchSpending'),
      Icon: AlertTriangle,
    },
    danger: {
      bg: 'bg-rose-50 dark:bg-rose-900/30 border-rose-200 dark:border-rose-800/50',
      iconBg: 'bg-rose-100 dark:bg-rose-900/40',
      iconColor: 'text-rose-600 dark:text-rose-400',
      barColor: 'bg-rose-500',
      titleColor: 'text-rose-800 dark:text-rose-300',
      pillBg: 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300',
      title: t('charts.overBudget'),
      Icon: AlertTriangle,
    },
    neutral: {
      bg: 'bg-slate-50 dark:bg-slate-700/50 border-slate-200 dark:border-slate-700',
      iconBg: 'bg-slate-100 dark:bg-slate-700',
      iconColor: 'text-slate-400 dark:text-slate-500',
      barColor: 'bg-slate-400',
      titleColor: 'text-slate-700 dark:text-slate-300',
      pillBg: 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400',
      title: t('charts.setUpIncome'),
      Icon: DollarSign,
    },
  };

  const cfg = configs[status];

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
      <NovaAvatar status={status} size={56} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
          <p className={`text-base font-extrabold ${cfg.titleColor}`}>{title}</p>
          {monthIncome > 0 && (
            <span className={`text-xs font-bold px-2 py-0.5 rounded-lg whitespace-nowrap ${cfg.pillBg}`}>
              {t('charts.savedPct', { pct: savingsRate.toFixed(0) })}
            </span>
          )}
          {overBudgetCount > 0 && (
            <span className="text-xs font-bold px-2 py-0.5 rounded-lg whitespace-nowrap bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300">
              {t('charts.nOverBudget', { n: overBudgetCount })}
            </span>
          )}
          {creditAlerts > 0 && (
            <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-lg bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">
              <CreditCard className="w-3 h-3" />
              {t('charts.creditOverPill', { n: creditAlerts })}
            </span>
          )}
        </div>
        {monthIncome === 0 ? (
          <p className="text-sm font-medium text-slate-600 dark:text-slate-300">{t('charts.recordPaycheckHint')}</p>
        ) : monthSpending > monthIncome ? (
          <p className="text-sm font-medium text-slate-600 dark:text-slate-300">{t('charts.overIncome', { amount: formatCurrency(monthSpending - monthIncome) })}</p>
        ) : (
          <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
            <span className="font-bold text-slate-900 dark:text-slate-100">{formatCurrency(cashFlow)}</span> {t('charts.netLabel')}
          </p>
        )}
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-extrabold text-slate-900 dark:text-slate-100">{daysLeft}d left</p>
        <div className="w-16 bg-slate-200 dark:bg-slate-600 rounded-full h-1.5 mt-1">
          <div
            className={`h-1.5 rounded-full transition-all ${cfg.barColor}`}
            style={{ width: `${Math.round(((daysInMonth - daysLeft) / daysInMonth) * 100)}%` }}
          />
        </div>
      </div>
    </motion.div>
  );
}

// ── Recharts widgets (lazy) ───────────────────────────────────────────────────
// The four Recharts-backed widgets live in ./DashboardRecharts so the recharts
// library (~130 KB gzipped) loads in its own chunk instead of the dashboard's
// first-load JS. Still server-rendered (each shows its pulse placeholder until
// mounted, exactly as before), so the page looks identical while it streams in.
const loadRecharts = () => import('./DashboardRecharts');
export const SpendingPieChart = dynamic(() => loadRecharts().then((m) => m.SpendingPieChart));
export const MonthlyBarChart = dynamic(() => loadRecharts().then((m) => m.MonthlyBarChart));
export const BudgetVsActualChart = dynamic(() => loadRecharts().then((m) => m.BudgetVsActualChart));
export const NetWorthTrendChart = dynamic(() => loadRecharts().then((m) => m.NetWorthTrendChart));

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
                {totalSpend != null && totalSpend > 0 && usage > 0 && (
                  <span className="text-xs font-bold text-slate-400 dark:text-slate-500 bg-slate-50 dark:bg-slate-700/50 px-1.5 py-0.5 rounded-md">
                    {((usage / totalSpend) * 100).toFixed(0)}%
                  </span>
                )}
                {rolledOver > 0 && (
                  <span className="text-xs font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 px-1.5 py-0.5 rounded-md whitespace-nowrap">
                    +{formatCurrency(rolledOver)} {t('planning.rolledOver')}
                  </span>
                )}
              </div>
              <div className="text-right">
                <span className={`text-sm font-extrabold ${over ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-slate-100'}`}>
                  {formatCurrency(usage)}
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
                    // Compare last month against this month's effective usage (spent +
                    // rolled-over deficit), mirroring the Planning page so the two agree.
                    const diff = usage - b.prevMonthSpent;
                    if (Math.abs(diff) < 0.5) return <span className="text-xs font-bold text-slate-400 dark:text-slate-500">{t('charts.sameAsLastMo')}</span>;
                    return (
                      <span className={`text-xs font-bold whitespace-nowrap ${diff > 0 ? 'text-rose-500 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
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
        <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500">3 {t('charts.monthsShort')}</span>
        <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500">6 {t('charts.monthsShort')}</span>
      </div>
      <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500 mt-1">
        {formatCurrency(liquidSavings)} {t('charts.liquid')} · {avgMonthlyExpense > 0 ? `${formatCurrency(avgMonthlyExpense)}/${t('charts.avg')}` : t('charts.noExpenseData')}
      </p>
    </div>
  );
}

// ── Financial Health Score ─────────────────────────────────────────────────────

/**
 * The composite-score gauge: a conic-gradient arc that sweeps from 0 to the score
 * while the number counts up to match. An 'A' grade earns a soft emerald glow.
 * Driven imperatively (refs + framer `animate`) so the per-frame updates don't
 * re-render. Honors reduced-motion by painting the final state instantly.
 */
function HealthRing({
  score, grade, ringColor, ringTrack, gradeColor,
}: {
  score: number; grade: string; ringColor: string; ringTrack: string; gradeColor: string;
}) {
  const reduce = useReducedMotion();
  const ringRef = useRef<HTMLDivElement>(null);
  const numRef = useRef<HTMLSpanElement>(null);
  const isA = grade === 'A';

  useEffect(() => {
    const ring = ringRef.current, num = numRef.current;
    if (!ring || !num) return;
    const paint = (v: number) => {
      ring.style.background = `conic-gradient(${ringColor} ${v * 3.6}deg, ${ringTrack} 0deg)`;
      num.textContent = String(Math.round(v));
    };
    if (reduce) { paint(score); return; }
    const controls = animate(0, score, { duration: 1.4, ease: 'easeOut', onUpdate: paint });
    return () => controls.stop();
  }, [score, ringColor, ringTrack, reduce]);

  return (
    <div className="text-center">
      <div
        ref={ringRef}
        className="relative w-16 h-16 flex items-center justify-center rounded-full"
        style={{ background: `conic-gradient(${ringColor} ${reduce ? score * 3.6 : 0}deg, ${ringTrack} 0deg)` }}
      >
        <div className="absolute inset-1.5 bg-white dark:bg-slate-800 rounded-full flex flex-col items-center justify-center">
          <span className={`text-lg font-extrabold leading-none ${gradeColor} ${isA ? 'drop-shadow-[0_0_10px_rgba(16,185,129,0.55)]' : ''}`}>{grade}</span>
          <span ref={numRef} className="text-[10px] font-bold text-slate-400 dark:text-slate-500">{reduce ? score : 0}</span>
        </div>
      </div>
    </div>
  );
}

export function FinancialHealthScore({ data }: { data: HealthScoreData }) {
  const { t } = useTranslation();
  const {
    score, savingsRate, emergencyFundMonths, overBudgetCount, budgetCount,
    dti, netWorthTrendPct, spendingCv, creditUtil, breakdown,
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
    if (r === 0) return t('charts.none');
    if (r >= 10) return `${r.toFixed(1)}×`;
    return `${(r * 100).toFixed(0)}%`;
  };
  const fmtTrend = (p: number | null) => p === null ? 'n/a' : `${p >= 0 ? '+' : ''}${p.toFixed(1)}%/${t('charts.monthsShort')}`;
  const fmtCv = (c: number | null) => c === null ? 'n/a' : `±${(c * 100).toFixed(0)}%`;

  const components = [
    { label: t('charts.savingsRate'),      detail: `${savingsRate.toFixed(0)}%`, score: breakdown.savings, max: HEALTH_WEIGHTS.savings },
    { label: t('charts.emergencyFund'),    detail: `${emergencyFundMonths.toFixed(1)} ${t('charts.monthsShort')}`, score: breakdown.emergency, max: HEALTH_WEIGHTS.emergency },
    { label: t('charts.creditUtil'),       detail: creditUtil === null ? t('charts.noCards') : `${Math.round(creditUtil)}%`, score: breakdown.credit, max: HEALTH_WEIGHTS.credit },
    {
      label: t('charts.budgetControl'),
      detail: budgetCount === 0 ? t('charts.noBudgetsSet') : overBudgetCount === 0 ? t('charts.onTrack') : `${overBudgetCount} ${t('charts.over')}`,
      score: breakdown.budget,
      max: HEALTH_WEIGHTS.budget,
    },
    { label: t('charts.debtToIncome'),     detail: fmtDti(dti),                 score: breakdown.dti,        max: HEALTH_WEIGHTS.dti },
    { label: t('charts.netWorthTrend'),    detail: fmtTrend(netWorthTrendPct),   score: breakdown.trend,      max: HEALTH_WEIGHTS.trend },
    { label: t('charts.spendingStability'), detail: fmtCv(spendingCv),           score: breakdown.volatility, max: HEALTH_WEIGHTS.volatility },
  ];

  return (
    <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700/60 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-start gap-1.5">
          <div>
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t('charts.financialHealth')}</p>
            <p className="text-slate-500 dark:text-slate-400 text-xs font-medium mt-0.5">{t('charts.healthScore')}</p>
          </div>
          <HelpHint label={t('charts.healthHelpTitle')} align="left">
            <p className="font-bold mb-1.5">{t('charts.healthHelpTitle')}</p>
            <p>{t('charts.healthHelp')}</p>
          </HelpHint>
        </div>
        <HealthRing
          score={score}
          grade={grade}
          ringColor={ringColor}
          ringTrack={ringTrack}
          gradeColor={gradeColors[grade]}
        />
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
