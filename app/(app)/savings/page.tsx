'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { ArrowDownLeft, ArrowUpRight, ArrowRightLeft, PiggyBank, Target, Pencil, CheckCircle2, Trash2, Percent } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { formatCurrency, formatDate, generateId, today } from '@/lib/utils';
import { calcSavingsInterest, calcFundingHeldByAccount } from '@/lib/calculations';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
import { peekCache, ensureResources } from '@/lib/client/store';
import type { Account, Transaction, Goal } from '@/types';
import { FitText } from '@/components/ui/FitText';
import { SavingsSkeleton } from '@/components/ui/Skeleton';
import { StaggerReveal } from '@/components/ui/Reveal';
import { useToast } from '@/lib/toast';
import { useTranslation } from '@/lib/i18n/context';

const ACCOUNT_COLORS = [
  '#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#84cc16',
];

type ActionForm = {
  type: 'deposit' | 'withdraw';
  accountId: string;
  amount: string;
  description: string;
  date: string;
};

type EditForm = {
  name: string;
  institution: string;
  balance: string;
  last4: string;
  color: string;
};

// Recording interest the bank paid on a savings account. The amount is
// pre-filled from the account's APY (see calcSavingsInterest) but stays editable
// so it can be set to the exact figure the statement shows.
type InterestForm = {
  accountId: string;
  amount: string;
  description: string;
  date: string;
};

const EMPTY_INTEREST_FORM: InterestForm = {
  accountId: '',
  amount: '',
  description: '',
  date: today(),
};

const EMPTY_EDIT_FORM: EditForm = {
  name: '',
  institution: '',
  balance: '',
  last4: '',
  color: ACCOUNT_COLORS[0],
};

const EMPTY_FORM: ActionForm = {
  type: 'deposit',
  accountId: '',
  amount: '',
  description: '',
  date: today(),
};

// Initial number of savings transactions shown; "Show more" reveals another batch.
const SAVINGS_PAGE_SIZE = 25;

export default function SavingsPage() {
  const { t, lang } = useTranslation();
  const [accounts, setAccounts] = useState<Account[]>(() => (peekCache(['accounts'])?.accounts ?? []).filter((a) => a.type === 'savings'));
  const [allAccounts, setAllAccounts] = useState<Account[]>(() => peekCache(['accounts'])?.accounts ?? []);
  const [transactions, setTransactions] = useState<Transaction[]>(() => peekCache(['transactions'])?.transactions ?? []);
  const [goals, setGoals] = useState<Goal[]>(() => peekCache(['goals'])?.goals ?? []);
  const [selectedAccount, setSelectedAccount] = useState<string>('all');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ActionForm>(EMPTY_FORM);
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Account | null>(null);
  const [editForm, setEditForm] = useState<EditForm>(EMPTY_EDIT_FORM);
  const [interestOpen, setInterestOpen] = useState(false);
  const [interestForm, setInterestForm] = useState<InterestForm>(EMPTY_INTEREST_FORM);
  const [loading, setLoading] = useState(() => peekCache(['accounts', 'transactions', 'goals']) === null);
  const [saving, setSaving] = useState(false);
  const [visibleCount, setVisibleCount] = useState(SAVINGS_PAGE_SIZE);
  const toast = useToast();

  // Switching the account filter resets the visible window back to one page.
  function selectAccount(id: string) {
    setSelectedAccount(id);
    setVisibleCount(SAVINGS_PAGE_SIZE);
  }

  const load = useCallback(async (force = false) => {
    // One round trip instead of three; served from the client cache when fresh.
    const data = await ensureResources(['accounts', 'transactions', 'goals'], { force });
    const accs = data.accounts;
    setAllAccounts(accs);
    setAccounts(accs.filter((a) => a.type === 'savings'));
    setTransactions(data.transactions);
    setGoals(data.goals);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useAutoRefresh(() => load(true));

  const savingsAccountIds = useMemo(() => accounts.map((a) => a.id), [accounts]);
  const accountMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const a of allAccounts) m[a.id] = a.name;
    return m;
  }, [allAccounts]);

  const savingsTx = transactions
    .filter((tx) => {
      const inSavings = savingsAccountIds.includes(tx.account) || savingsAccountIds.includes(tx.toAccount ?? '');
      if (selectedAccount === 'all') return inSavings;
      return tx.account === selectedAccount || tx.toAccount === selectedAccount;
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  const visibleTx = savingsTx.slice(0, visibleCount);

  // Same as the dashboard's "Total Saved": funding pools can park OTHER people's
  // cash in a savings account — net it out so the two figures always agree.
  const fundingHeldByAccount = useMemo(() => calcFundingHeldByAccount(transactions), [transactions]);
  const totalSaved = accounts.reduce((s, a) => s + a.balance - (fundingHeldByAccount[a.id] ?? 0), 0);

  // Money INTO savings = a deposit (income) or a transfer whose destination is a
  // savings account; otherwise it's money out.
  const isIncomingTx = (tx: Transaction) =>
    tx.type === 'transfer' ? savingsAccountIds.includes(tx.toAccount ?? '') : tx.type === 'income';

  // History summary over the full filtered set (not just the visible page).
  const historyTotals = savingsTx.reduce(
    (acc, tx) => {
      if (isIncomingTx(tx)) acc.in += tx.amount;
      else acc.out += tx.amount;
      return acc;
    },
    { in: 0, out: 0 },
  );
  const historyNet = historyTotals.in - historyTotals.out;

  // Group the visible rows by month so the history reads as a statement, with a
  // per-month net change header.
  const txByMonth: { key: string; label: string; net: number; items: Transaction[] }[] = [];
  for (const tx of visibleTx) {
    const key = tx.date.slice(0, 7);
    let g = txByMonth[txByMonth.length - 1];
    if (!g || g.key !== key) {
      g = { key, label: new Date(key + '-01T00:00:00').toLocaleDateString(lang === 'vi' ? 'vi-VN' : 'en-US', { month: 'long', year: 'numeric' }), net: 0, items: [] };
      txByMonth.push(g);
    }
    g.items.push(tx);
    g.net += isIncomingTx(tx) ? tx.amount : -tx.amount;
  }

  async function handleAction() {
    if (!form.accountId || !form.amount) return;
    setSaving(true);

    const account = accounts.find((a) => a.id === form.accountId);
    if (!account) { setSaving(false); return; }

    const amount = parseFloat(form.amount);
    const tx: Transaction = {
      id: generateId(),
      date: form.date,
      description: form.description || (form.type === 'deposit' ? 'Savings Deposit' : 'Savings Withdrawal'),
      amount,
      type: form.type === 'deposit' ? 'income' : 'expense',
      category: 'Transfer',
      account: form.accountId,
    };

    try {
      const res = await fetch('/api/transactions', {
        method: 'POST',
        body: JSON.stringify(tx),
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error();
      toast(t('transactions.toastAdded'), 'success');
      setOpen(false);
      setForm(EMPTY_FORM);
      await load();
    } catch {
      toast(t('transactions.toastFailedSave'), 'error');
    } finally {
      setSaving(false);
    }
  }

  function openAction(type: 'deposit' | 'withdraw') {
    setForm({ ...EMPTY_FORM, type, accountId: accounts[0]?.id ?? '' });
    setOpen(true);
  }

  // Prefer an account that actually has a rate set, so the amount pre-fills.
  function openInterest() {
    const withRate = accounts.find((a) => a.apr != null && a.apr > 0);
    const acc = withRate ?? accounts[0];
    setInterestForm({
      ...EMPTY_INTEREST_FORM,
      accountId: acc?.id ?? '',
      amount: acc ? String(calcSavingsInterest(acc.balance, acc.apr ?? 0)) : '',
      date: today(),
    });
    setInterestOpen(true);
  }

  // Switching accounts inside the modal re-suggests the interest for that account.
  function selectInterestAccount(id: string) {
    const acc = accounts.find((a) => a.id === id);
    setInterestForm((f) => ({ ...f, accountId: id, amount: acc ? String(calcSavingsInterest(acc.balance, acc.apr ?? 0)) : '' }));
  }

  async function handleInterest() {
    if (!interestForm.accountId || !interestForm.amount) return;
    const amount = parseFloat(interestForm.amount);
    if (!(amount > 0)) return;
    setSaving(true);

    // Interest the bank pays is real income credited to the savings account,
    // so it's an `income` row (raises the balance) — not a Transfer like a manual
    // deposit. Tagged category 'Interest' so it reads distinctly in history/reports.
    const tx: Transaction = {
      id: generateId(),
      date: interestForm.date,
      description: interestForm.description || 'Interest',
      amount,
      type: 'income',
      category: 'Interest',
      account: interestForm.accountId,
    };

    try {
      const res = await fetch('/api/transactions', {
        method: 'POST',
        body: JSON.stringify(tx),
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error();
      toast(t('transactions.toastAdded'), 'success');
      setInterestOpen(false);
      setInterestForm(EMPTY_INTEREST_FORM);
      await load();
    } catch {
      toast(t('transactions.toastFailedSave'), 'error');
    } finally {
      setSaving(false);
    }
  }

  function openEdit(account: Account) {
    setEditTarget(account);
    setEditForm({ name: account.name, institution: account.institution, balance: String(account.balance), last4: account.last4, color: account.color });
    setEditOpen(true);
  }

  async function handleEditSave() {
    if (!editTarget || !editForm.name) return;
    setSaving(true);
    const updated: Account = {
      ...editTarget,
      name: editForm.name,
      institution: editForm.institution,
      balance: parseFloat(editForm.balance) || 0,
      last4: editForm.last4,
      color: editForm.color,
    };
    try {
      const res = await fetch('/api/accounts', { method: 'POST', body: JSON.stringify(updated), headers: { 'Content-Type': 'application/json' } });
      if (!res.ok) throw new Error();
      toast(t('accounts.toastUpdated'), 'success');
      setEditOpen(false);
      setEditTarget(null);
      await load();
    } catch {
      toast(t('accounts.toastFailedSave'), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm(t('accounts.confirmDelete'))) return;
    const prev = accounts;
    setAccounts((a) => a.filter((acc) => acc.id !== id));
    try {
      const res = await fetch('/api/accounts', { method: 'DELETE', body: JSON.stringify({ id }), headers: { 'Content-Type': 'application/json' } });
      if (!res.ok) throw new Error();
      toast(t('accounts.toastDeleted'), 'success');
      await load();
    } catch {
      setAccounts(prev);
      toast(t('accounts.toastFailedDelete'), 'error');
    }
  }

  if (loading) return <SavingsSkeleton />;

  return (
    <StaggerReveal className="p-4 md:p-8 max-w-5xl mx-auto space-y-6 sm:space-y-8 pb-24 md:pb-8">
      <PageHeader
        icon={PiggyBank}
        tone="purple"
        title={t('savings.title')}
        subtitle={t('savings.subtitle')}
        action={
          accounts.length > 0 ? (
            <>
              <Button variant="secondary" onClick={openInterest} className="flex-1 md:flex-none shadow-sm">
                <Percent className="w-5 h-5" />
                {t('savings.addInterest')}
              </Button>
              <Button variant="secondary" onClick={() => openAction('withdraw')} className="flex-1 md:flex-none shadow-sm">
                <ArrowUpRight className="w-5 h-5" />
                {t('savings.withdraw')}
              </Button>
              <Button onClick={() => openAction('deposit')} className="flex-1 md:flex-none shadow-sm">
                <ArrowDownLeft className="w-5 h-5" />
                {t('savings.deposit')}
              </Button>
            </>
          ) : undefined
        }
      />

      {accounts.length === 0 ? (
        <Card className="text-center py-16 bg-slate-50 dark:bg-slate-700/50 border-slate-100 dark:border-slate-700/60">
          <div className="w-16 h-16 rounded-full bg-white dark:bg-slate-800 flex items-center justify-center mx-auto mb-4 shadow-sm border border-slate-100 dark:border-slate-700/60">
            <PiggyBank className="w-8 h-8 text-slate-400 dark:text-slate-500" />
          </div>
          <p className="text-slate-900 dark:text-slate-100 font-bold text-lg mb-1">{t('savings.noAccountsYet')}</p>
          <p className="text-slate-500 dark:text-slate-400 font-medium mb-6">{t('savings.emptyDesc')}</p>
          <a href="/accounts" className="inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm shadow-sm transition-colors">
            {t('savings.goToAccounts')}
          </a>
        </Card>
      ) : (
        <>
          {/* Savings accounts summary */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <Card className={`md:col-span-1 ${totalSaved >= 0 ? 'border-emerald-100 dark:border-emerald-800/50 hover:border-emerald-200 dark:hover:border-emerald-800/50' : 'border-rose-100 dark:border-rose-800/50 hover:border-rose-200 dark:hover:border-rose-800/50'}`}>
              <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t('savings.totalSaved')}</p>
              <FitText maxSize={28} minSize={13} className={`font-extrabold mt-2 ${totalSaved >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{formatCurrency(totalSaved)}</FitText>
            </Card>
            {accounts.map((a) => (
              <Card key={a.id} className="border-l-[6px]" style={{ borderLeftColor: a.color }}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider truncate">{a.name}</p>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => openEdit(a)} className="p-1.5 rounded-lg text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => handleDelete(a.id)} className="p-1.5 rounded-lg text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/30 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <FitText maxSize={28} minSize={13} className={`font-extrabold mt-2 ${a.balance < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-slate-100'}`}>{formatCurrency(a.balance)}</FitText>
                {a.institution && <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mt-1">{a.institution}</p>}
              </Card>
            ))}
          </div>

          {/* Goals linked to savings */}
          {goals.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-2 px-1">
                <Target className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                {t('savings.savingsGoals')}
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {goals.map((g) => {
                  const linked = g.linkedAccountId ? accounts.find((a) => a.id === g.linkedAccountId) : null;
                  const current = linked ? linked.balance : g.currentAmount;
                  const rawPct = g.targetAmount > 0 ? (current / g.targetAmount) * 100 : 0;
                  const pct = Math.max(-100, Math.min(100, rawPct));
                  const remaining = g.targetAmount - current;
                  const negative = current < 0;
                  return (
                    <Card key={g.id} className="hover:shadow-md transition-all">
                      <div className="flex items-start justify-between mb-4">
                        <div>
                          <p className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                            <span className="text-xl">{g.icon}</span> {g.name}
                          </p>
                          {g.deadline && (
                            <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mt-1">{t('savings.byDate', { date: formatDate(g.deadline) })}</p>
                          )}
                        </div>
                        <span className={`text-sm font-extrabold px-2.5 py-1 rounded-lg ${negative ? 'text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-900/30' : 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30'}`}>{pct.toFixed(0)}%</span>
                      </div>
                      <div className="w-full bg-slate-100 dark:bg-slate-700 rounded-full h-2.5 mb-3 overflow-hidden relative">
                        {negative ? (
                          <div
                            className="absolute right-0 top-0 bg-rose-500 h-full rounded-full transition-all duration-500"
                            style={{ width: `${Math.min(100, Math.abs(pct))}%` }}
                            aria-label="Deficit"
                          />
                        ) : (
                          <div
                            className="bg-indigo-500 h-full rounded-full transition-all duration-500"
                            style={{ width: `${Math.max(0, pct)}%` }}
                          />
                        )}
                      </div>
                      <div className="flex justify-between text-sm font-bold text-slate-500 dark:text-slate-400">
                        <span className={negative ? 'text-rose-600 dark:text-rose-400' : 'text-slate-700 dark:text-slate-300'}>{formatCurrency(current)} {t('savings.saved')}</span>
                        <span>{formatCurrency(remaining)} {t('savings.toGo')}</span>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}

          {/* Account filter */}
          {accounts.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-2 hide-scrollbar">
              <button
                onClick={() => selectAccount('all')}
                className={`px-5 h-10 rounded-xl text-sm font-bold transition-all duration-300 whitespace-nowrap shadow-sm ${
                  selectedAccount === 'all'
                    ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                    : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700/50 border border-slate-200 dark:border-slate-700'
                }`}
              >
                {t('savings.allAccounts')}
              </button>
              {accounts.map((a) => (
                <button
                  key={a.id}
                  onClick={() => selectAccount(a.id)}
                  className={`px-5 h-10 rounded-xl text-sm font-bold transition-all duration-300 whitespace-nowrap shadow-sm ${
                    selectedAccount === a.id
                      ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                      : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700/50 border border-slate-200 dark:border-slate-700'
                  }`}
                >
                  {a.name}
                </button>
              ))}
            </div>
          )}

          {/* Transaction history */}
          <div className="space-y-4">
            <h2 className="text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider px-1">{t('savings.transactionHistory')}</h2>
            {savingsTx.length === 0 ? (
              <Card className="text-center py-12 bg-slate-50 dark:bg-slate-700/50 border-slate-100 dark:border-slate-700/60">
                <p className="text-slate-500 dark:text-slate-400 font-bold">{t('savings.noTransactionsYet')}</p>
              </Card>
            ) : (
              <>
              {/* Summary strip: total in / out / net across the filtered history. */}
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-2xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800/40 p-3 sm:p-4">
                  <p className="text-[11px] font-bold text-emerald-700/80 dark:text-emerald-400/80 uppercase tracking-wider">{t('savings.totalIn')}</p>
                  <p className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400 mt-0.5 whitespace-nowrap">+{formatCurrency(historyTotals.in)}</p>
                </div>
                <div className="rounded-2xl bg-rose-50 dark:bg-rose-900/20 border border-rose-100 dark:border-rose-800/40 p-3 sm:p-4">
                  <p className="text-[11px] font-bold text-rose-700/80 dark:text-rose-400/80 uppercase tracking-wider">{t('savings.totalOut')}</p>
                  <p className="text-sm font-extrabold text-rose-600 dark:text-rose-400 mt-0.5 whitespace-nowrap">-{formatCurrency(historyTotals.out)}</p>
                </div>
                <div className="rounded-2xl bg-slate-50 dark:bg-slate-700/40 border border-slate-100 dark:border-slate-700/60 p-3 sm:p-4">
                  <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t('savings.netChange')}</p>
                  <p className={`text-sm font-extrabold mt-0.5 whitespace-nowrap ${historyNet >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{historyNet >= 0 ? '+' : '-'}{formatCurrency(Math.abs(historyNet))}</p>
                </div>
              </div>
              <div className="space-y-5">
                {txByMonth.map((group) => (
                  <div key={group.key} className="space-y-3">
                    <div className="flex items-center justify-between px-1">
                      <h3 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">{group.label}</h3>
                      <span className={`text-xs font-bold whitespace-nowrap ${group.net >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                        {group.net >= 0 ? '+' : '-'}{formatCurrency(Math.abs(group.net))}
                      </span>
                    </div>
                    {group.items.map((tx) => {
                      const fromName = accountMap[tx.account] ?? tx.account;
                      const toName = tx.toAccount ? accountMap[tx.toAccount] : null;
                      const isTransfer = tx.type === 'transfer';
                      const isIncoming = isIncomingTx(tx);
                      const displayDesc = tx.description || (isTransfer ? 'Transfer' : isIncoming ? 'Savings Deposit' : 'Savings Withdrawal');
                      const subtitle = isTransfer && toName
                        ? `${fromName} → ${toName} · ${formatDate(tx.date)}`
                        : `${fromName} · ${formatDate(tx.date)}`;
                      return (
                        <div
                          key={tx.id}
                          className="flex items-center justify-between p-4 sm:p-5 rounded-3xl bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700/60 hover:border-slate-200 dark:hover:border-slate-700 hover:shadow-sm transition-all duration-300"
                        >
                          <div className="flex items-center gap-4">
                            <div className={`flex items-center justify-center w-12 h-12 rounded-2xl shrink-0 border ${
                              isTransfer ? 'bg-indigo-50 dark:bg-indigo-900/30 border-indigo-100 dark:border-indigo-800/50' : isIncoming ? 'bg-emerald-50 dark:bg-emerald-900/30 border-emerald-100 dark:border-emerald-800/50' : 'bg-rose-50 dark:bg-rose-900/30 border-rose-100 dark:border-rose-800/50'
                            }`}>
                              {isTransfer
                                ? <ArrowRightLeft className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
                                : isIncoming
                                ? <ArrowDownLeft className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
                                : <ArrowUpRight className="w-6 h-6 text-rose-600 dark:text-rose-400" />}
                            </div>
                            <div>
                              <p className="text-base font-bold text-slate-900 dark:text-slate-100">{displayDesc}</p>
                              <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>
                            </div>
                          </div>
                          <span className={`text-lg font-extrabold whitespace-nowrap ${isIncoming ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                            {isIncoming ? '+' : '-'}{formatCurrency(tx.amount)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
              {savingsTx.length > visibleCount && (
                <div className="flex justify-center pt-2">
                  <Button variant="secondary" onClick={() => setVisibleCount((c) => c + SAVINGS_PAGE_SIZE)}>
                    {t('transactions.showMore', { count: savingsTx.length - visibleTx.length })}
                  </Button>
                </div>
              )}
              </>
            )}
          </div>
        </>
      )}

      {/* Edit Account Modal */}
      <Modal
        open={editOpen}
        onClose={() => { setEditOpen(false); setEditTarget(null); }}
        title={t('accounts.editAccount')}
      >
        <div className="space-y-5 pb-4">
          <Input
            label={t('accounts.accountName')}
            placeholder={t('savings.phName')}
            value={editForm.name}
            onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
          />
          <Input
            label={t('accounts.institution')}
            placeholder={t('savings.phInstitution')}
            value={editForm.institution}
            onChange={(e) => setEditForm((f) => ({ ...f, institution: e.target.value }))}
          />
          <Input
            label={t('accounts.currentBalance')}
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={editForm.balance}
            onChange={(e) => setEditForm((f) => ({ ...f, balance: e.target.value.replace(/[^0-9.,-]/g, '') }))}
          />
          <Input
            label={t('accounts.last4')}
            placeholder="1234"
            maxLength={4}
            value={editForm.last4}
            onChange={(e) => setEditForm((f) => ({ ...f, last4: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
          />
          <div>
            <p className="text-sm font-bold text-slate-700 dark:text-slate-300 ml-1 mb-2">{t('common.color')}</p>
            <div className="flex gap-3 flex-wrap">
              {ACCOUNT_COLORS.map((c) => (
                <button key={c} onClick={() => setEditForm((f) => ({ ...f, color: c }))} className="w-10 h-10 rounded-full border-[3px] transition-all flex items-center justify-center shadow-sm hover:scale-110" style={{ backgroundColor: c, borderColor: editForm.color === c ? '#0f172a' : 'transparent' }}>
                  {editForm.color === c && <CheckCircle2 className="w-5 h-5 text-white" />}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="sticky bottom-0 bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700/60 -mx-6 sm:-mx-8 px-6 sm:px-8 py-4">
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => { setEditOpen(false); setEditTarget(null); }}>{t('common.cancel')}</Button>
            <Button className="flex-1 shadow-sm" onClick={handleEditSave} disabled={saving || !editForm.name}>{saving ? t('common.saving') : t('accounts.editAccount')}</Button>
          </div>
        </div>
      </Modal>

      {/* Deposit/Withdraw Modal */}
      <Modal
        open={open}
        onClose={() => { setOpen(false); setForm(EMPTY_FORM); }}
        title={form.type === 'deposit' ? t('savings.depositToSavings') : t('savings.withdrawFromSavings')}
      >
        <div className="space-y-5 pb-4">
          <div className="flex p-1.5 rounded-2xl bg-slate-100 dark:bg-slate-700">
            <button
              onClick={() => setForm((f) => ({ ...f, type: 'deposit' }))}
              className={`flex-1 py-3 text-sm font-bold rounded-xl transition-all duration-300 ${
                form.type === 'deposit' ? 'bg-white dark:bg-slate-800 text-emerald-600 dark:text-emerald-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              {t('savings.deposit')}
            </button>
            <button
              onClick={() => setForm((f) => ({ ...f, type: 'withdraw' }))}
              className={`flex-1 py-3 text-sm font-bold rounded-xl transition-all duration-300 ${
                form.type === 'withdraw' ? 'bg-white dark:bg-slate-800 text-rose-600 dark:text-rose-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              {t('savings.withdraw')}
            </button>
          </div>
          <Select
            label={t('savings.savingsAccount')}
            value={form.accountId}
            options={accounts.map((a) => ({ value: a.id, label: `${a.name} (${formatCurrency(a.balance)})` }))}
            onChange={(e) => setForm((f) => ({ ...f, accountId: e.target.value }))}
          />
          <Input
            label={t('common.amount')}
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={form.amount}
            onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
          />
          <Input
            label={t('savings.descriptionOptional')}
            placeholder={form.type === 'deposit' ? t('savings.phDeposit') : t('savings.phWithdraw')}
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
          <Input
            label={t('common.date')}
            type="date"
            value={form.date}
            onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
          />
        </div>
        <div className="sticky bottom-0 bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700/60 -mx-6 sm:-mx-8 px-6 sm:px-8 py-4">
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => { setOpen(false); setForm(EMPTY_FORM); }}>
              {t('common.cancel')}
            </Button>
            <Button
              className={`flex-1 shadow-sm ${form.type === 'deposit' ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-rose-600 hover:bg-rose-500'}`}
              onClick={handleAction}
              disabled={saving || !form.amount || !form.accountId}
            >
              {saving ? t('common.saving') : form.type === 'deposit' ? t('savings.deposit') : t('savings.withdraw')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Add Interest Modal */}
      <Modal
        open={interestOpen}
        onClose={() => { setInterestOpen(false); setInterestForm(EMPTY_INTEREST_FORM); }}
        title={t('savings.addInterest')}
      >
        {(() => {
          const acc = accounts.find((a) => a.id === interestForm.accountId);
          const rate = acc?.apr;
          const suggested = acc ? calcSavingsInterest(acc.balance, acc.apr ?? 0) : 0;
          return (
            <>
              <div className="space-y-5 pb-4">
                <Select
                  label={t('savings.savingsAccount')}
                  value={interestForm.accountId}
                  options={accounts.map((a) => ({ value: a.id, label: `${a.name} (${formatCurrency(a.balance)})` }))}
                  onChange={(e) => selectInterestAccount(e.target.value)}
                />
                {/* Rate + calculated estimate so it's clear where the number comes from. */}
                {rate != null && rate > 0 ? (
                  <div className="rounded-2xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800/40 p-4">
                    <p className="text-xs font-bold text-emerald-700/80 dark:text-emerald-400/80 uppercase tracking-wider">{t('savings.interestEstimate', { rate: rate.toFixed(2) })}</p>
                    <p className="text-lg font-extrabold text-emerald-600 dark:text-emerald-400 mt-0.5 whitespace-nowrap">+{formatCurrency(suggested)}</p>
                    <p className="text-xs font-medium text-emerald-700/70 dark:text-emerald-400/70 mt-1">{t('savings.interestEstimateHint')}</p>
                  </div>
                ) : (
                  <div className="rounded-2xl bg-slate-50 dark:bg-slate-700/40 border border-slate-100 dark:border-slate-700/60 p-4">
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{t('savings.noRateHint')}</p>
                  </div>
                )}
                <Input
                  label={t('savings.interestAmount')}
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={interestForm.amount}
                  onChange={(e) => setInterestForm((f) => ({ ...f, amount: e.target.value }))}
                />
                <Input
                  label={t('savings.descriptionOptional')}
                  placeholder={t('savings.phInterest')}
                  value={interestForm.description}
                  onChange={(e) => setInterestForm((f) => ({ ...f, description: e.target.value }))}
                />
                <Input
                  label={t('common.date')}
                  type="date"
                  value={interestForm.date}
                  onChange={(e) => setInterestForm((f) => ({ ...f, date: e.target.value }))}
                />
              </div>
              <div className="sticky bottom-0 bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700/60 -mx-6 sm:-mx-8 px-6 sm:px-8 py-4">
                <div className="flex gap-3">
                  <Button variant="secondary" className="flex-1" onClick={() => { setInterestOpen(false); setInterestForm(EMPTY_INTEREST_FORM); }}>
                    {t('common.cancel')}
                  </Button>
                  <Button
                    className="flex-1 shadow-sm bg-emerald-600 hover:bg-emerald-500"
                    onClick={handleInterest}
                    disabled={saving || !interestForm.amount || !interestForm.accountId}
                  >
                    {saving ? t('common.saving') : t('savings.addInterest')}
                  </Button>
                </div>
              </div>
            </>
          );
        })()}
      </Modal>
    </StaggerReveal>
  );
}
