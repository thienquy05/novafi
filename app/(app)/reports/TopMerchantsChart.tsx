'use client';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useReducedMotion } from 'framer-motion';
import { useIsDark } from '@/hooks/useIsDark';
import { formatCurrency, formatAxisCurrency } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n/context';

export type MerchantDatum = { name: string; total: number; count: number };

// Horizontal "top merchants" bar chart. Isolated into its own module so the
// reports page can load Recharts lazily (via lib/dynamicChart) instead of
// carrying it in the route's first-load JS. Count shown in the tooltip.
export default function TopMerchantsChart({ data }: { data: MerchantDatum[] }) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const c = useIsDark()
    ? { grid: '#334155', axis: '#94a3b8', cursor: 'rgba(148, 163, 184, 0.08)', tip: { background: '#1e293b', color: '#f1f5f9', border: '1px solid #334155' } }
    : { grid: '#e2e8f0', axis: '#64748b', cursor: '#f8fafc', tip: { background: '#ffffff', color: '#0f172a', border: '1px solid #e2e8f0' } };
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
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
            const d = payload[0].payload as MerchantDatum;
            return (
              <div className="rounded-2xl px-4 py-3 shadow-xl" style={{ ...c.tip }}>
                <p className="text-sm font-bold capitalize" style={{ color: c.tip.color }}>{d.name}</p>
                <p className="text-base font-extrabold" style={{ color: c.tip.color }}>{formatCurrency(d.total)}</p>
                <p className="text-xs font-medium" style={{ color: c.axis }}>{d.count} {t('reports.transactions')}</p>
              </div>
            );
          }}
        />
        <Bar dataKey="total" fill="#6366f1" radius={[0, 5, 5, 0]} maxBarSize={22} isAnimationActive={!reduce} />
      </BarChart>
    </ResponsiveContainer>
  );
}
