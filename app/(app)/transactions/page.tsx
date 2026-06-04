'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus, Search, Pencil, RefreshCw, AlertCircle, Download, Users, List, Bookmark, BookmarkCheck, ChevronDown, ChevronLeft, ChevronRight, X, Filter, ArrowLeftRight, HandCoins, ArrowUpRight, ArrowDownLeft, UserPlus, Trash2, Check, Archive, Split as SplitIcon } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { SwipeToDelete } from '@/components/ui/SwipeToDelete';
import { TransactionsSkeleton } from '@/components/ui/Skeleton';
import { Collapsible } from '@/components/ui/Collapsible';
import { formatCurrency, formatCompact, formatDate, generateId, today } from '@/lib/utils';
import { transactionsToCsv } from '@/lib/csv';
import { calcLoanRemaining } from '@/lib/calculations';
import { buildSplitTx, groupSplits, isOneOffSplit, newOneOffGroupId, resolveSplit, splitRemaining, type SplitGroup } from '@/lib/splits';
import { motion, AnimatePresence } from 'framer-motion';
import { EXPENSE_CATEGORIES } from '@/types';
import type { Transaction, Account, Contact, Loan, Split } from '@/types';
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
const PAGE_SIZE = 25;

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
  category: '', // descriptive bucket for history lookup; '' = uncategorized
};
// Sentinel option that opens the inline "add new contact" input.
const NEW_CONTACT = '__new__';

// ── One-time split-an-expense (e.g. "I paid for dinner for the group") ──────────
// A single ad-hoc expense shared across MULTIPLE people. Your share is the only
// real expense; everyone else's share is fronted out of the account and tracked
// as a Split receivable (see lib/splits). Each participant becomes one Split,
// tied together by a `oneoff:`-tagged group id.
const EMPTY_SPLIT_EXPENSE = {
  description: '', total: '', date: today(), account: '', category: 'Food', includeMe: false,
  // Your explicitly-typed share, used only when the total is left blank (so the
  // total is inferred by summing the parts) and you include yourself.
  myShare: '',
};
type SplitParticipant = { key: string; contactId: string; amount: string; newName: string };
function emptyParticipant(): SplitParticipant {
  return { key: generateId(), contactId: '', amount: '', newName: '' };
}

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
    // Tagged 'Loan' (not 'Transfer') so the ledger history shows a distinct
    // loan icon/name. It stays a `transfer`, so income/expense math is unaffected.
    category: 'Loan',
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
  const [editingLoanId, setEditingLoanId] = useState<string | null>(null);
  const [loanForm, setLoanForm] = useState(EMPTY_LOAN_FORM);
  // Participants for a NEW group loan (edit stays single-contact via loanForm).
  const [loanParticipants, setLoanParticipants] = useState<SplitParticipant[]>([emptyParticipant()]);
  const [newContactName, setNewContactName] = useState('');
  const [addingContact, setAddingContact] = useState(false);
  const [savingLoan, setSavingLoan] = useState(false);
  const [paybackFor, setPaybackFor] = useState<string | null>(null);
  const [paybackForm, setPaybackForm] = useState({ amount: '', account: '' });
  const [recordingPayback, setRecordingPayback] = useState(false);
  const [expandedLoanGroups, setExpandedLoanGroups] = useState<Set<string>>(new Set());
  const [showLoanHistory, setShowLoanHistory] = useState(false);
  // Split bills (one-time expense splits)
  const [splits, setSplits] = useState<Split[]>([]);
  const [splitsOpen, setSplitsOpen] = useState(false);
  const [showSplitExpense, setShowSplitExpense] = useState(false);
  const [splitExpenseForm, setSplitExpenseForm] = useState(EMPTY_SPLIT_EXPENSE);
  const [splitParticipants, setSplitParticipants] = useState<SplitParticipant[]>([emptyParticipant()]);
  const [savingSplitExpense, setSavingSplitExpense] = useState(false);
  // Loan-style "record payment" for an "owed to you" split — splitPaybackFor is the
  // the split id whose inline form is open; the form holds the entered amount and
  // the account the cash returns into. (Kept separate from the loan payback state.)
  const [splitPaybackFor, setSplitPaybackFor] = useState<string | null>(null);
  const [splitPaybackForm, setSplitPaybackForm] = useState({ amount: '', account: '' });
  const [recordingSplitPayback, setRecordingSplitPayback] = useState(false);
  // Whole-group edit for a pending split: editingGroupKey is the group whose
  // card is replaced by the (reused) split-expense form, pre-filled with every
  // member. editingGroupSplits snapshots that group's members so the save can
  // reconcile (update / add / remove) against them. The form itself reuses
  // splitExpenseForm + splitParticipants — only the submit handler differs.
  const [editingGroupKey, setEditingGroupKey] = useState<string | null>(null);
  const [editingGroupSplits, setEditingGroupSplits] = useState<Split[]>([]);
  const [savingEditGroup, setSavingEditGroup] = useState(false);
  const [expandedSplitGroups, setExpandedSplitGroups] = useState<Set<string>>(new Set());
  const [showSplitHistory, setShowSplitHistory] = useState(false);
  const toast = useToast();
  const { expenseCategories, incomeCategories, archivedExpenseCategories, archivedIncomeCategories } = useCategories();
  const { t } = useTranslation();

  const load = useCallback(async () => {
    setError(false);
    try {
      const [txRes, accRes, loanRes, conRes, splitRes] = await Promise.all([
        fetch('/api/transactions'), fetch('/api/accounts'), fetch('/api/loans'), fetch('/api/contacts'), fetch('/api/splits'),
      ]);
      if (!txRes.ok || !accRes.ok) throw new Error();
      const [txs, accs, lns, cons, spls] = await Promise.all([
        txRes.json(), accRes.json(),
        loanRes.ok ? loanRes.json() : Promise.resolve([]),
        conRes.ok ? conRes.json() : Promise.resolve([]),
        splitRes.ok ? splitRes.json() : Promise.resolve([]),
      ]);
      setTransactions([...txs].sort((a: Transaction, b: Transaction) => {
        const dateCmp = b.date.localeCompare(a.date);
        if (dateCmp !== 0) return dateCmp;
        return (b.createdAt ?? b.id).localeCompare(a.createdAt ?? a.id);
      }));
      setAccounts(accs);
      setLoans(lns);
      setContacts(cons);
      setSplits(spls);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setTemplates(loadTemplates()); }, []);
  // One-shot: retag pre-existing loan/split transfers from 'Transfer' to their
  // dedicated 'Loan'/'Split' category. Guarded per browser; reloads if it changed
  // anything so the history reflects the new icons/names immediately.
  useEffect(() => {
    const KEY = 'nf_loan_split_cat_backfill_v1';
    try { if (localStorage.getItem(KEY)) return; } catch { return; }
    fetch('/api/transactions/backfill-categories', { method: 'POST' })
      .then((r) => (r.ok ? r.json() : null))
      .then((res) => {
        try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ }
        if (res?.updated > 0) load();
      })
      .catch(() => {});
  }, [load]);
  useAutoRefresh(load);
  const { pullY, refreshing } = usePullToRefresh(load);

  const categories = form.type === 'expense' ? expenseCategories : form.type === 'income' ? incomeCategories : [...EXPENSE_CATEGORIES];

  const accountMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const a of accounts) m[a.id] = a.name;
    return m;
  }, [accounts]);

  // Transfers OWNED by a loan or split (its principal/payback or fronted/settle
  // cash rows). Their amount & accounts are reconciled by the loans/splits APIs,
  // so editing those fields — or deleting the row — from the generic ledger would
  // desync the owning record. We let the date/note be edited but lock the rest.
  const managedTxIds = useMemo(() => {
    const s = new Set<string>();
    for (const l of loans) {
      if (l.principalTxId) s.add(l.principalTxId);
      for (const id of l.repaymentTxIds ?? []) if (id) s.add(id);
    }
    for (const sp of splits) {
      if (sp.frontedTxId) s.add(sp.frontedTxId);
      if (sp.settleTxId) s.add(sp.settleTxId);
      for (const id of sp.repaymentTxIds ?? []) if (id) s.add(id);
    }
    return s;
  }, [loans, splits]);
  const editManaged = !!editTarget && managedTxIds.has(editTarget.id);

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

  // Propagate an amount change on a loan/split-owned transfer back to the owning
  // record so its denormalized numbers stay correct (loan.principal /
  // loan.repaidAmount / split.amount). The edited row's balance is already handled
  // by the transactions PUT; for a split we also update the OTHER cash leg so the
  // fronted-out and paid-back amounts stay equal. Throws on failure so handleSave
  // falls back to a reload. NOTE (best-effort, per design): for a split this syncs
  // the person's share + both cash legs, but does NOT rebalance the original group
  // total or your own recorded share.
  async function syncOwnerAmount(original: Transaction, newAmount: number) {
    const loanP = loans.find((l) => l.principalTxId === original.id);
    if (loanP) {
      const fullyPaid = newAmount > 0 && loanP.repaidAmount >= roundCents(newAmount) - 0.005;
      const next: Loan = { ...loanP, principal: newAmount, settled: fullyPaid, settledDate: fullyPaid ? (loanP.settledDate || today()) : '' };
      setLoans((prev) => prev.map((l) => l.id === next.id ? next : l));
      const r = await fetch('/api/loans', { method: 'POST', body: JSON.stringify(next), headers: { 'Content-Type': 'application/json' } });
      if (!r.ok) throw new Error();
      return;
    }
    const loanR = loans.find((l) => (l.repaymentTxIds ?? []).includes(original.id));
    if (loanR) {
      const repaid = Math.max(0, roundCents(loanR.repaidAmount - original.amount + newAmount));
      const fullyPaid = repaid >= roundCents(loanR.principal) - 0.005;
      const next: Loan = { ...loanR, repaidAmount: repaid, settled: fullyPaid, settledDate: fullyPaid ? (loanR.settledDate || today()) : '' };
      setLoans((prev) => prev.map((l) => l.id === next.id ? next : l));
      const r = await fetch('/api/loans', { method: 'POST', body: JSON.stringify(next), headers: { 'Content-Type': 'application/json' } });
      if (!r.ok) throw new Error();
      return;
    }
    // Editing a single payback leg adjusts the running repaidAmount (mirrors the
    // loan repayment branch above) without touching the owed share.
    const splitR = splits.find((s) => (s.repaymentTxIds ?? []).includes(original.id));
    if (splitR) {
      const repaid = Math.max(0, roundCents(splitR.repaidAmount - original.amount + newAmount));
      const fullyPaid = repaid >= roundCents(splitR.amount) - 0.005;
      const next: Split = { ...splitR, repaidAmount: repaid, settled: fullyPaid, settledDate: fullyPaid ? (splitR.settledDate || today()) : '' };
      setSplits((prev) => prev.map((s) => s.id === next.id ? next : s));
      const r = await fetch('/api/splits', { method: 'POST', body: JSON.stringify(next), headers: { 'Content-Type': 'application/json' } });
      if (!r.ok) throw new Error();
      return;
    }
    const split = splits.find((s) => s.frontedTxId === original.id || s.settleTxId === original.id);
    if (split) {
      const next: Split = { ...split, amount: newAmount };
      setSplits((prev) => prev.map((s) => s.id === next.id ? next : s));
      const r = await fetch('/api/splits', { method: 'POST', body: JSON.stringify(next), headers: { 'Content-Type': 'application/json' } });
      if (!r.ok) throw new Error();
      // Keep the other cash leg (fronted/legacy settle) equal to the new share.
      const siblingId = split.frontedTxId === original.id ? split.settleTxId : split.frontedTxId;
      const sibling = siblingId ? transactions.find((tx) => tx.id === siblingId) : undefined;
      if (sibling && roundCents(sibling.amount) !== roundCents(newAmount)) {
        const updatedSibling: Transaction = { ...sibling, amount: newAmount };
        setTransactions((prev) => prev.map((tx) => tx.id === sibling.id ? updatedSibling : tx));
        const r2 = await fetch('/api/transactions', { method: 'PUT', body: JSON.stringify({ original: sibling, updated: updatedSibling }), headers: { 'Content-Type': 'application/json' } });
        if (!r2.ok) throw new Error();
      }
    }
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
      // Loan/split-owned row: keep the owning record (and a split's other cash
      // leg) in sync when the amount changed.
      if (editTarget && managedTxIds.has(editTarget.id) && roundCents(amount) !== roundCents(editTarget.amount)) {
        await syncOwnerAmount(editTarget, amount);
      }
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
  // Collapse multi-person loans (shared groupId) into one expandable row; loans
  // with no groupId (or a single loan left in a group) stay standalone. Used for
  // both the open and settled lists so loans group exactly like Bills/Splits.
  function groupLoansByGroupId(list: Loan[], keyPrefix = '') {
    const map = new Map<string, Loan[]>();
    for (const l of list) {
      const key = l.groupId || `solo:${l.id}`;
      (map.get(key) ?? map.set(key, []).get(key)!).push(l);
    }
    return [...map.entries()].map(([key, loans]) => ({
      key: keyPrefix + key,
      loans,
      isGroup: loans.length > 1,
      direction: loans[0].direction,
      remaining: loans.reduce((s, l) => s + calcLoanRemaining(l.principal, l.repaidAmount), 0),
      principal: loans.reduce((s, l) => s + l.principal, 0),
    }));
  }
  const openLoanGroups = useMemo(() => groupLoansByGroupId(openLoans), [openLoans]);
  const settledLoanGroups = useMemo(() => groupLoansByGroupId(settledLoans, 'settled:'), [settledLoans]);
  function toggleLoanGroup(key: string) {
    setExpandedLoanGroups((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }

  // One open-loan card (standalone, or nested inside an expanded group). `nested`
  // drops the outer border so it reads as a sub-row of the group container.
  function renderOpenLoanCard(loan: Loan, nested = false) {
    const remaining = calcLoanRemaining(loan.principal, loan.repaidAmount);
    const pct = loan.principal > 0 ? Math.min(100, (loan.repaidAmount / loan.principal) * 100) : 0;
    const isLent = loan.direction === 'lent';
    const expanded = paybackFor === loan.id;
    return (
      <div key={loan.id} className={nested ? 'p-3 rounded-xl bg-slate-50 dark:bg-slate-700/30' : `p-4 rounded-2xl bg-white dark:bg-slate-800 border ${isLent ? 'border-emerald-100 dark:border-emerald-800/40' : 'border-rose-100 dark:border-rose-800/40'}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {!nested && (
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${isLent ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400' : 'bg-rose-50 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400'}`}>
                {isLent ? <ArrowUpRight className="w-4.5 h-4.5" /> : <ArrowDownLeft className="w-4.5 h-4.5" />}
              </div>
            )}
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
          <button title={t('common.edit')} onClick={() => openEditLoan(loan)} className="p-2 text-slate-300 dark:text-slate-600 hover:text-indigo-500 dark:hover:text-indigo-400 rounded-lg transition-colors ml-auto">
            <Pencil className="w-4 h-4" />
          </button>
          <button title={t('common.delete')} onClick={() => handleDeleteLoan(loan)} className="p-2 text-slate-300 dark:text-slate-600 hover:text-rose-500 dark:hover:text-rose-400 rounded-lg transition-colors">
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
  }

  // A multi-person loan group: collapsed header (people + total remaining) that
  // expands to each person's own loan card (settle/edit/delete independently).
  function renderOpenLoanGroup(group: { key: string; loans: Loan[]; direction: Loan['direction']; remaining: number }) {
    const isLent = group.direction === 'lent';
    const open = expandedLoanGroups.has(group.key);
    const names = group.loans.map((l) => l.contactName).join(', ');
    return (
      <div key={group.key} className={`rounded-2xl bg-white dark:bg-slate-800 border ${isLent ? 'border-emerald-100 dark:border-emerald-800/40' : 'border-rose-100 dark:border-rose-800/40'}`}>
        <button onClick={() => toggleLoanGroup(group.key)} className="w-full flex items-center justify-between gap-3 p-4 text-left">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${isLent ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400' : 'bg-rose-50 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400'}`}>
              <Users className="w-4.5 h-4.5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">{t('loans.peopleCount', { n: group.loans.length })}</p>
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5 truncate">{isLent ? t('loans.lentLabel') : t('loans.borrowedLabel')} · {names}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <p className={`text-sm font-extrabold ${isLent ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{formatCurrency(group.remaining)}</p>
            <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
          </div>
        </button>
        <Collapsible open={open}>
          <div className="px-3 pb-3 space-y-2">
            {group.loans.map((l) => renderOpenLoanCard(l, true))}
          </div>
        </Collapsible>
      </div>
    );
  }

  // One settled-loan row (standalone, or nested inside an expanded group).
  function renderSettledLoanCard(loan: Loan, nested = false) {
    return (
      <div key={loan.id} className={`flex items-center justify-between ${nested ? 'px-3 py-2.5 rounded-xl bg-white dark:bg-slate-800/60' : 'p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-700/40 border border-slate-100 dark:border-slate-700/60 opacity-75'}`}>
        <div className="min-w-0">
          <p className="text-sm font-bold text-slate-700 dark:text-slate-300 truncate">{loan.contactName}</p>
          <p className="text-xs font-medium text-slate-400 dark:text-slate-500 mt-0.5">{loan.direction === 'lent' ? t('loans.lentLabel') : t('loans.borrowedLabel')} · {t('loans.settledOn', { date: formatDate(loan.settledDate || loan.date) })}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-sm font-bold text-slate-400 dark:text-slate-500 line-through">{formatCurrency(loan.principal)}</span>
          <button title={t('common.delete')} onClick={() => handleDeleteLoan(loan)} className="p-1.5 text-slate-300 dark:text-slate-600 hover:text-rose-500 dark:hover:text-rose-400 rounded-lg transition-colors"><Trash2 className="w-4 h-4" /></button>
        </div>
      </div>
    );
  }

  // A settled multi-person loan group: same collapsed/expandable shape as the
  // open group (and the Splits history), so all three read consistently.
  function renderSettledLoanGroup(group: { key: string; loans: Loan[]; direction: Loan['direction']; principal: number }) {
    const isLent = group.direction === 'lent';
    const open = expandedLoanGroups.has(group.key);
    const names = group.loans.map((l) => l.contactName).join(', ');
    return (
      <div key={group.key} className="rounded-2xl bg-slate-50 dark:bg-slate-700/40 border border-slate-100 dark:border-slate-700/60 opacity-75">
        <button onClick={() => toggleLoanGroup(group.key)} className="w-full flex items-center justify-between gap-3 p-3.5 text-left">
          <div className="flex items-center gap-2.5 min-w-0">
            <ChevronDown className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-700 dark:text-slate-300 truncate">{t('loans.peopleCount', { n: group.loans.length })}</p>
              <p className="text-xs font-medium text-slate-400 dark:text-slate-500 mt-0.5 truncate">{isLent ? t('loans.lentLabel') : t('loans.borrowedLabel')} · {names}</p>
            </div>
          </div>
          <span className="text-sm font-bold text-slate-400 dark:text-slate-500 line-through ml-2 shrink-0">{formatCurrency(group.principal)}</span>
        </button>
        <Collapsible open={open}>
          <div className="px-3 pb-3 space-y-2">
            {group.loans.map((l) => renderSettledLoanCard(l, true))}
          </div>
        </Collapsible>
      </div>
    );
  }

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

  // ── Loan participants (new group loan) ──
  function updateLoanParticipant(key: string, patch: Partial<SplitParticipant>) {
    setLoanParticipants((prev) => prev.map((p) => p.key === key ? { ...p, ...patch } : p));
  }
  function addLoanParticipantRow() {
    setLoanParticipants((prev) => [...prev, emptyParticipant()]);
  }
  function removeLoanParticipantRow(key: string) {
    setLoanParticipants((prev) => prev.length > 1 ? prev.filter((p) => p.key !== key) : prev);
  }
  function loanSplitEqually() {
    setLoanParticipants((prev) => prev.map((p) => ({ ...p, amount: '' })));
  }
  async function handleAddLoanParticipantContact(row: SplitParticipant) {
    const name = row.newName.trim();
    if (!name) return;
    setAddingContact(true);
    const contact: Contact = { id: generateId(), name, createdAt: new Date().toISOString() };
    try {
      const res = await fetch('/api/contacts', { method: 'POST', body: JSON.stringify(contact), headers: { 'Content-Type': 'application/json' } });
      if (!res.ok) throw new Error();
      setContacts((prev) => [...prev, contact].sort((a, b) => a.name.localeCompare(b.name)));
      updateLoanParticipant(row.key, { contactId: contact.id, newName: '' });
    } catch {
      toast(t('loans.toastFailedContact'), 'error');
    } finally {
      setAddingContact(false);
    }
  }

  // Creates one loan per participant. The entered amount is the TOTAL; each
  // person's principal is their share (typed, or auto-divided from the remainder
  // for blank boxes — same rule as Split Bills). One person = a normal loan.
  async function handleAddLoan() {
    const namedRows = loanParticipants.filter((p) => !!contacts.find((c) => c.id === p.contactId));
    if (namedRows.length === 0) return;
    const amounts = namedRows.map((p) => (p.amount.trim() === '' ? null : (parseFloat(p.amount) || 0)));
    const totalInput = loanForm.amount.trim() === '' ? null : (parseFloat(loanForm.amount) || 0);
    // Total filled → divide it across people (blanks auto-split the rest); total
    // blank → sum each person's typed share. You never take a share of a loan.
    const { shares, over } = resolveSplit(totalInput, amounts, false);
    if (over) { toast(t('bills.splitExpenseOverTotal'), 'error'); return; }
    const resolved = namedRows
      .map((p, i) => ({ contact: contacts.find((c) => c.id === p.contactId)!, amount: roundCents(shares[i]) }))
      .filter((p) => p.amount > 0);
    if (resolved.length === 0) return;

    // Multi-person loans created in one go share a groupId so they collapse into
    // one expandable row (each person still settles independently).
    const groupId = resolved.length > 1 ? generateId() : undefined;
    setSavingLoan(true);
    const created: Loan[] = [];
    let anyTx = false;
    try {
      // Sequential — each principal transfer mutates the same account balance
      // server-side, so parallel writes would race.
      for (const p of resolved) {
        const desc = loanForm.direction === 'lent'
          ? t('loans.txLent', { name: p.contact.name })
          : t('loans.txBorrowed', { name: p.contact.name });
        const tx = loanForm.account ? buildLoanTx(loanForm.direction, 'principal', p.amount, loanForm.account, desc, loanForm.date) : null;
        const loan: Loan = {
          id: generateId(),
          direction: loanForm.direction,
          contactId: p.contact.id,
          contactName: p.contact.name,
          account: loanForm.account,
          principal: p.amount,
          repaidAmount: 0,
          date: loanForm.date,
          note: loanForm.note,
          settled: false,
          settledDate: '',
          principalTxId: tx ? tx.id : '',
          repaymentTxIds: [],
          category: loanForm.category,
          groupId,
        };
        const res = await fetch('/api/loans', { method: 'POST', body: JSON.stringify(tx ? { loan, tx } : { loan }), headers: { 'Content-Type': 'application/json' } });
        if (!res.ok) throw new Error();
        created.push(loan);
        if (tx) anyTx = true;
      }
      setLoans((prev) => [...created, ...prev]);
      setShowAddLoan(false);
      setLoanForm(EMPTY_LOAN_FORM);
      setNewContactName('');
      setLoanParticipants([emptyParticipant()]);
      toast(created.length > 1 ? t('loans.toastAddedGroup', { n: created.length }) : t('loans.toastAdded'), 'success');
      if (anyTx) load(); // refresh balances + ledger
    } catch {
      toast(t('loans.toastFailed'), 'error');
      if (created.length) await load(); // partial write — reconcile from server
    } finally {
      setSavingLoan(false);
    }
  }

  // Opens the inline loan form pre-filled for editing an existing loan.
  function openEditLoan(loan: Loan) {
    setEditingLoanId(loan.id);
    setShowAddLoan(true);
    setNewContactName('');
    setPaybackFor(null);
    setLoanForm({
      direction: loan.direction,
      contactId: loan.contactId,
      amount: String(loan.principal),
      account: loan.account,
      date: loan.date,
      note: loan.note,
      category: loan.category ?? '',
    });
  }

  // Saves edits to an existing loan. The principal cash transfer is rebuilt from
  // the new amount/account/direction; the loans API reverses the old one and
  // applies the new one atomically. Paybacks (and repaidAmount) are preserved;
  // only `settled` is recomputed against the new principal.
  async function handleEditLoan() {
    const original = loans.find((l) => l.id === editingLoanId);
    if (!original) return;
    const amount = parseFloat(loanForm.amount) || 0;
    if (!loanForm.contactId || loanForm.contactId === NEW_CONTACT || amount <= 0) return;
    const contact = contacts.find((c) => c.id === loanForm.contactId);
    if (!contact) return;
    setSavingLoan(true);
    const desc = loanForm.direction === 'lent'
      ? t('loans.txLent', { name: contact.name })
      : t('loans.txBorrowed', { name: contact.name });
    const newTx = loanForm.account
      ? buildLoanTx(loanForm.direction, 'principal', amount, loanForm.account, desc, loanForm.date)
      : null;
    const fullyPaid = amount > 0 && roundCents(original.repaidAmount) >= roundCents(amount) - 0.005;
    const updated: Loan = {
      ...original,
      direction: loanForm.direction,
      contactId: contact.id,
      contactName: contact.name,
      account: loanForm.account,
      principal: amount,
      date: loanForm.date,
      note: loanForm.note,
      category: loanForm.category,
      settled: fullyPaid,
      settledDate: fullyPaid ? (original.settledDate || today()) : '',
      principalTxId: newTx ? newTx.id : '',
    };
    try {
      const res = await fetch('/api/loans', {
        method: 'PUT',
        body: JSON.stringify({ updated, newTx: newTx ?? undefined, removeTxId: original.principalTxId || undefined }),
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error();
      setLoans((prev) => prev.map((l) => l.id === updated.id ? updated : l));
      setShowAddLoan(false);
      setEditingLoanId(null);
      setLoanForm(EMPTY_LOAN_FORM);
      setNewContactName('');
      toast(t('loans.toastUpdated'), 'success');
      // Refresh balances/ledger when the principal cash row changed.
      if (newTx || original.principalTxId) load();
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
      // Cash transaction + loan update go in one request so balances and the
      // loan's repaidAmount/repaymentTxIds always move together.
      const res = await fetch('/api/loans', { method: 'POST', body: JSON.stringify(tx ? { loan: updated, tx } : { loan: updated }), headers: { 'Content-Type': 'application/json' } });
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
      // The loans API reverses and deletes every linked cash transaction
      // (principal + paybacks) atomically, so the client just deletes the loan.
      const res = await fetch('/api/loans', { method: 'DELETE', body: JSON.stringify({ id: loan.id }), headers: { 'Content-Type': 'application/json' } });
      if (!res.ok) throw new Error();
      toast(t('loans.toastDeleted'), 'success');
      // Refresh balances + ledger if any cash transactions were reversed.
      if (loan.principalTxId || loan.repaymentTxIds.length) load();
    } catch {
      setLoans(prev);
      toast(t('loans.toastFailed'), 'error');
    }
  }

  // ── Split bills (one-time expense splits) ───────────────────────────────────
  // Only one-time splits surface here; recurring shared-bill splits live on the
  // Bills page (see lib/splits isOneOffSplit).
  const oneOffSplits = useMemo(() => splits.filter(isOneOffSplit), [splits]);
  const pendingSplits = useMemo(() => oneOffSplits.filter((s) => !s.settled).sort((a, b) => b.date.localeCompare(a.date)), [oneOffSplits]);
  const settledSplits = useMemo(() => oneOffSplits.filter((s) => s.settled).sort((a, b) => (b.settledDate || '').localeCompare(a.settledDate || '')), [oneOffSplits]);
  const pendingSplitGroups = useMemo(() => groupSplits(pendingSplits), [pendingSplits]);
  const settledSplitGroups = useMemo(() => groupSplits(settledSplits), [settledSplits]);
  const totalOwedSplits = useMemo(() => pendingSplits.reduce((s, x) => s + x.amount, 0), [pendingSplits]);

  function toggleSplitGroup(key: string) {
    setExpandedSplitGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function openSplitExpense() {
    setEditingGroupKey(null);
    setEditingGroupSplits([]);
    setSplitExpenseForm(EMPTY_SPLIT_EXPENSE);
    setSplitParticipants([emptyParticipant()]);
    setShowSplitExpense(true);
  }
  function updateParticipant(key: string, patch: Partial<SplitParticipant>) {
    setSplitParticipants((prev) => prev.map((p) => p.key === key ? { ...p, ...patch } : p));
  }
  function addParticipantRow() {
    setSplitParticipants((prev) => [...prev, emptyParticipant()]);
  }
  function removeParticipantRow(key: string) {
    setSplitParticipants((prev) => prev.length > 1 ? prev.filter((p) => p.key !== key) : prev);
  }
  // Inline "add new contact" from a participant row — creates a reusable contact
  // and selects it in that row.
  async function handleAddParticipantContact(row: SplitParticipant) {
    const name = row.newName.trim();
    if (!name) return;
    setAddingContact(true);
    const contact: Contact = { id: generateId(), name, createdAt: new Date().toISOString() };
    try {
      const res = await fetch('/api/contacts', { method: 'POST', body: JSON.stringify(contact), headers: { 'Content-Type': 'application/json' } });
      if (!res.ok) throw new Error();
      setContacts((prev) => [...prev, contact].sort((a, b) => a.name.localeCompare(b.name)));
      updateParticipant(row.key, { contactId: contact.id, newName: '' });
      toast(t('bills.toastContactAdded'), 'success');
    } catch {
      toast(t('bills.toastFailedContact'), 'error');
    } finally {
      setAddingContact(false);
    }
  }
  // Auto-divide: clear every amount so all participants (and you, when included)
  // split the total evenly. Blank boxes are resolved live by resolveSplit.
  function splitEqually() {
    setSplitParticipants((prev) => prev.map((p) => ({ ...p, amount: '' })));
  }
  async function handleSaveSplitExpense() {
    const description = splitExpenseForm.description.trim();
    if (!description) return;
    // Only rows naming a person take part.
    const namedRows = splitParticipants.filter((p) => !!contacts.find((c) => c.id === p.contactId));
    if (namedRows.length === 0) { toast(t('bills.splitExpenseNeedPeople'), 'error'); return; }
    const amounts = namedRows.map((p) => (p.amount.trim() === '' ? null : (parseFloat(p.amount) || 0)));
    const totalInput = splitExpenseForm.total.trim() === '' ? null : (parseFloat(splitExpenseForm.total) || 0);
    // Total filled → divide it across people; total blank → sum the parts (your
    // own typed share included when you're in the split).
    const { shares, myShare, over, total } = resolveSplit(totalInput, amounts, splitExpenseForm.includeMe, parseFloat(splitExpenseForm.myShare) || 0);
    if (over) { toast(t('bills.splitExpenseOverTotal'), 'error'); return; }
    if (total <= 0) return;
    const resolved = namedRows
      .map((p, i) => ({ contact: contacts.find((c) => c.id === p.contactId)!, amount: roundCents(shares[i]) }))
      .filter((p) => p.amount > 0);
    if (resolved.length === 0) { toast(t('bills.splitExpenseNeedPeople'), 'error'); return; }
    const othersTotal = roundCents(resolved.reduce((s, p) => s + p.amount, 0));

    setSavingSplitExpense(true);
    const { date, account, category } = splitExpenseForm;
    const groupId = newOneOffGroupId();
    const created: Split[] = [];
    try {
      // Your share is the only real expense; the rest is fronted (see buildSplitTx).
      if (myShare > 0) {
        const tx: Transaction = {
          id: generateId(), date, description, amount: myShare,
          type: 'expense', category, account, createdAt: new Date().toISOString(),
        };
        const txRes = await fetch('/api/transactions', { method: 'POST', body: JSON.stringify(tx), headers: { 'Content-Type': 'application/json' } });
        if (!txRes.ok) throw new Error();
      }
      // Post each participant's split sequentially — every fronted transfer mutates
      // the same account balance server-side, so parallel writes would race.
      for (const p of resolved) {
        const frontedTx = account
          ? buildSplitTx('cashOut', p.amount, account, t('bills.txFronted', { name: p.contact.name, bill: description }), date)
          : null;
        const split: Split = {
          id: generateId(), billId: groupId, billName: description,
          contactId: p.contact.id, contactName: p.contact.name, amount: p.amount,
          category, account, date, settled: false, settledDate: '',
          repaidAmount: 0, repaymentTxIds: [],
          frontedTxId: frontedTx?.id ?? '', settleTxId: '',
        };
        const sRes = await fetch('/api/splits', {
          method: 'POST',
          body: JSON.stringify(frontedTx ? { split, tx: frontedTx } : split),
          headers: { 'Content-Type': 'application/json' },
        });
        if (!sRes.ok) throw new Error();
        created.push(split);
      }
      setSplits((prev) => [...created, ...prev]);
      setShowSplitExpense(false);
      // Refresh balances/ledger when cash was fronted out of an account.
      if (account) load();
      toast(t('bills.toastSplitExpense', { n: created.length, amount: formatCurrency(othersTotal) }), 'success');
    } catch {
      toast(t('bills.toastFailedSplit'), 'error');
      await load();
    } finally {
      setSavingSplitExpense(false);
    }
  }
  // Open / close the inline "record payment" form for one "owed to you" split,
  // mirroring the loan payback form. Opening pre-fills the amount with what's
  // still owed and the account with the one the share was fronted from.
  function openSplitPayback(split: Split) {
    if (splitPaybackFor === split.id) { setSplitPaybackFor(null); return; }
    setSplitPaybackFor(split.id);
    setSplitPaybackForm({ amount: String(splitRemaining(split)), account: split.account });
  }

  // Record a (possibly partial) payback for a split share — the same model as a
  // loan payback. The entered amount accumulates in repaidAmount; once it covers
  // the full share the split is marked settled. When an account is chosen the
  // share is returned INTO it as a cash-in transfer (bundled with the split so the
  // balance and the receivable move together); a note-only split just advances
  // repaidAmount.
  async function handleRecordSplitPayback(split: Split) {
    const remaining = splitRemaining(split);
    const entered = parseFloat(splitPaybackForm.amount) || 0;
    const applied = roundCents(Math.min(entered, remaining));
    if (applied <= 0) return;
    setRecordingSplitPayback(true);
    const account = splitPaybackForm.account;
    const tx: Transaction | null = account
      ? buildSplitTx('cashIn', applied, account, t('bills.txSettled', { name: split.contactName, bill: split.billName }), today())
      : null;
    const newRepaid = roundCents(split.repaidAmount + applied);
    const fullyPaid = newRepaid >= roundCents(split.amount) - 0.005;
    const updated: Split = {
      ...split,
      repaidAmount: newRepaid,
      settled: fullyPaid,
      settledDate: fullyPaid ? today() : '',
      repaymentTxIds: tx ? [...split.repaymentTxIds, tx.id] : split.repaymentTxIds,
    };
    const prev = splits;
    setSplits((list) => list.map((s) => s.id === split.id ? updated : s));
    try {
      const res = await fetch('/api/splits', { method: 'POST', body: JSON.stringify(tx ? { split: updated, tx } : updated), headers: { 'Content-Type': 'application/json' } });
      if (!res.ok) throw new Error();
      if (tx) load();
      toast(fullyPaid ? t('bills.toastSplitSettled', { name: split.contactName }) : t('bills.toastSplitPartial', { name: split.contactName, amount: formatCurrency(splitRemaining(updated)) }), 'success');
      setSplitPaybackFor(null);
      setSplitPaybackForm({ amount: '', account: '' });
    } catch {
      setSplits(prev);
      toast(t('bills.toastFailedSplit'), 'error');
    } finally {
      setRecordingSplitPayback(false);
    }
  }

  // Open the whole-group edit form for a pending split group: the group's card is
  // replaced in place by the same split-expense form used to create one, pre-filled
  // with the total, description, date, category, account and one participant row per
  // member. Closing any add form / payback panel first keeps a single panel open.
  function openEditSplitGroup(group: SplitGroup) {
    setShowSplitExpense(false);
    setSplitPaybackFor(null);
    setEditingGroupKey(group.key);
    setEditingGroupSplits(group.splits);
    setSplitExpenseForm({
      description: group.billName,
      total: String(roundCents(group.total)),
      date: group.date,
      account: group.splits[0]?.account ?? '',
      category: group.splits[0]?.category ?? 'Food',
      // Your own share isn't part of the group (it's a standalone expense row with
      // no back-link), so group edit never touches it — keep it out of the form.
      includeMe: false,
      myShare: '',
    });
    setSplitParticipants(
      group.splits.map((s) => ({ key: s.id, contactId: s.contactId, amount: String(s.amount), newName: '' })),
    );
  }
  function cancelEditGroup() {
    setEditingGroupKey(null);
    setEditingGroupSplits([]);
    setSplitExpenseForm(EMPTY_SPLIT_EXPENSE);
    setSplitParticipants([emptyParticipant()]);
  }
  // Saves a whole-group edit by reconciling the resolved participant shares against
  // the group's original members: a member still present is updated (its fronted
  // transfer rebuilt via the splits PUT, paybacks preserved, settled recomputed); a
  // newly-added person is created (POST); a removed person is deleted (DELETE, which
  // cascades the reversal of its fronted/payback transfers). All members share the
  // group's billId + date, so a date change moves the whole group together. Like the
  // create flow this does NOT touch your own recorded expense share. A final reload
  // resyncs splits and balances after the sequential writes.
  async function handleSaveEditGroup() {
    const originals = editingGroupSplits;
    const description = splitExpenseForm.description.trim();
    if (!description) return;
    const namedRows = splitParticipants.filter((p) => !!contacts.find((c) => c.id === p.contactId));
    if (namedRows.length === 0) { toast(t('bills.splitExpenseNeedPeople'), 'error'); return; }
    const amounts = namedRows.map((p) => (p.amount.trim() === '' ? null : (parseFloat(p.amount) || 0)));
    const totalInput = splitExpenseForm.total.trim() === '' ? null : (parseFloat(splitExpenseForm.total) || 0);
    const { shares, over, total } = resolveSplit(totalInput, amounts, false);
    if (over) { toast(t('bills.splitExpenseOverTotal'), 'error'); return; }
    if (total <= 0) return;
    const resolved = namedRows
      .map((p, i) => ({ contact: contacts.find((c) => c.id === p.contactId)!, amount: roundCents(shares[i]) }))
      .filter((p) => p.amount > 0);
    if (resolved.length === 0) { toast(t('bills.splitExpenseNeedPeople'), 'error'); return; }

    setSavingEditGroup(true);
    const { date, account, category } = splitExpenseForm;
    const groupId = originals[0]?.billId ?? newOneOffGroupId();
    const usedOriginalIds = new Set<string>();
    try {
      // Update existing members / create new ones — sequentially, since each fronted
      // transfer mutates the same account balance server-side.
      for (const r of resolved) {
        const orig = originals.find((o) => o.contactId === r.contact.id && !usedOriginalIds.has(o.id));
        const frontedTx = account
          ? buildSplitTx('cashOut', r.amount, account, t('bills.txFronted', { name: r.contact.name, bill: description }), date)
          : null;
        if (orig) {
          usedOriginalIds.add(orig.id);
          // Skip a member whose every editable field is unchanged (no cash churn).
          const unchanged = roundCents(orig.amount) === r.amount && orig.account === account
            && orig.date === date && orig.category === category && orig.billName === description;
          if (unchanged) continue;
          const fullyPaid = roundCents(orig.repaidAmount || 0) >= r.amount - 0.005;
          const updated: Split = {
            ...orig, contactName: r.contact.name, billName: description, amount: r.amount,
            account, date, category, settled: fullyPaid,
            settledDate: fullyPaid ? (orig.settledDate || today()) : '',
            frontedTxId: frontedTx ? frontedTx.id : '',
          };
          const res = await fetch('/api/splits', {
            method: 'PUT',
            body: JSON.stringify({ updated, newTx: frontedTx ?? undefined, removeTxId: orig.frontedTxId || undefined }),
            headers: { 'Content-Type': 'application/json' },
          });
          if (!res.ok) throw new Error();
        } else {
          const split: Split = {
            id: generateId(), billId: groupId, billName: description,
            contactId: r.contact.id, contactName: r.contact.name, amount: r.amount,
            category, account, date, settled: false, settledDate: '',
            repaidAmount: 0, repaymentTxIds: [],
            frontedTxId: frontedTx?.id ?? '', settleTxId: '',
          };
          const res = await fetch('/api/splits', {
            method: 'POST',
            body: JSON.stringify(frontedTx ? { split, tx: frontedTx } : split),
            headers: { 'Content-Type': 'application/json' },
          });
          if (!res.ok) throw new Error();
        }
      }
      // Delete members dropped from the group (the DELETE cascades their cash rows).
      for (const o of originals) {
        if (usedOriginalIds.has(o.id)) continue;
        const res = await fetch('/api/splits', {
          method: 'DELETE', body: JSON.stringify({ id: o.id }), headers: { 'Content-Type': 'application/json' },
        });
        if (!res.ok) throw new Error();
      }
      await load();
      cancelEditGroup();
      toast(t('bills.toastSplitUpdated'), 'success');
    } catch {
      toast(t('bills.toastFailedSplit'), 'error');
      await load();
    } finally {
      setSavingEditGroup(false);
    }
  }

  // One pending "owed to you" person inside a group card: remaining amount, a
  // progress bar + "{paid} of {total} paid" once partially paid, a "Record
  // payment" button, delete, and the inline payback form it toggles open.
  function renderPendingSplitRow(split: Split) {
    const expanded = splitPaybackFor === split.id;
    const remaining = splitRemaining(split);
    const partial = (split.repaidAmount || 0) > 0;
    const pct = split.amount > 0 ? Math.min(100, (split.repaidAmount / split.amount) * 100) : 0;
    return (
      <div key={split.id} className="px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">{split.contactName}</p>
            {partial && <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500 mt-0.5">{t('bills.splitPaidOf', { paid: formatCurrency(split.repaidAmount), total: formatCurrency(split.amount) })}</p>}
          </div>
          <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400 shrink-0">{formatCurrency(remaining)}</span>
        </div>
        {partial && (
          <div className="mt-2 h-1.5 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
          </div>
        )}
        <div className="flex items-center gap-2 mt-2.5">
          <Button size="sm" variant="secondary" className="h-9" onClick={() => openSplitPayback(split)}>
            <HandCoins className="w-4 h-4" />{t('bills.recordSplitPayment')}
          </Button>
          <button title={t('common.delete')} onClick={() => handleDeleteSplit(split)} className="p-2 text-slate-300 dark:text-slate-600 hover:text-rose-500 dark:hover:text-rose-400 rounded-lg transition-colors ml-auto">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
        <Collapsible open={expanded}>
          <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700/60 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input label={t('loans.paybackAmount')} type="number" min="0" step="0.01" value={splitPaybackForm.amount} onChange={(e) => setSplitPaybackForm((f) => ({ ...f, amount: e.target.value }))} />
              <Select
                label={t('loans.intoAccount')}
                value={splitPaybackForm.account}
                options={[{ value: '', label: t('loans.noAccount') }, ...accounts.map((a) => ({ value: a.id, label: `${a.name} (${formatCurrency(a.balance)})` }))]}
                onChange={(e) => setSplitPaybackForm((f) => ({ ...f, account: e.target.value }))}
              />
            </div>
            <div className="flex gap-3">
              <Button variant="secondary" className="flex-1 h-10" onClick={() => setSplitPaybackFor(null)}>{t('common.cancel')}</Button>
              <Button className="flex-1 h-10" onClick={() => handleRecordSplitPayback(split)} disabled={recordingSplitPayback || !splitPaybackForm.amount}>{recordingSplitPayback ? t('common.saving') : t('loans.confirmPayback')}</Button>
            </div>
          </div>
        </Collapsible>
      </div>
    );
  }
  async function handleDeleteSplit(split: Split) {
    if (!confirm(t('bills.confirmDeleteSplit'))) return;
    const prev = splits;
    setSplits((s) => s.filter((x) => x.id !== split.id));
    try {
      const res = await fetch('/api/splits', { method: 'DELETE', body: JSON.stringify({ id: split.id }), headers: { 'Content-Type': 'application/json' } });
      if (!res.ok) throw new Error();
      // The splits API reverses any linked fronted/settle/payback transfers atomically.
      if (split.frontedTxId || split.settleTxId || split.repaymentTxIds.length) load();
    } catch {
      setSplits(prev);
      toast(t('bills.toastFailedSplit'), 'error');
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
  // Live preview for the split-expense form. Only rows with a chosen contact
  // count. Total filled → divide it across people (blanks auto-divide the rest);
  // total blank → sum each typed amount (plus your share when you're included).
  const seTotalInput = splitExpenseForm.total.trim() === '' ? null : (parseFloat(splitExpenseForm.total) || 0);
  const seHasTotal = (seTotalInput ?? 0) > 0;
  const seNamedRows = splitParticipants.filter((p) => !!contacts.find((c) => c.id === p.contactId));
  const seAmounts = seNamedRows.map((p) => (p.amount.trim() === '' ? null : (parseFloat(p.amount) || 0)));
  const seComputed = resolveSplit(seTotalInput, seAmounts, splitExpenseForm.includeMe, parseFloat(splitExpenseForm.myShare) || 0);
  const seShareByKey = new Map<string, number>();
  seNamedRows.forEach((p, i) => seShareByKey.set(p.key, seComputed.shares[i]));
  const seOthersSum = roundCents(seComputed.shares.reduce((s, a) => s + a, 0));
  const seMyShare = seComputed.myShare;
  const seOver = seComputed.over;
  const seTotal = seComputed.total;

  // The split-an-expense form, reused for both creating a new split and editing an
  // existing group in place. The only differences in edit mode (editingGroupKey set):
  // the create-only help text and the "include my share" controls are hidden (your
  // own share isn't part of a group), and the footer saves the group instead.
  function renderSplitExpenseForm() {
    const editing = editingGroupKey !== null;
    return (
      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
        {!editing && <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">{t('bills.splitExpenseHelp')}</p>}
        <Input label={t('common.description')} placeholder={t('bills.splitExpensePlaceholder')} value={splitExpenseForm.description} onChange={(e) => setSplitExpenseForm((f) => ({ ...f, description: e.target.value }))} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label={!seHasTotal && seTotal > 0 ? t('bills.totalAmountAuto') : t('bills.totalAmount')}
            type="number" min="0" step="0.01"
            placeholder={!seHasTotal && seTotal > 0 ? seTotal.toFixed(2) : '0.00'}
            value={splitExpenseForm.total}
            onChange={(e) => setSplitExpenseForm((f) => ({ ...f, total: e.target.value }))}
          />
          <Input label={t('common.date')} type="date" value={splitExpenseForm.date} onChange={(e) => setSplitExpenseForm((f) => ({ ...f, date: e.target.value }))} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Select label={t('common.category')} value={splitExpenseForm.category} options={expenseCategories.map((c) => ({ value: c, label: c }))} onChange={(e) => setSplitExpenseForm((f) => ({ ...f, category: e.target.value }))} />
          <Select label={t('bills.payFromOptional')} value={splitExpenseForm.account} options={[{ value: '', label: t('loans.noAccount') }, ...accounts.map((a) => ({ value: a.id, label: a.name }))]} onChange={(e) => setSplitExpenseForm((f) => ({ ...f, account: e.target.value }))} />
        </div>

        {/* Participants */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-slate-700 dark:text-slate-300 flex items-center gap-2"><Users className="w-4 h-4" />{t('bills.whoShared')}</span>
            {seHasTotal && <button type="button" onClick={splitEqually} className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline">{t('bills.splitEqually')}</button>}
          </div>
          {!editing && (
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input type="checkbox" checked={splitExpenseForm.includeMe} onChange={(e) => setSplitExpenseForm((f) => ({ ...f, includeMe: e.target.checked }))} className="w-4 h-4 rounded accent-indigo-600" />
              <span className="text-xs font-medium text-slate-600 dark:text-slate-400">{t('bills.includeMe')}</span>
            </label>
          )}
          {!editing && !seHasTotal && splitExpenseForm.includeMe && (
            <Input label={t('bills.yourShareInput')} type="number" min="0" step="0.01" placeholder="0.00" value={splitExpenseForm.myShare} onChange={(e) => setSplitExpenseForm((f) => ({ ...f, myShare: e.target.value }))} />
          )}
          {splitParticipants.map((p) => (
            <div key={p.key} className="space-y-2 rounded-xl bg-slate-50 dark:bg-slate-700/40 p-3">
              <div className="flex gap-2 items-end">
                <div className="flex-1 min-w-0">
                  <Select
                    label={t('bills.person')}
                    value={p.contactId}
                    options={[
                      { value: '', label: t('bills.selectContact') },
                      ...contacts.map((c) => ({ value: c.id, label: c.name })),
                      { value: NEW_CONTACT, label: t('bills.addNewContact') },
                    ]}
                    onChange={(e) => updateParticipant(p.key, { contactId: e.target.value })}
                  />
                </div>
                <div className="w-28 shrink-0">
                  <Input label={seHasTotal && seShareByKey.has(p.key) && p.amount.trim() === '' ? t('bills.shareAuto') : t('bills.theirShareShort')} type="number" min="0" step="0.01" placeholder={seHasTotal && seShareByKey.has(p.key) ? (seShareByKey.get(p.key) ?? 0).toFixed(2) : '0.00'} value={p.amount} onChange={(e) => updateParticipant(p.key, { amount: e.target.value })} />
                </div>
                <button type="button" onClick={() => removeParticipantRow(p.key)} disabled={splitParticipants.length === 1} className="mb-1.5 p-2 text-slate-400 dark:text-slate-500 hover:text-rose-500 dark:hover:text-rose-400 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed" title={t('common.delete')}>
                  <X className="w-4 h-4" />
                </button>
              </div>
              {p.contactId === NEW_CONTACT && (
                <div className="flex gap-2 items-end">
                  <div className="flex-1"><Input label={t('bills.newContactName')} placeholder="e.g. Alex" value={p.newName} onChange={(e) => updateParticipant(p.key, { newName: e.target.value })} /></div>
                  <Button type="button" variant="secondary" className="shrink-0" onClick={() => handleAddParticipantContact(p)} disabled={addingContact || !p.newName.trim()}><UserPlus className="w-4 h-4" />{t('bills.addContact')}</Button>
                </div>
              )}
            </div>
          ))}
          <button type="button" onClick={addParticipantRow} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-dashed border-slate-300 dark:border-slate-600 text-xs font-bold text-slate-500 dark:text-slate-400 hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">
            <Plus className="w-4 h-4" />{t('bills.addPerson')}
          </button>
          <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500 px-1">{t('bills.splitSmartHint')}</p>
          {seTotal > 0 && (
            <div className={`flex items-center justify-between text-xs font-bold px-1 pt-1 ${seOver ? 'text-rose-600 dark:text-rose-400' : ''}`}>
              {!editing && <span className="text-slate-500 dark:text-slate-400">{t('bills.yourShare')}: <span className="text-slate-900 dark:text-slate-100">{formatCurrency(seMyShare)}</span></span>}
              <span className="text-slate-500 dark:text-slate-400 ml-auto">{t('bills.theyOwe')}: <span className="text-emerald-600 dark:text-emerald-400">{formatCurrency(seOthersSum)}</span></span>
            </div>
          )}
          {seOver && <p className="text-xs font-bold text-rose-600 dark:text-rose-400 px-1">{t('bills.splitExpenseOverTotal')}</p>}
        </div>

        <div className="flex gap-3 pt-1">
          <Button variant="secondary" className="flex-1" onClick={editing ? cancelEditGroup : () => setShowSplitExpense(false)}>{t('common.cancel')}</Button>
          {editing ? (
            <Button className="flex-1" onClick={handleSaveEditGroup} disabled={savingEditGroup || !splitExpenseForm.description.trim() || seTotal <= 0 || seOver}>
              {savingEditGroup ? t('common.saving') : t('common.save')}
            </Button>
          ) : (
            <Button className="flex-1" onClick={handleSaveSplitExpense} disabled={savingSplitExpense || !splitExpenseForm.description.trim() || seTotal <= 0 || seOver}>
              {savingSplitExpense ? t('common.saving') : t('bills.recordSplit')}
            </Button>
          )}
        </div>
      </div>
    );
  }

  // Live preview for a NEW group loan. Total filled → divide across people
  // (blank = auto); total blank → sum each typed share. You never take a share.
  const loanIsGroup = loanParticipants.length >= 2;
  const loanTotalInput = loanForm.amount.trim() === '' ? null : (parseFloat(loanForm.amount) || 0);
  const loanHasTotal = (loanTotalInput ?? 0) > 0;
  const loanNamedRows = loanParticipants.filter((p) => !!contacts.find((c) => c.id === p.contactId));
  const loanAmounts = loanNamedRows.map((p) => (p.amount.trim() === '' ? null : (parseFloat(p.amount) || 0)));
  const loanComputed = resolveSplit(loanTotalInput, loanAmounts, false);
  const loanTotal = loanComputed.total;
  const loanShareByKey = new Map<string, number>();
  loanNamedRows.forEach((p, i) => loanShareByKey.set(p.key, loanComputed.shares[i]));
  const loanOver = loanComputed.over;
  // When a total is typed but the explicit shares don't fill it, the leftover is
  // unassigned (no one's auto pool to absorb it, since you're not in a loan).
  const loanUnassigned = loanHasTotal ? loanComputed.myShare : 0;
  const loanCanSave = editingLoanId
    ? (!!loanForm.amount && !!loanForm.contactId && loanForm.contactId !== NEW_CONTACT)
    : (loanTotal > 0 && loanNamedRows.length > 0 && !loanOver);
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
          <Button variant="secondary" className="shadow-sm relative" onClick={() => setSplitsOpen(true)}>
            <SplitIcon className="w-4 h-4" />
            {t('splits.tab')}
            {pendingSplits.length > 0 && (
              <span className="ml-1 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-indigo-600 text-white text-[11px] font-bold">{pendingSplits.length}</span>
            )}
          </Button>
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

      {/* Split bills summary — tap to open the tracker */}
      {pendingSplits.length > 0 && (
        <button onClick={() => setSplitsOpen(true)} className="w-full flex items-center justify-between p-4 rounded-3xl bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700/60 hover:border-slate-200 dark:hover:border-slate-700 transition-colors text-left shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-100 dark:border-emerald-800/50 flex items-center justify-center shrink-0">
              <SplitIcon className="w-5 h-5 text-emerald-500 dark:text-emerald-400" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{t('splits.title')}</p>
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5">{t('bills.sharedOpenCount', { n: pendingSplits.length })}</p>
            </div>
          </div>
          {totalOwedSplits > 0 && <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">{t('bills.owedToYou')} {formatCurrency(totalOwedSplits)}</span>}
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
                <Collapsible open={isExpanded}>
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
                </Collapsible>
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
                  <SwipeableRow key={tx.id} tx={tx} accountName={accountName} onEdit={openEdit} onDelete={handleDelete} managed={managedTxIds.has(tx.id)} />
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
          {editManaged && (
            <div className="flex items-start gap-2.5 text-sm rounded-2xl border border-violet-200 dark:border-violet-800/50 bg-violet-50 dark:bg-violet-900/20 p-3.5">
              <HandCoins className="w-4 h-4 text-violet-600 dark:text-violet-400 mt-0.5 shrink-0" />
              <p className="font-medium text-violet-800 dark:text-violet-300">{t('transactions.managedRowHint')}</p>
            </div>
          )}
          <div className="flex p-1.5 rounded-2xl bg-slate-100 dark:bg-slate-700">
            {(['expense', 'income', 'transfer'] as const).map((tp) => (
              <button key={tp} disabled={editManaged} onClick={() => handleTypeChange(tp)} className={`flex-1 py-2.5 text-sm font-bold rounded-xl transition-all duration-200 ${editManaged ? 'cursor-not-allowed' : ''} ${form.type === tp ? tp === 'expense' ? 'bg-white dark:bg-slate-800 text-rose-600 dark:text-rose-400 shadow-sm' : tp === 'income' ? 'bg-white dark:bg-slate-800 text-emerald-600 dark:text-emerald-400 shadow-sm' : 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-sm' : `text-slate-500 dark:text-slate-400 ${editManaged ? '' : 'hover:text-slate-700 dark:hover:text-slate-300'}`}`}>
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
            <Select label={form.type === 'transfer' ? t('transactions.fromAccount') : t('common.account')} value={form.account} disabled={editManaged} className="disabled:opacity-60 disabled:cursor-not-allowed"
              options={[{ value: '', label: t('common.nonePlaceholder') }, ...accounts.map((a) => ({ value: a.id, label: a.type === 'credit' || a.type === 'loan' ? `${a.name} (owed: ${formatCurrency(a.balance)})` : `${a.name} (${formatCurrency(a.balance)})` }))]}
              onChange={(e) => setForm((f) => ({ ...f, account: e.target.value }))} />
          </div>
          {form.type === 'transfer' && (
            <Select label={t('transactions.toAccount')} value={form.toAccount} disabled={editManaged} className="disabled:opacity-60 disabled:cursor-not-allowed"
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
      <Modal open={loansOpen} onClose={() => { setLoansOpen(false); setShowAddLoan(false); setEditingLoanId(null); setPaybackFor(null); }} title={t('loans.title')}>
        <div className="space-y-4 pb-4">
          {/* Add loan: button → inline form */}
          {!showAddLoan ? (
            <Button className="w-full" onClick={() => { setShowAddLoan(true); setEditingLoanId(null); setLoanForm(EMPTY_LOAN_FORM); setNewContactName(''); setLoanParticipants([emptyParticipant()]); }}>
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
              {editingLoanId ? (
                /* Editing an existing loan stays single-contact. */
                <>
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
                </>
              ) : (
                /* New loan: one or more people. Per-person amount + auto-divide
                   only appear once a second person is added. */
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-slate-700 dark:text-slate-300 flex items-center gap-2"><Users className="w-4 h-4" />{loanIsGroup ? t('loans.people') : t('loans.contact')}</span>
                    {loanIsGroup && loanHasTotal && <button type="button" onClick={loanSplitEqually} className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline">{t('bills.splitEqually')}</button>}
                  </div>
                  {loanParticipants.map((p) => (
                    <div key={p.key} className="space-y-2">
                      <div className="flex gap-2 items-end">
                        <div className="flex-1 min-w-0">
                          <Select
                            label={t('loans.contact')}
                            value={p.contactId}
                            options={[
                              { value: '', label: t('bills.selectContact') },
                              ...contacts.map((c) => ({ value: c.id, label: c.name })),
                              { value: NEW_CONTACT, label: t('bills.addNewContact') },
                            ]}
                            onChange={(e) => updateLoanParticipant(p.key, { contactId: e.target.value })}
                          />
                        </div>
                        {loanIsGroup && (
                          <div className="w-28 shrink-0">
                            <Input label={loanHasTotal && loanShareByKey.has(p.key) && p.amount.trim() === '' ? t('bills.shareAuto') : t('bills.theirShareShort')} type="number" min="0" step="0.01" placeholder={loanHasTotal && loanShareByKey.has(p.key) ? (loanShareByKey.get(p.key) ?? 0).toFixed(2) : '0.00'} value={p.amount} onChange={(e) => updateLoanParticipant(p.key, { amount: e.target.value })} />
                          </div>
                        )}
                        {loanIsGroup && (
                          <button type="button" onClick={() => removeLoanParticipantRow(p.key)} className="mb-1.5 p-2 text-slate-400 dark:text-slate-500 hover:text-rose-500 dark:hover:text-rose-400 rounded-lg transition-colors" title={t('common.delete')}>
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                      {p.contactId === NEW_CONTACT && (
                        <div className="flex gap-2 items-end">
                          <div className="flex-1"><Input label={t('bills.newContactName')} placeholder="e.g. Alex" value={p.newName} onChange={(e) => updateLoanParticipant(p.key, { newName: e.target.value })} /></div>
                          <Button type="button" variant="secondary" className="shrink-0" onClick={() => handleAddLoanParticipantContact(p)} disabled={addingContact || !p.newName.trim()}><UserPlus className="w-4 h-4" />{t('bills.addContact')}</Button>
                        </div>
                      )}
                    </div>
                  ))}
                  <button type="button" onClick={addLoanParticipantRow} className="w-full flex items-center justify-center gap-2 py-2 rounded-xl border border-dashed border-slate-300 dark:border-slate-600 text-xs font-bold text-slate-500 dark:text-slate-400 hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">
                    <Plus className="w-4 h-4" />{t('loans.addPerson')}
                  </button>
                  {loanIsGroup && <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500 px-1">{t('bills.splitSmartHint')}</p>}
                  {loanIsGroup && loanUnassigned > 0 && <p className="text-[11px] font-bold text-amber-600 dark:text-amber-400 px-1">{t('loans.unassigned', { amount: formatCurrency(loanUnassigned) })}</p>}
                  {loanOver && <p className="text-[11px] font-bold text-rose-600 dark:text-rose-400 px-1">{t('bills.splitExpenseOverTotal')}</p>}
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  label={loanIsGroup && !loanHasTotal && loanTotal > 0 ? t('bills.totalAmountAuto') : loanIsGroup && !editingLoanId ? t('bills.totalAmount') : t('common.amountUsd')}
                  type="number" min="0" step="0.01"
                  placeholder={loanIsGroup && !loanHasTotal && loanTotal > 0 ? loanTotal.toFixed(2) : '0.00'}
                  value={loanForm.amount}
                  onChange={(e) => setLoanForm((f) => ({ ...f, amount: e.target.value }))}
                />
                <Input label={t('common.date')} type="date" value={loanForm.date} onChange={(e) => setLoanForm((f) => ({ ...f, date: e.target.value }))} />
              </div>
              <Select
                label={loanForm.direction === 'lent' ? t('loans.fromAccount') : t('loans.toAccount')}
                value={loanForm.account}
                options={[{ value: '', label: t('loans.noAccount') }, ...accounts.map((a) => ({ value: a.id, label: `${a.name} (${formatCurrency(a.balance)})` }))]}
                onChange={(e) => setLoanForm((f) => ({ ...f, account: e.target.value }))}
              />
              <Select
                label={t('common.category')}
                value={loanForm.category}
                options={[{ value: '', label: t('common.none') }, ...expenseCategories.map((cat) => ({ value: cat, label: cat }))]}
                onChange={(e) => setLoanForm((f) => ({ ...f, category: e.target.value }))}
              />
              <Input label={t('loans.noteOptional')} placeholder={t('loans.notePlaceholder')} value={loanForm.note} onChange={(e) => setLoanForm((f) => ({ ...f, note: e.target.value }))} />
              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">{loanForm.account ? t('loans.cashHelp') : t('loans.noteOnlyHelp')}</p>
              <div className="flex gap-3 pt-1">
                <Button variant="secondary" className="flex-1" onClick={() => { setShowAddLoan(false); setEditingLoanId(null); setLoanForm(EMPTY_LOAN_FORM); setLoanParticipants([emptyParticipant()]); }}>{t('common.cancel')}</Button>
                <Button className="flex-1" onClick={editingLoanId ? handleEditLoan : handleAddLoan} disabled={savingLoan || !loanCanSave}>{savingLoan ? t('common.saving') : editingLoanId ? t('loans.saveChanges') : loanIsGroup ? t('loans.addLoans') : t('loans.addLoan')}</Button>
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
          {openLoanGroups.map((group) => group.isGroup ? renderOpenLoanGroup(group) : renderOpenLoanCard(group.loans[0]))}

          {/* Settled loans — collapsible History, last 10 events (mirrors Splits) */}
          {settledLoans.length > 0 && (
            <div className="pt-1">
              <button
                onClick={() => setShowLoanHistory((v) => !v)}
                className="w-full flex items-center justify-between px-1 py-2 text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
              >
                <span>{t('loans.settledHistory', { n: settledLoans.length })}</span>
                <ChevronDown className={`w-4 h-4 transition-transform ${showLoanHistory ? 'rotate-180' : ''}`} />
              </button>
              {showLoanHistory && (
                <div className="space-y-2 pt-1">
                  {settledLoanGroups.slice(0, 10).map((group) => group.isGroup ? renderSettledLoanGroup(group) : renderSettledLoanCard(group.loans[0]))}
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>

      {/* ── Split Bills Modal ────────────────────────────────────────────── */}
      <Modal open={splitsOpen} onClose={() => { setSplitsOpen(false); setShowSplitExpense(false); setEditingGroupKey(null); setEditingGroupSplits([]); }} title={t('splits.title')}>
        <div className="space-y-4 pb-4">
          {/* Split an expense: button → inline form (modal-style inner view).
              Hidden while a group is being edited (its form renders in place below). */}
          {!editingGroupKey && (!showSplitExpense
            ? <Button className="w-full" onClick={openSplitExpense}><Plus className="w-4 h-4" />{t('bills.splitExpenseTitle')}</Button>
            : renderSplitExpenseForm())}

          {/* Total owed */}
          {totalOwedSplits > 0 && (
            <div className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-100 dark:border-emerald-800/50">
              <p className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300 uppercase tracking-wider">{t('bills.owedToYou')}</p>
              <p className="text-lg font-extrabold text-emerald-600 dark:text-emerald-400 mt-0.5">{formatCurrency(totalOwedSplits)}</p>
            </div>
          )}

          {/* Pending — grouped by expense, expand a card to see each person */}
          {pendingSplits.length === 0 && !showSplitExpense && (
            <p className="text-center text-sm text-slate-500 dark:text-slate-400 font-medium py-6">{t('bills.sharedEmpty')}</p>
          )}
          {pendingSplitGroups.map((group) => {
            const expanded = expandedSplitGroups.has(group.key);
            const groupRemaining = group.splits.reduce((s, x) => s + splitRemaining(x), 0);
            const subtitle = group.splits.length === 1
              ? `${group.splits[0].contactName} · ${t('bills.owedSince', { date: formatDate(group.date) })}`
              : t('bills.groupOwedSince', { n: group.splits.length, date: formatDate(group.date) });
            // Editing this group: its card is replaced in place by the split form.
            if (editingGroupKey === group.key) {
              return <div key={group.key}>{renderSplitExpenseForm()}</div>;
            }
            return (
              <div key={group.key} className="rounded-2xl bg-white dark:bg-slate-800 border border-emerald-100 dark:border-emerald-800/40 overflow-hidden">
                <div className="flex items-center">
                  <button onClick={() => toggleSplitGroup(group.key)} className="flex-1 min-w-0 flex items-center justify-between px-4 py-3 text-left">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <ChevronDown className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">{group.billName}</p>
                        <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5 truncate">{subtitle}</p>
                      </div>
                    </div>
                    <span className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400 ml-2 shrink-0">{formatCurrency(groupRemaining)}</span>
                  </button>
                  <button title={t('common.edit')} onClick={() => openEditSplitGroup(group)} className="px-3 py-3 text-slate-300 dark:text-slate-600 hover:text-indigo-500 dark:hover:text-indigo-400 transition-colors shrink-0">
                    <Pencil className="w-4 h-4" />
                  </button>
                </div>
                <Collapsible open={expanded}>
                  <div className="divide-y divide-slate-100 dark:divide-slate-700/60 border-t border-slate-100 dark:border-slate-700/60">
                    {group.splits.map((split) => renderPendingSplitRow(split))}
                  </div>
                </Collapsible>
              </div>
            );
          })}

          {/* History (settled) — collapsible, last 10 events, same grouping */}
          {settledSplits.length > 0 && (
            <div className="pt-1">
              <button
                onClick={() => setShowSplitHistory((v) => !v)}
                className="w-full flex items-center justify-between px-1 py-2 text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
              >
                <span>{t('bills.sharedHistory', { n: settledSplits.length })}</span>
                <ChevronDown className={`w-4 h-4 transition-transform ${showSplitHistory ? 'rotate-180' : ''}`} />
              </button>
              <Collapsible open={showSplitHistory}>
                <div className="space-y-2 pt-1">
                  {settledSplitGroups.slice(0, 10).map((group) => {
                    const expanded = expandedSplitGroups.has(group.key);
                    const subtitle = group.splits.length === 1
                      ? `${group.splits[0].contactName} · ${t('bills.transferredOn', { date: formatDate(group.settledDate || group.date) })}`
                      : t('bills.groupTransferredOn', { n: group.splits.length, date: formatDate(group.settledDate || group.date) });
                    return (
                      <div key={group.key} className="rounded-2xl bg-slate-50 dark:bg-slate-700/40 border border-slate-100 dark:border-slate-700/60 overflow-hidden opacity-90">
                        <button onClick={() => toggleSplitGroup(group.key)} className="w-full flex items-center justify-between px-3.5 py-2.5 text-left">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <ChevronDown className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                            <div className="min-w-0">
                              <p className="text-sm font-bold text-slate-700 dark:text-slate-300 truncate">{group.billName}</p>
                              <p className="text-xs font-medium text-slate-400 dark:text-slate-500 mt-0.5 truncate">{subtitle}</p>
                            </div>
                          </div>
                          <span className="text-sm font-bold text-slate-400 dark:text-slate-500 line-through ml-2 shrink-0">{formatCurrency(group.total)}</span>
                        </button>
                        <Collapsible open={expanded}>
                          <div className="divide-y divide-slate-100 dark:divide-slate-700/60 border-t border-slate-100 dark:border-slate-700/60">
                            {group.splits.map((split) => (
                              <div key={split.id} className="flex items-center justify-between px-3.5 py-2">
                                <p className="text-sm font-semibold text-slate-600 dark:text-slate-400 truncate min-w-0">{split.contactName}</p>
                                <div className="flex items-center gap-2 shrink-0">
                                  <span className="text-sm font-bold text-slate-400 dark:text-slate-500 line-through">{formatCurrency(split.amount)}</span>
                                  <span title={t('bills.transferred')} className="w-5 h-5 rounded-md bg-emerald-500 text-white flex items-center justify-center shrink-0">
                                    <Check className="w-3.5 h-3.5" />
                                  </span>
                                  <button title={t('common.delete')} onClick={() => handleDeleteSplit(split)} className="p-1.5 text-slate-300 dark:text-slate-600 hover:text-rose-500 dark:hover:text-rose-400 rounded-lg transition-colors">
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </Collapsible>
                      </div>
                    );
                  })}
                </div>
              </Collapsible>
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
              {(expenseCategories.length > 0 || archivedExpenseCategories.length > 0) && (
                <>
                  <p className="text-[11px] font-bold text-rose-500 dark:text-rose-400 uppercase tracking-wider mb-2">{t('common.expenses')}</p>
                  <div className="flex gap-2 flex-wrap mb-4">
                    {expenseCategories.map((c) => (
                      <button key={`exp-${c}`} onClick={() => toggleCategory(c)} className={`px-3.5 h-9 rounded-xl text-xs font-bold transition-all duration-200 whitespace-nowrap ${categoryFilters.includes(c) ? 'bg-indigo-600 text-white' : 'bg-slate-50 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600'}`}>{c}</button>
                    ))}
                    {/* Archived categories: kept filterable so past transactions stay findable, shown muted with an archive marker. */}
                    {archivedExpenseCategories.map((c) => (
                      <button key={`exp-arc-${c}`} onClick={() => toggleCategory(c)} title={t('categories.archivedHint')} className={`px-3.5 h-9 rounded-xl text-xs font-bold transition-all duration-200 whitespace-nowrap inline-flex items-center gap-1 ${categoryFilters.includes(c) ? 'bg-indigo-600 text-white' : 'bg-slate-50/60 dark:bg-slate-700/50 text-slate-400 dark:text-slate-500 border border-dashed border-slate-300 dark:border-slate-600'}`}><Archive className="w-3 h-3" />{c}</button>
                    ))}
                  </div>
                </>
              )}
              {(incomeCategories.length > 0 || archivedIncomeCategories.length > 0) && (
                <>
                  <p className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mb-2">{t('common.income')}</p>
                  <div className="flex gap-2 flex-wrap">
                    {incomeCategories.map((c) => (
                      <button key={`inc-${c}`} onClick={() => toggleCategory(c)} className={`px-3.5 h-9 rounded-xl text-xs font-bold transition-all duration-200 whitespace-nowrap ${categoryFilters.includes(c) ? 'bg-indigo-600 text-white' : 'bg-slate-50 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600'}`}>{c}</button>
                    ))}
                    {archivedIncomeCategories.map((c) => (
                      <button key={`inc-arc-${c}`} onClick={() => toggleCategory(c)} title={t('categories.archivedHint')} className={`px-3.5 h-9 rounded-xl text-xs font-bold transition-all duration-200 whitespace-nowrap inline-flex items-center gap-1 ${categoryFilters.includes(c) ? 'bg-indigo-600 text-white' : 'bg-slate-50/60 dark:bg-slate-700/50 text-slate-400 dark:text-slate-500 border border-dashed border-slate-300 dark:border-slate-600'}`}><Archive className="w-3 h-3" />{c}</button>
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
  /** Loan/split-owned row: delete is managed from Loans/Splits, so it's locked here. */
  managed?: boolean;
};

function SwipeableRow({ tx, accountName, onEdit, onDelete, managed }: SwipeRowProps) {
  return (
    <SwipeToDelete onDelete={() => onDelete(tx.id)} disabled={managed}>
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
