'use client';
import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Collapsible } from './Collapsible';

type Props = {
  /** Tinted icon tile (pass a lucide glyph). */
  icon?: ReactNode;
  /** Tailwind classes for the icon tile background/text. */
  iconWrapClass?: string;
  title: string;
  subtitle?: string;
  /** Optional trailing element on the header row (e.g. a count badge). */
  badge?: ReactNode;
  /** Whether the body starts expanded. Defaults to collapsed. */
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
};

/**
 * A self-contained card whose body collapses behind a clickable header. Matches
 * the surface styling of `Card` and reuses `Collapsible` for the smooth height
 * animation. Used for advisory/insight sections (unbudgeted spending, budget
 * reality check, detected subscriptions) so they don't crowd the page until the
 * user opens them.
 */
export function ExpandableCard({
  icon, iconWrapClass, title, subtitle, badge, defaultOpen = false, children, className,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={cn('rounded-3xl bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700/60 shadow-sm', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-3 p-5 sm:p-6 text-left"
      >
        {icon && (
          <div className={cn('w-10 h-10 rounded-2xl flex items-center justify-center shrink-0', iconWrapClass ?? 'bg-slate-50 dark:bg-slate-700/50 text-slate-600 dark:text-slate-300')}>
            {icon}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <span className="truncate">{title}</span>
            {badge}
          </p>
          {subtitle && <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>}
        </div>
        <ChevronDown className={cn('w-5 h-5 text-slate-400 dark:text-slate-500 shrink-0 transition-transform duration-300', open && 'rotate-180')} />
      </button>
      <Collapsible open={open}>
        <div className="px-5 sm:px-6 pb-6 -mt-1">{children}</div>
      </Collapsible>
    </div>
  );
}
