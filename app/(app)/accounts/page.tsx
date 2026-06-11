'use client';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Link from 'next/link';
import { Plus, Trash2, CreditCard, Landmark, PiggyBank, TrendingUp, Pencil, CheckCircle2, RefreshCw, AlertCircle, Banknote, Coins } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { creditUtilization, creditUtilStatus, calcLoanPayoff, calcLoanExtraPaymentImpact } from '@/lib/calculations';
import { buildLoanPaymentTxs } from '@/lib/loanPayments';
import { motion, AnimatePresence } from 'framer-motion';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { AccountsSkeleton } from '@/components/ui/Skeleton';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
import { peekCache, ensureResources } from '@/lib/client/store';
import { FitText } from '@/components/ui/FitText';
import { formatCurrency, generateId, today } from '@/lib/utils';
import { useToast } from '@/lib/toast';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import type { Account } from '@/types';
import { useTranslation } from '@/lib/i18n/context';

const ACCOUNT_COLORS = [
  '#6366f1', '#3b82f6', '#0ea5e9', '#06b6d4', '#14b8a6', '#10b981', '#84cc16',
  '#eab308', '#f59e0b', '#f97316', '#ef4444', '#ec4899', '#d946ef', '#8b5cf6',
  '#64748b', '#0f172a',
];

const ACCOUNT_TYPE_CONFIG = {
  checking: { icon: Landmark, colorClass: 'text-blue-600 dark:text-blue-400', bgClass: 'bg-blue-50 dark:bg-blue-900/30' },
  savings: { icon: PiggyBank, colorClass: 'text-emerald-600 dark:text-emerald-400', bgClass: 'bg-emerald-50 dark:bg-emerald-900/30' },
  credit: { icon: CreditCard, colorClass: 'text-rose-600 dark:text-rose-400', bgClass: 'bg-rose-50 dark:bg-rose-900/30' },
  investment: { icon: TrendingUp, colorClass: 'text-indigo-600 dark:text-indigo-400', bgClass: 'bg-indigo-50 dark:bg-indigo-900/30' },
  loan: { icon: CreditCard, colorClass: 'text-amber-600 dark:text-amber-400', bgClass: 'bg-amber-50 dark:bg-amber-900/30' },
  cash: { icon: Coins, colorClass: 'text-green-600 dark:text-green-400', bgClass: 'bg-green-50 dark:bg-green-900/30' },
};

// Tolerate "1,000.50", "1.000,50", "$100", and currency symbols — strip
// everything except digits, a single decimal point, and a leading minus.
function parseBalance(input: string): number {
  if (input == null) return 0;
  const s = String(input).trim();
  if (!s) return 0;
  const negative = s.startsWith('-');
  // Drop currency symbols/letters/spaces; treat both "," and "." as separators.
  let cleaned = s.replace(/[^0-9.,]/g, '');
  const lastDot = cleaned.lastIndexOf('.');
  const lastComma = cleaned.lastIndexOf(',');
  const decimalAt = Math.max(lastDot, lastComma);
  if (decimalAt >= 0) {
    const intPart = cleaned.slice(0, decimalAt).replace(/[.,]/g, '');
    const fracPart = cleaned.slice(decimalAt + 1).replace(/[.,]/g, '');
    cleaned = intPart + '.' + fracPart;
  } else {
    cleaned = cleaned.replace(/[.,]/g, '');
  }
  const n = parseFloat(cleaned);
  if (!Number.isFinite(n)) return 0;
  return negative ? -n : n;
}

const EMPTY_FORM = {
  name: '',
  type: 'checking' as Account['type'],
  institution: '',
  balance: '',
  last4: '',
  color: ACCOUNT_COLORS[0],
  creditLimit: '',
  apr: '',
  monthlyPayment: '',
  termMonths: '',
  paymentAccountId: '',
  minBalance: '',
};

// Deposit accounts that the low-balance safeguard watches (where real bills get
// paid from). Mirrors isSpendableAccount in lib/calculations.
const SPENDABLE_ACCOUNT_TYPES: Account['type'][] = ['checking', 'savings', 'cash'];

// Status → text color for the inline utilization readout on credit rows.
const UTIL_TEXT: Record<string, string> = {
  excellent: 'text-emerald-600 dark:text-emerald-400',
  good: 'text-emerald-600 dark:text-emerald-400',
  fair: 'text-amber-600 dark:text-amber-400',
  high: 'text-orange-600 dark:text-orange-400',
  maxed: 'text-rose-600 dark:text-rose-400',
  over: 'text-rose-600 dark:text-rose-400',
};

export default function AccountsPage() {
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState<Account[]>(() => peekCache(['accounts'])?.accounts ?? []);
  const [open, setOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Account | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(() => peekCache(['accounts']) === null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const toast = useToast();

  const ACCOUNT_TYPE_LABELS: Record<Account['type'], string> = {
    checking: t('accounts.typeChecking'),
    savings: t('accounts.typeSavings'),
    credit: t('accounts.typeCredit'),
    investment: t('accounts.typeInvestment'),
    loan: t('accounts.typeLoan'),
    cash: t('accounts.typeCash'),
  };

  // Section headers use a localized plural label rather than appending a literal
  // "s" — which produced "Checkings"/"Savingss" in English and a stray "s" in
  // languages that don't pluralize (e.g. Vietnamese).
  const ACCOUNT_TYPE_GROUP_LABELS: Record<Account['type'], string> = {
    checking: t('accounts.groupChecking'),
    savings: t('accounts.groupSavings'),
    credit: t('accounts.groupCredit'),
    investment: t('accounts.groupInvestment'),
    loan: t('accounts.groupLoan'),
    cash: t('accounts.groupCash'),
  };

  const load = useCallback(async (force = false) => {
    try {
      const { accounts } = await ensureResources(['accounts'], { force });
      setAccounts(accounts);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useAutoRefresh(() => load(true));

  const { pullY, refreshing } = usePullToRefresh(() => load(true));

  function openAdd() { setEditTarget(null); setForm(EMPTY_FORM); setOpen(true); }
  function openEdit(account: Account) {
    setEditTarget(account);
    setForm({ name: account.name, type: account.type, institution: account.institution, balance: String(account.balance), last4: account.last4, color: account.color, creditLimit: account.creditLimit != null ? String(account.creditLimit) : '', apr: account.apr != null ? String(account.apr) : '', monthlyPayment: account.monthlyPayment != null ? String(account.monthlyPayment) : '', termMonths: account.termMonths != null ? String(account.termMonths) : '', paymentAccountId: account.paymentAccountId ?? '', minBalance: account.minBalance != null ? String(account.minBalance) : '' });
    setOpen(true);
  }

  async function handleSave() {
    if (!form.name) return;
    setSaving(true);
    const account: Account = {
      id: editTarget?.id ?? generateId(),
      name: form.name,
      type: form.type,
      institution: form.institution,
      balance: parseBalance(form.balance),
      last4: form.last4,
      color: form.color,
      createdAt: editTarget?.createdAt ?? today(),
      // Credit limit only applies to credit cards (and powers the Smart Credit
      // Report). Switching a card to another type clears it.
      creditLimit: form.type === 'credit' && form.creditLimit ? Math.max(0, parseBalance(form.creditLimit)) : undefined,
      // The accounts form has no statement-day input (it lives on the Credit page),
      // so preserve the stored value on edit — the API only self-maintains
      // openingBalance, so omitting it here would wipe it. Cleared off non-credit.
      statementDay: form.type === 'credit' ? editTarget?.statementDay : undefined,
      // APR powers the Balance-Transfer Optimizer (credit) and payoff math (loan);
      // 0 is a valid 0% APR. Kept for both card and loan accounts.
      apr: (form.type === 'credit' || form.type === 'loan') && form.apr !== '' ? Math.max(0, parseFloat(form.apr)) : undefined,
      // Loan-only fields: scheduled monthly payment, original term, and the
      // account payments are drawn from. Cleared on non-loan types.
      monthlyPayment: form.type === 'loan' && form.monthlyPayment !== '' ? Math.max(0, parseBalance(form.monthlyPayment)) : undefined,
      termMonths: form.type === 'loan' && form.termMonths !== '' ? Math.max(0, Math.round(parseFloat(form.termMonths))) : undefined,
      paymentAccountId: form.type === 'loan' && form.paymentAccountId ? form.paymentAccountId : undefined,
      // Low-balance safeguard buffer — only meaningful on spendable deposit
      // accounts (where bills are paid from). Cleared when switched off those types.
      minBalance: SPENDABLE_ACCOUNT_TYPES.includes(form.type) && form.minBalance !== '' ? Math.max(0, parseBalance(form.minBalance)) : undefined,
    };

    // Optimistic update
    if (editTarget) {
      setAccounts((prev) => prev.map((a) => a.id === account.id ? account : a));
    } else {
      setAccounts((prev) => [...prev, account]);
    }
    setOpen(false);
    setForm(EMPTY_FORM);
    setEditTarget(null);

    try {
      const res = await fetch('/api/accounts', {
        method: 'POST',
        body: JSON.stringify(account),
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error();
      toast(editTarget ? t('accounts.toastUpdated') : t('accounts.toastAdded'), 'success');
      // The optimistic update already reflects every displayed field (the only
      // server-maintained field, openingBalance, isn't shown) — so no reload needed.
    } catch {
      toast(t('accounts.toastFailedSave'), 'error');
      await load(true); // reconcile from server truth after a failed write
    } finally {
      setSaving(false);
    }
  }

  // Make a loan payment, split into interest (an expense) + principal (a transfer
  // into the loan that lowers the balance) — see buildLoanPaymentTxs. Pays the
  // scheduled monthly amount, capped at the remaining balance. Each row is posted
  // sequentially (they mutate the same balances server-side); the last response
  // carries the authoritative post-write balances.
  async function makeLoanPayment(account: Account) {
    const from = account.paymentAccountId;
    const owed = Math.max(0, account.balance);
    const amount = Math.min(account.monthlyPayment ?? 0, owed);
    if (!from || !(amount > 0)) return;
    if (!confirm(t('accounts.confirmPayment', { amount: formatCurrency(amount), card: account.name }))) return;
    const txs = buildLoanPaymentTxs(from, account.id, owed, account.apr ?? 0, amount, t('accounts.loanPaymentDesc', { card: account.name }), 'Bills', today());
    const principal = txs.filter((tx) => tx.type === 'transfer').reduce((s, tx) => s + tx.amount, 0);
    const cashOut = txs.reduce((s, tx) => s + tx.amount, 0);
    // Optimistic: pay-from drops by the full payment, the loan by principal only.
    setAccounts((prev) => prev.map((a) => {
      if (a.id === account.id) return { ...a, balance: Math.round((a.balance - principal) * 100) / 100 };
      if (a.id === from) return { ...a, balance: Math.round((a.balance - cashOut) * 100) / 100 };
      return a;
    }));
    try {
      let latest: Account[] | null = null;
      for (const tx of txs) {
        const res = await fetch('/api/transactions', {
          method: 'POST',
          body: JSON.stringify(tx),
          headers: { 'Content-Type': 'application/json' },
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (data.accounts) latest = data.accounts;
      }
      if (latest) setAccounts(latest);
      toast(t('accounts.paymentMade', { amount: formatCurrency(cashOut) }), 'success');
    } catch {
      toast(t('accounts.paymentFailed'), 'error');
      await load(true);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm(t('accounts.confirmDelete'))) return;
    const prev = accounts;
    setAccounts((a) => a.filter((acc) => acc.id !== id));
    try {
      const res = await fetch('/api/accounts', { method: 'DELETE', body: JSON.stringify({ id }), headers: { 'Content-Type': 'application/json' } });
      if (!res.ok) {
        // Blocked because transactions still reference this account — restore the
        // row and tell the user how many must be moved/deleted first.
        if (res.status === 409) {
          const { count } = await res.json().catch(() => ({ count: 0 }));
          setAccounts(prev);
          toast(t('accounts.toastHasTransactions', { count }), 'error');
          return;
        }
        throw new Error();
      }
      toast(t('accounts.toastDeleted'), 'success');
    } catch {
      setAccounts(prev);
      toast(t('accounts.toastFailedDelete'), 'error');
    }
  }

  const { netWorth, totalAssets, totalDebt } = useMemo(() => {
    let nw = 0, assets = 0, debt = 0;
    for (const a of accounts) {
      if (a.type === 'credit' || a.type === 'loan') {
        nw -= a.balance;
        if (a.balance > 0) debt += a.balance;
      } else {
        nw += a.balance;
        assets += a.balance;
      }
    }
    return { netWorth: nw, totalAssets: assets, totalDebt: debt };
  }, [accounts]);

  const grouped = useMemo(() => {
    const g: Record<Account['type'], Account[]> = { checking: [], cash: [], savings: [], credit: [], investment: [], loan: [] };
    for (const a of accounts) g[a.type].push(a);
    return g;
  }, [accounts]);

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6 sm:space-y-8 pb-24 md:pb-8">
      {/* Pull-to-refresh indicator */}
      {(pullY > 0 || refreshing) && (
        <div className="fixed top-0 left-0 right-0 z-50 flex justify-center pt-safe">
          <div className="flex items-center gap-2 bg-indigo-600 text-white text-xs font-bold px-4 py-2 rounded-full shadow-lg mt-2">
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} style={!refreshing ? { transform: `rotate(${pullY * 180}deg)` } : undefined} />
            {refreshing ? t('accounts.refreshing') : pullY >= 1 ? t('accounts.releaseToRefresh') : t('accounts.pullToRefresh')}
          </div>
        </div>
      )}

      <PageHeader
        icon={Landmark}
        tone="indigo"
        title={t('accounts.title')}
        subtitle={t('accounts.subtitle')}
        action={
          <Button onClick={openAdd} className="w-full md:w-auto shadow-sm hover:shadow-md">
            <Plus className="w-5 h-5" />{t('accounts.addAccount')}
          </Button>
        }
      />

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-indigo-100 dark:border-indigo-800/50 hover:border-indigo-200 dark:hover:border-indigo-800/50">
          <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t('accounts.netWorth')}</p>
          <FitText maxSize={28} minSize={13} className={`font-extrabold mt-2 ${netWorth >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{formatCurrency(netWorth)}</FitText>
        </Card>
        <Card>
          <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t('accounts.totalAssets')}</p>
          <FitText maxSize={28} minSize={13} className="font-extrabold mt-2 text-slate-900 dark:text-slate-100">{formatCurrency(totalAssets)}</FitText>
        </Card>
        <Card>
          <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t('accounts.totalDebt')}</p>
          <FitText maxSize={28} minSize={13} className="font-extrabold mt-2 text-rose-600 dark:text-rose-400">{formatCurrency(totalDebt)}</FitText>
        </Card>
      </div>

      {loading ? (
        <AccountsSkeleton />
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-14 h-14 rounded-full bg-rose-50 dark:bg-rose-900/30 flex items-center justify-center mb-4">
            <AlertCircle className="w-7 h-7 text-rose-400" />
          </div>
          <p className="text-slate-700 dark:text-slate-300 font-bold text-base mb-1">Couldn&apos;t load accounts</p>
          <p className="text-slate-500 dark:text-slate-400 text-sm mb-6">Check your connection and try again.</p>
          <Button variant="secondary" onClick={() => load(true)}>Try Again</Button>
        </div>
      ) : accounts.length === 0 ? (
        <Card className="text-center py-16 bg-slate-50 dark:bg-slate-700/50 border-slate-100 dark:border-slate-700/60">
          <div className="w-16 h-16 rounded-full bg-white dark:bg-slate-800 flex items-center justify-center mx-auto mb-4 shadow-sm border border-slate-100 dark:border-slate-700/60">
            <Landmark className="w-8 h-8 text-slate-400 dark:text-slate-500" />
          </div>
          <p className="text-slate-900 dark:text-slate-100 font-bold text-lg mb-1">No accounts yet.</p>
          <p className="text-slate-500 dark:text-slate-400 font-medium mb-6">Add your checking account first — paychecks will be tracked there.</p>
          <Button onClick={openAdd} className="shadow-sm">Add Your First Account</Button>
        </Card>
      ) : (
        <div className="space-y-8">
          {(Object.entries(grouped) as [Account['type'], Account[]][])
            .filter(([, list]) => list.length > 0)
            .map(([type, list]) => {
              const config = ACCOUNT_TYPE_CONFIG[type];
              const Icon = config.icon;
              const label = ACCOUNT_TYPE_GROUP_LABELS[type];
              return (
                <div key={type} className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700/60 p-4 sm:p-6 shadow-sm">
                  <div className="flex items-center gap-3 mb-4 px-2">
                    <div className={`p-2 rounded-xl ${config.bgClass}`}><Icon className={`w-5 h-5 ${config.colorClass}`} /></div>
                    <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">{label}</h2>
                  </div>
                  <div className="space-y-3">
                    {list.map((account) => (
                      <div key={account.id} className="group flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-2xl bg-slate-50 dark:bg-slate-700/50 border border-slate-100 dark:border-slate-700/60 hover:border-slate-200 dark:hover:border-slate-700 hover:bg-white dark:hover:bg-slate-800 hover:shadow-sm transition-all duration-300 gap-4 sm:gap-0">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 shadow-sm border border-slate-100 dark:border-slate-700/60 bg-white dark:bg-slate-800">
                            <Icon className="w-6 h-6" style={{ color: account.color }} />
                          </div>
                          <div>
                            <p className="text-base font-bold text-slate-900 dark:text-slate-100">{account.name}</p>
                            <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mt-0.5">{account.institution || label}{account.last4 ? ` ····${account.last4}` : ''}</p>
                            {SPENDABLE_ACCOUNT_TYPES.includes(type) && (account.minBalance ?? 0) > 0 && (
                              <p className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 mt-1">{t('accounts.minBalanceBadge', { amount: formatCurrency(account.minBalance ?? 0) })}</p>
                            )}
                            {type === 'credit' && (() => {
                              const util = creditUtilization(account.balance, account.creditLimit ?? 0);
                              if (util === null) {
                                return (
                                  <Link href="/credit" className="inline-block text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline mt-1">{t('accounts.setLimitHint')}</Link>
                                );
                              }
                              return (
                                <Link href="/credit" className={`inline-block text-xs font-bold mt-1 hover:underline ${UTIL_TEXT[creditUtilStatus(util)]}`}>
                                  {t('accounts.utilization', { pct: `${Math.round(util)}%` })}
                                </Link>
                              );
                            })()}
                            {type === 'loan' && account.balance > 0 && (() => {
                              const payoff = calcLoanPayoff(account.balance, account.apr ?? 0, account.monthlyPayment ?? 0);
                              if (!(account.monthlyPayment && account.monthlyPayment > 0)) {
                                return <button onClick={() => openEdit(account)} className="block text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline mt-1">{t('accounts.setLoanTerms')}</button>;
                              }
                              if (!payoff.amortizes) {
                                return <p className="text-xs font-bold text-rose-600 dark:text-rose-400 mt-1">{t('accounts.loanNoAmortize', { interest: formatCurrency(payoff.monthlyInterest) })}</p>;
                              }
                              const extra = Math.max(25, Math.round((account.monthlyPayment * 0.1) / 25) * 25);
                              const impact = calcLoanExtraPaymentImpact(account.balance, account.apr ?? 0, account.monthlyPayment, extra);
                              return (
                                <div className="mt-1 space-y-0.5">
                                  <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
                                    {t('accounts.loanPayoff', { months: payoff.months ?? 0, interest: formatCurrency(payoff.totalInterest) })}
                                  </p>
                                  {impact && impact.monthsSaved > 0 && (
                                    <p className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                                      {t('accounts.loanPayExtra', { extra: formatCurrency(extra), months: impact.monthsSaved, saved: formatCurrency(impact.interestSaved) })}
                                    </p>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                        <div className="flex items-center justify-between sm:justify-end gap-6 sm:gap-8 w-full sm:w-auto pl-16 sm:pl-0">
                          <div className="text-left sm:text-right">
                            {type === 'credit' || type === 'loan' ? (
                              account.balance < 0 ? (
                                <><p className="text-base font-extrabold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">+{formatCurrency(Math.abs(account.balance))}</p><p className="text-xs font-bold text-emerald-500 dark:text-emerald-400">{t('accounts.creditNote')}</p></>
                              ) : account.balance === 0 ? (
                                <PaidOffBadge accountId={account.id} paidOffLabel={t('accounts.paidOff')} />
                              ) : (
                                <><p className="text-base font-extrabold text-rose-600 dark:text-rose-400 whitespace-nowrap">-{formatCurrency(account.balance)}</p><p className="text-xs font-bold text-slate-400 dark:text-slate-500">{t('accounts.owed')}</p></>
                              )
                            ) : (
                              <p className="text-base font-extrabold text-slate-900 dark:text-slate-100 whitespace-nowrap">{formatCurrency(account.balance)}</p>
                            )}
                          </div>
                          <div className="flex gap-2">
                            {type === 'loan' && account.balance > 0 && account.paymentAccountId && (account.monthlyPayment ?? 0) > 0 && (
                              <Button variant="ghost" size="icon" title={t('accounts.makePayment')} className="text-slate-400 dark:text-slate-500 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 h-10 w-10 rounded-xl" onClick={() => makeLoanPayment(account)}><Banknote className="w-4 h-4" /></Button>
                            )}
                            <Button variant="ghost" size="icon" className="text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 h-10 w-10 rounded-xl" onClick={() => openEdit(account)}><Pencil className="w-4 h-4" /></Button>
                            <Button variant="ghost" size="icon" className="text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/30 h-10 w-10 rounded-xl" onClick={() => handleDelete(account.id)}><Trash2 className="w-4 h-4" /></Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
        </div>
      )}

      <Modal open={open} onClose={() => { setOpen(false); setForm(EMPTY_FORM); setEditTarget(null); }} title={editTarget ? t('accounts.editAccount') : t('accounts.addAccount')}>
        <div className="space-y-5 pb-4">
          <Select label={t('accounts.accountType')} value={form.type} options={Object.entries(ACCOUNT_TYPE_CONFIG).map(([value]) => ({ value, label: ACCOUNT_TYPE_LABELS[value as Account['type']] }))} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as Account['type'] }))} />
          <Input label={t('accounts.accountName')} placeholder={form.type === 'checking' ? 'e.g. Chase Checking' : form.type === 'credit' ? 'e.g. Chase Sapphire' : form.type === 'cash' ? 'e.g. Wallet' : 'e.g. HYSA'} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          <Input label={t('accounts.institution')} placeholder="e.g. Chase, Bank of America" value={form.institution} onChange={(e) => setForm((f) => ({ ...f, institution: e.target.value }))} />
          <Input label={form.type === 'credit' || form.type === 'loan' ? `${t('accounts.balanceOwed')} — enter negative if bank owes you` : t('accounts.currentBalance')} type="text" inputMode="decimal" placeholder="0.00" value={form.balance} onChange={(e) => setForm((f) => ({ ...f, balance: e.target.value.replace(/[^0-9.,\-]/g, '') }))} />
          {form.type === 'credit' && (
            <div className="grid grid-cols-2 gap-3">
              <Input label={t('accounts.creditLimit')} type="text" inputMode="decimal" placeholder="0.00" value={form.creditLimit} onChange={(e) => setForm((f) => ({ ...f, creditLimit: e.target.value.replace(/[^0-9.,]/g, '') }))} />
              <Input label={t('accounts.apr')} type="text" inputMode="decimal" placeholder="0.00" value={form.apr} onChange={(e) => setForm((f) => ({ ...f, apr: e.target.value.replace(/[^0-9.]/g, '') }))} />
            </div>
          )}
          {form.type === 'loan' && (
            <div className="space-y-4 rounded-2xl bg-slate-50 dark:bg-slate-700/40 border border-slate-100 dark:border-slate-700/60 p-4">
              <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t('accounts.loanDetails')}</p>
              <div className="grid grid-cols-2 gap-3">
                <Input label={t('accounts.apr')} type="text" inputMode="decimal" placeholder="0.00" value={form.apr} onChange={(e) => setForm((f) => ({ ...f, apr: e.target.value.replace(/[^0-9.]/g, '') }))} />
                <Input label={t('accounts.monthlyPayment')} type="text" inputMode="decimal" placeholder="0.00" value={form.monthlyPayment} onChange={(e) => setForm((f) => ({ ...f, monthlyPayment: e.target.value.replace(/[^0-9.,]/g, '') }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Input label={t('accounts.termMonths')} type="text" inputMode="numeric" placeholder="60" value={form.termMonths} onChange={(e) => setForm((f) => ({ ...f, termMonths: e.target.value.replace(/[^0-9]/g, '').slice(0, 3) }))} />
                <Select
                  label={t('accounts.paymentAccount')}
                  value={form.paymentAccountId}
                  options={[
                    { value: '', label: t('accounts.paymentAccountNone') },
                    ...accounts.filter((a) => a.type !== 'loan').map((a) => ({ value: a.id, label: a.name })),
                  ]}
                  onChange={(e) => setForm((f) => ({ ...f, paymentAccountId: e.target.value }))}
                />
              </div>
            </div>
          )}
          {SPENDABLE_ACCOUNT_TYPES.includes(form.type) && (
            <div>
              <Input label={t('accounts.minBalance')} type="text" inputMode="decimal" placeholder="0.00" value={form.minBalance} onChange={(e) => setForm((f) => ({ ...f, minBalance: e.target.value.replace(/[^0-9.,]/g, '') }))} />
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 ml-1">{t('accounts.minBalanceHint')}</p>
            </div>
          )}
          <Input label={t('accounts.last4')} placeholder="1234" maxLength={4} value={form.last4} onChange={(e) => setForm((f) => ({ ...f, last4: e.target.value.replace(/\D/g, '').slice(0, 4) }))} />
          <div>
            <p className="text-sm font-bold text-slate-700 dark:text-slate-300 ml-1 mb-2">{t('common.color')}</p>
            <div className="flex gap-3 flex-wrap">
              {ACCOUNT_COLORS.map((c) => (
                <button key={c} onClick={() => setForm((f) => ({ ...f, color: c }))} className="w-7 h-7 rounded-full border-[3px] transition-all flex items-center justify-center shadow-sm hover:scale-110" style={{ backgroundColor: c, borderColor: form.color === c ? '#0f172a' : 'transparent' }}>
                  {form.color === c && <CheckCircle2 className="w-4 h-4 text-white" />}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="sticky bottom-0 bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700/60 -mx-6 sm:-mx-8 px-6 sm:px-8 py-4">
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => { setOpen(false); setForm(EMPTY_FORM); setEditTarget(null); }}>{t('common.cancel')}</Button>
            <Button className="flex-1 shadow-sm" onClick={handleSave} disabled={saving || !form.name}>{saving ? t('common.saving') : editTarget ? t('accounts.editAccount') : t('accounts.addAccount')}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ── Paid-off credit card celebration badge ───────────────────────────────────
//
// Shown when a credit/loan account's balance reaches exactly zero.
// Replaces the previous "-$0.00" treatment with a celebratory $0.00 badge:
//   • emerald-600 colour + check icon
//   • brief confetti burst on first appearance (per session, per account)
//   • subtle pulse + scale-in entry

const CONFETTI_COLORS = ['#10b981', '#34d399', '#6ee7b7', '#fbbf24', '#f472b6', '#60a5fa'];

function PaidOffBadge({ accountId, paidOffLabel }: { accountId: string; paidOffLabel: string }) {
  // Confetti fires once per account per session (sessionStorage gate) so the
  // animation doesn't replay on every re-render or list refresh.
  const sessionKey = `paidoff-confetti:${accountId}`;
  const fireRef = useRef<boolean>(false);
  const [showConfetti, setShowConfetti] = useState(false);

  // Pre-compute particle trajectories so the values stay stable across re-renders.
  const particles = useMemo(() => {
    const count = 14;
    return Array.from({ length: count }, (_, i) => {
      const angle = (i / count) * Math.PI * 2;
      const distance = 36 + ((i * 7) % 14); // deterministic jitter
      return {
        dx: Math.cos(angle) * distance,
        dy: Math.sin(angle) * distance,
        duration: 0.9 + ((i % 4) * 0.08),
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      };
    });
  }, []);

  useEffect(() => {
    if (fireRef.current) return;
    fireRef.current = true;
    if (typeof window === 'undefined') return;
    if (sessionStorage.getItem(sessionKey)) return;
    sessionStorage.setItem(sessionKey, '1');
    setShowConfetti(true);
    const t = setTimeout(() => setShowConfetti(false), 1400);
    return () => clearTimeout(t);
  }, [sessionKey]);

  return (
    <div className="relative inline-flex flex-col items-end">
      <motion.p
        initial={{ scale: 0.7, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 320, damping: 18 }}
        className="text-xl font-black text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1.5 whitespace-nowrap"
      >
        <CheckCircle2 className="w-5 h-5 shrink-0" aria-hidden />
        $0.00
      </motion.p>
      <p className="text-xs font-bold text-emerald-500 dark:text-emerald-400 mt-0.5">{paidOffLabel}</p>

      <AnimatePresence>
        {showConfetti && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
            {particles.map((p, i) => (
              <motion.span
                key={i}
                initial={{ x: 0, y: 0, opacity: 1, scale: 0.6 }}
                animate={{ x: p.dx, y: p.dy, opacity: 0, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: p.duration, ease: 'easeOut' }}
                className="absolute w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: p.color }}
              />
            ))}
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
