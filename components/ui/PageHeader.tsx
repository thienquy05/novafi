import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';
import type { CardTone } from './Card';

// Mirrors Card's TONE_TILE language, scaled up for the page-level emblem.
// Literal class strings are required by Tailwind v4 (no templating from vars).
const TONE_TILE: Record<CardTone, string> = {
  default: 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-200/70 dark:border-slate-700/60',
  emerald: 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 border-emerald-100 dark:border-emerald-800/50',
  rose: 'bg-rose-50 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 border-rose-100 dark:border-rose-800/50',
  amber: 'bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 border-amber-100 dark:border-amber-800/50',
  purple: 'bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 border-purple-100 dark:border-purple-800/50',
  indigo: 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 border-indigo-100 dark:border-indigo-800/50',
};

/**
 * The shared section-page header: a tinted icon emblem next to a font-display
 * title and subtitle. Gives every section a consistent identity that matches
 * the dashboard's premium look, while each page picks its own icon + accent
 * `tone`. Action buttons/controls go in the `action` slot and float to the
 * right on desktop.
 */
export function PageHeader({
  icon: Icon,
  tone = 'indigo',
  title,
  subtitle,
  action,
  className,
}: {
  icon: LucideIcon;
  tone?: CardTone;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col md:flex-row md:items-center justify-between gap-4', className)}>
      <div className="flex items-center gap-3 sm:gap-4 min-w-0">
        <span
          className={cn(
            'grid place-items-center shrink-0 rounded-2xl border shadow-sm',
            'w-12 h-12 sm:w-14 sm:h-14',
            TONE_TILE[tone],
          )}
        >
          <Icon className="w-6 h-6 sm:w-7 sm:h-7" strokeWidth={2.25} />
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl md:text-4xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100 font-display truncate">
            {title}
          </h1>
          {subtitle && (
            <p className="text-slate-500 dark:text-slate-400 text-sm md:text-base font-medium mt-0.5">{subtitle}</p>
          )}
        </div>
      </div>
      {action && (
        // flex-wrap: three or more actions flow onto a second row on narrow
        // phones instead of pushing past the viewport (which dragged the whole
        // page into horizontal scroll — see Savings' 3-button header).
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 shrink-0 w-full md:w-auto">
          {action}
        </div>
      )}
    </div>
  );
}
