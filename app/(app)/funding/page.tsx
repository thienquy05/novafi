'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { HandCoins, Plus, Trash2, Users, Wallet, RefreshCw, AlertCircle, MinusCircle, UserPlus } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { formatCurrency, formatDate, generateId, today } from '@/lib/utils';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { peekCache, ensureResources } from '@/lib/client/store';
import { useToast } from '@/lib/toast';
import { useTranslation } from '@/lib/i18n/context';
import type { Account, Funding, FundingParticipant } from '@/types';
import {
  othersContribution, myContribution, totalContribution, poolRemaining,
  buildContributionTx, buildSpendTxs,
} from '@/lib/funding';

type OtherRow = { key: string; name: string; amount: string };
function emptyOther(): OtherRow { return { key: generateId(), name: '', amount: '' }; }

const num = (s: string) => { const n = parseFloat(s); return Number.isFinite(n) ? n : 0; };

export default function FundingPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const [fundings, setFundings] = useState<Funding[]>(() => peekCache(['funding'])?.funding ?? []);
  const [accounts, setAccounts] = useState<Account[]>(() => peekCache(['accounts'])?.accounts ?? []);
  const [loading, setLoading] = useState(() => peekCache(['funding', 'accounts']) === null);
  const [error, setError] = useState(false);

  // New-pool modal
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [desc, setDesc] = useState('');
  const [accountId, setAccountId] = useState('');
  const [includeMe, setIncludeMe] = useState(true);
  const [myAmount, setMyAmount] = useState('');
  const [others, setOthers] = useState<OtherRow[]>([emptyOther()]);

  // Spend modal
  const [spendFor, setSpendFor] = useState<Funding | null>(null);
  const [spendAmount, setSpendAmount] = useState('');
  const [spendMine, setSpendMine] = useState('');
  const [spendDesc, setSpendDesc] = useState('');

  const load = useCallback(async (force = false) => {
    try {
      const data = await ensureResources(['funding', 'accounts'], { force });
      setFundings(data.funding);
      setAccounts(data.accounts);
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

  // Cash can be held in any deposit account.
  const holdAccounts = useMemo(() => accounts.filter((a) => a.type === 'checking' || a.type === 'savings' || a.type === 'cash'), [accounts]);
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? id;

  function openNew() {
    setDesc(''); setAccountId(holdAccounts[0]?.id ?? ''); setIncludeMe(true); setMyAmount('');
    setOthers([emptyOther()]); setOpen(true);
  }

  const draftParticipants = (): FundingParticipant[] => {
    const list: FundingParticipant[] = [];
    if (includeMe && num(myAmount) > 0) list.push({ name: t('funding.me'), contributed: num(myAmount), isMe: true });
    for (const o of others) {
      if (o.name.trim() && num(o.amount) > 0) list.push({ name: o.name.trim(), contributed: num(o.amount), isMe: false });
    }
    return list;
  };

  async function createPool() {
    const participants = draftParticipants();
    if (!desc.trim() || !accountId || participants.length === 0) return;
    setSaving(true);
    const date = today();
    const othersTotal = othersContribution(participants);
    const contributionTx = buildContributionTx(accountId, othersTotal, t('funding.contributionDesc', { desc: desc.trim() }), date);
    const funding: Funding = {
      id: generateId(),
      description: desc.trim(),
      account: accountId,
      date,
      participants,
      totalContributed: totalContribution(participants),
      spent: 0,
      contributionTxId: contributionTx?.id ?? '',
      spendTxIds: [],
      closed: false,
    };
    // Optimistic
    setFundings((prev) => [funding, ...prev]);
    if (contributionTx) setAccounts((prev) => prev.map((a) => a.id === accountId ? { ...a, balance: Math.round((a.balance + othersTotal) * 100) / 100 } : a));
    setOpen(false);
    try {
      const res = await fetch('/api/funding', {
        method: 'POST',
        body: JSON.stringify({ funding, addTxs: contributionTx ? [contributionTx] : [] }),
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (data.accounts) setAccounts(data.accounts);
      toast(t('funding.poolCreated'), 'success');
    } catch {
      toast(t('funding.saveFailed'), 'error');
      await load(true);
    } finally {
      setSaving(false);
    }
  }

  function openSpend(f: Funding) {
    setSpendFor(f); setSpendAmount(''); setSpendMine(''); setSpendDesc('');
  }

  async function recordSpend() {
    if (!spendFor) return;
    const amount = num(spendAmount);
    const mine = Math.min(num(spendMine), amount);
    if (!(amount > 0)) return;
    // Can't disburse more than the pool is holding.
    if (amount > poolRemaining(spendFor) + 0.005) {
      toast(t('funding.spendOverRemaining', { remaining: formatCurrency(poolRemaining(spendFor)) }), 'error');
      return;
    }
    setSaving(true);
    const date = today();
    const txs = buildSpendTxs(spendFor.account, amount, mine, spendDesc.trim() || t('funding.spendDefault', { desc: spendFor.description }), date);
    const updated: Funding = {
      ...spendFor,
      spent: Math.round((spendFor.spent + amount) * 100) / 100,
      spendTxIds: [...spendFor.spendTxIds, ...txs.map((tx) => tx.id)],
    };
    setFundings((prev) => prev.map((f) => f.id === updated.id ? updated : f));
    setAccounts((prev) => prev.map((a) => a.id === spendFor.account ? { ...a, balance: Math.round((a.balance - amount) * 100) / 100 } : a));
    setSpendFor(null);
    try {
      const res = await fetch('/api/funding', {
        method: 'POST',
        body: JSON.stringify({ funding: updated, addTxs: txs }),
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (data.accounts) setAccounts(data.accounts);
      toast(t('funding.spendRecorded'), 'success');
    } catch {
      toast(t('funding.saveFailed'), 'error');
      await load(true);
    } finally {
      setSaving(false);
    }
  }

  async function deletePool(f: Funding) {
    if (!confirm(t('funding.confirmDelete'))) return;
    setFundings((prev) => prev.filter((x) => x.id !== f.id));
    try {
      const res = await fetch('/api/funding', { method: 'DELETE', body: JSON.stringify({ id: f.id }), headers: { 'Content-Type': 'application/json' } });
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (data.accounts) setAccounts(data.accounts);
      toast(t('funding.poolDeleted'), 'success');
    } catch {
      toast(t('funding.saveFailed'), 'error');
      await load(true);
    }
  }

  const draftTotal = totalContribution(draftParticipants());

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-6 sm:space-y-7 pb-24 md:pb-8">
      {(pullY > 0 || refreshing) && (
        <div className="fixed top-0 left-0 right-0 z-50 flex justify-center pt-safe">
          <div className="flex items-center gap-2 bg-indigo-600 text-white text-xs font-bold px-4 py-2 rounded-full shadow-lg mt-2">
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} style={!refreshing ? { transform: `rotate(${pullY * 180}deg)` } : undefined} />
            {refreshing ? t('common.refreshing') : pullY >= 1 ? t('common.releaseToRefresh') : t('common.pullToRefresh')}
          </div>
        </div>
      )}

      <PageHeader
        icon={HandCoins}
        tone="emerald"
        title={t('funding.title')}
        subtitle={t('funding.subtitle')}
        action={
          holdAccounts.length > 0 ? (
            <Button onClick={openNew} className="flex-1 md:flex-none shadow-sm">
              <Plus className="w-5 h-5" />{t('funding.newPool')}
            </Button>
          ) : undefined
        }
      />

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-indigo-500 border-t-transparent" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-14 h-14 rounded-full bg-rose-50 dark:bg-rose-900/30 flex items-center justify-center mb-4">
            <AlertCircle className="w-7 h-7 text-rose-400" />
          </div>
          <p className="text-slate-700 dark:text-slate-300 font-bold text-base mb-1">{t('funding.loadError')}</p>
          <Button variant="secondary" onClick={() => load(true)} className="mt-4">{t('common.tryAgain')}</Button>
        </div>
      ) : holdAccounts.length === 0 ? (
        <Card className="text-center py-16 bg-slate-50 dark:bg-slate-700/50 border-slate-100 dark:border-slate-700/60">
          <div className="w-16 h-16 rounded-full bg-white dark:bg-slate-800 flex items-center justify-center mx-auto mb-4 shadow-sm border border-slate-100 dark:border-slate-700/60">
            <Wallet className="w-8 h-8 text-slate-400 dark:text-slate-500" />
          </div>
          <p className="text-slate-900 dark:text-slate-100 font-bold text-lg mb-1">{t('funding.noAccountsTitle')}</p>
          <p className="text-slate-500 dark:text-slate-400 font-medium max-w-sm mx-auto">{t('funding.noAccountsDesc')}</p>
        </Card>
      ) : fundings.length === 0 ? (
        <Card className="text-center py-16 bg-slate-50 dark:bg-slate-700/50 border-slate-100 dark:border-slate-700/60">
          <div className="w-16 h-16 rounded-full bg-white dark:bg-slate-800 flex items-center justify-center mx-auto mb-4 shadow-sm border border-slate-100 dark:border-slate-700/60">
            <HandCoins className="w-8 h-8 text-slate-400 dark:text-slate-500" />
          </div>
          <p className="text-slate-900 dark:text-slate-100 font-bold text-lg mb-1">{t('funding.emptyTitle')}</p>
          <p className="text-slate-500 dark:text-slate-400 font-medium mb-6 max-w-sm mx-auto">{t('funding.emptyDesc')}</p>
          <Button onClick={openNew} className="shadow-sm"><Plus className="w-5 h-5" />{t('funding.newPool')}</Button>
        </Card>
      ) : (
        <div className="space-y-4">
          {fundings.map((f) => {
            const remaining = poolRemaining(f);
            const myShare = myContribution(f.participants);
            return (
              <Card key={f.id} className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold text-slate-900 dark:text-slate-100 truncate">{f.description}</p>
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5">
                      {accountName(f.account)} · {formatDate(f.date)}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {!f.closed && remaining > 0 && (
                      <Button variant="secondary" size="sm" onClick={() => openSpend(f)}>
                        <MinusCircle className="w-4 h-4" />{t('funding.spend')}
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" className="text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/30 h-9 w-9 rounded-xl" onClick={() => deletePool(f)}><Trash2 className="w-4 h-4" /></Button>
                  </div>
                </div>

                {/* Pool figures */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-2xl bg-slate-50 dark:bg-slate-700/40 border border-slate-100 dark:border-slate-700/60 p-3">
                    <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t('funding.pool')}</p>
                    <p className="text-base font-extrabold text-slate-900 dark:text-slate-100 mt-0.5">{formatCurrency(f.totalContributed)}</p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 dark:bg-slate-700/40 border border-slate-100 dark:border-slate-700/60 p-3">
                    <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t('funding.spent')}</p>
                    <p className="text-base font-extrabold text-rose-600 dark:text-rose-400 mt-0.5">{formatCurrency(f.spent)}</p>
                  </div>
                  <div className="rounded-2xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800/40 p-3">
                    <p className="text-[11px] font-bold text-emerald-700/80 dark:text-emerald-400/80 uppercase tracking-wider">{t('funding.remaining')}</p>
                    <p className="text-base font-extrabold text-emerald-600 dark:text-emerald-400 mt-0.5">{formatCurrency(remaining)}</p>
                  </div>
                </div>

                {/* Participants */}
                <div>
                  <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5" />{t('funding.contributors', { n: f.participants.length })}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {f.participants.map((p, i) => (
                      <span key={i} className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-lg ${p.isMe ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}>
                        {p.name}<span className="opacity-70">{formatCurrency(p.contributed)}</span>
                      </span>
                    ))}
                  </div>
                  {myShare > 0 && (
                    <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500 mt-2">{t('funding.yourStake', { amount: formatCurrency(myShare) })}</p>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* ── New pool modal ──────────────────────────────────────────────── */}
      <Modal open={open} onClose={() => setOpen(false)} title={t('funding.newPool')}>
        <div className="space-y-5 pb-4">
          <Input label={t('funding.description')} placeholder={t('funding.descPlaceholder')} value={desc} onChange={(e) => setDesc(e.target.value)} />
          <Select
            label={t('funding.holdIn')}
            value={accountId}
            options={holdAccounts.map((a) => ({ value: a.id, label: a.name }))}
            onChange={(e) => setAccountId(e.target.value)}
          />

          {/* My contribution */}
          <div className="rounded-2xl bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800/40 p-4 space-y-3">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input type="checkbox" checked={includeMe} onChange={(e) => setIncludeMe(e.target.checked)} className="w-4 h-4 rounded accent-indigo-600" />
              <span className="text-sm font-bold text-slate-800 dark:text-slate-200">{t('funding.includeMe')}</span>
            </label>
            {includeMe && (
              <Input label={t('funding.myContribution')} type="text" inputMode="decimal" placeholder="0.00" value={myAmount} onChange={(e) => setMyAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
            )}
          </div>

          {/* Other people */}
          <div className="space-y-3">
            <p className="text-sm font-bold text-slate-700 dark:text-slate-300">{t('funding.otherPeople')}</p>
            {others.map((o, i) => (
              <div key={o.key} className="flex items-center gap-2.5">
                <Input className="h-14 flex-1 text-lg placeholder:text-lg placeholder:font-medium" placeholder={t('funding.personName')} value={o.name} onChange={(e) => setOthers((prev) => prev.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                <Input className="h-14 w-24 text-lg" type="text" inputMode="decimal" placeholder="0.00" value={o.amount} onChange={(e) => setOthers((prev) => prev.map((x, j) => j === i ? { ...x, amount: e.target.value.replace(/[^0-9.]/g, '') } : x))} />
                <button onClick={() => setOthers((prev) => prev.length > 1 ? prev.filter((_, j) => j !== i) : prev)} className="text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 shrink-0 p-2 rounded-xl transition-colors" aria-label="Remove"><Trash2 className="w-5 h-5" /></button>
              </div>
            ))}
            <button onClick={() => setOthers((prev) => [...prev, emptyOther()])} className="text-sm font-bold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 inline-flex items-center gap-2 mt-1 px-3 py-2 rounded-xl transition-colors">
              <UserPlus className="w-5 h-5" />{t('funding.addPerson')}
            </button>
          </div>

          {draftTotal > 0 && (
            <p className="text-sm font-bold text-slate-600 dark:text-slate-300 text-center">{t('funding.poolTotal', { amount: formatCurrency(draftTotal) })}</p>
          )}
        </div>
        <div className="sticky bottom-0 bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700/60 -mx-6 sm:-mx-8 px-6 sm:px-8 py-4">
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button className="flex-1 shadow-sm" onClick={createPool} disabled={saving || !desc.trim() || !accountId || draftTotal <= 0}>{saving ? t('common.saving') : t('funding.createPool')}</Button>
          </div>
        </div>
      </Modal>

      {/* ── Spend modal ─────────────────────────────────────────────────── */}
      <Modal open={spendFor !== null} onClose={() => setSpendFor(null)} title={t('funding.spendFromPool')}>
        {spendFor && (
          <>
            <div className="space-y-5 pb-4">
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{t('funding.spendingFrom', { desc: spendFor.description, remaining: formatCurrency(poolRemaining(spendFor)) })}</p>
              <div>
                <Input label={t('funding.amount')} type="text" inputMode="decimal" placeholder="0.00" value={spendAmount} onChange={(e) => setSpendAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
                {num(spendAmount) > poolRemaining(spendFor) + 0.005 && (
                  <p className="text-xs font-bold text-rose-500 dark:text-rose-400 mt-1.5">{t('funding.spendOverRemaining', { remaining: formatCurrency(poolRemaining(spendFor)) })}</p>
                )}
              </div>
              <div>
                <Input label={t('funding.myShare')} type="text" inputMode="decimal" placeholder="0.00" value={spendMine} onChange={(e) => setSpendMine(e.target.value.replace(/[^0-9.]/g, ''))} />
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1.5">{t('funding.myShareHint')}</p>
              </div>
              <Input label={t('funding.noteOptional')} placeholder={t('funding.notePlaceholder')} value={spendDesc} onChange={(e) => setSpendDesc(e.target.value)} />
            </div>
            <div className="sticky bottom-0 bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700/60 -mx-6 sm:-mx-8 px-6 sm:px-8 py-4">
              <div className="flex gap-3">
                <Button variant="secondary" className="flex-1" onClick={() => setSpendFor(null)}>{t('common.cancel')}</Button>
                <Button className="flex-1 shadow-sm" onClick={recordSpend} disabled={saving || num(spendAmount) <= 0 || num(spendAmount) > poolRemaining(spendFor) + 0.005}>{saving ? t('common.saving') : t('funding.recordSpend')}</Button>
              </div>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
