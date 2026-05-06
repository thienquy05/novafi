'use client';
import { useState } from 'react';
import { Plus, Zap } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { generateId, today } from '@/lib/utils';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '@/types';
import type { Account, Transaction } from '@/types';

const EMPTY_FORM = {
  date: today(),
  description: '',
  amount: '',
  type: 'expense' as Transaction['type'],
  category: 'Food',
  account: '',
};

export function QuickAddTransaction({ accounts, isFab }: { accounts: Account[], isFab?: boolean }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const categories = form.type === 'expense' ? [...EXPENSE_CATEGORIES] : [...INCOME_CATEGORIES];

  function handleTypeChange(type: Transaction['type']) {
    const newCategory = type === 'expense' ? 'Food' : 'Paycheck';
    setForm((f) => ({ ...f, type, category: newCategory }));
  }

  async function handleSave() {
    if (!form.amount || !form.account) return;
    setSaving(true);
    const amount = parseFloat(form.amount) || 0;
    const tx: Transaction = {
      id: generateId(),
      date: form.date,
      description: form.description,
      amount,
      type: form.type,
      category: form.category,
      account: form.account,
    };

    await fetch('/api/transactions', {
      method: 'POST',
      body: JSON.stringify(tx),
      headers: { 'Content-Type': 'application/json' },
    });

    setOpen(false);
    setForm({ ...EMPTY_FORM, date: today() });
    setSaving(false);
    window.location.reload();
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
          Quick Add
        </Button>
      )}

      <Modal
        open={open}
        onClose={() => { setOpen(false); setForm(EMPTY_FORM); }}
        title="New Transaction"
      >
        <div className="space-y-5">
          {/* Type toggle */}
          <div className="flex p-1.5 rounded-2xl bg-slate-100">
            {(['expense', 'income'] as const).map((t) => (
              <button
                key={t}
                onClick={() => handleTypeChange(t)}
                className={`flex-1 py-3 text-sm font-bold rounded-xl transition-all duration-300 ${
                  form.type === t
                    ? t === 'expense' ? 'bg-white text-rose-600 shadow-sm' : 'bg-white text-emerald-600 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {t === 'expense' ? 'Expense' : 'Income'}
              </button>
            ))}
          </div>

          {/* Amount — large tap target on mobile */}
          <div className="relative">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Amount ($)</label>
            <div className="relative flex items-center">
              <span className="absolute left-4 text-xl font-bold text-slate-400 pointer-events-none">$</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                className="w-full pl-9 pr-4 py-4 text-2xl font-extrabold text-slate-900 placeholder-slate-300 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Date"
              type="date"
              value={form.date}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
            />
            <Input
              label="Description"
              placeholder="e.g. Grocery run, Coffee"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select
              label="Category"
              value={form.category}
              options={categories.map((c) => ({ value: c, label: c }))}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
            />
            <Select
              label="Account"
              value={form.account}
              options={[
                { value: '', label: '— Select —' },
                ...accounts.map((a) => ({ value: a.id, label: a.name })),
              ]}
              onChange={(e) => setForm((f) => ({ ...f, account: e.target.value }))}
            />
          </div>

          <div className="flex gap-3 pt-2">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => { setOpen(false); setForm(EMPTY_FORM); }}
            >
              Cancel
            </Button>
            <Button
              className="flex-1"
              onClick={handleSave}
              disabled={saving || !form.amount || !form.account}
            >
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}