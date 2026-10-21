'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  ComposedChart, BarChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Area, ReferenceLine, Legend,
} from 'recharts';
import { motion, useReducedMotion } from 'framer-motion';
import { formatCurrency, formatAxisCurrency } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n/context';
import { useIsDark } from '@/hooks/useIsDark';
import {
  CHART, useChartReady,
  type CategoryData, type MonthlyData, type BudgetData, type NetWorthPoint,
} from './DashboardCharts';

// Recharts-backed dashboard widgets, split out of DashboardCharts.tsx so the
// recharts library lands in an on-demand chunk (see the dynamic() wrappers there).

/** Shared Recharts series animation — a tuned ease-out glide that also re-runs
 *  when the dataset changes (year/filter switches interpolate bar heights instead
 *  of snapping). Disabled under prefers-reduced-motion. Spread onto a series:
 *  `<Bar {...anim} />`. */
function useChartAnim(duration = 800) {
  const reduce = useReducedMotion();
  return {
    isAnimationActive: !reduce,
    animationDuration: reduce ? 0 : duration,
    animationEasing: 'ease-out' as const,
  };
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

// ── Spending Pie Chart ────────────────────────────────────────────────────────

/** Deep link into the Transactions page, pre-filtered (see its URL params). */
function txHref(params: Record<string, string>): string {
  return `/transactions?${new URLSearchParams(params).toString()}`;
}

export function SpendingPieChart({ data, month }: { data: CategoryData[]; month?: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  // Category rows + slices open that month's transactions in the category.
  const hrefFor = (i: number) => (month ? txHref({ month, category: data[i].name, type: 'expense' }) : null);
  const isEmpty = data.length === 0;
  const cleanData = data.map(d => ({ ...d, name: d.name.replace(/^categories\./, '') }));
  const displayData = isEmpty ? [{ name: t('charts.noExpenseData'), value: 1 }] : cleanData;
  const ready = useChartReady();
  const c = useIsDark() ? CHART.dark : CHART.light;
  const anim = useChartAnim(700);
  const categoryTotal = data.reduce((s, d) => s + d.value, 0);
  const tCategory = (name: string) => { const k = `categories.${name}`; const r = t(k); return r === k ? name : r; };
  // Hovering a slice swaps the center label to that category instead of floating a
  // tooltip box over the donut's center (which used to cover the TOTAL readout).
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const active = !isEmpty && activeIdx !== null ? cleanData[activeIdx] : null;

  return (
    <div className="flex flex-col md:flex-row items-center gap-8 w-full">
      <div
        className="w-full md:w-56 h-56 relative"
        role="img"
        aria-label={isEmpty ? t('charts.noExpenseData') : `${t('charts.total')}: ${formatCurrency(categoryTotal)}`}
      >
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
              onMouseEnter={isEmpty ? undefined : (_, i) => setActiveIdx(i)}
              onMouseLeave={isEmpty ? undefined : () => setActiveIdx(null)}
              onClick={isEmpty ? undefined : (_, i) => { const href = hrefFor(i); if (href) router.push(href); }}
              {...anim}
            >
              {displayData.map((entry) => (
                <Cell
                  key={entry.name}
                  fill={isEmpty ? c.track : (CATEGORY_COLORS[entry.name] ?? DEFAULT_COLOR)}
                  className="hover:opacity-80 transition-opacity duration-300 cursor-pointer"
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>}
        {isEmpty ? (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-slate-400 dark:text-slate-500 font-bold text-lg">{formatCurrency(0)}</span>
          </div>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none px-6 text-center">
            <span className="text-[11px] font-bold uppercase tracking-wider truncate max-w-full" style={{ color: active ? (CATEGORY_COLORS[active.name] ?? DEFAULT_COLOR) : undefined }}>
              <span className={active ? '' : 'text-slate-400 dark:text-slate-500'}>{active ? tCategory(active.name) : t('charts.total')}</span>
            </span>
            <span className="text-lg font-extrabold text-slate-900 dark:text-slate-100 leading-tight">{formatCurrency(active ? active.value : categoryTotal)}</span>
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
            const href = hrefFor(i);
            return (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                key={entry.name}
              >
              <Link
                href={href ?? '#'}
                aria-disabled={!href}
                onClick={href ? undefined : (e) => e.preventDefault()}
                className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
              >
                <div
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: CATEGORY_COLORS[entry.name] ?? DEFAULT_COLOR }}
                />
                <span className="text-sm font-bold text-slate-700 dark:text-slate-300 flex-1 truncate">{tCategory(entry.name)}</span>
                <span className="text-xs text-slate-400 dark:text-slate-500 font-bold bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded-md">{pct.toFixed(0)}%</span>
                <span className="text-sm font-extrabold text-slate-900 dark:text-slate-100 min-w-20 shrink-0 text-right whitespace-nowrap tabular-nums">{formatCurrency(entry.value)}</span>
              </Link>
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
  const router = useRouter();
  // Tapping a month opens its transactions (when the rows carry a YYYY-MM key).
  const openMonth = (index: unknown) => {
    const key = data[Number(index)]?.key;
    if (key) router.push(txHref({ month: key }));
  };
  const isEmpty = data.every(d => d.income === 0 && d.expenses === 0);
  const ready = useChartReady();
  const c = useIsDark() ? CHART.dark : CHART.light;
  const anim = useChartAnim(800);
  const hasNet = data.some((d) => d.net !== undefined);

  return (
    <>
    <figure className={`h-64 w-full mt-4 ${data.some((d) => d.key) ? 'cursor-pointer' : ''}`} role="img" aria-label={`${t('dashboard.cashFlow')}: ${t('common.income')} vs ${t('common.expenses')}`}>
      {!ready ? <div className="w-full h-full rounded-2xl bg-slate-100 dark:bg-slate-700 animate-pulse" /> : <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }} barGap={6} onClick={(state) => openMonth(state?.activeTooltipIndex)}>
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
            tickFormatter={formatAxisCurrency}
            width={60}
          />
          {!isEmpty && <Tooltip content={<BarTooltip />} cursor={{ fill: c.cursor }} />}
          {hasNet && <ReferenceLine y={0} stroke={c.grid} strokeDasharray="4 4" />}
          <Bar dataKey="income" name={t('common.income')} fill="#10b981" radius={[6, 6, 0, 0]} maxBarSize={32} {...anim} />
          <Bar dataKey="expenses" name={t('common.expenses')} fill="#f43f5e" radius={[6, 6, 0, 0]} maxBarSize={32} {...anim} animationBegin={anim.isAnimationActive ? 120 : 0} />
          {hasNet && (
            <Line
              type="monotone"
              dataKey="net"
              name={t('common.netSavings')}
              stroke="#6366f1"
              strokeWidth={2.5}
              dot={{ r: 3, fill: '#6366f1', strokeWidth: 0 }}
              activeDot={{ r: 5 }}
              {...anim}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>}
    </figure>
    {/* Same numbers as a table for screen readers (the chart is an image to them). */}
    <table className="sr-only">
      <caption>{t('dashboard.cashFlow')}</caption>
      <thead><tr><th scope="col">{t('common.month')}</th><th scope="col">{t('common.income')}</th><th scope="col">{t('common.expenses')}</th></tr></thead>
      <tbody>
        {data.map((d) => (
          <tr key={d.month}><th scope="row">{d.month}</th><td>{formatCurrency(d.income)}</td><td>{formatCurrency(d.expenses)}</td></tr>
        ))}
      </tbody>
    </table>
    </>
  );
}

// ── Budget vs Actual (grouped bars) ───────────────────────────────────────────

/** At-a-glance comparison of budget vs spent across all categories. Complements
 *  BudgetBars (which shows per-category detail) by making cross-category
 *  magnitudes directly comparable. Spent bar turns rose when over budget. */
export function BudgetVsActualChart({ data }: { data: BudgetData[] }) {
  const { t } = useTranslation();
  const ready = useChartReady();
  const reduced = useReducedMotion();
  const c = useIsDark() ? CHART.dark : CHART.light;

  if (data.length < 2) return null;

  // Plot effective spent (this-month spend + any rolled-over deficit), matching
  // the BudgetBars detail cards and the Planning page — otherwise a category
  // whose whole usage is carried over from last month (this-month spend = 0,
  // e.g. Shopping) would render a 0-length "Spent" bar despite being over budget.
  const chartData = data
    .map((b) => ({ category: b.category.replace(/^categories\./, ''), budget: b.budget, spent: b.spent + (b.rolledOver ?? 0) }))
    .sort((a, b) => b.spent - a.spent);
  const height = Math.max(140, chartData.length * 52);

  return (
    <figure
      className="w-full mb-5 pb-5 border-b border-slate-100 dark:border-slate-700/60"
      style={{ height: height + 20 }}
      role="img"
      aria-label={t('dashboard.budgetProgress')}
    >
      {!ready ? <div className="w-full h-full rounded-2xl bg-slate-100 dark:bg-slate-700 animate-pulse" /> : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 12, left: 0, bottom: 0 }} barGap={2} barCategoryGap={12}>
            <CartesianGrid strokeDasharray="3 3" stroke={c.grid} horizontal={false} />
            <XAxis
              type="number"
              tickFormatter={formatAxisCurrency}
              tick={{ fill: c.axis, fontSize: 11, fontWeight: 600 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="category"
              width={88}
              tick={{ fill: c.axis, fontSize: 11, fontWeight: 700 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip content={<BarTooltip />} cursor={{ fill: c.cursor }} />
            {/* Custom legend so the swatch colors actually match the bars: the
                Budget track (light) and the Spent indigo. The default recharts
                legend mis-renders the Spent swatch because that bar is painted
                per-Cell (indigo / rose-when-over), leaving its series fill unset. */}
            <Legend
              verticalAlign="bottom"
              content={() => (
                <div className="flex items-center justify-center gap-5 pt-2 text-xs font-bold text-slate-500 dark:text-slate-400">
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-[3px]" style={{ backgroundColor: c.track }} />
                    {t('charts.budget')}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-[3px]" style={{ backgroundColor: '#6366f1' }} />
                    {t('charts.spent')}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-[3px]" style={{ backgroundColor: '#f43f5e' }} />
                    {t('charts.over')}
                  </span>
                </div>
              )}
            />
            <Bar dataKey="budget" name={t('charts.budget')} fill={c.track} radius={[0, 5, 5, 0]} maxBarSize={13} isAnimationActive={!reduced} />
            <Bar dataKey="spent" name={t('charts.spent')} fill="#6366f1" radius={[0, 5, 5, 0]} maxBarSize={13} isAnimationActive={!reduced}>
              {chartData.map((d) => (
                <Cell key={d.category} fill={d.spent > d.budget ? '#f43f5e' : '#6366f1'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </figure>
  );
}

// ── Net Worth Trend Chart ─────────────────────────────────────────────────────

type NetWorthChartRow = { label: string; netWorth?: number; projected?: number; kind: NetWorthPoint['kind'] | 'projected' };

function NetWorthTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number; payload: NetWorthChartRow }[]; label?: string }) {
  const { t } = useTranslation();
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const val = row.kind === 'projected' ? row.projected ?? payload[0].value : row.netWorth ?? payload[0].value;
  const kindLabel = {
    actual: t('charts.nwActual'),
    estimated: t('charts.nwEstimated'),
    live: t('charts.nwToday'),
    projected: t('charts.projected'),
  }[row.kind ?? 'actual'];
  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl px-4 py-3 text-sm shadow-xl">
      <p className="text-slate-500 dark:text-slate-400 font-bold mb-1">{label}</p>
      <p className={`font-extrabold text-lg ${val >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
        {formatCurrency(val)}
      </p>
      <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 mt-0.5">{kindLabel}</p>
    </div>
  );
}

export function NetWorthTrendChart({ data, projection, assumption }: { data: NetWorthPoint[]; projection?: { label: string; projected: number }[]; assumption?: string }) {
  const { t } = useTranslation();
  const ready = useChartReady();
  const c = useIsDark() ? CHART.dark : CHART.light;
  const anim = useChartAnim(900);

  // Every month gets a label (`interval={0}`; Recharts' default silently drops
  // ticks it thinks are crowded). When the labels no longer fit side by side
  // (phones: up to 12 history + projected months) they tilt instead of vanishing.
  const figureRef = useRef<HTMLElement>(null);
  const [plotWidth, setPlotWidth] = useState(0);
  useEffect(() => {
    const el = figureRef.current;
    if (!el) return;
    const measure = () => setPlotWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ready, data.length]);

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

  // History (solid area) and forecast (dashed line) share the x-axis. The last
  // history point is TODAY, so it also carries `projected` — the dashed line
  // starts exactly where the actual line ends instead of the actual line being
  // drawn one month into the future (the old join gave the first future month
  // the last actual value).
  const hasProjection = !!projection && projection.length > 0;
  const chartData: NetWorthChartRow[] = [
    ...data.map((d, i) => ({
      label: d.label,
      netWorth: d.netWorth,
      projected: hasProjection && i === data.length - 1 ? d.netWorth : undefined,
      kind: d.kind,
    })),
    ...(projection ?? []).map((p) => ({ label: p.label, projected: p.projected, kind: 'projected' as const })),
  ];
  const hasEstimates = data.some((d) => d.kind === 'estimated');
  // "Oct '26" at 12px semi-bold is ~46px wide; tilt once a slot is narrower than that.
  const tiltLabels = plotWidth > 0 && (plotWidth - 46) / chartData.length < 50;

  return (
    <div className="w-full">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 mb-4 px-2">
        <span className={`text-sm font-extrabold px-3 py-1 rounded-lg ${isPositive ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' : 'bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300'}`}>
          {isPositive ? '+' : ''}{formatCurrency(delta)} {t('charts.since', { label: data[0].label })}
        </span>
        {hasProjection && (
          <span className="text-xs font-bold text-slate-400 dark:text-slate-500 flex items-center gap-1 shrink-0">
            <span className="inline-block w-6 border-t-2 border-dashed border-slate-300 dark:border-slate-600" />
            {t('charts.projected')}
          </span>
        )}
      </div>
      <figure
        ref={figureRef}
        className={`${tiltLabels ? 'h-60' : 'h-52'} w-full`}
        role="img"
        aria-label={`${t('dashboard.netWorthTrend')}: ${formatCurrency(latest)}${hasProjection ? ` · ${t('charts.projected')} ${projection![projection!.length - 1].label}: ${formatCurrency(projection![projection!.length - 1].projected)}` : ''}`}
      >
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
              interval={0}
              tick={{ fill: c.axis, fontSize: tiltLabels ? 11 : 12, fontWeight: 600 }}
              axisLine={false}
              tickLine={false}
              {...(tiltLabels ? { angle: -45, textAnchor: 'end' as const, height: 52, dy: 4 } : { dy: 10 })}
            />
            <YAxis
              tick={{ fill: c.axis, fontSize: 12, fontWeight: 600 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={formatAxisCurrency}
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
              // Months rebuilt from transactions get a hollow dot; saved months and
              // today stay solid.
              dot={(p: { cx?: number; cy?: number; index?: number; payload?: NetWorthChartRow }) =>
                p.cx == null || p.cy == null || p.payload?.netWorth === undefined ? <g key={p.index} /> : (
                  <circle
                    key={p.index}
                    cx={p.cx}
                    cy={p.cy}
                    r={p.payload.kind === 'estimated' ? 3.5 : 4}
                    fill={p.payload.kind === 'estimated' ? c.track : stroke}
                    stroke={stroke}
                    strokeWidth={p.payload.kind === 'estimated' ? 1.5 : 0}
                  />
                )}
              activeDot={{ r: 6, fill: stroke, strokeWidth: 0 }}
              connectNulls={false}
              {...anim}
            />
            {hasProjection && (
              <Line
                type="monotone"
                dataKey="projected"
                stroke={stroke}
                strokeWidth={2}
                strokeDasharray="6 4"
                dot={false}
                activeDot={{ r: 4, fill: stroke, strokeWidth: 0 }}
                connectNulls
                {...anim}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>}
      </figure>
      {(hasEstimates || (hasProjection && assumption)) && (
        <p className="mt-3 px-2 text-[11px] font-medium text-slate-400 dark:text-slate-500 leading-snug">
          {[hasEstimates ? t('charts.nwEstimatedNote') : null, hasProjection ? assumption : null].filter(Boolean).join(' · ')}
        </p>
      )}
    </div>
  );
}

