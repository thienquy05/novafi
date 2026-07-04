'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { TrendingUp, Plus, ArrowUpRight, ArrowDownRight, ArrowDownLeft, Pencil } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { FitText } from '@/components/ui/FitText';
import { InvestmentsSkeleton } from '@/components/ui/Skeleton';
import { StaggerReveal } from '@/components/ui/Reveal';
import { formatCurrency, generateId, today } from '@/lib/utils';
import { peekCache, ensureResources } from '@/lib/client/store';
import { useToast } from '@/lib/toast';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
import { useTranslation } from '@/lib/i18n/context';
import { isSpendableAccount } from '@/lib/calculations';
import {
  accountInvestment, portfolioStats, contributionHistory, CONTRIBUTION_CATEGORY,
} from '@/lib/investments';
import type { Account, Transaction } from '@/types';

function fmtPct(pct: number | null): string {
  if (pct === null) return '—';
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

// Which modal is open, and for which investment account.
type Action = 'contribute' | 'withdraw' | 'value';

export default function InvestmentsPage() {
  const { t } = useTranslation();
  const toast = useToast();

  const [accounts, setAccounts] = useState<Account[]>(() => peekCache(['accounts'])?.accounts ?? []);
  const [transactions, setTransactions] = useState<Transaction[]>(() => peekCache(['transactions'])?.transactions ?? []);
  // Warm client cache → skip the skeleton entirely (same pattern as siblings).
  const [loading, setLoading] = useState(() => peekCache(['accounts', 'transactions']) === null);
  const [saving, setSaving] = useState(false);

  const [action, setAction] = useState<Action | null>(null);
  const [target, setTarget] = useState<Account | null>(null);
  const [fromAccount, setFromAccount] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today());
  const [note, setNote] = useState('');
  const [value, setValue] = useState('');

  const load = useCallback(async (force = false) => {
    const data = await ensureResources(['accounts', 'transactions'], { force });
    setAccounts(data.accounts);
    setTransactions(data.transactions);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useAutoRefresh(() => load(true));

  const investAccounts = useMemo(
    () => accounts.filter((a) => a.type === 'investment'),
    [accounts],
  );
  // Accounts you can fund from / withdraw to — real spendable cash accounts.
  const spendAccounts = useMemo(() => accounts.filter(isSpendableAccount), [accounts]);
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? t('investments.unknownAccount');

  const stats = useMemo(() => portfolioStats(investAccounts, transactions), [investAccounts, transactions]);

  function openContribute(acc: Account) {
    setTarget(acc); setAction('contribute');
    setFromAccount(spendAccounts[0]?.id ?? ''); setAmount(''); setDate(today()); setNote('');
  }
  function openWithdraw(acc: Account) {
    setTarget(acc); setAction('withdraw');
    setFromAccount(spendAccounts[0]?.id ?? ''); setAmount(''); setDate(today()); setNote('');
  }
  function openValue(acc: Account) {
    setTarget(acc); setAction('value');
    setValue(acc.balance ? String(acc.balance) : '');
  }
  function close() { setAction(null); setTarget(null); }

  // Post a transfer between a spendable account and the investment account.
  // Direction is set by `action`: contribute = money in, withdraw = money out.
  async function saveTransfer() {
    if (!target || !fromAccount) return;
    const amt = parseFloat(amount);
    if (!(amt > 0)) return;
    setSaving(true);
    const isContribute = action === 'contribute';
    const tx: Transaction = {
      id: generateId(),
      date: date || today(),
      description: note.trim() || (isContribute
        ? t('investments.defaultContributeNote', { name: target.name })
        : t('investments.defaultWithdrawNote', { name: target.name })),
      amount: amt,
      type: 'transfer',
      category: CONTRIBUTION_CATEGORY,
      account: isContribute ? fromAccount : target.id,
      toAccount: isContribute ? target.id : fromAccount,
      createdAt: new Date().toISOString(),
    };
    try {
      const res = await fetch('/api/transactions', {
        method: 'POST', body: JSON.stringify(tx),
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error();
      toast(isContribute ? t('investments.toastContributed') : t('investments.toastWithdrawn'), 'success');
      close();
      load(true);
    } catch {
      toast(t('investments.toastFailed'), 'error');
    } finally {
      setSaving(false);
    }
  }

  // Set the investment account's current value (its balance) directly.
  async function saveValue() {
    if (!target) return;
    const v = parseFloat(value);
    if (!(v >= 0)) return;
    setSaving(true);
    try {
      const res = await fetch('/api/investments', {
        method: 'POST', body: JSON.stringify({ accountId: target.id, value: v }),
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error();
      toast(t('investments.toastValueUpdated'), 'success');
      close();
      load(true);
    } catch {
      toast(t('investments.toastFailed'), 'error');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <InvestmentsSkeleton />;

  const gainPositive = stats.gain >= 0;
  const gainColor = gainPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400';

  return (
    <StaggerReveal className="p-4 md:p-8 max-w-3xl mx-auto space-y-6 pb-24 md:pb-8">
      <PageHeader
        icon={TrendingUp}
        tone="emerald"
        title={t('investments.title')}
        subtitle={t('investments.subtitle')}
      />

      {investAccounts.length === 0 ? (
        <Card className="py-12 text-center">
          <TrendingUp className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-600 mb-3" />
          <p className="text-base font-bold text-slate-700 dark:text-slate-300 mb-1">{t('investments.noAccountTitle')}</p>
          <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm mx-auto mb-5">{t('investments.noAccountBody')}</p>
          <Link href="/accounts">
            <Button className="mx-auto">
              <Plus className="w-4 h-4" />
              {t('investments.goToAccounts')}
            </Button>
          </Link>
        </Card>
      ) : (
        <>
          {/* Portfolio summary */}
          <div className="grid grid-cols-3 gap-3">
            {/* min-w-0 + break-words keep long labels (incl. Vietnamese) inside
                these narrow 3-col cards instead of spilling past the border. */}
            <Card className="p-4 text-center flex flex-col min-w-0">
              <p className="flex-1 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide break-words mb-2">{t('investments.totalValue')}</p>
              <FitText maxSize={20} minSize={12} className="font-extrabold text-slate-900 dark:text-slate-100">{formatCurrency(stats.value)}</FitText>
            </Card>
            <Card className="p-4 text-center flex flex-col min-w-0">
              <p className="flex-1 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide break-words mb-2">{t('investments.totalInvested')}</p>
              <FitText maxSize={20} minSize={12} className="font-extrabold text-slate-900 dark:text-slate-100">{formatCurrency(stats.invested)}</FitText>
            </Card>
            <Card className="p-4 text-center flex flex-col min-w-0">
              <p className="flex-1 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide break-words mb-2">{t('investments.totalGain')}</p>
              <FitText maxSize={20} minSize={12} className={`font-extrabold ${gainColor}`}>{formatCurrency(stats.gain, true)}</FitText>
              <p className={`text-xs font-semibold mt-0.5 ${gainColor}`}>{fmtPct(stats.gainPct)}</p>
            </Card>
          </div>

          {spendAccounts.length === 0 && (
            <p className="text-xs text-amber-600 dark:text-amber-400 text-center">{t('investments.noSpendAccount')}</p>
          )}

          {/* One card per investment account */}
          {investAccounts.map((acc) => {
            const s = accountInvestment(acc, transactions);
            const up = s.gain >= 0;
            const flow = contributionHistory(acc, transactions).slice(0, 4);
            return (
              <Card key={acc.id} className="p-5 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-base font-extrabold text-slate-900 dark:text-slate-100 truncate">{acc.name}</p>
                    {acc.institution && <p className="text-xs text-slate-400 dark:text-slate-500 truncate">{acc.institution}</p>}
                  </div>
                  <div className="text-right shrink-0">
                    <FitText maxSize={20} minSize={12} className="font-extrabold text-slate-900 dark:text-slate-100">{formatCurrency(s.value)}</FitText>
                    <p className={`text-xs font-semibold flex items-center justify-end gap-0.5 ${up ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                      {up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                      {formatCurrency(s.gain, true)} ({fmtPct(s.gainPct)})
                    </p>
                  </div>
                </div>

                {/* Invested vs current value */}
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-700/40">
                    <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t('investments.invested')}</p>
                    <p className="font-extrabold text-slate-800 dark:text-slate-100 mt-0.5">{formatCurrency(s.invested)}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-700/40">
                    <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t('investments.currentValue')}</p>
                    <p className="font-extrabold text-slate-800 dark:text-slate-100 mt-0.5">{formatCurrency(s.value)}</p>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => openContribute(acc)} disabled={spendAccounts.length === 0} className="flex-1 min-w-[7rem]">
                    <Plus className="w-4 h-4" />
                    {t('investments.addMoney')}
                  </Button>
                  <Button variant="secondary" onClick={() => openValue(acc)} className="flex-1 min-w-[7rem]">
                    <Pencil className="w-4 h-4" />
                    {t('investments.updateValue')}
                  </Button>
                  <Button variant="secondary" onClick={() => openWithdraw(acc)} disabled={spendAccounts.length === 0} className="flex-1 min-w-[7rem]">
                    <ArrowDownLeft className="w-4 h-4" />
                    {t('investments.withdraw')}
                  </Button>
                </div>

                {/* Recent money flow */}
                {flow.length > 0 && (
                  <div className="pt-1">
                    <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">{t('investments.flowTitle')}</p>
                    <div className="space-y-1.5">
                      {flow.map(({ tx, direction }) => (
                        <div key={tx.id} className="flex items-center justify-between text-xs">
                          <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 truncate">
                            {direction === 'in'
                              ? <ArrowUpRight className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                              : <ArrowDownLeft className="w-3.5 h-3.5 text-rose-500 shrink-0" />}
                            <span className="truncate">{tx.date} · {direction === 'in' ? accountName(tx.account) : accountName(tx.toAccount ?? '')}</span>
                          </span>
                          <span className={`font-bold shrink-0 ml-2 whitespace-nowrap ${direction === 'in' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                            {direction === 'in' ? '+' : '−'}{formatCurrency(tx.amount)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </>
      )}

      {/* Contribute / Withdraw modal */}
      <Modal
        open={action === 'contribute' || action === 'withdraw'}
        onClose={close}
        title={action === 'withdraw' ? t('investments.withdrawTitle') : t('investments.contributeTitle')}
      >
        {target && (
          <div className="space-y-4">
            <Select
              label={action === 'withdraw' ? t('investments.toAccount') : t('investments.fromAccount')}
              value={fromAccount}
              options={spendAccounts.map((a) => ({ value: a.id, label: `${a.name} (${formatCurrency(a.balance)})` }))}
              onChange={(e) => setFromAccount(e.target.value)}
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                label={t('investments.amount')}
                type="number" min="0" step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <Input
                label={t('investments.date')}
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <Input
              label={t('investments.note')}
              placeholder={t('investments.notePlaceholder')}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <p className="text-xs text-slate-400 dark:text-slate-500">
              {action === 'withdraw' ? t('investments.withdrawHint') : t('investments.contributeHint')}
            </p>
            <div className="flex gap-2 pt-1">
              <Button onClick={saveTransfer} disabled={saving || !fromAccount || !(parseFloat(amount) > 0)} className="flex-1">
                {saving ? t('common.saving') : t('investments.saveBtn')}
              </Button>
              <Button variant="secondary" onClick={close} className="flex-1">{t('investments.cancelBtn')}</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Update current value modal */}
      <Modal open={action === 'value'} onClose={close} title={t('investments.updateValueTitle')}>
        {target && (
          <div className="space-y-4">
            <Input
              label={t('investments.currentValue')}
              type="number" min="0" step="0.01"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            <p className="text-xs text-slate-400 dark:text-slate-500">{t('investments.valueHint')}</p>
            {value !== '' && parseFloat(value) >= 0 && (() => {
              const invested = accountInvestment(target, transactions).invested;
              const gain = Math.round((parseFloat(value) - invested) * 100) / 100;
              const up = gain >= 0;
              return (
                <div className="flex items-center justify-between gap-4 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-700/40 text-sm">
                  <span className="font-semibold text-slate-600 dark:text-slate-300">{t('investments.totalGain')}</span>
                  <span className={`font-extrabold ${up ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                    {formatCurrency(gain, true)}
                  </span>
                </div>
              );
            })()}
            <div className="flex gap-2 pt-1">
              <Button onClick={saveValue} disabled={saving || !(parseFloat(value) >= 0)} className="flex-1">
                {saving ? t('common.saving') : t('investments.saveBtn')}
              </Button>
              <Button variant="secondary" onClick={close} className="flex-1">{t('investments.cancelBtn')}</Button>
            </div>
          </div>
        )}
      </Modal>
    </StaggerReveal>
  );
}
