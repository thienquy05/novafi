'use client';
import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Search, Pencil, RefreshCw, AlertCircle, Download, Users, List, Bookmark, BookmarkCheck, ChevronDown, ChevronRight, X } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { TransactionsSkeleton } from '@/components/ui/Skeleton';
import { formatCurrency, formatDate, generateId, today } from '@/lib/utils';
import { EXPENSE_CATEGORIES } from '@/types';
import type { Transaction, Account } from '@/types';
import { CategoryIconBadge } from '@/components/CategoryIcon';
import { useToast } from '@/lib/toast';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
import { useCategories } from '@/hooks/useCategories';

// ── Recurring template helpers (localStorage) ─────────────────────────────────

type Template = { id: string; description: string; amount: number; type: Transaction['type']; category: string; account: string };
const TEMPLATES_KEY = 'nf_tx_templates_v1';

function loadTemplates(): Template[] {
  try { return JSON.parse(localStorage.getItem(TEMPLATES_KEY) ?? '[]'); } catch { return []; }
}
function saveTemplates(templates: Template[]) {
  try { localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates)); } catch { /* ignore */ }
}

// ── Merchant grouping ─────────────────────────────────────────────────────────

type MerchantRow = {
  merchant: string;
  total: number;
  count: number;
  lastDate: string;
  transactions: Transaction[];
};

function buildMerchantRows(transactions: Transaction[]): MerchantRow[] {
  const map: Record<string, MerchantRow> = {};
  for (const tx of transactions) {
    const key = (tx.description || tx.category).toLowerCase().trim();
    if (!map[key]) map[key] = { merchant: tx.description || tx.category, total: 0, count: 0, lastDate: tx.date, transactions: [] };
    map[key].total += tx.amount;
    map[key].count += 1;
    if (tx.date > map[key].lastDate) map[key].lastDate = tx.date;
    map[key].transactions.push(tx);
  }
  return Object.values(map).sort((a, b) => b.total - a.total);
}

// ── CSV export ────────────────────────────────────────────────────────────────

function exportCSV(transactions: Transaction[], accountName: (id: string) => string) {
  const headers = ['Date', 'Description', 'Amount', 'Type', 'Category', 'Account'];
  const rows = transactions.map((tx) => [
    tx.date,
    tx.description,
    tx.amount.toFixed(2),
    tx.type,
    tx.category,
    accountName(tx.account),
  ]);
  const csv = [headers, ...rows]
    .map((row) => row.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `transactions-${today()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Empty form ────────────────────────────────────────────────────────────────

const EMPTY_FORM = {
  date: today(),
  description: '',
  amount: '',
  type: 'expense' as Transaction['type'],
  category: 'Food',
  account: '',
  toAccount: '',
};

// ── Main page ─────────────────────────────────────────────────────────────────

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'income' | 'expense' | 'transfer'>('all');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editTarget, setEditTarget] = useState<Transaction | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'merchant'>('list');
  const [expandedMerchant, setExpandedMerchant] = useState<string | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const toast = useToast();
  const { expenseCategories, incomeCategories } = useCategories();

  const load = useCallback(async () => {
    setError(false);
    try {
      const [txRes, accRes] = await Promise.all([fetch('/api/transactions'), fetch('/api/accounts')]);
      if (!txRes.ok || !accRes.ok) throw new Error();
      const [txs, accs] = await Promise.all([txRes.json(), accRes.json()]);
      setTransactions([...txs].sort((a: Transaction, b: Transaction) => b.date.localeCompare(a.date)));
      setAccounts(accs);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setTemplates(loadTemplates()); }, []);
  useAutoRefresh(load);
  const { pullY, refreshing } = usePullToRefresh(load);

  const categories = form.type === 'expense' ? expenseCategories : form.type === 'income' ? incomeCategories : [...EXPENSE_CATEGORIES];
  const filtered = transactions.filter((t) => {
    const matchSearch = !search || t.description.toLowerCase().includes(search.toLowerCase()) || t.category.toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === 'all' || t.type === filter;
    const matchCategory = !categoryFilter || t.category === categoryFilter;
    return matchSearch && matchFilter && matchCategory;
  });

  function openAdd() { setEditTarget(null); setForm(EMPTY_FORM); setOpen(true); }
  function openEdit(tx: Transaction) {
    setEditTarget(tx);
    setForm({ date: tx.date, description: tx.description, amount: String(tx.amount), type: tx.type, category: tx.category, account: tx.account, toAccount: tx.toAccount ?? '' });
    setOpen(true);
  }
  function closeModal() { setOpen(false); setEditTarget(null); setForm(EMPTY_FORM); }

  function handleTypeChange(type: Transaction['type']) {
    const newCategory = type === 'expense' ? (expenseCategories[0] ?? 'Food') : type === 'income' ? (incomeCategories[0] ?? 'Paycheck') : 'Transfer';
    setForm((f) => ({ ...f, type, category: newCategory }));
  }

  function applyTemplate(t: Template) {
    setForm({ date: today(), description: t.description, amount: String(t.amount), type: t.type, category: t.category, account: t.account, toAccount: '' });
    setShowTemplates(false);
    setOpen(true);
  }

  function saveAsTemplate() {
    const amt = parseFloat(form.amount) || 0;
    if (!form.description && !amt) return;
    const tpl: Template = { id: generateId(), description: form.description, amount: amt, type: form.type, category: form.category, account: form.account };
    const updated = [...templates.filter((t) => t.description !== tpl.description || t.category !== tpl.category), tpl];
    saveTemplates(updated);
    setTemplates(updated);
    toast('Template saved', 'success');
  }

  function deleteTemplate(id: string) {
    const updated = templates.filter((t) => t.id !== id);
    saveTemplates(updated);
    setTemplates(updated);
  }

  async function handleSave() {
    setSaving(true);
    const amount = parseFloat(form.amount) || 0;
    const updated: Transaction = {
      id: editTarget?.id ?? generateId(),
      date: form.date,
      description: form.description,
      amount,
      type: form.type,
      category: form.category,
      account: form.account,
      toAccount: form.type === 'transfer' ? form.toAccount : undefined,
    };

    if (editTarget) {
      setTransactions((prev) => prev.map((t) => t.id === editTarget.id ? updated : t));
    } else {
      setTransactions((prev) => [updated, ...prev].sort((a, b) => b.date.localeCompare(a.date)));
    }
    closeModal();

    try {
      const res = await fetch('/api/transactions', {
        method: editTarget ? 'PUT' : 'POST',
        body: JSON.stringify(editTarget ? { original: editTarget, updated } : updated),
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error();
      toast(editTarget ? 'Transaction updated' : 'Transaction added', 'success');
      load();
    } catch {
      toast('Failed to save transaction', 'error');
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this transaction?')) return;
    const prev = transactions;
    setTransactions((t) => t.filter((tx) => tx.id !== id));
    try {
      const res = await fetch('/api/transactions', { method: 'DELETE', body: JSON.stringify({ id }), headers: { 'Content-Type': 'application/json' } });
      if (!res.ok) throw new Error();
      toast('Transaction deleted', 'success');
    } catch {
      setTransactions(prev);
      toast('Failed to delete transaction', 'error');
    }
  }

  const totalIncome = filtered.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const totalExpense = filtered.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? id;
  const merchantRows = buildMerchantRows(filtered);

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-5 sm:space-y-7 pb-28 md:pb-8">
      {(pullY > 0 || refreshing) && (
        <div className="fixed top-0 left-0 right-0 z-50 flex justify-center pt-safe">
          <div className="flex items-center gap-2 bg-indigo-600 text-white text-xs font-bold px-4 py-2 rounded-full shadow-lg mt-2">
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} style={!refreshing ? { transform: `rotate(${pullY * 180}deg)` } : undefined} />
            {refreshing ? 'Refreshing…' : pullY >= 1 ? 'Release to refresh' : 'Pull to refresh'}
          </div>
        </div>
      )}

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-4xl font-extrabold tracking-tight text-slate-900">Transactions</h1>
          <p className="text-slate-500 text-sm font-medium mt-1">All income and expenses</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {templates.length > 0 && (
            <Button variant="secondary" className="shadow-sm" onClick={() => setShowTemplates(true)}>
              <BookmarkCheck className="w-4 h-4" />
              Templates
            </Button>
          )}
          <Button variant="secondary" className="shadow-sm" onClick={() => exportCSV(filtered, accountName)}>
            <Download className="w-4 h-4" />
            Export CSV
          </Button>
          <Button onClick={openAdd} className="shadow-sm"><Plus className="w-5 h-5" />Add Transaction</Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card className="p-4 sm:p-5"><p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Income</p><p className="text-xl font-extrabold text-emerald-600 mt-1.5 tracking-tight">{formatCurrency(totalIncome)}</p></Card>
        <Card className="p-4 sm:p-5"><p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Spending</p><p className="text-xl font-extrabold text-rose-600 mt-1.5 tracking-tight">{formatCurrency(totalExpense)}</p></Card>
        <Card className="p-4 sm:p-5 border-indigo-100"><p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Net</p><p className={`text-xl font-extrabold mt-1.5 tracking-tight ${totalIncome - totalExpense >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{formatCurrency(totalIncome - totalExpense)}</p></Card>
      </div>

      {/* Filters + view toggle */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1 max-w-full md:max-w-md">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input className="w-full h-11 pl-10 pr-4 rounded-2xl border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-500/10 transition-all duration-200 shadow-sm" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 hide-scrollbar">
            {(['all', 'income', 'expense', 'transfer'] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={`px-4 h-11 rounded-2xl text-sm font-bold transition-all duration-200 whitespace-nowrap ${filter === f ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:text-slate-900 hover:bg-slate-50 border border-slate-200'}`}>
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
            {/* View toggle */}
            <div className="flex bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <button onClick={() => setViewMode('list')} className={`px-3 h-11 transition-all duration-200 ${viewMode === 'list' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-900'}`} title="List view">
                <List className="w-4 h-4" />
              </button>
              <button onClick={() => setViewMode('merchant')} className={`px-3 h-11 transition-all duration-200 ${viewMode === 'merchant' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-900'}`} title="By merchant">
                <Users className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1 hide-scrollbar">
          <button onClick={() => setCategoryFilter('')} className={`px-3.5 h-9 rounded-xl text-xs font-bold transition-all duration-200 whitespace-nowrap ${!categoryFilter ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:text-slate-900 border border-slate-200'}`}>All</button>
          {expenseCategories.map((c) => (
            <button key={c} onClick={() => setCategoryFilter(categoryFilter === c ? '' : c)} className={`px-3.5 h-9 rounded-xl text-xs font-bold transition-all duration-200 whitespace-nowrap ${categoryFilter === c ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:text-slate-900 border border-slate-200'}`}>{c}</button>
          ))}
        </div>
      </div>

      {loading ? (
        <TransactionsSkeleton />
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-14 h-14 rounded-full bg-rose-50 flex items-center justify-center mb-4"><AlertCircle className="w-7 h-7 text-rose-400" /></div>
          <p className="text-slate-700 font-bold text-base mb-1">Couldn&apos;t load transactions</p>
          <p className="text-slate-500 text-sm mb-6">Check your connection and try again.</p>
          <Button variant="secondary" onClick={load}>Try Again</Button>
        </div>
      ) : filtered.length === 0 ? (
        <Card className="text-center py-16 bg-slate-50 border-slate-100">
          <p className="text-slate-500 font-bold">No transactions found.</p>
          {transactions.length === 0 && <Button onClick={openAdd} className="mt-4 shadow-sm">Add Your First Transaction</Button>}
        </Card>
      ) : viewMode === 'merchant' ? (
        /* ── Merchant View ─────────────────────────────────────────────── */
        <div className="space-y-2">
          <p className="text-xs font-bold text-slate-400 px-1">{merchantRows.length} merchants · sorted by total</p>
          {merchantRows.map((row) => {
            const isExpanded = expandedMerchant === row.merchant;
            return (
              <div key={row.merchant} className="bg-white rounded-3xl border border-slate-100 overflow-hidden">
                <button
                  onClick={() => setExpandedMerchant(isExpanded ? null : row.merchant)}
                  className="w-full flex items-center justify-between p-4 hover:bg-slate-50 transition-colors text-left"
                >
                  <div className="flex items-center gap-3">
                    <CategoryIconBadge category={row.transactions[0]?.category ?? ''} type={row.transactions[0]?.type ?? 'expense'} className="w-10 h-10 rounded-xl" />
                    <div>
                      <p className="text-sm font-bold text-slate-900">{row.merchant || '(no description)'}</p>
                      <p className="text-xs font-medium text-slate-500 mt-0.5">{row.count} transaction{row.count !== 1 ? 's' : ''} · last {formatDate(row.lastDate)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-extrabold text-slate-900">{formatCurrency(row.total)}</span>
                    {isExpanded ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                  </div>
                </button>
                {isExpanded && (
                  <div className="border-t border-slate-100 divide-y divide-slate-50">
                    {row.transactions.map((tx) => (
                      <div key={tx.id} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold text-slate-700 shrink-0">{formatDate(tx.date)}</p>
                          <p className="text-xs font-medium text-slate-400 truncate">{tx.category} · {accountName(tx.account)}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-extrabold ${tx.type === 'income' ? 'text-emerald-600' : tx.type === 'transfer' ? 'text-blue-600' : 'text-slate-900'}`}>
                            {tx.type === 'income' ? '+' : tx.type === 'transfer' ? '' : '-'}{formatCurrency(tx.amount)}
                          </span>
                          <Button variant="ghost" size="icon" className="text-slate-400 h-8 w-8 rounded-xl" onClick={() => openEdit(tx)}><Pencil className="w-3.5 h-3.5" /></Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* ── List View ─────────────────────────────────────────────────── */
        <div className="space-y-2.5">
          {filtered.map((tx) => (
            <div key={tx.id} className="flex items-center justify-between p-4 sm:p-4.5 rounded-3xl bg-white border border-slate-100 transition-all duration-200">
              <div className="flex items-center gap-3.5 flex-1 min-w-0">
                <CategoryIconBadge category={tx.category} type={tx.type} className="w-11 h-11 rounded-2xl" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-slate-900 truncate">{tx.description || tx.category}</p>
                  <div className="flex items-center gap-1 mt-0.5">
                    <p className="text-xs font-medium text-slate-500 truncate min-w-0">
                      {tx.category}{tx.account ? ` · ${accountName(tx.account)}` : ''}{tx.type === 'transfer' && tx.toAccount ? ` → ${accountName(tx.toAccount)}` : ''}
                    </p>
                    <span className="text-xs font-medium text-slate-400 shrink-0">· {formatDate(tx.date)}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 sm:gap-3 ml-3">
                <span className={`text-sm font-extrabold whitespace-nowrap ${tx.type === 'income' ? 'text-emerald-600' : tx.type === 'transfer' ? 'text-blue-600' : 'text-slate-900'}`}>
                  {tx.type === 'income' ? '+' : tx.type === 'transfer' ? '' : '-'}{formatCurrency(tx.amount)}
                </span>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" className="text-slate-400 h-9 w-9 rounded-xl" onClick={() => openEdit(tx)}><Pencil className="w-3.5 h-3.5" /></Button>
                  <Button variant="ghost" size="icon" className="text-slate-400 h-9 w-9 rounded-xl" onClick={() => handleDelete(tx.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Add/Edit Transaction Modal ───────────────────────────────────── */}
      <Modal open={open} onClose={closeModal} title={editTarget ? 'Edit Transaction' : 'New Transaction'}>
        <div className="space-y-4 pb-4">
          <div className="flex p-1.5 rounded-2xl bg-slate-100">
            {(['expense', 'income', 'transfer'] as const).map((t) => (
              <button key={t} onClick={() => handleTypeChange(t)} className={`flex-1 py-2.5 text-sm font-bold rounded-xl transition-all duration-200 ${form.type === t ? t === 'expense' ? 'bg-white text-rose-600 shadow-sm' : t === 'income' ? 'bg-white text-emerald-600 shadow-sm' : 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Amount ($)</label>
            <div className="relative flex items-center">
              <span className="absolute left-4 text-2xl font-bold text-slate-400 pointer-events-none select-none">$</span>
              <input type="number" inputMode="decimal" min="0" step="0.01" placeholder="0.00" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} className="w-full pl-10 pr-4 py-3.5 text-2xl font-extrabold text-slate-900 placeholder-slate-300 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Date" type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
            <Input label="Description" placeholder="e.g. Netflix" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {form.type !== 'transfer' && (
              <Select label="Category" value={form.category} options={categories.map((c) => ({ value: c, label: c }))} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} />
            )}
            <Select label={form.type === 'transfer' ? 'From Account' : 'Account'} value={form.account}
              options={[{ value: '', label: '— None —' }, ...accounts.map((a) => ({ value: a.id, label: a.type === 'credit' || a.type === 'loan' ? `${a.name} (owed: ${formatCurrency(a.balance)})` : `${a.name} (${formatCurrency(a.balance)})` }))]}
              onChange={(e) => setForm((f) => ({ ...f, account: e.target.value }))} />
          </div>
          {form.type === 'transfer' && (
            <Select label="To Account" value={form.toAccount}
              options={[{ value: '', label: '— None —' }, ...accounts.filter((a) => a.id !== form.account).map((a) => ({ value: a.id, label: a.type === 'credit' || a.type === 'loan' ? `${a.name} · Pay off (owed: ${formatCurrency(a.balance)})` : `${a.name} (${formatCurrency(a.balance)})` }))]}
              onChange={(e) => setForm((f) => ({ ...f, toAccount: e.target.value }))} />
          )}
          {form.type === 'transfer' && form.toAccount && (() => {
            const toAcc = accounts.find((a) => a.id === form.toAccount);
            const isDebt = toAcc?.type === 'credit' || toAcc?.type === 'loan';
            const amt = parseFloat(form.amount) || 0;
            if (!toAcc || !amt) return null;
            return (
              <div className="text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-1">
                {isDebt ? <><p className="text-blue-600 font-bold text-xs">Credit card payoff</p><p className="font-medium text-xs">Balance after: <span className="text-slate-900 font-bold">{formatCurrency(Math.max(0, toAcc.balance - amt))} owed</span></p></> : <><p className="text-blue-600 font-bold text-xs">Transfer preview</p><p className="font-medium text-xs">{toAcc.name} after: <span className="text-slate-900 font-bold">{formatCurrency(toAcc.balance + amt)}</span></p></>}
              </div>
            );
          })()}
          {/* Save as template */}
          {!editTarget && (
            <button
              type="button"
              onClick={saveAsTemplate}
              className="flex items-center gap-1.5 text-xs font-bold text-indigo-600 hover:text-indigo-700 transition-colors"
            >
              <Bookmark className="w-3.5 h-3.5" />
              Save as recurring template
            </button>
          )}
        </div>
        <div className="sticky bottom-0 bg-white border-t border-slate-100 -mx-6 sm:-mx-8 px-6 sm:px-8 py-4">
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={closeModal}>Cancel</Button>
            <Button className="flex-1" onClick={handleSave} disabled={saving || !form.amount}>{saving ? 'Saving…' : editTarget ? 'Save Changes' : 'Add Transaction'}</Button>
          </div>
        </div>
      </Modal>

      {/* ── Templates Modal ──────────────────────────────────────────────── */}
      <Modal open={showTemplates} onClose={() => setShowTemplates(false)} title="Recurring Templates">
        <div className="space-y-2 pb-4">
          {templates.length === 0 ? (
            <div className="text-center py-8 text-slate-500 font-medium text-sm">No templates saved yet.<br />Use &quot;Save as recurring template&quot; when adding a transaction.</div>
          ) : templates.map((t) => (
            <div key={t.id} className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-50 border border-slate-100 hover:border-slate-200 transition-colors">
              <div>
                <p className="text-sm font-bold text-slate-900">{t.description || t.category}</p>
                <p className="text-xs font-medium text-slate-500 mt-0.5">{t.category} · {formatCurrency(t.amount)}</p>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" className="h-8" onClick={() => applyTemplate(t)}>Use</Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50" onClick={() => deleteTemplate(t.id)}><X className="w-3.5 h-3.5" /></Button>
              </div>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}
