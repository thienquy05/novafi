'use client';
import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Search, ArrowUpRight, ArrowDownRight, ArrowLeftRight } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { formatCurrency, formatDate, generateId, today } from '@/lib/utils';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '@/types';
import type { Transaction, Account } from '@/types';

const EMPTY_FORM = {
  date: today(),
  description: '',
  amount: '',
  type: 'expense' as Transaction['type'],
  category: 'Food',
  account: '',
  toAccount: '',
};

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'income' | 'expense' | 'transfer'>('all');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [txRes, accRes] = await Promise.all([fetch('/api/transactions'), fetch('/api/accounts')]);
    const [txs, accs] = await Promise.all([txRes.json(), accRes.json()]);
    setTransactions([...txs].sort((a: Transaction, b: Transaction) => b.date.localeCompare(a.date)));
    setAccounts(accs);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const categories = form.type === 'expense'
    ? [...EXPENSE_CATEGORIES]
    : [...INCOME_CATEGORIES];

  const filtered = transactions.filter((t) => {
    const matchSearch =
      !search ||
      t.description.toLowerCase().includes(search.toLowerCase()) ||
      t.category.toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === 'all' || t.type === filter;
    const matchCategory = !categoryFilter || t.category === categoryFilter;
    return matchSearch && matchFilter && matchCategory;
  });

  async function handleSave() {
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
      toAccount: form.type === 'transfer' ? form.toAccount : undefined,
    };

    await fetch('/api/transactions', {
      method: 'POST',
      body: JSON.stringify(tx),
      headers: { 'Content-Type': 'application/json' },
    });
    setOpen(false);
    setForm(EMPTY_FORM);
    await load();
    setSaving(false);
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this transaction?')) return;
    await fetch('/api/transactions', {
      method: 'DELETE',
      body: JSON.stringify({ id }),
      headers: { 'Content-Type': 'application/json' },
    });
    await load();
  }

  function handleTypeChange(type: Transaction['type']) {
    const newCategory = type === 'expense' ? 'Food' : type === 'income' ? 'Paycheck' : 'Transfer';
    setForm((f) => ({ ...f, type, category: newCategory }));
  }

  const totalIncome = filtered.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const totalExpense = filtered.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);

  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? id;

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6 sm:space-y-8 pb-24 md:pb-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-slate-900">Transactions</h1>
          <p className="text-slate-500 text-base font-medium mt-1">Track all your income and expenses</p>
        </div>
        <Button onClick={() => setOpen(true)} className="w-full md:w-auto shadow-sm hover:shadow-md">
          <Plus className="w-5 h-5" />
          Add Transaction
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Income</p>
          <p className="text-2xl md:text-3xl font-extrabold text-emerald-600 mt-2 tracking-tight">{formatCurrency(totalIncome)}</p>
        </Card>
        <Card>
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Spending</p>
          <p className="text-2xl md:text-3xl font-extrabold text-rose-600 mt-2 tracking-tight">{formatCurrency(totalExpense)}</p>
        </Card>
        <Card className="border-indigo-100 hover:border-indigo-200">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Net</p>
          <p className={`text-2xl md:text-3xl font-extrabold mt-2 tracking-tight ${totalIncome - totalExpense >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
            {formatCurrency(totalIncome - totalExpense)}
          </p>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1 max-w-full md:max-w-md">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              className="w-full h-12 pl-11 pr-4 rounded-2xl border border-slate-200 bg-white text-base text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-500/10 transition-all duration-300 shadow-sm"
              placeholder="Search transactions…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex gap-2 overflow-x-auto pb-2 md:pb-0 hide-scrollbar">
            {(['all', 'income', 'expense', 'transfer'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-5 h-12 rounded-2xl text-sm font-bold transition-all duration-300 whitespace-nowrap shadow-sm ${
                  filter === f
                    ? 'bg-slate-900 text-white'
                    : 'bg-white text-slate-600 hover:text-slate-900 hover:bg-slate-50 border border-slate-200'
                }`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>
        {/* Category quick-filter */}
        <div className="flex gap-2 overflow-x-auto pb-2 hide-scrollbar">
          <button
            onClick={() => setCategoryFilter('')}
            className={`px-4 h-10 rounded-xl text-sm font-bold transition-all duration-300 whitespace-nowrap shadow-sm ${
              !categoryFilter ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:text-slate-900 border border-slate-200'
            }`}
          >
            All Categories
          </button>
          {[...EXPENSE_CATEGORIES].map((c) => (
            <button
              key={c}
              onClick={() => setCategoryFilter(categoryFilter === c ? '' : c)}
              className={`px-4 h-10 rounded-xl text-sm font-bold transition-all duration-300 whitespace-nowrap shadow-sm ${
                categoryFilter === c ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:text-slate-900 border border-slate-200'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-indigo-600 border-t-transparent" />
        </div>
      ) : filtered.length === 0 ? (
        <Card className="text-center py-16 bg-slate-50 border-slate-100">
          <p className="text-slate-500 font-bold text-lg">No transactions found.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((tx) => (
            <div
              key={tx.id}
              className="group flex items-center justify-between p-4 sm:p-5 rounded-3xl bg-white border border-slate-100 hover:border-slate-200 hover:shadow-sm transition-all duration-300"
            >
              <div className="flex items-center gap-4">
                <div className={`flex items-center justify-center w-12 h-12 rounded-2xl shrink-0 border ${
                  tx.type === 'income' ? 'bg-emerald-50 border-emerald-100' : tx.type === 'transfer' ? 'bg-blue-50 border-blue-100' : 'bg-rose-50 border-rose-100'
                }`}>
                  {tx.type === 'income'
                    ? <ArrowUpRight className="w-6 h-6 text-emerald-600" />
                    : tx.type === 'transfer'
                    ? <ArrowLeftRight className="w-6 h-6 text-blue-600" />
                    : <ArrowDownRight className="w-6 h-6 text-rose-600" />}
                </div>
                <div>
                  <p className="text-base font-bold text-slate-900">{tx.description || '(no description)'}</p>
                  <p className="text-sm font-medium text-slate-500 mt-0.5">
                    {tx.category}
                    {tx.account ? ` · ${accountName(tx.account)}` : ''}
                    {tx.type === 'transfer' && tx.toAccount ? ` → ${accountName(tx.toAccount)}` : ''}
                    {' · '}{formatDate(tx.date)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-4 sm:gap-6">
                <span className={`text-lg font-extrabold ${
                  tx.type === 'income' ? 'text-emerald-600' : tx.type === 'transfer' ? 'text-blue-600' : 'text-slate-900'
                }`}>
                  {tx.type === 'income' ? '+' : tx.type === 'transfer' ? '' : '-'}{formatCurrency(tx.amount)}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-slate-400 hover:text-rose-600 hover:bg-rose-50 h-10 w-10 rounded-xl"
                  onClick={() => handleDelete(tx.id)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Transaction Modal */}
      <Modal open={open} onClose={() => { setOpen(false); setForm(EMPTY_FORM); }} title="Add Transaction">
        <div className="space-y-5">
          {/* Type selector */}
          <div className="flex p-1.5 rounded-2xl bg-slate-100">
            {(['expense', 'income', 'transfer'] as const).map((t) => (
              <button
                key={t}
                onClick={() => handleTypeChange(t)}
                className={`flex-1 py-3 text-sm font-bold rounded-xl transition-all duration-300 ${
                  form.type === t
                    ? t === 'expense' ? 'bg-white text-rose-600 shadow-sm'
                      : t === 'income' ? 'bg-white text-emerald-600 shadow-sm'
                      : 'bg-white text-blue-600 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Date"
              type="date"
              value={form.date}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
            />
            <Input
              label="Amount"
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
            />
          </div>
          <Input
            label="Description"
            placeholder="e.g. Chipotle, Amazon, Paycheck"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />

          {form.type !== 'transfer' && (
            <Select
              label="Category"
              value={form.category}
              options={categories.map((c) => ({ value: c, label: c }))}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
            />
          )}

          {accounts.length > 0 ? (
            <>
              <Select
                label={form.type === 'transfer' ? 'From Account' : 'Account'}
                value={form.account}
                options={[
                  { value: '', label: '— None —' },
                  ...accounts.map((a) => ({
                    value: a.id,
                    label: a.type === 'credit' || a.type === 'loan'
                      ? `${a.name} (owed: ${formatCurrency(a.balance)})`
                      : `${a.name} (${formatCurrency(a.balance)})`,
                  })),
                ]}
                onChange={(e) => setForm((f) => ({ ...f, account: e.target.value }))}
              />
              {form.type === 'transfer' && (
                <Select
                  label="To Account"
                  value={form.toAccount}
                  options={[
                    { value: '', label: '— None —' },
                    ...accounts
                      .filter((a) => a.id !== form.account)
                      .map((a) => ({
                        value: a.id,
                        label: a.type === 'credit' || a.type === 'loan'
                          ? `${a.name} · Pay off (owed: ${formatCurrency(a.balance)})`
                          : `${a.name} (${formatCurrency(a.balance)})`,
                      })),
                  ]}
                  onChange={(e) => setForm((f) => ({ ...f, toAccount: e.target.value }))}
                />
              )}
              {form.type === 'transfer' && form.toAccount && (() => {
                const toAcc = accounts.find((a) => a.id === form.toAccount);
                const isDebt = toAcc?.type === 'credit' || toAcc?.type === 'loan';
                const amt = parseFloat(form.amount) || 0;
                if (!toAcc || !amt) return null;
                return (
                  <div className="text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-1 shadow-sm">
                    {isDebt ? (
                      <>
                        <p className="text-blue-600 font-bold">Credit card payoff</p>
                        <p className="font-medium">Balance after: <span className="text-slate-900 font-bold">{formatCurrency(Math.max(0, toAcc.balance - amt))} owed</span></p>
                      </>
                    ) : (
                      <>
                        <p className="text-blue-600 font-bold">Transfer preview</p>
                        <p className="font-medium">{toAcc.name} after: <span className="text-slate-900 font-bold">{formatCurrency(toAcc.balance + amt)}</span></p>
                      </>
                    )}
                  </div>
                );
              })()}
            </>
          ) : (
            <div className="p-4 rounded-2xl bg-slate-50 border border-dashed border-slate-300 text-sm text-slate-500 font-medium text-center">
              No accounts added yet.{' '}
              <a href="/accounts" className="text-indigo-600 font-bold hover:text-indigo-500 transition-colors">Add accounts →</a>
            </div>
          )}

          <div className="flex gap-3 pt-4">
            <Button variant="secondary" className="flex-1" onClick={() => { setOpen(false); setForm(EMPTY_FORM); }}>
              Cancel
            </Button>
            <Button className="flex-1 shadow-sm" onClick={handleSave} disabled={saving || !form.amount}>
              {saving ? 'Saving…' : 'Add Transaction'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
