'use client';
import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { formatCurrency, formatDate } from '@/lib/utils';
import { useIsDark } from '@/hooks/useIsDark';
import { useTranslation } from '@/lib/i18n/context';
import { HEATMAP_SCALE, HEATMAP_SCALE_DARK } from '@/lib/colors';
import { Haptics } from '@/lib/haptics';

export type HeatmapDay = { date: string; total: number };

/**
 * GitHub-style month grid where each day's tint scales with how much was spent.
 * Answers "when did I spend" to complement the pie's "what did I spend on".
 * Tap a day (mobile-first) to see its exact total below the grid.
 */
export function SpendingHeatmap({ days, todayIso }: { days: HeatmapDay[]; todayIso: string }) {
  const { t, lang } = useTranslation();
  const dark = useIsDark();
  const scale = dark ? HEATMAP_SCALE_DARK : HEATMAP_SCALE;
  const [selected, setSelected] = useState<string | null>(null);

  const { max, monthTotal, noSpendDays, leadBlanks, weekdayLabels } = useMemo(() => {
    const max = days.reduce((m, d) => Math.max(m, d.total), 0);
    const monthTotal = days.reduce((s, d) => s + d.total, 0);
    const noSpendDays = days.filter((d) => d.total <= 0 && d.date <= todayIso).length;
    // Align day 1 under its weekday column (0 = Sunday).
    const firstWeekday = days.length ? new Date(days[0].date + 'T00:00:00').getDay() : 0;
    // Localized single-letter weekday headers (Sun..Sat).
    const fmt = new Intl.DateTimeFormat(lang === 'vi' ? 'vi-VN' : 'en-US', { weekday: 'narrow' });
    const weekdayLabels = Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2023, 0, 1 + i)));
    return { max, monthTotal, noSpendDays, leadBlanks: firstWeekday, weekdayLabels };
  }, [days, todayIso, lang]);

  // sqrt curve spreads low/medium days out instead of bunching them near 0.
  const bucket = (total: number) => {
    if (total <= 0 || max <= 0) return 0;
    return Math.min(5, 1 + Math.floor(Math.sqrt(total / max) * 4.999));
  };

  const selectedDay = selected ? days.find((d) => d.date === selected) ?? null : null;

  return (
    <div className="flex flex-col h-full">
      {/* Weekday header */}
      <div className="grid grid-cols-7 gap-1.5 mb-1.5">
        {weekdayLabels.map((w, i) => (
          <div key={i} className="text-center text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase">
            {w}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-1.5">
        {Array.from({ length: leadBlanks }).map((_, i) => (
          <div key={`blank-${i}`} />
        ))}
        {days.map((d, i) => {
          const b = bucket(d.total);
          const isFuture = d.date > todayIso;
          const isToday = d.date === todayIso;
          const isSelected = d.date === selected;
          const dayNum = Number(d.date.slice(8, 10));
          return (
            <motion.button
              key={d.date}
              type="button"
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: isFuture ? 0.4 : 1, scale: 1 }}
              transition={{ delay: Math.min(i * 0.008, 0.25), type: 'spring', stiffness: 500, damping: 30 }}
              onClick={() => { Haptics.light(); setSelected(isSelected ? null : d.date); }}
              aria-label={`${formatDate(d.date)}: ${formatCurrency(d.total)}`}
              className={`relative aspect-square rounded-[7px] flex items-center justify-center text-[10px] font-bold tap-highlight-none transition-shadow ${
                isToday ? 'ring-2 ring-indigo-500 ring-offset-1 ring-offset-white dark:ring-offset-slate-800' : ''
              } ${isSelected ? 'shadow-md scale-105' : ''} ${
                isFuture ? 'border border-dashed border-slate-200 dark:border-slate-700' : ''
              }`}
              style={{ backgroundColor: isFuture ? 'transparent' : scale[b] }}
            >
              <span className={b >= 4 && !isFuture ? 'text-white/90' : 'text-slate-500 dark:text-slate-400'}>
                {dayNum}
              </span>
            </motion.button>
          );
        })}
      </div>

      {/* Detail / legend footer */}
      <div className="mt-auto pt-4 flex items-end justify-between gap-3">
        <div className="min-w-0">
          {selectedDay ? (
            <>
              <p className="text-xs font-bold text-slate-500 dark:text-slate-400">{formatDate(selectedDay.date)}</p>
              <p className="text-base font-extrabold text-slate-900 dark:text-slate-100 font-display">
                {selectedDay.total > 0 ? formatCurrency(selectedDay.total) : t('heatmap.noSpend')}
              </p>
            </>
          ) : (
            <>
              <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
                {t('heatmap.noSpendDays', { n: noSpendDays })}
              </p>
              <p className="text-base font-extrabold text-slate-900 dark:text-slate-100 font-display">
                {formatCurrency(monthTotal)}
              </p>
            </>
          )}
        </div>
        {/* Less → More legend */}
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500">{t('heatmap.less')}</span>
          {scale.map((c, i) => (
            <span key={i} className="w-3 h-3 rounded-[3px]" style={{ backgroundColor: c }} />
          ))}
          <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500">{t('heatmap.more')}</span>
        </div>
      </div>
    </div>
  );
}
