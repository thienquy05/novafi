'use client';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useReducedMotion } from 'framer-motion';
import { useIsDark } from '@/hooks/useIsDark';
import { formatCurrency, formatAxisCurrency } from '@/lib/utils';

export type MonthlyComparisonDatum = { month: string; income: number; expenses: number };

// The monthly income-vs-expense bar chart. Isolated into its own module so the
// reports page can load Recharts lazily (via lib/dynamicChart) instead of carrying
// it in the route's first-load JS. ssr:false from dynamicChart means this only
// renders client-side, so the old `ready` guard isn't needed here.
export default function MonthlyComparisonChart({ data }: { data: MonthlyComparisonDatum[] }) {
  // Tuned ease-out glide; re-runs when the year selector swaps the dataset so the
  // bars interpolate to new heights instead of snapping. Off under reduced-motion.
  const reduce = useReducedMotion();
  const anim = {
    isAnimationActive: !reduce,
    animationDuration: reduce ? 0 : 800,
    animationEasing: 'ease-out' as const,
  };
  const c = useIsDark()
    ? { grid: '#334155', axis: '#94a3b8', cursor: 'rgba(148, 163, 184, 0.08)', tip: { background: '#1e293b', color: '#f1f5f9', border: '1px solid #334155' } }
    : { grid: '#e2e8f0', axis: '#64748b', cursor: '#f8fafc', tip: { background: '#ffffff', color: '#0f172a', border: '1px solid #e2e8f0' } };
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }} barGap={4}>
        <CartesianGrid strokeDasharray="3 3" stroke={c.grid} vertical={false} />
        {/* interval={0} forces all 12 month labels; Recharts otherwise auto-thins them (dropping Jan/Mar/May/Sep…). minTickGap=0 keeps them all even when tight. */}
        <XAxis dataKey="month" interval={0} minTickGap={0} tick={{ fill: c.axis, fontSize: 10, fontWeight: 600 }} axisLine={false} tickLine={false} dy={10} />
        <YAxis tick={{ fill: c.axis, fontSize: 11, fontWeight: 600 }} axisLine={false} tickLine={false} tickFormatter={formatAxisCurrency} width={52} />
        <Tooltip formatter={(v) => formatCurrency(Number(v))} cursor={{ fill: c.cursor }} contentStyle={{ ...c.tip, borderRadius: 16, fontSize: 13, fontWeight: 700 }} itemStyle={{ color: c.tip.color }} labelStyle={{ color: c.tip.color }} />
        <Bar dataKey="income" name="Income" fill="#10b981" radius={[6, 6, 0, 0]} maxBarSize={28} {...anim} />
        <Bar dataKey="expenses" name="Expenses" fill="#f43f5e" radius={[6, 6, 0, 0]} maxBarSize={28} {...anim} animationBegin={anim.isAnimationActive ? 120 : 0} />
      </BarChart>
    </ResponsiveContainer>
  );
}
