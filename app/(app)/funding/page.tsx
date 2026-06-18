'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { CircleDollarSign, Plus, Trash2, Users, Wallet, RefreshCw, AlertCircle, MinusCircle, UserPlus, Pencil, HandCoins, Archive, ArchiveRestore, ChevronDown, PiggyBank, Target } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { Collapsible } from '@/components/ui/Collapsible';
import { formatCurrency, formatDate, generateId, today } from '@/lib/utils';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { peekCache, ensureResources } from '@/lib/client/store';
import { useToast } from '@/lib/toast';
import { useTranslation } from '@/lib/i18n/context';
import type { Account, Funding, FundingContribution, FundingParticipant, FundingRepayment, Transaction } from '@/types';
import {
  myContribution, totalContribution, poolRemaining,
  buildSpendTxs, buildRepayTx, groupFundingSpends, participantOwed, participantRepaid, totalOwed,
  totalRepaid, isFullySettled,
  isRealPool, buildPoolContributionTx, participantsFromContributions, contributionsTotal, poolProgress,
  repointRealPoolAccount, planVirtualPoolEdit,
  type FundingSpend,
} from '@/lib/funding';
import { applyTransactionToBalances } from '@/lib/calculations';

type OtherRow = { key: string; name: string; amount: string };
function emptyOther(): OtherRow { return { key: generateId(), name: '', amount: '' }; }

const num = (s: string) => { const n = parseFloat(s); return Number.isFinite(n) ? n : 0; };
const round2 = (n: number) => Math.round(n * 100) / 100;

export default function FundingPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const [fundings, setFundings] = useState<Funding[]>(() => peekCache(['funding'])?.funding ?? []);
  const [accounts, setAccounts] = useState<Account[]>(() => peekCache(['accounts'])?.accounts ?? []);
  const [transactions, setTransactions] = useState<Transaction[]>(() => peekCache(['transactions'])?.transactions ?? []);
  const [loading, setLoading] = useState(() => peekCache(['funding', 'accounts', 'transactions']) === null);
  const [error, setError] = useState(false);

  // New-pool modal
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [kind, setKind] = useState<'virtual' | 'real'>('virtual');
  const [desc, setDesc] = useState('');
  const [accountId, setAccountId] = useState('');
  const [includeMe, setIncludeMe] = useState(true);
  const [myAmount, setMyAmount] = useState('');
  const [others, setOthers] = useState<OtherRow[]>([emptyOther()]);
  const [target, setTarget] = useState(''); // real pool: optional savings-goal target

  // Contribution modal (real pools — add / edit a cash-in). Mirrors the payback modal.
  const [contribFor, setContribFor] = useState<Funding | null>(null);
  const [editingContrib, setEditingContrib] = useState<FundingContribution | null>(null);
  const [contribWho, setContribWho] = useState('');
  const [contribAmount, setContribAmount] = useState('');
  const [contribIsMe, setContribIsMe] = useState(false);
  const [contribAccount, setContribAccount] = useState('');

  // Spend modal (also serves editing an existing spend)
  const [spendFor, setSpendFor] = useState<Funding | null>(null);
  const [editingSpend, setEditingSpend] = useState<FundingSpend | null>(null);
  const [spendAmount, setSpendAmount] = useState('');
  const [spendMine, setSpendMine] = useState('');
  const [spendDesc, setSpendDesc] = useState('');
  const [spendAccount, setSpendAccount] = useState('');

  // Which pools' spend / payback history is expanded (collapsed by default to keep
  // the card tidy), plus whether the archived-pools section is open.
  const [openSpends, setOpenSpends] = useState<Set<string>>(new Set());
  const [openPays, setOpenPays] = useState<Set<string>>(new Set());
  const [openContribs, setOpenContribs] = useState<Set<string>>(new Set());
  const [showArchived, setShowArchived] = useState(false);
  const toggle = (set: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) =>
    set((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  // Legacy-pool migration modal (move an old synthetic-account pool onto a real account)
  const [migrateFor, setMigrateFor] = useState<Funding | null>(null);
  const [migrateAccount, setMigrateAccount] = useState('');
  function openMigrate(f: Funding) { setMigrateFor(f); setMigrateAccount(depositAccounts[0]?.id || ''); }

  // Edit-pool modal: adjust description + (virtual) the roster/pledges or (real) the goal.
  const [editFor, setEditFor] = useState<Funding | null>(null);
  const [editDesc, setEditDesc] = useState('');
  const [editTarget, setEditTarget] = useState('');
  const [editIncludeMe, setEditIncludeMe] = useState(true);
  const [editMyAmount, setEditMyAmount] = useState('');
  const [editOthers, setEditOthers] = useState<OtherRow[]>([emptyOther()]);

  // Settle-up / record-payment modal (also serves editing a payment)
  const [payFor, setPayFor] = useState<Funding | null>(null);
  const [editingPay, setEditingPay] = useState<FundingRepayment | null>(null);
  const [payWho, setPayWho] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [payAccount, setPayAccount] = useState('');

  const load = useCallback(async (force = false) => {
    try {
      const data = await ensureResources(['funding', 'accounts', 'transactions'], { force });
      setFundings(data.funding);
      setAccounts(data.accounts);
      setTransactions(data.transactions);
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

  // Accounts you can CHARGE a spend to: spendable deposits plus credit cards.
  const chargeAccounts = useMemo(
    () => accounts.filter((a) => a.type === 'checking' || a.type === 'savings' || a.type === 'cash' || a.type === 'credit'),
    [accounts],
  );
  // Accounts a repayment can land IN: deposit accounts only (a payback is cash to you).
  const depositAccounts = useMemo(
    () => accounts.filter((a) => a.type === 'checking' || a.type === 'savings' || a.type === 'cash'),
    [accounts],
  );
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? id;
  // A legacy real pool still parks its cash in an auto-created `pool`-type account.
  // Such pools get a one-click prompt to move that cash into a real account.
  const legacyHolding = (f: Funding) => isRealPool(f) && accounts.find((a) => a.id === f.poolAccountId)?.type === 'pool';

  // Optimistically fold a set of added/removed rows into the live account balances,
  // using the same ledger math the server applies (correct for cards vs deposits).
  const applyRows = useCallback((addTxs: Transaction[], removeTxIds: string[]) => {
    setAccounts((prev) => {
      let working = prev;
      for (const id of removeTxIds) {
        const old = transactions.find((tx) => tx.id === id);
        if (old) working = applyTransactionToBalances(working, old, 'reverse');
      }
      for (const tx of addTxs) working = applyTransactionToBalances(working, tx, 'apply');
      return working;
    });
  }, [transactions]);

  function openNew() {
    setKind('virtual'); setDesc(''); setAccountId(depositAccounts[0]?.id ?? accounts[0]?.id ?? '');
    setIncludeMe(true); setMyAmount(''); setOthers([emptyOther()]); setTarget(''); setOpen(true);
  }

  const draftParticipants = (): FundingParticipant[] => {
    const list: FundingParticipant[] = [];
    if (includeMe && num(myAmount) > 0) list.push({ name: t('funding.me'), contributed: num(myAmount), isMe: true });
    for (const o of others) {
      if (o.name.trim() && num(o.amount) > 0) list.push({ name: o.name.trim(), contributed: num(o.amount), isMe: false });
    }
    return list;
  };

  async function persist(funding: Funding, addTxs: Transaction[], removeTxIds: string[], successKey: string, addAccount?: Account, removeAccountId?: string) {
    setSaving(true);
    applyRows(addTxs, removeTxIds);
    if (removeAccountId) setAccounts((prev) => prev.filter((a) => a.id !== removeAccountId));
    try {
      const res = await fetch('/api/funding', {
        method: 'POST',
        body: JSON.stringify({ funding, addTxs, removeTxIds, addAccount, removeAccountId }),
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (data.accounts) setAccounts(data.accounts);
      toast(t(successKey), 'success');
    } catch {
      toast(t('funding.saveFailed'), 'error');
    } finally {
      setSaving(false);
      await load(true); // refresh transactions so spend/payment lists stay in lockstep
    }
  }

  async function createPool() {
    const participants = draftParticipants();
    if (!desc.trim() || participants.length === 0) return;
    const date = today();
    if (kind === 'real') { await createRealPool(participants, date); return; }
    // Virtual pool: no cash moves up front — just the agreed budget and who pledged.
    const funding: Funding = {
      id: generateId(),
      description: desc.trim(),
      account: accountId,
      date,
      kind: 'virtual',
      participants,
      totalContributed: totalContribution(participants),
      spent: 0,
      contributionTxId: '',
      spendTxIds: [],
      repayments: [],
      closed: false,
    };
    setFundings((prev) => [funding, ...prev]);
    setOpen(false);
    await persist(funding, [], [], 'funding.poolCreated');
  }

  // Real pool: the cash lives in a real account you chose (`accountId`). Others' cash
  // is moved into it as held-for-the-group money; your own money is already there, so
  // it's just earmarked (no cash row). The account's balance reflects the real flow.
  async function createRealPool(participants: FundingParticipant[], date: string) {
    const note = t('funding.contributionDesc', { desc: desc.trim() });
    const holdingId = accountId; // the chosen real deposit account that holds the pool
    const txs: Transaction[] = [];
    const contributions: FundingContribution[] = [];
    for (const p of participants) {
      const { tx, contribution } = buildPoolContributionTx(
        holdingId, p.contributed, p.name, p.isMe, p.isMe ? holdingId : '', note, date,
      );
      if (tx) txs.push(tx);
      contributions.push(contribution);
    }
    const targetNum = round2(num(target));
    const funding: Funding = {
      id: generateId(),
      description: desc.trim(),
      account: holdingId,
      date,
      kind: 'real',
      participants: participantsFromContributions(contributions),
      totalContributed: contributionsTotal(contributions),
      spent: 0,
      contributionTxId: '',
      spendTxIds: [],
      repayments: [],
      closed: false,
      poolAccountId: holdingId,
      target: targetNum > 0 ? targetNum : undefined,
      contributions,
    };
    setFundings((prev) => [funding, ...prev]);
    setOpen(false);
    await persist(funding, txs, [], 'funding.poolCreated');
  }

  // ── Spend ────────────────────────────────────────────────────────────────────
  function openSpend(f: Funding) {
    setSpendFor(f); setEditingSpend(null);
    setSpendAmount(''); setSpendMine(''); setSpendDesc('');
    // Real pools always draw from their own holding account; virtual pools let you
    // pick which real account fronts the spend.
    setSpendAccount(isRealPool(f) ? (f.poolAccountId ?? '') : (f.account || chargeAccounts[0]?.id || ''));
  }
  function openEditSpend(f: Funding, s: FundingSpend) {
    setSpendFor(f); setEditingSpend(s);
    setSpendAmount(String(s.amount)); setSpendMine(s.myShare ? String(s.myShare) : '');
    setSpendDesc(s.description);
    setSpendAccount(isRealPool(f) ? (f.poolAccountId ?? '') : (s.chargedAccount || f.account || chargeAccounts[0]?.id || ''));
  }

  async function recordSpend() {
    if (!spendFor) return;
    const amount = round2(num(spendAmount));
    const mine = Math.min(round2(num(spendMine)), amount);
    if (!(amount > 0) || !spendAccount) return;
    const date = editingSpend?.date || today();
    const note = spendDesc.trim() || t('funding.spendDefault', { desc: spendFor.description });
    const txs = buildSpendTxs(spendAccount, amount, mine, note, date);
    const removeTxIds = editingSpend?.txIds ?? [];
    const prevAmount = editingSpend?.amount ?? 0;
    const updated: Funding = {
      ...spendFor,
      spent: Math.max(0, round2(spendFor.spent - prevAmount + amount)),
      spendTxIds: [...spendFor.spendTxIds.filter((id) => !removeTxIds.includes(id)), ...txs.map((tx) => tx.id)],
    };
    setFundings((prev) => prev.map((f) => f.id === updated.id ? updated : f));
    setSpendFor(null); setEditingSpend(null);
    await persist(updated, txs, removeTxIds, editingSpend ? 'funding.spendUpdated' : 'funding.spendRecorded');
  }

  async function deleteSpend(f: Funding, s: FundingSpend) {
    if (!confirm(t('funding.confirmDeleteSpend'))) return;
    const updated: Funding = {
      ...f,
      spent: Math.max(0, round2(f.spent - s.amount)),
      spendTxIds: f.spendTxIds.filter((id) => !s.txIds.includes(id)),
    };
    setFundings((prev) => prev.map((x) => x.id === updated.id ? updated : x));
    await persist(updated, [], s.txIds, 'funding.spendDeleted');
  }

  // ── Contributions (real pools) ─────────────────────────────────────────────────
  // Adding/editing real cash put into the pool. Each is a `transfer` into the pool
  // account; the participant roster + totals are re-derived from the contributions.
  function openContrib(f: Funding, participant?: FundingParticipant) {
    setContribFor(f); setEditingContrib(null);
    const isMe = participant?.isMe ?? false;
    setContribIsMe(isMe);
    setContribWho(participant && !participant.isMe ? participant.name : '');
    setContribAmount('');
    // Default my-money source to the holding account itself (no transfer — just earmark
    // money already there); fall back to the first deposit account for legacy pools.
    const holding = f.poolAccountId && depositAccounts.some((a) => a.id === f.poolAccountId) ? f.poolAccountId : '';
    setContribAccount(holding || depositAccounts[0]?.id || '');
  }
  function openEditContrib(f: Funding, c: FundingContribution) {
    setContribFor(f); setEditingContrib(c);
    setContribIsMe(c.isMe);
    setContribWho(c.isMe ? '' : c.participant);
    setContribAmount(String(c.amount));
    setContribAccount(c.account || depositAccounts[0]?.id || '');
  }

  async function recordContribution() {
    if (!contribFor || !contribFor.poolAccountId) return;
    const amount = round2(num(contribAmount));
    const who = contribIsMe ? t('funding.me') : contribWho.trim();
    if (!(amount > 0) || !who || (contribIsMe && !contribAccount)) return;
    const date = editingContrib?.date || today();
    const note = t('funding.contributionDesc', { desc: contribFor.description });
    const { tx, contribution } = buildPoolContributionTx(
      contribFor.poolAccountId, amount, who, contribIsMe, contribIsMe ? contribAccount : '', note, date,
    );
    const removeTxIds = editingContrib ? [editingContrib.id] : [];
    const contributions = [...(contribFor.contributions ?? []).filter((c) => c.id !== editingContrib?.id), contribution];
    const updated: Funding = {
      ...contribFor,
      contributions,
      participants: participantsFromContributions(contributions),
      totalContributed: contributionsTotal(contributions),
    };
    setFundings((prev) => prev.map((f) => f.id === updated.id ? updated : f));
    setContribFor(null); setEditingContrib(null);
    // `tx` is null when it's my own money already in the holding account (nothing moves).
    await persist(updated, tx ? [tx] : [], removeTxIds, editingContrib ? 'funding.contributionUpdated' : 'funding.contributionAdded');
  }

  async function deleteContribution(f: Funding, c: FundingContribution) {
    if (!confirm(t('funding.confirmDeleteContribution'))) return;
    const contributions = (f.contributions ?? []).filter((x) => x.id !== c.id);
    const updated: Funding = {
      ...f,
      contributions,
      participants: participantsFromContributions(contributions),
      totalContributed: contributionsTotal(contributions),
    };
    setFundings((prev) => prev.map((x) => x.id === updated.id ? updated : x));
    await persist(updated, [], [c.id], 'funding.contributionDeleted');
  }

  // ── Settle-up / repayment ──────────────────────────────────────────────────────
  function openPay(f: Funding, participant?: FundingParticipant) {
    setPayFor(f); setEditingPay(null);
    const owedFirst = participant ?? f.participants.find((p) => !p.isMe && participantOwed(p, f.repayments) > 0);
    setPayWho(owedFirst?.name ?? f.participants.find((p) => !p.isMe)?.name ?? '');
    setPayAmount(owedFirst ? String(participantOwed(owedFirst, f.repayments)) : '');
    setPayAccount(f.account && depositAccounts.some((a) => a.id === f.account) ? f.account : depositAccounts[0]?.id || '');
  }
  function openEditPay(f: Funding, r: FundingRepayment) {
    setPayFor(f); setEditingPay(r);
    setPayWho(r.participant); setPayAmount(String(r.amount));
    setPayAccount(r.account || depositAccounts[0]?.id || '');
  }

  async function recordPayment() {
    if (!payFor) return;
    const amount = round2(num(payAmount));
    if (!(amount > 0) || !payWho || !payAccount) return;
    const date = editingPay?.date || today();
    const note = t('funding.paymentDesc', { name: payWho, desc: payFor.description });
    const { tx, repayment } = buildRepayTx(payAccount, amount, payWho, note, date);
    const removeTxIds = editingPay ? [editingPay.id] : [];
    const base: Funding = {
      ...payFor,
      repayments: [...payFor.repayments.filter((r) => r.id !== editingPay?.id), repayment],
    };
    // Auto-archive the moment this payback settles everyone up (only if it wasn't
    // already wrapped up). Manual archive/reopen below can always override.
    const justSettled = !base.closed && isFullySettled(base);
    const updated: Funding = justSettled ? { ...base, closed: true } : base;
    setFundings((prev) => prev.map((f) => f.id === updated.id ? updated : f));
    setPayFor(null); setEditingPay(null);
    const successKey = justSettled ? 'funding.poolSettledArchived' : editingPay ? 'funding.paymentUpdated' : 'funding.paymentRecorded';
    await persist(updated, [tx], removeTxIds, successKey);
  }

  async function deletePayment(f: Funding, r: FundingRepayment) {
    if (!confirm(t('funding.confirmDeletePayment'))) return;
    const updated: Funding = { ...f, repayments: f.repayments.filter((x) => x.id !== r.id) };
    setFundings((prev) => prev.map((x) => x.id === updated.id ? updated : x));
    await persist(updated, [], [r.id], 'funding.paymentDeleted');
  }

  // Migrate a legacy real pool off its auto-created `pool` account onto a real account
  // you choose: re-point every cash row, then drop the now-empty synthetic account.
  async function migrateHolding() {
    if (!migrateFor || !migrateAccount) return;
    const m = repointRealPoolAccount(migrateFor, migrateAccount, transactions);
    if (!m) { setMigrateFor(null); return; }
    setFundings((prev) => prev.map((x) => x.id === m.funding.id ? m.funding : x));
    const oldId = migrateFor.poolAccountId;
    setMigrateFor(null);
    await persist(m.funding, m.addTxs, m.removeTxIds, 'funding.poolMigrated', undefined, oldId);
  }

  // ── Edit pool ──────────────────────────────────────────────────────────────────
  function openEdit(f: Funding) {
    setEditFor(f);
    setEditDesc(f.description);
    setEditTarget(f.target ? String(f.target) : '');
    const me = f.participants.find((p) => p.isMe);
    setEditIncludeMe(!!me);
    setEditMyAmount(me ? String(me.contributed) : '');
    const others = f.participants.filter((p) => !p.isMe).map((p) => ({ key: generateId(), name: p.name, amount: String(p.contributed) }));
    setEditOthers(others.length ? others : [emptyOther()]);
  }

  // Build the edited roster from the modal fields (mirrors draftParticipants).
  const editParticipants = (): FundingParticipant[] => {
    const list: FundingParticipant[] = [];
    if (editIncludeMe && num(editMyAmount) > 0) list.push({ name: t('funding.me'), contributed: num(editMyAmount), isMe: true });
    for (const o of editOthers) {
      if (o.name.trim() && num(o.amount) > 0) list.push({ name: o.name.trim(), contributed: num(o.amount), isMe: false });
    }
    return list;
  };

  async function saveEdit() {
    if (!editFor) return;
    const description = editDesc.trim();
    if (!description) return;
    if (isRealPool(editFor)) {
      // Real pools derive their roster + total from contributions (managed via the
      // contributions list) — here we only adjust the description and savings goal.
      const targetNum = round2(num(editTarget));
      const updated: Funding = { ...editFor, description, target: targetNum > 0 ? targetNum : undefined };
      setFundings((prev) => prev.map((f) => f.id === updated.id ? updated : f));
      setEditFor(null);
      await persist(updated, [], [], 'funding.poolUpdated');
      return;
    }
    // Virtual pool: recompute the roster/total. Any removed participant's paybacks are
    // reversed (their cash leaves your account), keeping every row synchronized.
    const newParticipants = editParticipants();
    if (newParticipants.length === 0) return;
    const newNames = new Set(newParticipants.map((p) => p.name));
    const droppedRepaid = editFor.repayments.filter((r) => !newNames.has(r.participant)).length;
    if (droppedRepaid > 0 && !confirm(t('funding.confirmDropPaid', { n: droppedRepaid }))) return;
    const { funding, addTxs, removeTxIds } = planVirtualPoolEdit(editFor, newParticipants, description, transactions);
    setFundings((prev) => prev.map((f) => f.id === funding.id ? funding : f));
    setEditFor(null);
    await persist(funding, addTxs, removeTxIds, 'funding.poolUpdated');
  }

  // Manual wrap-up: archive a pool (e.g. you're done even if not fully settled) or
  // reopen one. No cash rows move — this only flips the pool's `closed` flag.
  async function setArchived(f: Funding, closed: boolean) {
    const updated: Funding = { ...f, closed };
    setFundings((prev) => prev.map((x) => x.id === f.id ? updated : x));
    await persist(updated, [], [], closed ? 'funding.poolArchived' : 'funding.poolReopened');
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
    } finally {
      await load(true);
    }
  }

  const draftTotal = totalContribution(draftParticipants());
  const hasAccounts = accounts.length > 0;
  const activePools = fundings.filter((f) => !f.closed);
  const archivedPools = fundings.filter((f) => f.closed);

  function renderPool(f: Funding) {
    const real = isRealPool(f);
    const remaining = poolRemaining(f);
    const myShare = myContribution(f.participants);
    const owed = totalOwed(f);
    const spends = groupFundingSpends(f.spendTxIds, transactions);
    const spendsOpen = openSpends.has(f.id);
    const paysOpen = openPays.has(f.id);
    const contribsOpen = openContribs.has(f.id);
    const contributions = f.contributions ?? [];
    const progress = poolProgress(f.totalContributed, f.target);
    return (
      <Card key={f.id} className={`space-y-4 ${f.closed ? 'opacity-75' : ''}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-bold text-slate-900 dark:text-slate-100 truncate flex items-center gap-2">
              {f.description}
              {f.closed && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded-full">
                  <Archive className="w-3 h-3" />{t('funding.archivedBadge')}
                </span>
              )}
            </p>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-1.5">
              {real ? <PiggyBank className="w-3.5 h-3.5 text-emerald-500" /> : null}
              {real ? t('funding.realBadge') : t('funding.virtualBadge')} · {formatDate(f.date)}
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            {!f.closed && (
              <Button variant="secondary" size="sm" onClick={() => openSpend(f)}>
                <MinusCircle className="w-4 h-4" />{t('funding.spend')}
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 h-9 w-9 rounded-xl"
              onClick={() => openEdit(f)}
              aria-label={t('funding.editPool')}
              title={t('funding.editPool')}
            >
              <Pencil className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 h-9 w-9 rounded-xl"
              onClick={() => setArchived(f, !f.closed)}
              aria-label={f.closed ? t('funding.reopen') : t('funding.archive')}
              title={f.closed ? t('funding.reopen') : t('funding.archive')}
            >
              {f.closed ? <ArchiveRestore className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
            </Button>
            <Button variant="ghost" size="icon" className="text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/30 h-9 w-9 rounded-xl" onClick={() => deletePool(f)}><Trash2 className="w-4 h-4" /></Button>
          </div>
        </div>

        {/* Legacy holding-account nudge: move the pool's cash into a real account */}
        {legacyHolding(f) && (
          <div className="rounded-2xl bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800/40 p-3 flex items-start justify-between gap-3">
            <div className="flex items-start gap-2 min-w-0">
              <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-xs font-medium text-amber-800 dark:text-amber-300">{t('funding.migrateDesc')}</p>
            </div>
            <Button variant="secondary" size="sm" className="shrink-0" onClick={() => openMigrate(f)}>{t('funding.migrateButton')}</Button>
          </div>
        )}

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
          <div className={`rounded-2xl p-3 border ${remaining < 0 ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-100 dark:border-amber-800/40' : 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-100 dark:border-emerald-800/40'}`}>
            <p className={`text-[11px] font-bold uppercase tracking-wider ${remaining < 0 ? 'text-amber-700/80 dark:text-amber-400/80' : 'text-emerald-700/80 dark:text-emerald-400/80'}`}>{remaining < 0 ? t('funding.overspent') : real ? t('funding.balance') : t('funding.remaining')}</p>
            <p className={`text-base font-extrabold mt-0.5 ${remaining < 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{formatCurrency(Math.abs(remaining))}</p>
          </div>
        </div>

        {/* Savings-goal progress (real pools with a target) */}
        {real && progress !== null && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <Target className="w-3.5 h-3.5" />{t('funding.goalProgress')}
              </p>
              <p className="text-xs font-bold text-slate-600 dark:text-slate-300">
                {t('funding.goalOf', { current: formatCurrency(f.totalContributed), target: formatCurrency(f.target ?? 0) })} · {Math.round(progress * 100)}%
              </p>
            </div>
            <div className="h-2.5 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${progress >= 1 ? 'bg-emerald-500' : 'bg-indigo-500'}`}
                style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }}
              />
            </div>
          </div>
        )}

        {/* Participants — pledge/contribution, paid back, and what's still owed */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" />{t('funding.contributors', { n: f.participants.length })}
            </p>
            {real ? (
              !f.closed && (
                <Button variant="ghost" size="sm" className="text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 h-8" onClick={() => openContrib(f)}>
                  <Plus className="w-4 h-4" />{t('funding.addContribution')}
                </Button>
              )
            ) : owed > 0 && (
              <Button variant="ghost" size="sm" className="text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 h-8" onClick={() => openPay(f)}>
                <HandCoins className="w-4 h-4" />{t('funding.recordPayment')}
              </Button>
            )}
          </div>
          <div className="space-y-1.5">
            {f.participants.map((p, i) => {
              const owe = participantOwed(p, f.repayments);
              const paid = participantRepaid(f.repayments, p.name);
              return (
                <div key={i} className="flex items-center justify-between gap-2 text-sm">
                  <span className={`inline-flex items-center gap-1.5 font-bold px-2.5 py-1 rounded-lg ${p.isMe ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}>
                    {p.name}<span className="opacity-70">{formatCurrency(p.contributed)}</span>
                  </span>
                  {real ? (
                    !f.closed ? (
                      <button onClick={() => openContrib(f, p)} className="text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:underline">
                        {t('funding.addMore')}
                      </button>
                    ) : (
                      <span className="text-xs font-medium text-slate-400 dark:text-slate-500">{t('funding.paidIn')}</span>
                    )
                  ) : p.isMe ? (
                    <span className="text-xs font-medium text-slate-400 dark:text-slate-500">{t('funding.yourPledge')}</span>
                  ) : owe > 0 ? (
                    <button onClick={() => openPay(f, p)} className="text-xs font-bold text-amber-600 dark:text-amber-400 hover:underline">
                      {t('funding.owesYou', { amount: formatCurrency(owe) })}
                    </button>
                  ) : (
                    <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">{paid > 0 ? t('funding.settledUp') : t('funding.nothingOwed')}</span>
                  )}
                </div>
              );
            })}
          </div>
          {myShare > 0 && (
            <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500 mt-2">{t(real ? 'funding.yourMoneyIn' : 'funding.yourStake', { amount: formatCurrency(myShare) })}</p>
          )}
        </div>

        {/* Spends — collapsed to a summary row; expand to see/edit each one */}
        {spends.length > 0 && (
          <div>
            <button
              onClick={() => toggle(setOpenSpends, f.id)}
              className="w-full flex items-center justify-between gap-2 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
              aria-expanded={spendsOpen}
            >
              <span className="flex items-center gap-1.5">
                {t('funding.spendsTitle')}
                <span className="normal-case tracking-normal text-slate-400 dark:text-slate-500">· {t('funding.itemsTotal', { n: spends.length, amount: formatCurrency(f.spent) })}</span>
              </span>
              <ChevronDown className={`w-4 h-4 transition-transform ${spendsOpen ? 'rotate-180' : ''}`} />
            </button>
            <Collapsible open={spendsOpen}>
              <div className="space-y-1.5">
                {spends.map((s) => (
                  <div key={s.key} className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 dark:bg-slate-700/40 border border-slate-100 dark:border-slate-700/60 px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-700 dark:text-slate-200 truncate">{s.description}</p>
                      <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500">
                        {t('funding.chargedTo', { account: accountName(s.chargedAccount) })}{s.myShare > 0 ? ` · ${t('funding.yourShareOf', { amount: formatCurrency(s.myShare) })}` : ''} · {formatDate(s.date)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-sm font-extrabold text-rose-600 dark:text-rose-400">{formatCurrency(s.amount)}</span>
                      <button onClick={() => openEditSpend(f, s)} className="text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 p-1.5 rounded-lg" aria-label={t('funding.edit')}><Pencil className="w-3.5 h-3.5" /></button>
                      <button onClick={() => deleteSpend(f, s)} className="text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 p-1.5 rounded-lg" aria-label={t('common.delete')}><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                ))}
              </div>
            </Collapsible>
          </div>
        )}

        {/* Contributions (real pools) — collapsed to a summary row; expand to see/edit */}
        {real && contributions.length > 0 && (
          <div>
            <button
              onClick={() => toggle(setOpenContribs, f.id)}
              className="w-full flex items-center justify-between gap-2 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
              aria-expanded={contribsOpen}
            >
              <span className="flex items-center gap-1.5">
                {t('funding.contributionsTitle')}
                <span className="normal-case tracking-normal text-slate-400 dark:text-slate-500">· {t('funding.itemsTotal', { n: contributions.length, amount: formatCurrency(f.totalContributed) })}</span>
              </span>
              <ChevronDown className={`w-4 h-4 transition-transform ${contribsOpen ? 'rotate-180' : ''}`} />
            </button>
            <Collapsible open={contribsOpen}>
              <div className="space-y-1.5">
                {[...contributions].sort((a, b) => b.date.localeCompare(a.date)).map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-2 rounded-xl bg-emerald-50/50 dark:bg-emerald-900/10 border border-emerald-100 dark:border-emerald-800/40 px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-700 dark:text-slate-200 truncate">{c.participant}</p>
                      <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500">
                        {c.isMe ? t('funding.fromAccount', { account: accountName(c.account) }) : t('funding.cashHandedIn')} · {formatDate(c.date)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400">{formatCurrency(c.amount)}</span>
                      <button onClick={() => openEditContrib(f, c)} className="text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 p-1.5 rounded-lg" aria-label={t('funding.edit')}><Pencil className="w-3.5 h-3.5" /></button>
                      <button onClick={() => deleteContribution(f, c)} className="text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 p-1.5 rounded-lg" aria-label={t('common.delete')}><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                ))}
              </div>
            </Collapsible>
          </div>
        )}

        {/* Repayments (virtual pools) — collapsed to a summary row; expand to see/edit each one */}
        {!real && f.repayments.length > 0 && (
          <div>
            <button
              onClick={() => toggle(setOpenPays, f.id)}
              className="w-full flex items-center justify-between gap-2 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
              aria-expanded={paysOpen}
            >
              <span className="flex items-center gap-1.5">
                {t('funding.paymentsTitle')}
                <span className="normal-case tracking-normal text-slate-400 dark:text-slate-500">· {t('funding.itemsTotal', { n: f.repayments.length, amount: formatCurrency(totalRepaid(f.repayments)) })}</span>
              </span>
              <ChevronDown className={`w-4 h-4 transition-transform ${paysOpen ? 'rotate-180' : ''}`} />
            </button>
            <Collapsible open={paysOpen}>
              <div className="space-y-1.5">
                {f.repayments.map((r) => (
                  <div key={r.id} className="flex items-center justify-between gap-2 rounded-xl bg-emerald-50/50 dark:bg-emerald-900/10 border border-emerald-100 dark:border-emerald-800/40 px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-700 dark:text-slate-200 truncate">{r.participant}</p>
                      <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500">{t('funding.paidInto', { account: accountName(r.account) })} · {formatDate(r.date)}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400">{formatCurrency(r.amount)}</span>
                      <button onClick={() => openEditPay(f, r)} className="text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 p-1.5 rounded-lg" aria-label={t('funding.edit')}><Pencil className="w-3.5 h-3.5" /></button>
                      <button onClick={() => deletePayment(f, r)} className="text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 p-1.5 rounded-lg" aria-label={t('common.delete')}><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                ))}
              </div>
            </Collapsible>
          </div>
        )}
      </Card>
    );
  }

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
        icon={CircleDollarSign}
        tone="emerald"
        title={t('funding.title')}
        subtitle={t('funding.subtitle')}
        action={
          hasAccounts ? (
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
      ) : !hasAccounts ? (
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
            <CircleDollarSign className="w-8 h-8 text-slate-400 dark:text-slate-500" />
          </div>
          <p className="text-slate-900 dark:text-slate-100 font-bold text-lg mb-1">{t('funding.emptyTitle')}</p>
          <p className="text-slate-500 dark:text-slate-400 font-medium mb-6 max-w-sm mx-auto">{t('funding.emptyDesc')}</p>
          <Button onClick={openNew} className="shadow-sm"><Plus className="w-5 h-5" />{t('funding.newPool')}</Button>
        </Card>
      ) : (
        <div className="space-y-4">
          {activePools.map((f) => renderPool(f))}

          {/* Archived pools — wrapped-up / fully-settled, tucked behind a toggle */}
          {archivedPools.length > 0 && (
            <div className="pt-2">
              <button
                onClick={() => setShowArchived((v) => !v)}
                className="w-full flex items-center justify-between gap-2 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider px-1 py-2 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                aria-expanded={showArchived}
              >
                <span className="flex items-center gap-1.5">
                  <Archive className="w-3.5 h-3.5" />{t('funding.archivedSection', { n: archivedPools.length })}
                </span>
                <ChevronDown className={`w-4 h-4 transition-transform ${showArchived ? 'rotate-180' : ''}`} />
              </button>
              <Collapsible open={showArchived}>
                <div className="space-y-4 pt-2">
                  {archivedPools.map((f) => renderPool(f))}
                </div>
              </Collapsible>
            </div>
          )}
        </div>
      )}

      {/* ── New pool modal ──────────────────────────────────────────────── */}
      <Modal open={open} onClose={() => setOpen(false)} title={t('funding.newPool')}>
        <div className="space-y-5 pb-4">
          {/* Kind: virtual budget vs. real cash pool */}
          <div className="grid grid-cols-2 gap-2 p-1 rounded-2xl bg-slate-100 dark:bg-slate-700/50">
            {(['virtual', 'real'] as const).map((k) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-colors ${kind === k ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-500 dark:text-slate-400'}`}
              >
                {k === 'real' ? <PiggyBank className="w-4 h-4" /> : <Wallet className="w-4 h-4" />}
                {t(k === 'real' ? 'funding.realPool' : 'funding.virtualPool')}
              </button>
            ))}
          </div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-700/40 rounded-xl px-3 py-2">{t(kind === 'real' ? 'funding.realHint' : 'funding.virtualHint')}</p>
          <Input label={t('funding.description')} placeholder={t('funding.descPlaceholder')} value={desc} onChange={(e) => setDesc(e.target.value)} />
          <Select
            label={t(kind === 'real' ? 'funding.holdIn' : 'funding.defaultAccount')}
            value={accountId}
            options={(kind === 'real' ? depositAccounts : chargeAccounts).map((a) => ({ value: a.id, label: a.name }))}
            onChange={(e) => setAccountId(e.target.value)}
          />
          {kind === 'real' && (
            <Input label={t('funding.targetOptional')} type="text" inputMode="decimal" placeholder="0.00" value={target} onChange={(e) => setTarget(e.target.value.replace(/[^0-9.]/g, ''))} />
          )}

          {/* My pledge / contribution */}
          <div className="rounded-2xl bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800/40 p-4 space-y-3">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input type="checkbox" checked={includeMe} onChange={(e) => setIncludeMe(e.target.checked)} className="w-4 h-4 rounded accent-indigo-600" />
              <span className="text-sm font-bold text-slate-800 dark:text-slate-200">{t(kind === 'real' ? 'funding.includeMeReal' : 'funding.includeMe')}</span>
            </label>
            {includeMe && (
              <Input label={t(kind === 'real' ? 'funding.myContributionReal' : 'funding.myContribution')} type="text" inputMode="decimal" placeholder="0.00" value={myAmount} onChange={(e) => setMyAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
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
            <Button className="flex-1 shadow-sm" onClick={createPool} disabled={saving || !desc.trim() || draftTotal <= 0}>{saving ? t('common.saving') : t('funding.createPool')}</Button>
          </div>
        </div>
      </Modal>

      {/* ── Spend modal (new + edit) ─────────────────────────────────────── */}
      <Modal open={spendFor !== null} onClose={() => { setSpendFor(null); setEditingSpend(null); }} title={editingSpend ? t('funding.editSpend') : t('funding.spendFromPool')}>
        {spendFor && (
          <>
            <div className="space-y-5 pb-4">
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{t('funding.spendingFrom', { desc: spendFor.description, remaining: formatCurrency(poolRemaining(spendFor)) })}</p>
              {isRealPool(spendFor) ? (
                // Real pools draw from their own holding account — not a choice.
                <div className="rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800/40 px-3 py-2.5">
                  <p className="text-[11px] font-bold text-emerald-700/80 dark:text-emerald-400/80 uppercase tracking-wider">{t('funding.chargeFrom')}</p>
                  <p className="text-sm font-bold text-slate-700 dark:text-slate-200 mt-0.5">{accountName(spendFor.poolAccountId ?? '')}</p>
                </div>
              ) : (
                <Select
                  label={t('funding.chargeFrom')}
                  value={spendAccount}
                  options={chargeAccounts.map((a) => ({ value: a.id, label: a.name }))}
                  onChange={(e) => setSpendAccount(e.target.value)}
                />
              )}
              <Input label={t('funding.amount')} type="text" inputMode="decimal" placeholder="0.00" value={spendAmount} onChange={(e) => setSpendAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
              <div>
                <Input label={t('funding.myShare')} type="text" inputMode="decimal" placeholder="0.00" value={spendMine} onChange={(e) => setSpendMine(e.target.value.replace(/[^0-9.]/g, ''))} />
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1.5">{t('funding.myShareHint')}</p>
              </div>
              <Input label={t('funding.noteOptional')} placeholder={t('funding.notePlaceholder')} value={spendDesc} onChange={(e) => setSpendDesc(e.target.value)} />
            </div>
            <div className="sticky bottom-0 bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700/60 -mx-6 sm:-mx-8 px-6 sm:px-8 py-4">
              <div className="flex gap-3">
                <Button variant="secondary" className="flex-1" onClick={() => { setSpendFor(null); setEditingSpend(null); }}>{t('common.cancel')}</Button>
                <Button className="flex-1 shadow-sm" onClick={recordSpend} disabled={saving || num(spendAmount) <= 0 || !spendAccount}>{saving ? t('common.saving') : (editingSpend ? t('common.save') : t('funding.recordSpend'))}</Button>
              </div>
            </div>
          </>
        )}
      </Modal>

      {/* ── Record-payment modal (new + edit) ────────────────────────────── */}
      <Modal open={payFor !== null} onClose={() => { setPayFor(null); setEditingPay(null); }} title={editingPay ? t('funding.editPayment') : t('funding.recordPayment')}>
        {payFor && (
          <>
            <div className="space-y-5 pb-4">
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{t('funding.paymentHint')}</p>
              <Select
                label={t('funding.whoPaid')}
                value={payWho}
                options={payFor.participants.filter((p) => !p.isMe).map((p) => ({ value: p.name, label: p.name }))}
                onChange={(e) => setPayWho(e.target.value)}
              />
              <Input label={t('funding.amount')} type="text" inputMode="decimal" placeholder="0.00" value={payAmount} onChange={(e) => setPayAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
              <Select
                label={t('funding.payInto')}
                value={payAccount}
                options={depositAccounts.map((a) => ({ value: a.id, label: a.name }))}
                onChange={(e) => setPayAccount(e.target.value)}
              />
            </div>
            <div className="sticky bottom-0 bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700/60 -mx-6 sm:-mx-8 px-6 sm:px-8 py-4">
              <div className="flex gap-3">
                <Button variant="secondary" className="flex-1" onClick={() => { setPayFor(null); setEditingPay(null); }}>{t('common.cancel')}</Button>
                <Button className="flex-1 shadow-sm" onClick={recordPayment} disabled={saving || num(payAmount) <= 0 || !payWho || !payAccount}>{saving ? t('common.saving') : (editingPay ? t('common.save') : t('funding.recordPayment'))}</Button>
              </div>
            </div>
          </>
        )}
      </Modal>

      {/* ── Contribution modal (real pools — add + edit) ──────────────────── */}
      <Modal open={contribFor !== null} onClose={() => { setContribFor(null); setEditingContrib(null); }} title={editingContrib ? t('funding.editContribution') : t('funding.addContribution')}>
        {contribFor && (
          <>
            <div className="space-y-5 pb-4">
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{t('funding.contributionHint')}</p>
              <label className="flex items-center gap-2.5 cursor-pointer rounded-xl bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800/40 px-3 py-2.5">
                <input type="checkbox" checked={contribIsMe} onChange={(e) => setContribIsMe(e.target.checked)} className="w-4 h-4 rounded accent-indigo-600" />
                <span className="text-sm font-bold text-slate-800 dark:text-slate-200">{t('funding.contributionIsMe')}</span>
              </label>
              {!contribIsMe && (
                <Input label={t('funding.whoContributed')} placeholder={t('funding.personName')} value={contribWho} onChange={(e) => setContribWho(e.target.value)} />
              )}
              <Input label={t('funding.amount')} type="text" inputMode="decimal" placeholder="0.00" value={contribAmount} onChange={(e) => setContribAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
              {contribIsMe && (
                <Select
                  label={t('funding.fundMyShareFrom')}
                  value={contribAccount}
                  options={depositAccounts.map((a) => ({ value: a.id, label: a.name }))}
                  onChange={(e) => setContribAccount(e.target.value)}
                />
              )}
            </div>
            <div className="sticky bottom-0 bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700/60 -mx-6 sm:-mx-8 px-6 sm:px-8 py-4">
              <div className="flex gap-3">
                <Button variant="secondary" className="flex-1" onClick={() => { setContribFor(null); setEditingContrib(null); }}>{t('common.cancel')}</Button>
                <Button className="flex-1 shadow-sm" onClick={recordContribution} disabled={saving || num(contribAmount) <= 0 || (!contribIsMe && !contribWho.trim()) || (contribIsMe && !contribAccount)}>{saving ? t('common.saving') : (editingContrib ? t('common.save') : t('funding.addContribution'))}</Button>
              </div>
            </div>
          </>
        )}
      </Modal>

      {/* ── Migrate legacy pool to a real account ─────────────────────────── */}
      <Modal open={migrateFor !== null} onClose={() => setMigrateFor(null)} title={t('funding.migrateTitle')}>
        {migrateFor && (
          <>
            <div className="space-y-5 pb-4">
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{t('funding.migrateHint')}</p>
              <Select
                label={t('funding.holdIn')}
                value={migrateAccount}
                options={depositAccounts.map((a) => ({ value: a.id, label: a.name }))}
                onChange={(e) => setMigrateAccount(e.target.value)}
              />
            </div>
            <div className="sticky bottom-0 bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700/60 -mx-6 sm:-mx-8 px-6 sm:px-8 py-4">
              <div className="flex gap-3">
                <Button variant="secondary" className="flex-1" onClick={() => setMigrateFor(null)}>{t('common.cancel')}</Button>
                <Button className="flex-1 shadow-sm" onClick={migrateHolding} disabled={saving || !migrateAccount}>{saving ? t('common.saving') : t('funding.migrateButton')}</Button>
              </div>
            </div>
          </>
        )}
      </Modal>

      {/* ── Edit pool modal ───────────────────────────────────────────────── */}
      <Modal open={editFor !== null} onClose={() => setEditFor(null)} title={t('funding.editPool')}>
        {editFor && (
          <>
            <div className="space-y-5 pb-4">
              <Input label={t('funding.description')} placeholder={t('funding.descPlaceholder')} value={editDesc} onChange={(e) => setEditDesc(e.target.value)} />

              {isRealPool(editFor) ? (
                <>
                  <Input label={t('funding.targetOptional')} type="text" inputMode="decimal" placeholder="0.00" value={editTarget} onChange={(e) => setEditTarget(e.target.value.replace(/[^0-9.]/g, ''))} />
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-700/40 rounded-xl px-3 py-2">{t('funding.editRealHint')}</p>
                </>
              ) : (
                <>
                  {/* My pledge */}
                  <div className="rounded-2xl bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800/40 p-4 space-y-3">
                    <label className="flex items-center gap-2.5 cursor-pointer">
                      <input type="checkbox" checked={editIncludeMe} onChange={(e) => setEditIncludeMe(e.target.checked)} className="w-4 h-4 rounded accent-indigo-600" />
                      <span className="text-sm font-bold text-slate-800 dark:text-slate-200">{t('funding.includeMe')}</span>
                    </label>
                    {editIncludeMe && (
                      <Input label={t('funding.myContribution')} type="text" inputMode="decimal" placeholder="0.00" value={editMyAmount} onChange={(e) => setEditMyAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
                    )}
                  </div>

                  {/* Other people */}
                  <div className="space-y-3">
                    <p className="text-sm font-bold text-slate-700 dark:text-slate-300">{t('funding.otherPeople')}</p>
                    {editOthers.map((o, i) => (
                      <div key={o.key} className="flex items-center gap-2.5">
                        <Input className="h-14 flex-1 text-lg placeholder:text-lg placeholder:font-medium" placeholder={t('funding.personName')} value={o.name} onChange={(e) => setEditOthers((prev) => prev.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                        <Input className="h-14 w-24 text-lg" type="text" inputMode="decimal" placeholder="0.00" value={o.amount} onChange={(e) => setEditOthers((prev) => prev.map((x, j) => j === i ? { ...x, amount: e.target.value.replace(/[^0-9.]/g, '') } : x))} />
                        <button onClick={() => setEditOthers((prev) => prev.length > 1 ? prev.filter((_, j) => j !== i) : [emptyOther()])} className="text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 shrink-0 p-2 rounded-xl transition-colors" aria-label="Remove"><Trash2 className="w-5 h-5" /></button>
                      </div>
                    ))}
                    <button onClick={() => setEditOthers((prev) => [...prev, emptyOther()])} className="text-sm font-bold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 inline-flex items-center gap-2 mt-1 px-3 py-2 rounded-xl transition-colors">
                      <UserPlus className="w-5 h-5" />{t('funding.addPerson')}
                    </button>
                  </div>
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-700/40 rounded-xl px-3 py-2">{t('funding.editVirtualHint')}</p>
                  {totalContribution(editParticipants()) > 0 && (
                    <p className="text-sm font-bold text-slate-600 dark:text-slate-300 text-center">{t('funding.poolTotal', { amount: formatCurrency(totalContribution(editParticipants())) })}</p>
                  )}
                </>
              )}
            </div>
            <div className="sticky bottom-0 bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700/60 -mx-6 sm:-mx-8 px-6 sm:px-8 py-4">
              <div className="flex gap-3">
                <Button variant="secondary" className="flex-1" onClick={() => setEditFor(null)}>{t('common.cancel')}</Button>
                <Button className="flex-1 shadow-sm" onClick={saveEdit} disabled={saving || !editDesc.trim() || (!isRealPool(editFor) && totalContribution(editParticipants()) <= 0)}>{saving ? t('common.saving') : t('common.save')}</Button>
              </div>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
