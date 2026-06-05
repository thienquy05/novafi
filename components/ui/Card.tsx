import { cn } from '@/lib/utils';
import { HTMLAttributes } from 'react';

/** Accent tones for cards and their icon tiles. `default` = neutral slate. */
export type CardTone = 'default' | 'emerald' | 'rose' | 'amber' | 'purple' | 'indigo';

// Full class strings per tone — Tailwind v4 still needs literal class names, so
// these can't be templated from a variable.
const TONE_BORDER: Record<CardTone, string> = {
  default: 'border-slate-100 dark:border-slate-700/60 hover:border-slate-200 dark:hover:border-slate-600',
  emerald: 'border-emerald-100 dark:border-emerald-800/50 hover:border-emerald-200 dark:hover:border-emerald-700',
  rose: 'border-rose-100 dark:border-rose-800/50 hover:border-rose-200 dark:hover:border-rose-700',
  amber: 'border-amber-100 dark:border-amber-800/50 hover:border-amber-200 dark:hover:border-amber-700',
  purple: 'border-purple-100 dark:border-purple-800/50 hover:border-purple-200 dark:hover:border-purple-700',
  indigo: 'border-indigo-100 dark:border-indigo-800/50 hover:border-indigo-200 dark:hover:border-indigo-700',
};

const TONE_TILE: Record<CardTone, string> = {
  default: 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-100 dark:border-slate-700/60',
  emerald: 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 border-emerald-100 dark:border-emerald-800/50',
  rose: 'bg-rose-50 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 border-rose-100 dark:border-rose-800/50',
  amber: 'bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 border-amber-100 dark:border-amber-800/50',
  purple: 'bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 border-purple-100 dark:border-purple-800/50',
  indigo: 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 border-indigo-100 dark:border-indigo-800/50',
};

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Accent border tone. Defaults to neutral slate. */
  tone?: CardTone;
}

export function Card({ className, tone = 'default', ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-3xl bg-white dark:bg-slate-800 border p-5 sm:p-7 shadow-sm hover:shadow-md transition-[box-shadow,border-color] duration-200',
        TONE_BORDER[tone],
        className
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-center justify-between mb-5', className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn('text-sm font-bold text-slate-800 dark:text-slate-200 tracking-wide', className)}
      {...props}
    />
  );
}

/**
 * The tinted, rounded icon tile used in card headers throughout the dashboard.
 * Pass a lucide icon as the child with no color class — it inherits the tile's
 * `currentColor`, so one `tone` styles both the tile and the glyph.
 */
export function CardIcon({
  tone = 'indigo',
  className,
  children,
}: {
  tone?: CardTone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'p-2 rounded-xl border flex items-center justify-center shrink-0',
        TONE_TILE[tone],
        className
      )}
    >
      {children}
    </div>
  );
}
