'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus, Search, Pencil, RefreshCw, AlertCircle, Download, Users, List, Bookmark, BookmarkCheck, ChevronDown, ChevronLeft, ChevronRight, X, Filter, ArrowLeftRight, HandCoins, ArrowUpRight, ArrowDownLeft, UserPlus, Trash2 } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { SwipeToDelete } from '@/components/ui/SwipeToDelete';
import { TransactionsSkeleton } from '@/components/ui/Skeleton';
import { formatCurrency, formatCompact, formatDate, generateId, today } from '@/lib/utils';
import { transactionsToCsv } from '@/lib/csv';
import { calcLoanRemaining } from '@/lib/calculations';
import { motion, AnimatePresence } from 'framer-motion';
import { EXPENSE_CATEGORIES } from '@/types';
import type { Transaction, Account, Contact, Loan } from '@/types';
import { CategoryIconBadge } from '@/components/CategoryIcon';
import { useToast } from '@/lib/toast';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
import { useCategories } from '@/hooks/useCategories';
import { useTranslation } from '@/lib/i18n/context';

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

// ── Month scoping helpers ──────────────────────────────────────────────────────
// Summary totals (income/spending/net) and the ledger are scoped to a single
// month so the numbers "restart" each month. `selectedMonth` is a YYYY-MM string,
// or null for the all-time view.

function currentMonth(): string {
  return today().slice(0, 7);
}

// Shift a YYYY-MM string by `delta` months (e.g. -1 → previous month).
function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatMonthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

// ── CSV export ────────────────────────────────────────────────────────────────

function exportCSV(transactions: Transaction[], accountName: (id: string) => string) {
  const csv = transactionsToCsv(transactions, accountName);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `transactions-${today()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Empty form ────────────────────────────────────────────────────────────────

// List view renders in pages to cap DOM nodes as the ledger grows over years.
const PAGE_SIZE = 50;

const EMPTY_FORM = {
  date: today(),
  description: '',
  amount: '',
  type: 'expense' as Transaction['type'],
  category: 'Food',
  account: '',
  toAccount: '',
};

// ── Loans / IOUs ───────────────────────────────────────────────────────────────

const EMPTY_LOAN_FORM = {
  direction: 'lent' as Loan['direction'],
  contactId: '',
  amount: '',
  account: '',
  date: today(),
  note: '',
};
// Sentinel option that opens the inline "add new contact" input.
const NEW_CONTACT = '__new__';

function roundCents(n: number): number {
  return Math.round(n * 100) / 100;
}

// Builds the cash-movement transaction for a loan principal or payback. It's a
// `transfer` with an external (empty) counterparty so it shifts the account
// balance WITHOUT counting as income or expense. Cash leaves the account when
// you lend the principal or repay something you borrowed; otherwise it comes in.
function buildLoanTx(
  direction: Loan['direction'],
  kind: 'principal' | 'payback',
  amount: number,
  account: string,
  description: string,
  date: string,
): Transaction {
  const cashOut = (direction === 'lent') === (kind === 'principal');
  return {
    id: generateId(),
    date,
    description,
    amount,
    type: 'transfer',
    category: 'Transfer',
    account: cashOut ? account : '',
    toAccount: cashOut ? '' : account,
    createdAt: new Date().toISOString(),
  };
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'income' | 'expense' | 'transfer'>('all');
  const [categoryFilters, setCategoryFilters] = useState<string[]>([]);
  // YYYY-MM string scopes totals + ledger to one month; null = all time.
  const [selectedMonth, setSelectedMonth] = useState<string | null>(currentMonth());
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
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [prevFilterKey, setPrevFilterKey] = useState('');
  // Loans / IOUs
  const [loans, setLoans] = useState<Loan[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loansOpen, setLoansOpen] = useState(false);
  const [showAddLoan, setShowAddLoan] = useState(false);
  const [loanForm, setLoanForm] = useState(EMPTY_LOAN_FORM);
  const [newContactName, setNewContactName] = useState('');
  const [addingContact, setAddingContact] = useState(false);
  const [savingLoan, setSavingLoan] = useState(false);
  const [paybackFor, setPaybackFor] = useState<string | null>(null);
  const [paybackForm, setPaybackForm] = useState({ amount: '', account: '' });
  const [recordingPayback, setRecordingPayback] = useState(false);
  const toast = useToast();
  const { expenseCategories, incomeCategories } = useCategories();
  const { t } = useTranslation();

  const load = useCallback(async () => {
    setError(false);
    try {
      const [txRes, accRes, loanRes, conRes] = await Promise.all([
        fetch('/api/transactions'), fetch('/api/accounts'), fetch('/api/loans'), fetch('/api/contacts'),
      ]);
      if (!txRes.ok || !accRes.ok) throw new Error();
      const [txs, accs, lns, cons] = await Promise.all([
        txRes.json(), accRes.json(),
        loanRes.ok ? loanRes.json() : Promise.resolve([]),
        conRes.ok ? conRes.json() : Promise.resolve([]),
      ]);
      setTransactions([...txs].sort((a: Transaction, b: Transaction) => {
        const dateCmp = b.date.localeCompare(a.date);
        if (dateCmp !== 0) return dateCmp;
        return (b.createdAt ?? b.id).localeCompare(a.createdAt ?? a.id);
      }));
      setAccounts(accs);
      setLoans(lns);
      setContacts(cons);
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

  const accountMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const a of accounts) m[a.id] = a.name;
    return m;
  }, [accounts]);

  const filtered = useMemo(() => transactions.filter((tx) => {
    const matchSearch = !search || tx.description.toLowerCase().includes(search.toLowerCase()) || tx.category.toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === 'all' || tx.type === filter;
    const matchCategory = categoryFilters.length === 0 || categoryFilters.includes(tx.category);
    const matchMonth = selectedMonth === null || tx.date.slice(0, 7) === selectedMonth;
    return matchSearch && matchFilter && matchCategory && matchMonth;
  }), [transactions, search, filter, categoryFilters, selectedMonth]);

  function toggleCategory(c: string) {
    setCategoryFilters((prev) => prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]);
  }

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

  function applyTemplate(tpl: Template) {
    setForm({ date: today(), description: tpl.description, amount: String(tpl.amount), type: tpl.type, category: tpl.category, account: tpl.account, toAccount: '' });
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
    toast(t('transactions.toastTemplateSaved'), 'success');
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
      createdAt: editTarget?.createdAt ?? new Date().toISOString(),
    };

    const txSort = (a: Transaction, b: Transaction) => {
      const dateCmp = b.date.localeCompare(a.date);
      if (dateCmp !== 0) return dateCmp;
      return (b.createdAt ?? b.id).localeCompare(a.createdAt ?? a.id);
    };
    if (editTarget) {
      setTransactions((prev) => prev.map((tx) => tx.id === editTarget.id ? updated : tx));
    } else {
      setTransactions((prev) => [updated, ...prev].sort(txSort));
    }
    closeModal();

    try {
      const res = await fetch('/api/transactions', {
        method: editTarget ? 'PUT' : 'POST',
        body: JSON.stringify(editTarget ? { original: editTarget, updated } : updated),
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error();
      toast(editTarget ? t('transactions.toastUpdated') : t('transactions.toastAdded'), 'success');
      load();
    } catch {
      toast(t('transactions.toastFailedSave'), 'error');
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function restoreTransaction(tx: Transaction) {
    const prev = transactions;
    setTransactions((txs) => txs.some((t) => t.id === tx.id) ? txs : [tx, ...txs]);
    try {
      const res = await fetch('/api/transactions', { method: 'POST', body: JSON.stringify(tx), headers: { 'Content-Type': 'application/json' } });
      if (!res.ok) throw new Error();
      toast(t('transactions.toastRestored'), 'success');
    } catch {
      setTransactions(prev);
      toast(t('transactions.toastFailedRestore'), 'error');
    }
  }

  async function handleDelete(id: string) {
    if (!confirm(t('transactions.confirmDelete'))) return;
    const removed = transactions.find((tx) => tx.id === id);
    const prev = transactions;
    setTransactions((txs) => txs.filter((tx) => tx.id !== id));
    try {
      const res = await fetch('/api/transactions', { method: 'DELETE', body: JSON.stringify({ id }), headers: { 'Content-Type': 'application/json' } });
      if (!res.ok) throw new Error();
      // Offer one-tap undo: re-creating the row also re-applies its balance effects.
      toast(t('transactions.toastDeleted'), 'success', removed ? { label: t('common.undo'), onClick: () => restoreTransaction(removed) } : undefined);
    } catch {
      setTransactions(prev);
      toast(t('transactions.toastFailedDelete'), 'error');
    }
  }

  // ── Loans / IOUs ──────────────────────────────────────────────────────────
  const openLoans = useMemo(() => loans.filter((l) => !l.settled).sort((a, b) => b.date.localeCompare(a.date)), [loans]);
  const settledLoans = useMemo(() => loans.filter((l) => l.settled).sort((a, b) => (b.settledDate || '').localeCompare(a.settledDate || '')), [loans]);
  const owedToYou = useMemo(() => openLoans.filter((l) => l.direction === 'lent').reduce((s, l) => s + calcLoanRemaining(l.principal, l.repaidAmount), 0), [openLoans]);
  const youOwe = useMemo(() => openLoans.filter((l) => l.direction === 'borrowed').reduce((s, l) => s + calcLoanRemaining(l.principal, l.repaidAmount), 0), [openLoans]);

  async function handleAddLoanContact() {
    const name = newContactName.trim();
    if (!name) return;
    setAddingContact(true);
    const contact: Contact = { id: generateId(), name, createdAt: new Date().toISOString() };
    try {
      const res = await fetch('/api/contacts', { method: 'POST', body: JSON.stringify(contact), headers: { 'Content-Type': 'application/json' } });
      if (!res.ok) throw new Error();
      setContacts((prev) => [...prev, contact].sort((a, b) => a.name.localeCompare(b.name)));
      setLoanForm((f) => ({ ...f, contactId: contact.id }));
      setNewContactName('');
    } catch {
      toast(t('loans.toastFailedContact'), 'error');
    } finally {
      setAddingContact(false);
    }
  }

  async function handleAddLoan() {
    const amount = parseFloat(loanForm.amount) || 0;
    if (!loanForm.contactId || loanForm.contactId === NEW_CONTACT || amount <= 0) return;
    const contact = contacts.find((c) => c.id === loanForm.contactId);
    if (!contact) return;
    setSavingLoan(true);
    const desc = loanForm.direction === 'lent'
      ? t('loans.txLent', { name: contact.name })
      : t('loans.txBorrowed', { name: contact.name });
    const tx = loanForm.account ? buildLoanTx(loanForm.direction, 'principal', amount, loanForm.account, desc, loanForm.date) : null;
    const loan: Loan = {
      id: generateId(),
      direction: loanForm.direction,
      contactId: contact.id,
      contactName: contact.name,
      account: loanForm.account,
      principal: amount,
      repaidAmount: 0,
      date: loanForm.date,
      note: loanForm.note,
      settled: false,
      settledDate: '',
      principalTxId: tx ? tx.id : '',
      repaymentTxIds: [],
    };
    try {
      if (tx) {
        const txRes = await fetch('/api/transactions', { method: 'POST', body: JSON.stringify(tx), headers: { 'Content-Type': 'application/json' } });
        if (!txRes.ok) throw new Error();
      }
      const res = await fetch('/api/loans', { method: 'POST', body: JSON.stringify(loan), headers: { 'Content-Type': 'application/json' } });
      if (!res.ok) throw new Error();
      setLoans((prev) => [loan, ...prev]);
      setShowAddLoan(false);
      setLoanForm(EMPTY_LOAN_FORM);
      setNewContactName('');
      toast(t('loans.toastAdded'), 'success');
      if (tx) load(); // refresh balances + ledger
    } catch {
      toast(t('loans.toastFailed'), 'error');
    } finally {
      setSavingLoan(false);
    }
  }

  async function handleRecordPayback(loan: Loan) {
    const remaining = calcLoanRemaining(loan.principal, loan.repaidAmount);
    const entered = parseFloat(paybackForm.amount) || 0;
    const applied = Math.min(entered, remaining);
    if (applied <= 0) return;
    setRecordingPayback(true);
    const account = paybackForm.account || loan.account;
    const desc = loan.direction === 'lent'
      ? t('loans.txRepaidToYou', { name: loan.contactName })
      : t('loans.txYouRepaid', { name: loan.contactName });
    const tx = account ? buildLoanTx(loan.direction, 'payback', applied, account, desc, today()) : null;
    const newRepaid = roundCents(loan.repaidAmount + applied);
    const fullyPaid = newRepaid >= roundCents(loan.principal) - 0.005;
    const updated: Loan = {
      ...loan,
      repaidAmount: newRepaid,
      settled: fullyPaid,
      settledDate: fullyPaid ? today() : '',
      repaymentTxIds: tx ? [...loan.repaymentTxIds, tx.id] : loan.repaymentTxIds,
    };
    try {
      if (tx) {
        const txRes = await fetch('/api/transactions', { method: 'POST', body: JSON.stringify(tx), headers: { 'Content-Type': 'application/json' } });
        if (!txRes.ok) throw new Error();
      }
      const res = await fetch('/api/loans', { method: 'POST', body: JSON.stringify(updated), headers: { 'Content-Type': 'application/json' } });
      if (!res.ok) throw new Error();
      setLoans((prev) => prev.map((l) => l.id === loan.id ? updated : l));
      setPaybackFor(null);
      setPaybackForm({ amount: '', account: '' });
      toast(fullyPaid ? t('loans.toastSettled', { name: loan.contactName }) : t('loans.toastPayback'), 'success');
      if (tx) load();
    } catch {
      toast(t('loans.toastFailed'), 'error');
    } finally {
      setRecordingPayback(false);
    }
  }

  async function handleDeleteLoan(loan: Loan) {
    if (!confirm(t('loans.confirmDelete'))) return;
    const prev = loans;
    setLoans((ls) => ls.filter((l) => l.id !== loan.id));
    try {
      // Reverse every linked cash transaction so balances return to where they were.
      const txIds = [loan.principalTxId, ...loan.repaymentTxIds].filter(Boolean);
      for (const id of txIds) {
        await fetch('/api/transactions', { method: 'DELETE', body: JSON.stringify({ id }), headers: { 'Content-Type': 'application/json' } });
      }
      const res = await fetch('/api/loans', { method: 'DELETE', body: JSON.stringify({ id: loan.id }), headers: { 'Content-Type': 'application/json' } });
      if (!res.ok) throw new Error();
      toast(t('loans.toastDeleted'), 'success');
      if (txIds.length) load();
    } catch {
      setLoans(prev);
      toast(t('loans.toastFailed'), 'error');
    }
  }

  const { totalIncome, totalExpense } = useMemo(() => {
    let income = 0, expense = 0;
    for (const tx of filtered) {
      if (tx.type === 'income') income += tx.amount;
      else if (tx.type === 'expense') expense += tx.amount;
    }
    return { totalIncome: income, totalExpense: expense };
  }, [filtered]);
  const accountName = (id: string) => accountMap[id] ?? id;
  const merchantRows = useMemo(() => buildMerchantRows(filtered), [filtered]);
  // Reset paging whenever the active filters change. Adjusting state during
  // render (rather than in an effect) avoids a cascading re-render.
  const filterKey = `${search}|${filter}|${categoryFilters.join(',')}|${selectedMonth ?? 'all'}`;
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey);
    setVisibleCount(PAGE_SIZE);
  }
  const visibleTransactions = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);
  const hasMore = filtered.length > visibleTransactions.length;
  const groupedByDate = useMemo(() => {
    const groups: Array<{ date: string; txs: Transaction[] }> = [];
    for (const tx of visibleTransactions) {
      const last = groups[groups.length - 1];
      if (!last || last.date !== tx.date) groups.push({ date: tx.date, txs: [tx] });
      else last.txs.push(tx);
    }
    return groups;
  }, [visibleTransactions]);
  const activeFilterCount = (filter !== 'all' ? 1 : 0) + categoryFilters.length;

  const filterLabels: Record<string, string> = {
    all: t('common.all'),
    income: t('common.income'),
    expense: t('common.expenses'),
    transfer: t('common.transfers'),
  };

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
          <h1 className="text-2xl md:text-4xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">{t('transactions.title')}</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm font-medium mt-1">{t('transactions.subtitle')}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {templates.length > 0 && (
            <Button variant="secondary" className="shadow-sm" onClick={() => setShowTemplates(true)}>
              <BookmarkCheck className="w-4 h-4" />
              {t('transactions.templates')}
            </Button>
          )}
          <Button variant="secondary" className="shadow-sm relative" onClick={() => setLoansOpen(true)}>
            <HandCoins className="w-4 h-4" />
            {t('loans.loans')}
            {openLoans.length > 0 && (
              <span className="ml-1 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-indigo-600 text-white text-[11px] font-bold">{openLoans.length}</span>
            )}
          </Button>
          <Button variant="secondary" className="shadow-sm" onClick={() => exportCSV(filtered, accountName)}>
            <Download className="w-4 h-4" />
            {t('transactions.exportCsv')}
          </Button>
          <Button onClick={openAdd} className="shadow-sm"><Plus className="w-5 h-5" />{t('transactions.addTransaction')}</Button>
        </div>
      </div>

      {/* Month navigator — scopes the totals + ledger to one month */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden shadow-sm">
          <button
            onClick={() => setSelectedMonth((m) => shiftMonth(m ?? currentMonth(), -1))}
            disabled={selectedMonth === null}
            className="h-11 px-3 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title={t('transactions.prevMonth')}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className={`h-11 px-2 min-w-[8.5rem] flex items-center justify-center text-sm font-bold ${selectedMonth === null ? 'text-slate-400 dark:text-slate-500' : 'text-slate-900 dark:text-slate-100'}`}>
            {selectedMonth === null ? t('transactions.allTime') : formatMonthLabel(selectedMonth)}
          </span>
          <button
            onClick={() => setSelectedMonth((m) => shiftMonth(m ?? currentMonth(), 1))}
            disabled={selectedMonth === null || selectedMonth >= currentMonth()}
            className="h-11 px-3 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title={t('transactions.nextMonth')}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <button
          onClick={() => setSelectedMonth((m) => (m === null ? currentMonth() : null))}
          className={`h-11 px-4 rounded-2xl text-sm font-bold transition-all duration-200 shrink-0 ${selectedMonth === null ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 shadow-sm'}`}
        >
          {t('transactions.allTime')}
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card className="p-4 sm:p-5 min-w-0">
          <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t('common.income')}</p>
          <p className="font-extrabold text-emerald-600 dark:text-emerald-400 mt-1.5 text-base sm:text-lg truncate">{formatCompact(totalIncome)}</p>
        </Card>
        <Card className="p-4 sm:p-5 min-w-0">
          <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t('transactions.spending')}</p>
          <p className="font-extrabold text-rose-600 dark:text-rose-400 mt-1.5 text-base sm:text-lg truncate">{formatCompact(totalExpense)}</p>
        </Card>
        <Card className="p-4 sm:p-5 min-w-0 border-indigo-100 dark:border-indigo-800/50">
          <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t('common.net')}</p>
          <p className={`font-extrabold mt-1.5 text-base sm:text-lg truncate ${totalIncome - totalExpense >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{formatCompact(totalIncome - totalExpense)}</p>
        </Card>
      </div>

      {/* Loans / IOUs summary — tap to open the tracker */}
      {openLoans.length > 0 && (
        <button onClick={() => setLoansOpen(true)} className="w-full flex items-center justify-between p-4 rounded-3xl bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700/60 hover:border-slate-200 dark:hover:border-slate-700 transition-colors text-left shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-100 dark:border-indigo-800/50 flex items-center justify-center shrink-0">
              <HandCoins className="w-5 h-5 text-indigo-500 dark:text-indigo-400" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{t('loans.title')}</p>
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5">{t('loans.openCount', { n: openLoans.length })}</p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-0.5">
            {owedToYou > 0 && <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">{t('loans.owedToYou')} {formatCurrency(owedToYou)}</span>}
            {youOwe > 0 && <span className="text-xs font-bold text-rose-600 dark:text-rose-400">{t('loans.youOwe')} {formatCurrency(youOwe)}</span>}
          </div>
        </button>
      )}

      {/* Filters + view toggle */}
      <div className="flex flex-col gap-2">
        <div className="flex gap-2 items-center">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500" />
            <input className="w-full h-11 pl-10 pr-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-500/10 transition-all duration-200 shadow-sm" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <button
            onClick={() => setFilterSheetOpen(true)}
            className={`h-11 px-4 rounded-2xl text-sm font-bold transition-all duration-200 flex items-center gap-2 shrink-0 ${activeFilterCount > 0 ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'}`}
          >
            <Filter className="w-4 h-4" />
            {activeFilterCount > 0 ? `${t('transactions.filters')} (${activeFilterCount})` : t('transactions.filters')}
          </button>
          <div className="flex bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden shrink-0">
            <button onClick={() => setViewMode('list')} className={`px-3 h-11 transition-all duration-200 ${viewMode === 'list' ? 'bg-indigo-600 text-white' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'}`} title="List view">
              <List className="w-4 h-4" />
            </button>
            <button onClick={() => setViewMode('merchant')} className={`px-3 h-11 transition-all duration-200 ${viewMode === 'merchant' ? 'bg-indigo-600 text-white' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'}`} title="By merchant">
              <Users className="w-4 h-4" />
            </button>
          </div>
        </div>
        {/* Active filter chips */}
        {activeFilterCount > 0 && (
          <div className="flex gap-2 flex-wrap">
            {filter !== 'all' && (
              <button onClick={() => setFilter('all')} className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 text-xs font-bold border border-indigo-100 dark:border-indigo-800/50">
                {filterLabels[filter]} <X className="w-3 h-3" />
              </button>
            )}
            {categoryFilters.map((c) => (
              <button key={`chip-${c}`} onClick={() => toggleCategory(c)} className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 text-xs font-bold border border-indigo-100 dark:border-indigo-800/50">
                {c} <X className="w-3 h-3" />
              </button>
            ))}
            {activeFilterCount > 1 && (
              <button onClick={() => { setFilter('all'); setCategoryFilters([]); }} className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-rose-50 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 text-xs font-bold border border-rose-100 dark:border-rose-800/50">
                {t('transactions.clearFilters')} <X className="w-3 h-3" />
              </button>
            )}
          </div>
        )}
      </div>

      {loading ? (
        <TransactionsSkeleton />
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-14 h-14 rounded-full bg-rose-50 dark:bg-rose-900/30 flex items-center justify-center mb-4"><AlertCircle className="w-7 h-7 text-rose-400" /></div>
          <p className="text-slate-700 dark:text-slate-300 font-bold text-base mb-1">{t('transactions.errorTitle')}</p>
          <p className="text-slate-500 dark:text-slate-400 text-sm mb-6">{t('transactions.errorBody')}</p>
          <Button variant="secondary" onClick={load}>{t('common.tryAgain')}</Button>
        </div>
      ) : filtered.length === 0 ? (
        transactions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-20 h-20 rounded-3xl bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center mb-5">
              <ArrowLeftRight className="w-8 h-8 text-indigo-400" />
            </div>
            <h3 className="text-slate-800 dark:text-slate-200 font-bold text-lg mb-1">{t('transactions.noTransactionsYet')}</h3>
            <p className="text-slate-500 dark:text-slate-400 text-sm mb-6 max-w-xs">{t('transactions.noTransactionsYetBody')}</p>
            <Button onClick={openAdd} className="shadow-sm"><Plus className="w-4 h-4" />{t('transactions.addTransaction')}</Button>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-20 h-20 rounded-3xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-5">
              <Search className="w-8 h-8 text-slate-400 dark:text-slate-500" />
            </div>
            <h3 className="text-slate-800 dark:text-slate-200 font-bold text-lg mb-1">{t('transactions.noResultsTitle')}</h3>
            <p className="text-slate-500 dark:text-slate-400 text-sm mb-4">{t('transactions.noResultsBody')}</p>
            <Button variant="secondary" onClick={() => { setSearch(''); setFilter('all'); setCategoryFilters([]); }}>
              {t('transactions.clearFilters')}
            </Button>
          </div>
        )
      ) : viewMode === 'merchant' ? (
        /* ── Merchant View ─────────────────────────────────────────────── */
        <div className="space-y-2">
          <p className="text-xs font-bold text-slate-400 dark:text-slate-500 px-1">{t('transactions.merchantCount', { n: merchantRows.length })}</p>
          {merchantRows.map((row) => {
            const isExpanded = expandedMerchant === row.merchant;
            return (
              <div key={row.merchant} className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700/60 overflow-hidden">
                <button
                  onClick={() => setExpandedMerchant(isExpanded ? null : row.merchant)}
                  className="w-full flex items-center justify-between p-4 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors text-left"
                >
                  <div className="flex items-center gap-3">
                    <CategoryIconBadge category={row.transactions[0]?.category ?? ''} type={row.transactions[0]?.type ?? 'expense'} className="w-10 h-10 rounded-xl" />
                    <div>
                      <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{row.merchant || t('transactions.noDescription')}</p>
                      <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5">{t('transactions.transactionCount', { n: row.count, date: formatDate(row.lastDate) })}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-extrabold text-slate-900 dark:text-slate-100">{formatCurrency(row.total)}</span>
                    {isExpanded ? <ChevronDown className="w-4 h-4 text-slate-400 dark:text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-400 dark:text-slate-500" />}
                  </div>
                </button>
                {isExpanded && (
                  <div className="border-t border-slate-100 dark:border-slate-700/60 divide-y divide-slate-50 dark:divide-slate-700/60">
                    {row.transactions.map((tx) => (
                      <div key={tx.id} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold text-slate-700 dark:text-slate-300 shrink-0">{formatDate(tx.date)}</p>
                          <p className="text-xs font-medium text-slate-400 dark:text-slate-500 truncate">{tx.category} · {accountName(tx.account)}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-extrabold ${tx.type === 'income' ? 'text-emerald-600 dark:text-emerald-400' : tx.type === 'transfer' ? 'text-blue-600 dark:text-blue-400' : 'text-slate-900 dark:text-slate-100'}`}>
                            {tx.type === 'income' ? '+' : tx.type === 'transfer' ? '' : '-'}{formatCurrency(tx.amount)}
                          </span>
                          <Button variant="ghost" size="icon" className="text-slate-400 dark:text-slate-500 h-8 w-8 rounded-xl" onClick={() => openEdit(tx)}><Pencil className="w-3.5 h-3.5" /></Button>
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
        /* ── List View (date-grouped + swipe-to-delete) ────────────────── */
        <div className="space-y-1">
          {groupedByDate.map(({ date, txs }) => (
            <div key={date}>
              <div className="flex items-center gap-3 px-1 py-2">
                <span className="text-xs font-bold text-slate-400 dark:text-slate-500 whitespace-nowrap">{formatDate(date)}</span>
                <div className="flex-1 h-px bg-slate-100 dark:bg-slate-800" />
              </div>
              <div className="space-y-2">
                {txs.map((tx) => (
                  <SwipeableRow key={tx.id} tx={tx} accountName={accountName} onEdit={openEdit} onDelete={handleDelete} />
                ))}
              </div>
            </div>
          ))}
          {hasMore && (
            <div className="pt-4 flex justify-center">
              <Button variant="secondary" onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}>
                {t('transactions.showMore', { count: filtered.length - visibleTransactions.length })}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ── Add/Edit Transaction Modal ───────────────────────────────────── */}
      <Modal open={open} onClose={closeModal} title={editTarget ? t('transactions.editTransaction') : t('transactions.newTransaction')}>
        <div className="space-y-4 pb-4">
          <div className="flex p-1.5 rounded-2xl bg-slate-100 dark:bg-slate-700">
            {(['expense', 'income', 'transfer'] as const).map((tp) => (
              <button key={tp} onClick={() => handleTypeChange(tp)} className={`flex-1 py-2.5 text-sm font-bold rounded-xl transition-all duration-200 ${form.type === tp ? tp === 'expense' ? 'bg-white dark:bg-slate-800 text-rose-600 dark:text-rose-400 shadow-sm' : tp === 'income' ? 'bg-white dark:bg-slate-800 text-emerald-600 dark:text-emerald-400 shadow-sm' : 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}>
                {tp.charAt(0).toUpperCase() + tp.slice(1)}
              </button>
            ))}
          </div>
          <div>
            <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-1.5">{t('common.amountUsd')}</label>
            <div className="relative flex items-center">
              <span className="absolute left-4 text-2xl font-bold text-slate-400 dark:text-slate-500 pointer-events-none select-none">$</span>
              <input type="number" inputMode="decimal" min="0" step="0.01" placeholder="0.00" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} className="w-full pl-10 pr-4 py-3.5 text-2xl font-extrabold text-slate-900 dark:text-slate-100 placeholder-slate-300 bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-700 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label={t('common.date')} type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
            <Input label={t('common.description')} placeholder="e.g. Netflix" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {form.type !== 'transfer' && (
              <Select label={t('common.category')} value={form.category} options={categories.map((c) => ({ value: c, label: c }))} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} />
            )}
            <Select label={form.type === 'transfer' ? t('transactions.fromAccount') : t('common.account')} value={form.account}
              options={[{ value: '', label: t('common.nonePlaceholder') }, ...accounts.map((a) => ({ value: a.id, label: a.type === 'credit' || a.type === 'loan' ? `${a.name} (owed: ${formatCurrency(a.balance)})` : `${a.name} (${formatCurrency(a.balance)})` }))]}
              onChange={(e) => setForm((f) => ({ ...f, account: e.target.value }))} />
          </div>
          {form.type === 'transfer' && (
            <Select label={t('transactions.toAccount')} value={form.toAccount}
              options={[{ value: '', label: t('common.nonePlaceholder') }, ...accounts.filter((a) => a.id !== form.account).map((a) => ({ value: a.id, label: a.type === 'credit' || a.type === 'loan' ? `${a.name} · Pay off (owed: ${formatCurrency(a.balance)})` : `${a.name} (${formatCurrency(a.balance)})` }))]}
              onChange={(e) => setForm((f) => ({ ...f, toAccount: e.target.value }))} />
          )}
          {form.type === 'transfer' && form.toAccount && (() => {
            const toAcc = accounts.find((a) => a.id === form.toAccount);
            const isDebt = toAcc?.type === 'credit' || toAcc?.type === 'loan';
            const amt = parseFloat(form.amount) || 0;
            if (!toAcc || !amt) return null;
            return (
              <div className="text-sm text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 space-y-1">
                {isDebt ? <><p className="text-blue-600 dark:text-blue-400 font-bold text-xs">Credit card payoff</p><p className="font-medium text-xs">Balance after: <span className="text-slate-900 dark:text-slate-100 font-bold">{formatCurrency(Math.max(0, toAcc.balance - amt))} owed</span></p></> : <><p className="text-blue-600 dark:text-blue-400 font-bold text-xs">Transfer preview</p><p className="font-medium text-xs">{toAcc.name} after: <span className="text-slate-900 dark:text-slate-100 font-bold">{formatCurrency(toAcc.balance + amt)}</span></p></>}
              </div>
            );
          })()}
          {/* Save as template */}
          {!editTarget && (
            <button
              type="button"
              onClick={saveAsTemplate}
              className="flex items-center gap-1.5 text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors"
            >
              <Bookmark className="w-3.5 h-3.5" />
              {t('transactions.saveAsTemplate')}
            </button>
          )}
        </div>
        <div className="sticky bottom-0 bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700/60 -mx-6 sm:-mx-8 px-6 sm:px-8 py-4">
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={closeModal}>{t('common.cancel')}</Button>
            <Button className="flex-1" onClick={handleSave} disabled={saving || !form.amount}>{saving ? t('common.saving') : editTarget ? t('transactions.saveChanges') : t('transactions.addTransaction')}</Button>
          </div>
        </div>
      </Modal>

      {/* ── Templates Modal ──────────────────────────────────────────────── */}
      <Modal open={showTemplates} onClose={() => setShowTemplates(false)} title={t('transactions.recurringTemplates')}>
        <div className="space-y-2 pb-4">
          {templates.length === 0 ? (
            <div className="text-center py-8 text-slate-500 dark:text-slate-400 font-medium text-sm">{t('transactions.noTemplates')}<br />Use &quot;{t('transactions.saveAsTemplate')}&quot; when adding a transaction.</div>
          ) : templates.map((tpl) => (
            <div key={tpl.id} className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-700/50 border border-slate-100 dark:border-slate-700/60 hover:border-slate-200 dark:hover:border-slate-700 transition-colors">
              <div>
                <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{tpl.description || tpl.category}</p>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5">{tpl.category} · {formatCurrency(tpl.amount)}</p>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" className="h-8" onClick={() => applyTemplate(tpl)}>Use</Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/30" onClick={() => deleteTemplate(tpl.id)}><X className="w-3.5 h-3.5" /></Button>
              </div>
            </div>
          ))}
        </div>
      </Modal>

      {/* ── Loans / IOUs Modal ───────────────────────────────────────────── */}
      <Modal open={loansOpen} onClose={() => { setLoansOpen(false); setShowAddLoan(false); setPaybackFor(null); }} title={t('loans.title')}>
        <div className="space-y-4 pb-4">
          {/* Add loan: button → inline form */}
          {!showAddLoan ? (
            <Button className="w-full" onClick={() => { setShowAddLoan(true); setLoanForm(EMPTY_LOAN_FORM); setNewContactName(''); }}>
              <Plus className="w-4 h-4" />{t('loans.addLoan')}
            </Button>
          ) : (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
              {/* Direction toggle */}
              <div className="flex p-1.5 rounded-2xl bg-slate-100 dark:bg-slate-700">
                {(['lent', 'borrowed'] as const).map((d) => (
                  <button key={d} onClick={() => setLoanForm((f) => ({ ...f, direction: d }))} className={`flex-1 py-2.5 text-sm font-bold rounded-xl transition-all duration-200 ${loanForm.direction === d ? d === 'lent' ? 'bg-white dark:bg-slate-800 text-emerald-600 dark:text-emerald-400 shadow-sm' : 'bg-white dark:bg-slate-800 text-rose-600 dark:text-rose-400 shadow-sm' : 'text-slate-500 dark:text-slate-400'}`}>
                    {d === 'lent' ? t('loans.iLent') : t('loans.iBorrowed')}
                  </button>
                ))}
              </div>
              <Select
                label={t('loans.contact')}
                value={loanForm.contactId}
                options={[
                  { value: '', label: t('bills.selectContact') },
                  ...contacts.map((c) => ({ value: c.id, label: c.name })),
                  { value: NEW_CONTACT, label: t('bills.addNewContact') },
                ]}
                onChange={(e) => setLoanForm((f) => ({ ...f, contactId: e.target.value }))}
              />
              {loanForm.contactId === NEW_CONTACT && (
                <div className="flex gap-2 items-end">
                  <div className="flex-1"><Input label={t('bills.newContactName')} placeholder="e.g. Alex" value={newContactName} onChange={(e) => setNewContactName(e.target.value)} /></div>
                  <Button type="button" variant="secondary" className="shrink-0" onClick={handleAddLoanContact} disabled={addingContact || !newContactName.trim()}><UserPlus className="w-4 h-4" />{t('bills.addContact')}</Button>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input label={t('common.amountUsd')} type="number" min="0" step="0.01" placeholder="0.00" value={loanForm.amount} onChange={(e) => setLoanForm((f) => ({ ...f, amount: e.target.value }))} />
                <Input label={t('common.date')} type="date" value={loanForm.date} onChange={(e) => setLoanForm((f) => ({ ...f, date: e.target.value }))} />
              </div>
              <Select
                label={loanForm.direction === 'lent' ? t('loans.fromAccount') : t('loans.toAccount')}
                value={loanForm.account}
                options={[{ value: '', label: t('loans.noAccount') }, ...accounts.map((a) => ({ value: a.id, label: `${a.name} (${formatCurrency(a.balance)})` }))]}
                onChange={(e) => setLoanForm((f) => ({ ...f, account: e.target.value }))}
              />
              <Input label={t('loans.noteOptional')} placeholder={t('loans.notePlaceholder')} value={loanForm.note} onChange={(e) => setLoanForm((f) => ({ ...f, note: e.target.value }))} />
              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">{loanForm.account ? t('loans.cashHelp') : t('loans.noteOnlyHelp')}</p>
              <div className="flex gap-3 pt-1">
                <Button variant="secondary" className="flex-1" onClick={() => { setShowAddLoan(false); setLoanForm(EMPTY_LOAN_FORM); }}>{t('common.cancel')}</Button>
                <Button className="flex-1" onClick={handleAddLoan} disabled={savingLoan || !loanForm.amount || !loanForm.contactId || loanForm.contactId === NEW_CONTACT}>{savingLoan ? t('common.saving') : t('loans.addLoan')}</Button>
              </div>
            </div>
          )}

          {/* Totals */}
          {openLoans.length > 0 && (
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-100 dark:border-emerald-800/50">
                <p className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300 uppercase tracking-wider">{t('loans.owedToYou')}</p>
                <p className="text-lg font-extrabold text-emerald-600 dark:text-emerald-400 mt-0.5">{formatCurrency(owedToYou)}</p>
              </div>
              <div className="p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-900/30 border border-rose-100 dark:border-rose-800/50">
                <p className="text-[11px] font-bold text-rose-700 dark:text-rose-300 uppercase tracking-wider">{t('loans.youOwe')}</p>
                <p className="text-lg font-extrabold text-rose-600 dark:text-rose-400 mt-0.5">{formatCurrency(youOwe)}</p>
              </div>
            </div>
          )}

          {/* Open loans */}
          {openLoans.length === 0 && !showAddLoan && (
            <p className="text-center text-sm text-slate-500 dark:text-slate-400 font-medium py-6">{t('loans.empty')}</p>
          )}
          {openLoans.map((loan) => {
            const remaining = calcLoanRemaining(loan.principal, loan.repaidAmount);
            const pct = loan.principal > 0 ? Math.min(100, (loan.repaidAmount / loan.principal) * 100) : 0;
            const isLent = loan.direction === 'lent';
            const expanded = paybackFor === loan.id;
            return (
              <div key={loan.id} className={`p-4 rounded-2xl bg-white dark:bg-slate-800 border ${isLent ? 'border-emerald-100 dark:border-emerald-800/40' : 'border-rose-100 dark:border-rose-800/40'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${isLent ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400' : 'bg-rose-50 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400'}`}>
                      {isLent ? <ArrowUpRight className="w-4.5 h-4.5" /> : <ArrowDownLeft className="w-4.5 h-4.5" />}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">{loan.contactName}</p>
                      <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                        {isLent ? t('loans.lentLabel') : t('loans.borrowedLabel')}{loan.account ? ` · ${accountName(loan.account)}` : ''}{loan.note ? ` · ${loan.note}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`text-sm font-extrabold ${isLent ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{formatCurrency(remaining)}</p>
                    {loan.repaidAmount > 0 && <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500">{t('loans.ofPrincipal', { amount: formatCurrency(loan.principal) })}</p>}
                  </div>
                </div>
                {loan.repaidAmount > 0 && (
                  <div className="mt-3 h-1.5 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                    <div className={`h-full rounded-full ${isLent ? 'bg-emerald-500' : 'bg-rose-500'}`} style={{ width: `${pct}%` }} />
                  </div>
                )}
                <div className="flex items-center gap-2 mt-3">
                  <Button size="sm" variant="secondary" className="h-9" onClick={() => { if (expanded) { setPaybackFor(null); } else { setPaybackFor(loan.id); setPaybackForm({ amount: String(remaining), account: loan.account }); } }}>
                    {t('loans.recordPayback')}
                  </Button>
                  <button title={t('common.delete')} onClick={() => handleDeleteLoan(loan)} className="p-2 text-slate-300 dark:text-slate-600 hover:text-rose-500 dark:hover:text-rose-400 rounded-lg transition-colors ml-auto">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                {expanded && (
                  <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700/60 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Input label={t('loans.paybackAmount')} type="number" min="0" step="0.01" value={paybackForm.amount} onChange={(e) => setPaybackForm((f) => ({ ...f, amount: e.target.value }))} />
                      <Select
                        label={isLent ? t('loans.intoAccount') : t('loans.fromAccount')}
                        value={paybackForm.account}
                        options={[{ value: '', label: t('loans.noAccount') }, ...accounts.map((a) => ({ value: a.id, label: `${a.name} (${formatCurrency(a.balance)})` }))]}
                        onChange={(e) => setPaybackForm((f) => ({ ...f, account: e.target.value }))}
                      />
                    </div>
                    <div className="flex gap-3">
                      <Button variant="secondary" className="flex-1 h-10" onClick={() => setPaybackFor(null)}>{t('common.cancel')}</Button>
                      <Button className="flex-1 h-10" onClick={() => handleRecordPayback(loan)} disabled={recordingPayback || !paybackForm.amount}>{recordingPayback ? t('common.saving') : t('loans.confirmPayback')}</Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* Settled loans */}
          {settledLoans.length > 0 && (
            <div className="space-y-2 pt-2">
              <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider px-1">{t('loans.settled')}</p>
              {settledLoans.map((loan) => (
                <div key={loan.id} className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-700/40 border border-slate-100 dark:border-slate-700/60 opacity-75">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-700 dark:text-slate-300 truncate">{loan.contactName}</p>
                    <p className="text-xs font-medium text-slate-400 dark:text-slate-500 mt-0.5">{loan.direction === 'lent' ? t('loans.lentLabel') : t('loans.borrowedLabel')} · {t('loans.settledOn', { date: formatDate(loan.settledDate || loan.date) })}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-sm font-bold text-slate-400 dark:text-slate-500 line-through">{formatCurrency(loan.principal)}</span>
                    <button title={t('common.delete')} onClick={() => handleDeleteLoan(loan)} className="p-1.5 text-slate-300 dark:text-slate-600 hover:text-rose-500 dark:hover:text-rose-400 rounded-lg transition-colors"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>

      {/* ── Filter Sheet ─────────────────────────────────────────────────── */}
      <AnimatePresence>
        {filterSheetOpen && (
          <>
            <motion.div
              key="filter-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40"
              onClick={() => setFilterSheetOpen(false)}
            />
            <motion.div
              key="filter-sheet"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', bounce: 0.1, duration: 0.38 }}
              className="fixed bottom-[72px] left-0 right-0 z-50 bg-white dark:bg-slate-800 rounded-t-3xl border-t border-slate-200 dark:border-slate-700 shadow-[0_-20px_60px_rgba(0,0,0,0.12)] px-4 pt-5 pb-6 max-h-[70vh] overflow-y-auto"
            >
              <div className="w-10 h-1 bg-slate-200 dark:bg-slate-600 rounded-full mx-auto mb-4" />
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">{t('transactions.filters')}</h2>
                <button onClick={() => setFilterSheetOpen(false)} className="text-sm font-semibold text-indigo-600 dark:text-indigo-400 tap-highlight-none px-1">{t('nav.done')}</button>
              </div>
              <p className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">{t('common.type')}</p>
              <div className="flex gap-2 flex-wrap mb-5">
                {(['all', 'income', 'expense', 'transfer'] as const).map((f) => (
                  <button key={f} onClick={() => setFilter(f)} className={`px-3.5 h-9 rounded-xl text-xs font-bold transition-all duration-200 whitespace-nowrap ${filter === f ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900' : 'bg-slate-50 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600'}`}>
                    {filterLabels[f]}
                  </button>
                ))}
              </div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">{t('common.category')}</p>
                {categoryFilters.length > 0 && (
                  <button onClick={() => setCategoryFilters([])} className="text-[11px] font-bold text-rose-500 dark:text-rose-400 hover:text-rose-600 dark:hover:text-rose-400 tap-highlight-none flex items-center gap-1">
                    <X className="w-3 h-3" />{t('transactions.clearFilters')} ({categoryFilters.length})
                  </button>
                )}
              </div>
              <div className="flex gap-2 flex-wrap mb-4">
                <button onClick={() => setCategoryFilters([])} className={`px-3.5 h-9 rounded-xl text-xs font-bold transition-all duration-200 whitespace-nowrap ${categoryFilters.length === 0 ? 'bg-indigo-600 text-white' : 'bg-slate-50 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600'}`}>{t('common.all')}</button>
              </div>
              {expenseCategories.length > 0 && (
                <>
                  <p className="text-[11px] font-bold text-rose-500 dark:text-rose-400 uppercase tracking-wider mb-2">{t('common.expenses')}</p>
                  <div className="flex gap-2 flex-wrap mb-4">
                    {expenseCategories.map((c) => (
                      <button key={`exp-${c}`} onClick={() => toggleCategory(c)} className={`px-3.5 h-9 rounded-xl text-xs font-bold transition-all duration-200 whitespace-nowrap ${categoryFilters.includes(c) ? 'bg-indigo-600 text-white' : 'bg-slate-50 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600'}`}>{c}</button>
                    ))}
                  </div>
                </>
              )}
              {incomeCategories.length > 0 && (
                <>
                  <p className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mb-2">{t('common.income')}</p>
                  <div className="flex gap-2 flex-wrap">
                    {incomeCategories.map((c) => (
                      <button key={`inc-${c}`} onClick={() => toggleCategory(c)} className={`px-3.5 h-9 rounded-xl text-xs font-bold transition-all duration-200 whitespace-nowrap ${categoryFilters.includes(c) ? 'bg-indigo-600 text-white' : 'bg-slate-50 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600'}`}>{c}</button>
                    ))}
                  </div>
                </>
              )}
              {activeFilterCount > 0 && (
                <button onClick={() => { setFilter('all'); setCategoryFilters([]); }} className="mt-5 w-full py-2.5 text-sm font-semibold text-rose-500 dark:text-rose-400 hover:text-rose-600 dark:hover:text-rose-400 tap-highlight-none">
                  {t('transactions.clearFilters')}
                </button>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Swipeable transaction row ──────────────────────────────────────────────────

type SwipeRowProps = {
  tx: Transaction;
  accountName: (id: string) => string;
  onEdit: (tx: Transaction) => void;
  onDelete: (id: string) => void;
};

function SwipeableRow({ tx, accountName, onEdit, onDelete }: SwipeRowProps) {
  return (
    <SwipeToDelete onDelete={() => onDelete(tx.id)}>
      <div className="flex items-center justify-between p-4 bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700/60 rounded-3xl select-none">
        <div className="flex items-center gap-3.5 flex-1 min-w-0">
          <CategoryIconBadge category={tx.category} type={tx.type} className="w-11 h-11 rounded-2xl" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">{tx.description || tx.category}</p>
            <div className="flex items-center gap-1 mt-0.5">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400 truncate min-w-0">
                {tx.category}{tx.account ? ` · ${accountName(tx.account)}` : ''}{tx.type === 'transfer' && tx.toAccount ? ` → ${accountName(tx.toAccount)}` : ''}
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 ml-3 shrink-0">
          <span className={`text-sm font-extrabold whitespace-nowrap ${tx.type === 'income' ? 'text-emerald-600 dark:text-emerald-400' : tx.type === 'transfer' ? 'text-blue-600 dark:text-blue-400' : 'text-slate-900 dark:text-slate-100'}`}>
            {tx.type === 'income' ? '+' : tx.type === 'transfer' ? '' : '-'}{formatCurrency(tx.amount)}
          </span>
          <Button variant="ghost" size="icon" className="text-slate-400 dark:text-slate-500 h-9 w-9 rounded-xl" onClick={(e) => { e.stopPropagation(); onEdit(tx); }}>
            <Pencil className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </SwipeToDelete>
  );
}
