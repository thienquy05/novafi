'use client';
import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowDownLeft, ArrowUpRight, Receipt } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import { FitText } from '@/components/ui/FitText';
import { useIsDark } from '@/hooks/useIsDark';
import { useTranslation } from '@/lib/i18n/context';
import { HEATMAP_SCALE, HEATMAP_SCALE_DARK } from '@/lib/colors';
import { Haptics } from '@/lib/haptics';

export type HeatmapBill = { name: string; amount: number };
export type HeatmapDay = {
  date: string;
  /** Expense total — drives the heat tint. */
  total: number;
  /** Income received that day. */
  income?: number;
  /** Bills due that day (your share). */
  bills?: HeatmapBill[];
};

/**
 * Month calendar that folds three signals into one grid: each day's tint scales
 * with spending, an emerald dot marks income, and an amber dot marks bills due
 * (past or upcoming) so cash-flow crunch days surface early. Tap a day for its
 * full breakdown; with nothing selected the footer shows the month's income vs.
 * expense at a glance.
 */
export function SpendingHeatmap({ days, todayIso }: { days: HeatmapDay[]; todayIso: string }) {
  const { t, lang } = useTranslation();
  const dark = useIsDark();
  const scale = dark ? HEATMAP_SCALE_DARK : HEATMAP_SCALE;
  const [selected, setSelected] = useState<string | null>(null);

  const { max, monthExpense, monthIncome, noSpendDays, leadBlanks, weekdayLabels } = useMemo(() => {
    const max = days.reduce((m, d) => Math.max(m, d.total), 0);
    const monthExpense = days.reduce((s, d) => s + d.total, 0);
    const monthIncome = days.reduce((s, d) => s + (d.income ?? 0), 0);
    // Days up to today with zero spending — a gentle "spend-free" tally.
    const noSpendDays = days.filter((d) => d.total <= 0 && d.date <= todayIso).length;
    // Align day 1 under its weekday column (0 = Sunday).
    const firstWeekday = days.length ? new Date(days[0].date + 'T00:00:00').getDay() : 0;
    // Localized single-letter weekday headers (Sun..Sat).
    const fmt = new Intl.DateTimeFormat(lang === 'vi' ? 'vi-VN' : 'en-US', { weekday: 'narrow' });
    const weekdayLabels = Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2023, 0, 1 + i)));
    return { max, monthExpense, monthIncome, noSpendDays, leadBlanks: firstWeekday, weekdayLabels };
  }, [days, todayIso, lang]);

  // sqrt curve spreads low/medium days out instead of bunching them near 0.
  const bucket = (total: number) => {
    if (total <= 0 || max <= 0) return 0;
    return Math.min(5, 1 + Math.floor(Math.sqrt(total / max) * 4.999));
  };

  const selectedDay = selected ? days.find((d) => d.date === selected) ?? null : null;
  const monthNet = monthIncome - monthExpense;

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
          const hasIncome = (d.income ?? 0) > 0;
          const hasBills = (d.bills?.length ?? 0) > 0;
          const labelParts = [`${formatDate(d.date)}: ${formatCurrency(d.total)}`];
          if (hasIncome) labelParts.push(`${t('heatmap.income')} ${formatCurrency(d.income!)}`);
          if (hasBills) labelParts.push(`${d.bills!.length} ${t('heatmap.billsDue')}`);
          return (
            <motion.button
              key={d.date}
              type="button"
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: isFuture ? 0.5 : 1, scale: 1 }}
              transition={{ delay: Math.min(i * 0.008, 0.25), type: 'spring', stiffness: 500, damping: 30 }}
              onClick={() => { Haptics.light(); setSelected(isSelected ? null : d.date); }}
              aria-label={labelParts.join(' · ')}
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
              {/* Income / bill markers */}
              {(hasIncome || hasBills) && (
                <span className="absolute bottom-[3px] left-0 right-0 flex justify-center gap-[3px]">
                  {hasIncome && <span className="w-[5px] h-[5px] rounded-full bg-emerald-500 shadow-sm" />}
                  {hasBills && <span className="w-[5px] h-[5px] rounded-full bg-amber-500 shadow-sm" />}
                </span>
              )}
            </motion.button>
          );
        })}
      </div>

      {/* Detail / summary footer */}
      <div className="mt-auto pt-4">
        {selectedDay ? (
          <div className="rounded-xl bg-slate-50 dark:bg-slate-700/50 border border-slate-100 dark:border-slate-700/60 p-3">
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400 mb-1.5">{formatDate(selectedDay.date)}</p>
            <div className="space-y-1.5">
              <DetailRow
                icon={<ArrowUpRight className="w-3.5 h-3.5 text-rose-500" />}
                label={t('heatmap.spent')}
                value={selectedDay.total > 0 ? formatCurrency(selectedDay.total) : t('heatmap.noSpend')}
                valueClass={selectedDay.total > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400 dark:text-slate-500'}
              />
              {(selectedDay.income ?? 0) > 0 && (
                <DetailRow
                  icon={<ArrowDownLeft className="w-3.5 h-3.5 text-emerald-500" />}
                  label={t('heatmap.income')}
                  value={formatCurrency(selectedDay.income!)}
                  valueClass="text-emerald-600 dark:text-emerald-400"
                />
              )}
              {(selectedDay.bills ?? []).map((bill, i) => (
                <DetailRow
                  key={i}
                  icon={<Receipt className="w-3.5 h-3.5 text-amber-500" />}
                  label={bill.name}
                  value={formatCurrency(bill.amount)}
                  valueClass="text-amber-600 dark:text-amber-400"
                />
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-stretch gap-2">
              <SummaryStat label={t('heatmap.income')} value={formatCurrency(monthIncome)} tone="emerald" />
              <SummaryStat label={t('heatmap.spent')} value={formatCurrency(monthExpense)} tone="rose" />
              <SummaryStat
                label={t('heatmap.net')}
                value={`${monthNet >= 0 ? '+' : ''}${formatCurrency(monthNet)}`}
                tone={monthNet >= 0 ? 'indigo' : 'rose'}
              />
            </div>
            {noSpendDays > 0 && (
              <p className="text-center text-[11px] font-semibold text-slate-400 dark:text-slate-500 mt-2">
                {t('heatmap.noSpendDays', { n: noSpendDays })}
              </p>
            )}
          </>
        )}

        {/* Marker legend */}
        <div className="flex items-center justify-center gap-4 mt-3">
          <span className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 dark:text-slate-500">
            <span className="w-[6px] h-[6px] rounded-full bg-emerald-500" />{t('heatmap.income')}
          </span>
          <span className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 dark:text-slate-500">
            <span className="w-[6px] h-[6px] rounded-full bg-amber-500" />{t('heatmap.billsDue')}
          </span>
          <span className="flex items-center gap-1 text-[10px] font-bold text-slate-400 dark:text-slate-500">
            {t('heatmap.less')}
            {scale.map((c, i) => (
              <span key={i} className="w-2.5 h-2.5 rounded-[3px]" style={{ backgroundColor: c }} />
            ))}
            {t('heatmap.more')}
          </span>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ icon, label, value, valueClass }: { icon: React.ReactNode; label: string; value: string; valueClass: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-1.5 min-w-0">
        {icon}
        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 truncate">{label}</span>
      </span>
      <span className={`text-xs font-extrabold shrink-0 ${valueClass}`}>{value}</span>
    </div>
  );
}

function SummaryStat({ label, value, tone }: { label: string; value: string; tone: 'emerald' | 'rose' | 'indigo' }) {
  const toneClass =
    tone === 'emerald' ? 'text-emerald-600 dark:text-emerald-400'
    : tone === 'rose' ? 'text-rose-600 dark:text-rose-400'
    : 'text-indigo-600 dark:text-indigo-400';
  return (
    <div className="flex-1 min-w-0 rounded-xl bg-slate-50 dark:bg-slate-700/50 border border-slate-100 dark:border-slate-700/60 px-2.5 py-2 text-center">
      <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider truncate">{label}</p>
      {/* FitText shrinks the amount instead of ellipsizing it, so sign + number
          always read as one piece on narrow phones. */}
      <FitText maxSize={14} minSize={10} className={`font-extrabold mt-0.5 font-display ${toneClass}`}>{value}</FitText>
    </div>
  );
}
