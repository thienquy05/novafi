'use client';
import { Zap, AlertTriangle, TrendingUp, TrendingDown } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n/context';
import type { SpendingPaceItem } from '@/lib/calculations';

// Pure presentational widget (no Recharts). Extracted from DashboardCharts so the
// reports page can import it WITHOUT transitively pulling the Recharts-heavy
// DashboardCharts module into its first-load bundle.
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
