'use client';
import { useState, useEffect, useCallback } from 'react';
import { Receipt, Landmark, ArrowRight, CircleDollarSign } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { ensureResources } from '@/lib/client/store';
import { formatCurrency } from '@/lib/utils';
import { totalOwed, isRealPool, poolProgress } from '@/lib/funding';
import type { Funding, Transaction } from '@/types';

export function FundingWidget() {
  const [fundings, setFundings] = useState<Funding[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await ensureResources(['funding', 'transactions']);
      setFundings(data.funding);
      setTransactions(data.transactions);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!ready) return null;

  const active = fundings.filter((f) => !f.closed);
  const tabs = active.filter((f) => !isRealPool(f));
  const vaults = active.filter((f) => isRealPool(f));

  const totalOwedAll = tabs.reduce((s, f) => s + totalOwed(f), 0);
  const outstandingTabs = tabs.filter((f) => totalOwed(f) > 0);
  const activeVaults = vaults.filter((f) => f.target && f.target > 0);

  if (active.length === 0) return null;

  return (
    <a href="/funding" className="block">
      <Card className="hover:shadow-md transition-shadow cursor-pointer">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center">
              <CircleDollarSign className="w-4 h-4 text-indigo-500" />
            </div>
            <p className="text-sm font-bold text-slate-700 dark:text-slate-300">Group Money</p>
          </div>
          <ArrowRight className="w-4 h-4 text-slate-400 dark:text-slate-500" />
        </div>

        <div className="space-y-3">
          {/* Group Tabs summary */}
          {tabs.length > 0 && (
            <div className="rounded-xl bg-indigo-50/60 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800/40 px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <Receipt className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                  <span className="text-xs font-bold text-slate-600 dark:text-slate-300">
                    {tabs.length} Group {tabs.length === 1 ? 'Tab' : 'Tabs'}
                  </span>
                </div>
                {totalOwedAll > 0 ? (
                  <span className="text-sm font-extrabold text-indigo-600 dark:text-indigo-400">
                    {formatCurrency(totalOwedAll)} owed
                  </span>
                ) : (
                  <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">All settled ✓</span>
                )}
              </div>
              {outstandingTabs.length > 0 && (
                <div className="mt-2 space-y-1">
                  {outstandingTabs.slice(0, 2).map((f) => (
                    <div key={f.id} className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-slate-500 dark:text-slate-400 truncate">{f.description}</span>
                      <span className="text-xs font-bold text-amber-600 dark:text-amber-400 shrink-0">{formatCurrency(totalOwed(f))}</span>
                    </div>
                  ))}
                  {outstandingTabs.length > 2 && (
                    <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500">+{outstandingTabs.length - 2} more</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Group Vaults summary */}
          {activeVaults.length > 0 && (
            <div className="rounded-xl bg-emerald-50/60 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800/40 px-3 py-2.5">
              <div className="flex items-center gap-1.5 mb-2">
                <Landmark className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                <span className="text-xs font-bold text-slate-600 dark:text-slate-300">
                  {activeVaults.length} Group {activeVaults.length === 1 ? 'Vault' : 'Vaults'}
                </span>
              </div>
              <div className="space-y-2">
                {activeVaults.slice(0, 2).map((f) => {
                  const pct = poolProgress(f.totalContributed, f.target) ?? 0;
                  return (
                    <div key={f.id}>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 truncate">{f.description}</span>
                        <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 shrink-0">{Math.round(pct * 100)}%</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${pct >= 1 ? 'bg-emerald-500' : 'bg-indigo-500'}`}
                          style={{ width: `${Math.min(100, Math.max(0, pct * 100))}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Vaults without goals */}
          {vaults.length > activeVaults.length && (
            <div className="flex items-center gap-1.5">
              <Landmark className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                {vaults.filter((f) => !f.target).length} vault{vaults.filter((f) => !f.target).length !== 1 ? 's' : ''} saving
              </span>
            </div>
          )}
        </div>
      </Card>
    </a>
  );
}
