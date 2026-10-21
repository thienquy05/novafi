'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronUp, ChevronDown, LayoutGrid } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/lib/toast';
import { useTranslation } from '@/lib/i18n/context';
import { serializeDashboardLayout, type DashboardCardId, type DashboardCardState } from '@/lib/dashboardLayout';

const LABEL_KEY: Record<DashboardCardId, string> = {
  calendar: 'dashboard.cardCalendar',
  balances: 'dashboard.cardBalances',
  credit: 'dashboard.cardCredit',
  netWorth: 'dashboard.cardNetWorth',
  cashFlow: 'dashboard.cardCashFlow',
  health: 'dashboard.cardHealth',
  budgetsGoals: 'dashboard.cardBudgetsGoals',
  billsRecent: 'dashboard.cardBillsRecent',
};

/**
 * "Customize Home": show/hide and reorder the dashboard card groups. Saved to the
 * account (settings.dashboardLayout via PATCH /api/settings), then the server
 * page re-renders in the new order.
 */
export function DashboardCustomizer({ layout }: { layout: DashboardCardState[] }) {
  const { t } = useTranslation();
  const toast = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [cards, setCards] = useState(layout);
  const [saving, setSaving] = useState(false);
  const [, startTransition] = useTransition();

  function openModal() { setCards(layout); setOpen(true); }
  function move(i: number, dir: -1 | 1) {
    setCards((prev) => {
      const next = [...prev];
      [next[i], next[i + dir]] = [next[i + dir], next[i]];
      return next;
    });
  }
  async function save(next: string[]) {
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({ list: 'dashboardLayout', set: next }),
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error();
      setOpen(false);
      toast(t('dashboard.layoutSaved'), 'success');
      startTransition(() => router.refresh());
    } catch {
      toast(t('dashboard.layoutFailed'), 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="flex justify-center">
        <Button variant="ghost" size="sm" onClick={openModal} className="text-slate-500 dark:text-slate-400">
          <LayoutGrid className="w-4 h-4" />
          {t('dashboard.customize')}
        </Button>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={t('dashboard.customize')}>
        <p className="text-sm font-medium text-slate-500 dark:text-slate-400 -mt-1 mb-4">{t('dashboard.customizeHint')}</p>
        <ul className="space-y-2 pb-4">
          {cards.map((c, i) => (
            <li key={c.id} className="flex items-center gap-2 p-3 rounded-2xl bg-slate-50 dark:bg-slate-700/40 border border-slate-100 dark:border-slate-700/60">
              <button
                type="button"
                role="switch"
                aria-checked={c.visible}
                aria-label={t(LABEL_KEY[c.id])}
                onClick={() => setCards((prev) => prev.map((x) => (x.id === c.id ? { ...x, visible: !x.visible } : x)))}
                className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${c.visible ? 'bg-indigo-600' : 'bg-slate-200 dark:bg-slate-600'}`}
              >
                <span className={`inline-block h-5 w-5 rounded-full bg-white dark:bg-slate-800 shadow transition-transform ${c.visible ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
              <span className={`flex-1 min-w-0 text-sm font-bold truncate ${c.visible ? 'text-slate-800 dark:text-slate-100' : 'text-slate-400 dark:text-slate-500'}`}>
                {t(LABEL_KEY[c.id])}
              </span>
              <button type="button" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`${t('dashboard.moveUp')}: ${t(LABEL_KEY[c.id])}`} className="hit-area p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-30">
                <ChevronUp className="w-4 h-4" />
              </button>
              <button type="button" disabled={i === cards.length - 1} onClick={() => move(i, 1)} aria-label={`${t('dashboard.moveDown')}: ${t(LABEL_KEY[c.id])}`} className="hit-area p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-30">
                <ChevronDown className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>
        <div className="sticky bottom-0 bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700/60 -mx-6 sm:-mx-8 px-6 sm:px-8 py-4 flex gap-3">
          <Button variant="secondary" className="flex-1" disabled={saving} onClick={() => save([])}>{t('dashboard.resetLayout')}</Button>
          <Button className="flex-1" disabled={saving} onClick={() => save(serializeDashboardLayout(cards))}>{saving ? t('common.saving') : t('common.save')}</Button>
        </div>
      </Modal>
    </>
  );
}
