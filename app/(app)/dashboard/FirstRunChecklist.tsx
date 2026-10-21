'use client';
import { useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Circle, ChevronRight, X, Rocket } from 'lucide-react';
import { Card, CardIcon } from '@/components/ui/Card';
import { useTranslation } from '@/lib/i18n/context';
import { ONBOARD_COOKIE } from '@/lib/dashboardLayout';


export type ChecklistStep = { key: string; label: string; done: boolean; href: string };

/**
 * First-run checklist on Home (account → transaction → budget → goal). Rendered
 * by the server only while a step is open and the user hasn't hidden it.
 */
export function FirstRunChecklist({ steps }: { steps: ChecklistStep[] }) {
  const { t } = useTranslation();
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  const done = steps.filter((s) => s.done).length;

  function hide() {
    document.cookie = `${ONBOARD_COOKIE}=1; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    setHidden(true);
  }

  return (
    <Card tone="indigo">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3 min-w-0">
          <CardIcon tone="indigo"><Rocket className="w-5 h-5" /></CardIcon>
          <div className="min-w-0">
            <p className="text-base font-extrabold text-slate-900 dark:text-slate-100">{t('dashboard.onboardTitle')}</p>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5">{t('dashboard.onboardSub', { done, total: steps.length })}</p>
          </div>
        </div>
        <button onClick={hide} aria-label={t('dashboard.onboardDismiss')} title={t('dashboard.onboardDismiss')} className="hit-area p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 shrink-0">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden mb-3" aria-hidden>
        <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${(done / steps.length) * 100}%` }} />
      </div>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {steps.map((s) => (
          <li key={s.key}>
            <Link
              href={s.href}
              className={`flex items-center gap-2.5 p-3 rounded-2xl border transition-colors ${s.done ? 'border-emerald-100 dark:border-emerald-800/40 bg-emerald-50/50 dark:bg-emerald-900/10' : 'border-slate-100 dark:border-slate-700/60 bg-white dark:bg-slate-800 hover:border-indigo-200 dark:hover:border-indigo-700/60'}`}
            >
              {s.done
                ? <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                : <Circle className="w-5 h-5 text-slate-300 dark:text-slate-600 shrink-0" />}
              <span className={`flex-1 min-w-0 text-sm font-bold wrap-anywhere ${s.done ? 'text-slate-400 dark:text-slate-500 line-through' : 'text-slate-800 dark:text-slate-100'}`}>{s.label}</span>
              {!s.done && <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
