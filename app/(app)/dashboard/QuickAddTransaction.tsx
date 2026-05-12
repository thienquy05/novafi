'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { generateId, today } from '@/lib/utils';
import type { Account, Transaction } from '@/types';
import { useCategories } from '@/hooks/useCategories';
import { useTranslation } from '@/lib/i18n/context';

const EMPTY_FORM = {
  date: today(),
  description: '',
  amount: '',
  type: 'expense' as Transaction['type'],
  category: 'Food',
  account: '',
};

export function QuickAddTransaction({ accounts, isFab }: { accounts: Account[]; isFab?: boolean }) {
  const router = useRouter();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const { expenseCategories, incomeCategories } = useCategories();

  const categories = form.type === 'expense' ? expenseCategories : incomeCategories;

  function handleTypeChange(type: Transaction['type']) {
    const newCategory = type === 'expense' ? (expenseCategories[0] ?? 'Food') : (incomeCategories[0] ?? 'Paycheck');
    setForm((f) => ({ ...f, type, category: newCategory }));
  }

  function handleClose() {
    setOpen(false);
    setForm(EMPTY_FORM);
  }

  async function handleSave() {
    if (!form.amount || !form.account) return;
    setSaving(true);
    const tx: Transaction = {
      id: generateId(),
      date: form.date,
      description: form.description,
      amount: parseFloat(form.amount) || 0,
      type: form.type,
      category: form.category,
      account: form.account,
    };

    await fetch('/api/transactions', {
      method: 'POST',
      body: JSON.stringify(tx),
      headers: { 'Content-Type': 'application/json' },
    });

    handleClose();
    setSaving(false);
    router.refresh();
  }

  return (
    <>
      {isFab ? (
        <Button
          onClick={() => setOpen(true)}
          size="icon"
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
          {/* Expense / Income toggle */}
          <div className="flex p-1.5 rounded-2xl bg-slate-100">
            {(['expense', 'income'] as const).map((tp) => (
              <button
                key={tp}
                onClick={() => handleTypeChange(tp)}
                className={`flex-1 py-2.5 text-sm font-bold rounded-xl transition-all duration-200 ${
                  form.type === tp
                    ? tp === 'expense'
                      ? 'bg-white text-rose-600 shadow-sm'
                      : 'bg-white text-emerald-600 shadow-sm'
                    : 'text-slate-500'
                }`}
              >
                {tp === 'expense' ? t('quickAdd.expenseLabel') : t('quickAdd.incomeLabel')}
              </button>
            ))}
          </div>

          {/* Amount */}
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1.5">
              {t('quickAdd.amountLabel')}
            </label>
            <div className="relative flex items-center">
              <span className="absolute left-4 text-2xl font-bold text-slate-400 pointer-events-none select-none">$</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                className="w-full pl-10 pr-4 py-3.5 text-2xl font-extrabold text-slate-900 placeholder-slate-300 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
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
              placeholder="e.g. Netflix"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>

          {/* Category + Account */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select
              label={t('common.category')}
              value={form.category}
              options={categories.map((c) => ({ value: c, label: c }))}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
            />
            <Select
              label={t('common.account')}
              value={form.account}
              options={[
                { value: '', label: t('common.selectPlaceholder') },
                ...accounts.map((a) => ({ value: a.id, label: a.name })),
              ]}
              onChange={(e) => setForm((f) => ({ ...f, account: e.target.value }))}
            />
          </div>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-slate-100 -mx-6 sm:-mx-8 px-6 sm:px-8 py-4">
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={handleClose}>
              {t('common.cancel')}
            </Button>
            <Button
              className="flex-1"
              onClick={handleSave}
              disabled={saving || !form.amount || !form.account}
            >
              {saving ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
