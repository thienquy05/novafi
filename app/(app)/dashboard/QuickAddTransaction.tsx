'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { generateId, today, formatCurrency } from '@/lib/utils';
import { evaluatePaymentSafety, isOverdraftAssessable } from '@/lib/calculations';
import type { Account, Bill, Transaction } from '@/types';
import { useCategories } from '@/hooks/useCategories';
import { useTranslation } from '@/lib/i18n/context';
import { Haptics } from '@/lib/haptics';
import { useToast } from '@/lib/toast';

const EMPTY_FORM = {
  date: today(),
  description: '',
  amount: '',
  type: 'expense' as Transaction['type'],
  category: 'Food',
  account: '',
  toAccount: '',
};

type QuickAddVariant = 'header' | 'fab' | 'sidebar' | 'navFab';

export function QuickAddTransaction({ accounts: accountsProp, bills: billsProp, variant = 'header' }: { accounts?: Account[]; bills?: Bill[]; variant?: QuickAddVariant }) {
  const router = useRouter();
  const { t } = useTranslation();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>(accountsProp ?? []);
  const [bills, setBills] = useState<Bill[]>(billsProp ?? []);
  const { expenseCategories, incomeCategories } = useCategories();

  // Keep in sync when a parent supplies accounts (e.g. dashboard server data).
  useEffect(() => { if (accountsProp) setAccounts(accountsProp); }, [accountsProp]);
  useEffect(() => { if (billsProp) setBills(billsProp); }, [billsProp]);

  // Persistent nav usage (sidebar / bottom bar) gets no accounts prop — fetch
  // them lazily the first time the modal is opened. The nav stays mounted across
  // navigations, so this runs at most once per session (like useBadges). Bills are
  // fetched alongside so the low-balance safeguard can warn before a payment.
  useEffect(() => {
    if (!open || accountsProp || accounts.length > 0) return;
    fetch('/api/accounts')
      .then((r) => r.json())
      .then((data: Account[]) => setAccounts(data))
      .catch(() => {});
  }, [open, accountsProp, accounts.length]);

  useEffect(() => {
    if (!open || billsProp || bills.length > 0) return;
    fetch('/api/bills')
      .then((r) => r.json())
      .then((data: Bill[]) => setBills(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [open, billsProp, bills.length]);

  const categories = form.type === 'expense' ? expenseCategories : incomeCategories;

  // Payment safeguard: for a spend leaving the selected account (an expense, or
  // the FROM side of a transfer), check whether it would breach that account's
  // safety line once upcoming bills are accounted for. Covers every assessable
  // account — deposit accounts (overdraft / below buffer) and credit cards with a
  // limit (over the credit limit) — so the warning fires however the spend is
  // entered, matching the dashboard prediction alert.
  const safety = (() => {
    if (form.type === 'income') return null;
    const amount = parseFloat(form.amount) || 0;
    if (!form.account || amount <= 0) return null;
    const account = accounts.find((a) => a.id === form.account);
    if (!account || !isOverdraftAssessable(account)) return null;
    const result = evaluatePaymentSafety({ account, amount, bills });
    return result.status === 'ok' ? null : result;
  })();

  function handleTypeChange(type: Transaction['type']) {
    if (type === 'transfer') {
      setForm((f) => ({ ...f, type, category: 'Transfer' }));
      return;
    }
    const newCategory = type === 'expense' ? (expenseCategories[0] ?? 'Food') : (incomeCategories[0] ?? 'Paycheck');
    setForm((f) => ({ ...f, type, category: newCategory }));
  }

  function handleClose() {
    setOpen(false);
    setForm(EMPTY_FORM);
  }

  async function handleSave() {
    if (!form.amount || !form.account) return;
    if (form.type === 'transfer' && !form.toAccount) return;
    setSaving(true);
    const tx: Transaction = {
      id: generateId(),
      date: form.date,
      description: form.description,
      amount: parseFloat(form.amount) || 0,
      type: form.type,
      category: form.type === 'transfer' ? 'Transfer' : form.category,
      account: form.account,
      toAccount: form.type === 'transfer' ? form.toAccount : undefined,
      createdAt: new Date().toISOString(),
    };

    try {
      const res = await fetch('/api/transactions', {
        method: 'POST',
        body: JSON.stringify(tx),
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error();
      Haptics.success();
      toast(t('transactions.toastAdded'), 'success');
      // Badge/notification invalidation is handled by the global write-guard in
      // lib/client/store (fires on every successful API write).
    } catch {
      toast(t('transactions.toastFailedSave'), 'error');
    }
    handleClose();
    setSaving(false);
    router.refresh();
  }

  return (
    <>
      {variant === 'sidebar' ? (
        <button
          onClick={() => setOpen(true)}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm shadow-sm transition-colors duration-150 tap-highlight-none"
        >
          <Plus className="w-4 h-4" />
          {t('quickAdd.quickAddBtn')}
        </button>
      ) : variant === 'navFab' ? (
        <button
          onClick={() => setOpen(true)}
          aria-label={t('quickAdd.quickAddBtn')}
          className="flex items-center justify-center w-14 h-14 -mt-7 shrink-0 rounded-full bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white shadow-[0_6px_20px_rgba(79,70,229,0.45)] transition-all duration-150 tap-highlight-none"
        >
          <Plus className="w-7 h-7" />
        </button>
      ) : variant === 'fab' ? (
        <Button
          onClick={() => { Haptics.light(); setOpen(true); }}
          size="icon"
          aria-label={t('quickAdd.quickAddBtn')}
          className="h-14 w-14 rounded-full shadow-[0_8px_30px_rgb(79,70,229,0.3)] bg-indigo-600 hover:bg-indigo-700 text-white"
        >
          <Plus className="w-6 h-6" />
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)} size="md" className="hidden md:flex">
          <Plus className="w-4 h-4" />
          {t('quickAdd.quickAddBtn')}
        </Button>
      )}

      <Modal open={open} onClose={handleClose} title={t('quickAdd.title')}>
        <div className="space-y-4 pb-4">
          {/* Expense / Income / Transfer toggle */}
          <div className="flex p-1.5 rounded-2xl bg-slate-100 dark:bg-slate-700">
            {(['expense', 'income', 'transfer'] as const).map((tp) => (
              <button
                key={tp}
                onClick={() => handleTypeChange(tp)}
                className={`flex-1 py-2.5 text-sm font-bold rounded-xl transition-all duration-200 ${
                  form.type === tp
                    ? tp === 'expense'
                      ? 'bg-white dark:bg-slate-800 text-rose-600 dark:text-rose-400 shadow-sm'
                      : tp === 'income'
                        ? 'bg-white dark:bg-slate-800 text-emerald-600 dark:text-emerald-400 shadow-sm'
                        : 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
              >
                {tp === 'expense' ? t('quickAdd.expenseLabel') : tp === 'income' ? t('quickAdd.incomeLabel') : t('common.transfer')}
              </button>
            ))}
          </div>

          {/* Amount */}
          <div>
            <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-1.5">
              {t('quickAdd.amountLabel')}
            </label>
            <div className="relative flex items-center">
              <span className="absolute left-4 text-2xl font-bold text-slate-400 dark:text-slate-500 pointer-events-none select-none">$</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                className="w-full pl-10 pr-4 py-3.5 text-2xl font-extrabold text-slate-900 dark:text-slate-100 placeholder-slate-300 bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-700 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Date + Description */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label={t('common.date')}
              type="date"
              value={form.date}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
            />
            <Input
              label={t('common.description')}
              placeholder={t('transactions.phDescription')}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>

          {/* Category + Account (or From/To for transfers) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {form.type !== 'transfer' && (
              <Select
                label={t('common.category')}
                value={form.category}
                options={categories.map((c) => ({ value: c, label: c }))}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              />
            )}
            <Select
              label={form.type === 'transfer' ? t('transactions.fromAccount') : t('common.account')}
              value={form.account}
              options={[
                { value: '', label: t('common.selectPlaceholder') },
                ...accounts.filter((a) => a.type !== 'pool').map((a) => ({ value: a.id, label: a.name })),
              ]}
              onChange={(e) => setForm((f) => ({ ...f, account: e.target.value }))}
            />
            {form.type === 'transfer' && (
              <Select
                label={t('transactions.toAccount')}
                value={form.toAccount}
                options={[
                  { value: '', label: t('common.selectPlaceholder') },
                  ...accounts.filter((a) => a.id !== form.account && a.type !== 'pool').map((a) => ({ value: a.id, label: a.name })),
                ]}
                onChange={(e) => setForm((f) => ({ ...f, toAccount: e.target.value }))}
              />
            )}
          </div>

          {/* Payment safeguard — warns before the spend overdraws a deposit
              account, eats into the buffer you set, or runs a credit card past
              its limit. `severe` (overdraft / over-limit) shows red, a buffer dip
              shows amber. */}
          {safety && (() => {
            const severe = safety.status === 'overdraft' || safety.status === 'overLimit';
            const title =
              safety.status === 'overdraft' ? t('quickAdd.safeguardOverdraftTitle')
              : safety.status === 'overLimit' ? t('quickAdd.safeguardOverLimitTitle')
              : t('quickAdd.safeguardBufferTitle');
            const detail = safety.kind === 'credit'
              ? (safety.upcomingTotal > 0
                  ? t('quickAdd.safeguardCreditDetailWithBills', { projected: formatCurrency(safety.projectedBalance), limit: formatCurrency(safety.threshold), bills: formatCurrency(safety.upcomingTotal) })
                  : t('quickAdd.safeguardCreditDetail', { projected: formatCurrency(safety.projectedBalance), limit: formatCurrency(safety.threshold) }))
              : (safety.upcomingTotal > 0
                  ? t('quickAdd.safeguardDetailWithBills', { projected: formatCurrency(safety.projectedBalance), bills: formatCurrency(safety.upcomingTotal) })
                  : t('quickAdd.safeguardDetail', { projected: formatCurrency(safety.projectedBalance) }));
            return (
              <div className={`flex items-start gap-3 px-4 py-3 rounded-2xl border ${
                severe
                  ? 'bg-rose-50 dark:bg-rose-900/30 border-rose-200 dark:border-rose-800/50'
                  : 'bg-amber-50 dark:bg-amber-900/30 border-amber-200 dark:border-amber-800/50'
              }`}>
                <AlertTriangle className={`w-5 h-5 shrink-0 mt-0.5 ${severe ? 'text-rose-500 dark:text-rose-400' : 'text-amber-500 dark:text-amber-400'}`} />
                <div className="min-w-0">
                  <p className={`text-sm font-bold ${severe ? 'text-rose-700 dark:text-rose-300' : 'text-amber-700 dark:text-amber-300'}`}>
                    {title}
                  </p>
                  <p className={`text-xs font-medium mt-0.5 ${severe ? 'text-rose-600 dark:text-rose-400' : 'text-amber-600 dark:text-amber-400'}`}>
                    {detail}
                    {safety.status === 'belowBuffer' ? ` ${t('quickAdd.safeguardBufferNote', { buffer: formatCurrency(safety.threshold) })}` : ''}
                  </p>
                </div>
              </div>
            );
          })()}
        </div>

        <div className="sticky bottom-0 bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700/60 -mx-6 sm:-mx-8 px-6 sm:px-8 py-4">
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={handleClose}>
              {t('common.cancel')}
            </Button>
            <Button
              className="flex-1"
              onClick={handleSave}
              disabled={saving || !form.amount || !form.account || (form.type === 'transfer' && !form.toAccount)}
            >
              {saving ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
