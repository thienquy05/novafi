'use client';
import { useEffect, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { ArrowLeftRight } from 'lucide-react';
import { CategoryIconBadge } from '@/components/CategoryIcon';
import { formatCurrency, formatDate } from '@/lib/utils';

export type RecentTxItem = {
  id: string;
  date: string;
  description: string;
  amount: number;
  type: 'income' | 'expense' | 'transfer';
  category: string;
};

/**
 * Recent-transactions ledger with a receipt slide-in. After a Quick Add logs a
 * transaction, `router.refresh()` re-renders this list with the new row at the
 * top; we detect ids we haven't shown before and slide just those in from above
 * while `layout` springs the older rows gracefully down. Initial page load shows
 * no per-row motion (the section already fades in via StaggerReveal). Honors
 * reduced-motion.
 */
export function RecentTransactions({
  items,
  emptyTitle,
  emptySub,
}: {
  items: RecentTxItem[];
  emptyTitle: string;
  emptySub: string;
}) {
  const reduce = useReducedMotion();
  // `seen` is state (safe to read during render). Seeded with the initial rows so
  // they don't animate on first paint; the effect adds ids that appear later (e.g.
  // a just-logged transaction) and only mutates when something's new, so no loop.
  const [seen, setSeen] = useState<Set<string>>(() => new Set(items.map((i) => i.id)));

  useEffect(() => {
    setSeen((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const i of items) if (!next.has(i.id)) { next.add(i.id); changed = true; }
      return changed ? next : prev;
    });
  }, [items]);

  if (items.length === 0) {
    return (
      <div className="flex items-center gap-4 p-4 rounded-2xl bg-slate-50 dark:bg-slate-700/50 border border-slate-100 dark:border-slate-700/60">
        <div className="w-11 h-11 rounded-full flex items-center justify-center bg-slate-200 dark:bg-slate-600 text-slate-400 dark:text-slate-500">
          <ArrowLeftRight className="w-5 h-5" />
        </div>
        <div>
          <p className="text-sm text-slate-900 dark:text-slate-100 font-bold">{emptyTitle}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-medium">{emptySub}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <AnimatePresence initial={false}>
        {items.map((tx) => {
          const isIncome = tx.type === 'income';
          const isNew = !seen.has(tx.id) && !reduce;
          return (
            <motion.div
              key={tx.id}
              layout
              initial={isNew ? { opacity: 0, y: -18, scale: 0.96 } : false}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              className="flex items-center justify-between p-3.5 rounded-2xl hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors border border-transparent hover:border-slate-100 dark:hover:border-slate-700/60"
            >
              <div className="flex items-center gap-3">
                <CategoryIconBadge category={tx.category} type={tx.type} className="w-11 h-11 rounded-xl" />
                <div>
                  <p className="text-sm text-slate-900 dark:text-slate-100 font-bold">{tx.description || tx.category}</p>
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5">{tx.category} · {formatDate(tx.date)}</p>
                </div>
              </div>
              <span
                className={`text-sm font-extrabold whitespace-nowrap ${isIncome ? 'text-emerald-600 dark:text-emerald-400' : tx.type === 'transfer' ? 'text-blue-600 dark:text-blue-400' : 'text-slate-900 dark:text-slate-100'}`}
              >
                {isIncome ? '+' : tx.type === 'transfer' ? '' : '-'}{formatCurrency(tx.amount)}
              </span>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
