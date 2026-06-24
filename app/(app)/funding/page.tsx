'use client';
import { useState, useEffect, useCallback } from 'react';
import { CircleDollarSign, Plus, Trash2, Users, Wallet, RefreshCw, AlertCircle, MinusCircle, UserPlus, Pencil, HandCoins, Archive, ArchiveRestore, ChevronDown, Receipt, Landmark, PartyPopper, Target, Share2, Sparkles, Clock, SlidersHorizontal, CalendarDays } from 'lucide-react';
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
import { loadTransactionsByIds } from '@/lib/client/api';
import { useToast } from '@/lib/toast';
import { useTranslation } from '@/lib/i18n/context';
import type { Account, Funding, FundingContribution, FundingParticipant, FundingRepayment, Transaction } from '@/types';
import {
  myContribution, totalContribution, poolRemaining,
  buildSpendTxs, buildRepayTx, groupFundingSpends, participantOwed, participantRepaid, totalOwed,
  totalRepaid, isFullySettled,
  isRealPool, buildPoolContributionTx, participantsFromContributions, contributionsTotal, poolProgress,
  repointRealPoolAccount, planVirtualPoolEdit, buildPoolActivity, referencedTxIds,
  type FundingSpend, type FundingActivity,
} from '@/lib/funding';
import { applyTransactionToBalances } from '@/lib/calculations';

// `id` is the participant's stable identity (preserved across edits so a rename keeps
// their paybacks); `origName` is the name when the edit modal opened (used to re-key
// existing paybacks onto the new name). Both unused by the create flow.
type OtherRow = { key: string; id: string; name: string; amount: string; origName?: string };
function emptyOther(): OtherRow { return { key: generateId(), id: generateId(), name: '', amount: '' }; }

const num = (s: string) => { const n = parseFloat(s); return Number.isFinite(n) ? n : 0; };
const round2 = (n: number) => Math.round(n * 100) / 100;

// Spend categories with emoji labels for the category pill selector.
const POOL_SPEND_CATEGORIES = [
  { value: 'Food', label: '🍕 Food' },
  { value: 'Entertainment', label: '🎉 Fun' },
  { value: 'Shopping', label: '🛍 Shopping' },
  { value: 'Transportation', label: '🚗 Travel' },
  { value: 'Health', label: '💊 Health' },
  { value: 'Other', label: '📦 Other' },
] as const;

export default function FundingPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const [fundings, setFundings] = useState<Funding[]>(() => peekCache(['funding'])?.funding ?? []);
  const [accounts, setAccounts] = useState<Account[]>(() => peekCache(['accounts'])?.accounts ?? []);
  // Only the ledger rows the pools reference (spends + contributions) live here —
  // never the whole Transactions sheet. Filled by `load` via loadTransactionsByIds.
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(() => peekCache(['funding', 'accounts']) === null);
  const [error, setError] = useState(false);

  // New-pool modal
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [kind, setKind] = useState<'virtual' | 'real'>('virtual');
  const [desc, setDesc] = useState('');
  const [accountId, setAccountId] = useState('');
  const [includeMe, setIncludeMe] = useState(true);
  const [myAmount, setMyAmount] = useState('');
  const [myRowId, setMyRowId] = useState(() => generateId()); // stable id for the "me" pledge
  const [others, setOthers] = useState<OtherRow[]>([emptyOther()]);
  const [target, setTarget] = useState(''); // real pool: optional savings-goal target

  // Contribution modal (real pools — add / edit a cash-in). Mirrors the payback modal.
  const [contribFor, setContribFor] = useState<Funding | null>(null);
  const [editingContrib, setEditingContrib] = useState<FundingContribution | null>(null);
  const [contribWho, setContribWho] = useState('');
  const [contribAmount, setContribAmount] = useState('');
  const [contribIsMe, setContribIsMe] = useState(false);
  const [contribAccount, setContribAccount] = useState('');
  const [contribDate, setContribDate] = useState(today());

  // Spend modal (also serves editing an existing spend)
  const [spendFor, setSpendFor] = useState<Funding | null>(null);
  const [editingSpend, setEditingSpend] = useState<FundingSpend | null>(null);
  const [spendAmount, setSpendAmount] = useState('');
  const [spendMine, setSpendMine] = useState('');
  const [spendDesc, setSpendDesc] = useState('');
  const [spendAccount, setSpendAccount] = useState('');
  const [spendDate, setSpendDate] = useState(today());
  const [spendCategory, setSpendCategory] = useState('Other');

  const [payDate, setPayDate] = useState(today());

  // Which pools' spend / payback / activity history is expanded (collapsed by default
  // to keep the card tidy), plus whether the archived-pools section is open.
  const [openSpends, setOpenSpends] = useState<Set<string>>(new Set());
  const [openPays, setOpenPays] = useState<Set<string>>(new Set());
  const [openContribs, setOpenContribs] = useState<Set<string>>(new Set());
  const [openActivity, setOpenActivity] = useState<Set<string>>(new Set());
  const [showArchived, setShowArchived] = useState(false);

  // Sort & filter for the active pool list
  const [filterType, setFilterType] = useState<'all' | 'virtual' | 'real' | 'action'>('all');
  const [sortBy, setSortBy] = useState<'recent' | 'owed' | 'az'>('recent');

  // Settle-up confirmation: holds the pending payment state so the user can choose
  // whether to archive the pool before we commit it to the server.
  const [settledFor, setSettledFor] = useState<{ pool: Funding; tx: Transaction; removeTxIds: string[]; wasEditing: boolean } | null>(null);
  // Delete confirmation modal: holds the pool to delete until user confirms.
  const [deleteFor, setDeleteFor] = useState<Funding | null>(null);

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
  const [editMyId, setEditMyId] = useState('');
  const [editOthers, setEditOthers] = useState<OtherRow[]>([emptyOther()]);

  // Settle-up / record-payment modal (also serves editing a payment)
  const [payFor, setPayFor] = useState<Funding | null>(null);
  const [editingPay, setEditingPay] = useState<FundingRepayment | null>(null);
  const [payWho, setPayWho] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [payAccount, setPayAccount] = useState('');

  const load = useCallback(async (force = false) => {
    try {
      const data = await ensureResources(['funding', 'accounts'], { force });
      setFundings(data.funding);
      setAccounts(data.accounts);
      // Resolve only the ledger rows these pools reference (spends + the legacy
      // contribution row + real-pool cash-ins) instead of pulling the entire
      // Transactions sheet — keeps the page light no matter how many settled
      // payments have piled up in the ledger over time.
      setTransactions(await loadTransactionsByIds(referencedTxIds(data.funding)));
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
  // (Plain derived consts — the React Compiler memoizes them; a manual useMemo here
  // couldn't be preserved once these feed the migrate/contribution handlers below.)
  const chargeAccounts = accounts.filter((a) => a.type === 'checking' || a.type === 'savings' || a.type === 'cash' || a.type === 'credit');
  // Accounts a repayment can land IN: deposit accounts only (a payback is cash to you).
  const depositAccounts = accounts.filter((a) => a.type === 'checking' || a.type === 'savings' || a.type === 'cash');
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
    setIncludeMe(true); setMyAmount(''); setMyRowId(generateId()); setOthers([emptyOther()]); setTarget(''); setOpen(true);
  }

  const draftParticipants = (): FundingParticipant[] => {
    const list: FundingParticipant[] = [];
    if (includeMe && num(myAmount) > 0) list.push({ id: myRowId, name: t('funding.me'), contributed: num(myAmount), isMe: true });
    for (const o of others) {
      if (o.name.trim() && num(o.amount) > 0) list.push({ id: o.id, name: o.name.trim(), contributed: num(o.amount), isMe: false });
    }
    return list;
  };

  const draftRealParticipants = (): FundingParticipant[] => {
    const list: FundingParticipant[] = [];
    if (includeMe) list.push({ id: myRowId, name: t('funding.me'), contributed: 0, isMe: true });
    for (const o of others) {
      if (o.name.trim()) list.push({ id: o.id, name: o.name.trim(), contributed: 0, isMe: false });
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
    const date = today();
    if (kind === 'real') {
      const participants = draftRealParticipants();
      if (!desc.trim() || participants.length === 0) return;
      await createRealPool(participants, date);
      return;
    }
    const participants = draftParticipants();
    if (!desc.trim() || participants.length === 0) return;
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
    setSpendDate(today()); setSpendCategory('Other');
    setSpendAccount(isRealPool(f) ? (f.poolAccountId ?? '') : (f.account || chargeAccounts[0]?.id || ''));
  }
  function openEditSpend(f: Funding, s: FundingSpend) {
    setSpendFor(f); setEditingSpend(s);
    setSpendAmount(String(s.amount)); setSpendMine(s.myShare ? String(s.myShare) : '');
    setSpendDesc(s.description);
    setSpendDate(s.date); setSpendCategory(s.category ?? 'Other');
    setSpendAccount(isRealPool(f) ? (f.poolAccountId ?? '') : (s.chargedAccount || f.account || chargeAccounts[0]?.id || ''));
  }

  async function recordSpend() {
    if (!spendFor) return;
    const amount = round2(num(spendAmount));
    const mine = Math.min(round2(num(spendMine)), amount);
    if (!(amount > 0) || !spendAccount) return;
    const date = spendDate || today();
    const note = spendDesc.trim() || t('funding.spendDefault', { desc: spendFor.description });
    const txs = buildSpendTxs(spendAccount, amount, mine, note, date, spendCategory);
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
    setContribDate(today());
    const holding = f.poolAccountId && depositAccounts.some((a) => a.id === f.poolAccountId) ? f.poolAccountId : '';
    setContribAccount(holding || depositAccounts[0]?.id || '');
  }
  function openEditContrib(f: Funding, c: FundingContribution) {
    setContribFor(f); setEditingContrib(c);
    setContribIsMe(c.isMe);
    setContribWho(c.isMe ? '' : c.participant);
    setContribAmount(String(c.amount));
    setContribDate(c.date);
    setContribAccount(c.account || depositAccounts[0]?.id || '');
  }

  async function recordContribution() {
    if (!contribFor || !contribFor.poolAccountId) return;
    const amount = round2(num(contribAmount));
    const who = contribIsMe ? t('funding.me') : contribWho.trim();
    if (!(amount > 0) || !who || (contribIsMe && !contribAccount)) return;
    const date = contribDate || today();
    const note = t('funding.contributionDesc', { desc: contribFor.description });
    const { tx, contribution } = buildPoolContributionTx(
      contribFor.poolAccountId, amount, who, contribIsMe, contribIsMe ? contribAccount : '', note, date,
    );
    const removeTxIds = editingContrib ? [editingContrib.id] : [];
    const contributions = [...(contribFor.contributions ?? []).filter((c) => c.id !== editingContrib?.id), contribution];
    const prevTotal = contribFor.totalContributed;
    const updated: Funding = {
      ...contribFor,
      contributions,
      participants: participantsFromContributions(contributions),
      totalContributed: contributionsTotal(contributions),
    };
    setFundings((prev) => prev.map((f) => f.id === updated.id ? updated : f));
    setContribFor(null); setEditingContrib(null);
    // Milestone toasts when a Group Vault crosses 25/50/75/100% of its savings target.
    if (contribFor.target) {
      const prevProg = poolProgress(prevTotal, contribFor.target) ?? 0;
      const newProg = poolProgress(updated.totalContributed, contribFor.target) ?? 0;
      for (const [m, key] of [[0.25, 'funding.milestone25'], [0.5, 'funding.milestone50'], [0.75, 'funding.milestone75'], [1.0, 'funding.milestone100']] as [number, string][]) {
        if (prevProg < m && newProg >= m) setTimeout(() => toast(t(key), 'success'), 500);
      }
    }
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
    setPayDate(today());
    setPayAccount(f.account && depositAccounts.some((a) => a.id === f.account) ? f.account : depositAccounts[0]?.id || '');
  }
  function openEditPay(f: Funding, r: FundingRepayment) {
    setPayFor(f); setEditingPay(r);
    setPayWho(r.participant); setPayAmount(String(r.amount));
    setPayDate(r.date);
    setPayAccount(r.account || depositAccounts[0]?.id || '');
  }

  async function recordPayment() {
    if (!payFor) return;
    const amount = round2(num(payAmount));
    if (!(amount > 0) || !payWho || !payAccount) return;
    const date = payDate || today();
    const note = t('funding.paymentDesc', { name: payWho, desc: payFor.description });
    const { tx, repayment } = buildRepayTx(payAccount, amount, payWho, note, date);
    const payer = payFor.participants.find((p) => p.name === payWho);
    const removeTxIds = editingPay ? [editingPay.id] : [];
    const wasEditing = !!editingPay;
    const base: Funding = {
      ...payFor,
      repayments: [...payFor.repayments.filter((r) => r.id !== editingPay?.id), { ...repayment, participantId: payer?.id ?? editingPay?.participantId }],
    };
    setFundings((prev) => prev.map((f) => f.id === base.id ? base : f));
    setPayFor(null); setEditingPay(null);
    // When the final payback settles everyone, ask the user whether to archive instead
    // of silently archiving — they may want to keep the pool active for reference.
    if (!base.closed && isFullySettled(base)) {
      setSettledFor({ pool: base, tx, removeTxIds, wasEditing });
    } else {
      await persist(base, [tx], removeTxIds, wasEditing ? 'funding.paymentUpdated' : 'funding.paymentRecorded');
    }
  }

  async function confirmSettleArchive(archive: boolean) {
    if (!settledFor) return;
    const { pool, tx, removeTxIds, wasEditing } = settledFor;
    const updated = archive ? { ...pool, closed: true } : pool;
    if (archive) setFundings((prev) => prev.map((f) => f.id === updated.id ? updated : f));
    setSettledFor(null);
    const successKey = archive ? 'funding.poolSettledArchived' : wasEditing ? 'funding.paymentUpdated' : 'funding.paymentRecorded';
    await persist(updated, [tx], removeTxIds, successKey);
  }

  async function deletePayment(f: Funding, r: FundingRepayment) {
    if (!confirm(t('funding.confirmDeletePayment'))) return;
    const updated: Funding = { ...f, repayments: f.repayments.filter((x) => x.id !== r.id) };
    setFundings((prev) => prev.map((x) => x.id === updated.id ? updated : x));
    await persist(updated, [], [r.id], 'funding.paymentDeleted');
  }

  async function copyPoolSummary(f: Funding) {
    const real = isRealPool(f);
    const remaining = poolRemaining(f);
    const lines: string[] = [
      `${real ? '🏦' : '📋'} ${f.description} · ${real ? 'Group Vault' : 'Group Tab'}`,
      `📅 ${formatDate(f.date)}`,
      '',
      `💰 Pool: ${formatCurrency(f.totalContributed)} | Spent: ${formatCurrency(f.spent)} | ${remaining >= 0 ? 'Remaining' : 'Overspent'}: ${formatCurrency(Math.abs(remaining))}`,
    ];
    if (f.target) {
      const pct = Math.round((poolProgress(f.totalContributed, f.target) ?? 0) * 100);
      lines.push(`🎯 Goal: ${formatCurrency(f.totalContributed)} of ${formatCurrency(f.target)} (${pct}%)`);
    }
    lines.push('', '👥 Members:');
    for (const p of f.participants) {
      if (real) {
        lines.push(`  • ${p.name}: ${formatCurrency(p.contributed)} contributed`);
      } else {
        const owe = participantOwed(p, f.repayments);
        const status = p.isMe ? 'your pledge' : owe > 0 ? `owes ${formatCurrency(owe)}` : 'settled ✓';
        lines.push(`  • ${p.name}: ${formatCurrency(p.contributed)} — ${status}`);
      }
    }
    if (!real) {
      const owed = totalOwed(f);
      if (owed > 0) lines.push('', `Total owed to you: ${formatCurrency(owed)}`);
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      toast(t('funding.summaryCopied'), 'success');
    } catch {
      toast(t('funding.summaryFailed'), 'error');
    }
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
    setEditMyId(me?.id ?? generateId()); // backfill a stable id for legacy "me"
    // Each row carries the participant's stable id + the name it had on open, so a
    // rename keeps its identity (legacy rows without an id get one assigned now).
    const others = f.participants.filter((p) => !p.isMe).map((p) => ({ key: generateId(), id: p.id ?? generateId(), origName: p.name, name: p.name, amount: String(p.contributed) }));
    setEditOthers(others.length ? others : [emptyOther()]);
  }

  // Build the edited roster from the modal fields, preserving each row's stable id.
  const editParticipants = (): FundingParticipant[] => {
    const list: FundingParticipant[] = [];
    if (editIncludeMe && num(editMyAmount) > 0) list.push({ id: editMyId, name: t('funding.me'), contributed: num(editMyAmount), isMe: true });
    for (const o of editOthers) {
      if (o.name.trim() && num(o.amount) > 0) list.push({ id: o.id, name: o.name.trim(), contributed: num(o.amount), isMe: false });
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
    // Virtual pool: recompute the roster/total. Map each surviving participant's OLD
    // name → its new name so renames keep their paybacks; anyone dropped from the roster
    // has their paybacks reversed (their cash leaves your account).
    const newParticipants = editParticipants();
    if (newParticipants.length === 0) return;
    const keptRename: Record<string, string> = {};
    const me = editFor.participants.find((p) => p.isMe);
    if (editIncludeMe && num(editMyAmount) > 0 && me) keptRename[me.name] = t('funding.me');
    for (const o of editOthers) {
      if (o.origName && o.name.trim() && num(o.amount) > 0) keptRename[o.origName] = o.name.trim();
    }
    const droppedRepaid = editFor.repayments.filter((r) => keptRename[r.participant] === undefined).length;
    if (droppedRepaid > 0 && !confirm(t('funding.confirmDropPaid', { n: droppedRepaid }))) return;
    const { funding, addTxs, removeTxIds } = planVirtualPoolEdit(editFor, newParticipants, description, transactions, keptRename);
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

  // Count how many ledger transactions a pool owns (shown in the delete warning).
  function poolTxCount(f: Funding): number {
    return [
      f.contributionTxId,
      ...(f.spendTxIds ?? []),
      ...(f.repayments ?? []).map((r) => r.id),
      ...(f.contributions ?? []).map((c) => c.id),
    ].filter(Boolean).length;
  }

  async function confirmDeletePool() {
    const f = deleteFor;
    if (!f) return;
    setDeleteFor(null);
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
  const draftRealCount = draftRealParticipants().length;
  const hasAccounts = accounts.length > 0;
  const activePools = fundings.filter((f) => !f.closed);
  const archivedPools = fundings.filter((f) => f.closed);

  // Summary banner stats across all active Group Tabs.
  const totalOwedAll = activePools.filter((f) => !isRealPool(f)).reduce((s, f) => s + totalOwed(f), 0);
  const owingTabsCount = activePools.filter((f) => !isRealPool(f) && totalOwed(f) > 0).length;
  const owingPeopleCount = activePools
    .filter((f) => !isRealPool(f))
    .flatMap((f) => f.participants.filter((p) => !p.isMe && participantOwed(p, f.repayments) > 0))
    .length;

  // Filtered + sorted active pools for the list view.
  const filteredPools = activePools.filter((f) => {
    if (filterType === 'virtual') return !isRealPool(f);
    if (filterType === 'real') return isRealPool(f);
    if (filterType === 'action') return !isRealPool(f) && totalOwed(f) > 0;
    return true;
  });
  const sortedPools = [...filteredPools].sort((a, b) => {
    if (sortBy === 'owed') return totalOwed(b) - totalOwed(a);
    if (sortBy === 'az') return a.description.localeCompare(b.description);
    return b.date.localeCompare(a.date);
  });

  function renderPool(f: Funding) {
    const real = isRealPool(f);
    const remaining = poolRemaining(f);
    const myShare = myContribution(f.participants);
    const owed = totalOwed(f);
    const spends = groupFundingSpends(f.spendTxIds, transactions);
    const spendsOpen = openSpends.has(f.id);
    const paysOpen = openPays.has(f.id);
    const contribsOpen = openContribs.has(f.id);
    const contributions = (f.contributions ?? []).filter((c) => c.amount > 0);
    const progress = poolProgress(f.totalContributed, f.target);
    const activityLog: FundingActivity[] = buildPoolActivity(f, transactions);
    const activityOpen = openActivity.has(f.id);
    return (
      <Card key={f.id} tone={real ? 'emerald' : 'indigo'} className={`space-y-4 ${f.closed ? 'opacity-75' : ''}`}>
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <p className="font-bold text-slate-900 dark:text-slate-100 truncate flex-1">{f.description}</p>
            <span className={`shrink-0 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${real ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' : 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'}`}>
              {real ? <Landmark className="w-3 h-3" /> : <Receipt className="w-3 h-3" />}
              {real ? t('funding.realBadge') : t('funding.virtualBadge')}
            </span>
            {f.closed && (
              <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded-full">
                <Archive className="w-3 h-3" />{t('funding.archivedBadge')}
              </span>
            )}
            <span className="shrink-0 text-xs font-medium text-slate-400 dark:text-slate-500">{formatDate(f.date)}</span>
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            {!f.closed && (
              <Button variant="secondary" size="sm" onClick={() => openSpend(f)}>
                <MinusCircle className="w-4 h-4" />{t('funding.spend')}
              </Button>
            )}
            {real && !f.closed && (
              <Button variant="secondary" size="sm" className="text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/40 hover:bg-emerald-50 dark:hover:bg-emerald-900/30" onClick={() => openContrib(f)}>
                <Plus className="w-4 h-4" />{t('funding.addContribution')}
              </Button>
            )}
            {!real && owed > 0 && !f.closed && (
              <Button variant="secondary" size="sm" className="text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/40 hover:bg-emerald-50 dark:hover:bg-emerald-900/30" onClick={() => openPay(f)}>
                <HandCoins className="w-4 h-4" />{t('funding.recordPayment')}
              </Button>
            )}
            <Button variant="ghost" size="icon" className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 h-9 w-9 rounded-xl" onClick={() => copyPoolSummary(f)} aria-label={t('funding.sharePool')} title={t('funding.sharePool')}><Share2 className="w-4 h-4" /></Button>
            <Button variant="ghost" size="icon" className="text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 h-9 w-9 rounded-xl" onClick={() => openEdit(f)} aria-label={t('funding.editPool')} title={t('funding.editPool')}><Pencil className="w-4 h-4" /></Button>
            <Button variant="ghost" size="icon" className="text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 h-9 w-9 rounded-xl" onClick={() => setArchived(f, !f.closed)} aria-label={f.closed ? t('funding.reopen') : t('funding.archive')} title={f.closed ? t('funding.reopen') : t('funding.archive')}>{f.closed ? <ArchiveRestore className="w-4 h-4" /> : <Archive className="w-4 h-4" />}</Button>
            <Button variant="ghost" size="icon" className="text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/30 h-9 w-9 rounded-xl" onClick={() => setDeleteFor(f)} aria-label={t('common.delete')}><Trash2 className="w-4 h-4" /></Button>
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
          <div className="mb-2">
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" />{t('funding.contributors', { n: f.participants.length })}
            </p>
          </div>
          <div className="space-y-1.5">
            {f.participants.map((p, i) => {
              const owe = participantOwed(p, f.repayments);
              const paid = participantRepaid(f.repayments, p);
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
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-0.5">
                {spends.map((s) => (
                  <div key={s.key} className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 dark:bg-slate-700/40 border border-slate-100 dark:border-slate-700/60 px-3 py-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <p className="text-sm font-bold text-slate-700 dark:text-slate-200 truncate">{s.description}</p>
                        {s.category && s.category !== 'Other' && (
                          <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400">{POOL_SPEND_CATEGORIES.find((c) => c.value === s.category)?.label ?? s.category}</span>
                        )}
                      </div>
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
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-0.5">
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
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-0.5">
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

        {/* Activity log — unified chronological timeline of all pool events */}
        {activityLog.length > 1 && (
          <div>
            <button
              onClick={() => toggle(setOpenActivity, f.id)}
              className="w-full flex items-center justify-between gap-2 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
              aria-expanded={activityOpen}
            >
              <span className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />{t('funding.activityTitle')}
                <span className="normal-case tracking-normal text-slate-400 dark:text-slate-500">· {activityLog.length}</span>
              </span>
              <ChevronDown className={`w-4 h-4 transition-transform ${activityOpen ? 'rotate-180' : ''}`} />
            </button>
            <Collapsible open={activityOpen}>
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-0.5">
                {activityLog.map((entry, i) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-700/40 border border-slate-100 dark:border-slate-700/60">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${entry.type === 'spend' ? 'bg-rose-400' : entry.type === 'created' ? 'bg-indigo-400' : 'bg-emerald-400'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                        {entry.type === 'created' ? t('funding.activityCreated') : entry.type === 'spend' ? t('funding.activitySpend') : entry.type === 'contribution' ? t('funding.activityContrib') : t('funding.activityRepay')}
                      </p>
                      <p className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate">{entry.label}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-xs font-extrabold ${entry.type === 'spend' ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                        {entry.type === 'spend' ? '-' : '+'}{formatCurrency(entry.amount)}
                      </p>
                      <p className="text-[10px] font-medium text-slate-400 dark:text-slate-500">{formatDate(entry.date)}</p>
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
          {/* "You're Owed" summary banner — shown when any Group Tab has outstanding amounts */}
          {totalOwedAll > 0 && (
            <div className="rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 p-4 text-white shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-indigo-200">{t('funding.owedBannerTitle')}</p>
                  <p className="text-2xl font-black mt-0.5">{formatCurrency(totalOwedAll)}</p>
                  <p className="text-xs font-medium text-indigo-200 mt-1">
                    {t('funding.owedBannerSub', {
                      tabs: owingTabsCount,
                      tabLabel: owingTabsCount === 1 ? t('funding.tabSingular') : t('funding.tabPlural'),
                      people: owingPeopleCount,
                      peopleLabel: owingPeopleCount === 1 ? t('funding.personSingular') : t('funding.personPlural'),
                    })}
                  </p>
                </div>
                <Sparkles className="w-10 h-10 text-indigo-300 shrink-0 opacity-80" />
              </div>
            </div>
          )}

          {/* Sort & filter bar — only shown when there are multiple pools */}
          {activePools.length > 1 && (
            <div className="flex items-center gap-2 flex-wrap">
              {(['all', 'virtual', 'real', 'action'] as const).map((fk) => (
                <button
                  key={fk}
                  onClick={() => setFilterType(fk)}
                  className={`text-xs font-bold px-3 py-1.5 rounded-xl border transition-colors ${filterType === fk ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-600'}`}
                >
                  {fk === 'all' ? t('funding.filterAll') : fk === 'virtual' ? t('funding.filterTabs') : fk === 'real' ? t('funding.filterVaults') : t('funding.filterAction')}
                </button>
              ))}
              <div className="ml-auto">
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as 'recent' | 'owed' | 'az')}
                  className="h-9 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300 px-3 pr-8 focus:outline-none focus:border-indigo-400 appearance-none"
                  style={{ backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%2364748b' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`, backgroundPosition: 'right 0.5rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.25em 1.25em' }}
                >
                  <option value="recent">{t('funding.sortRecent')}</option>
                  <option value="owed">{t('funding.sortOwed')}</option>
                  <option value="az">{t('funding.sortAZ')}</option>
                </select>
              </div>
            </div>
          )}

          {sortedPools.length === 0 && activePools.length > 0 ? (
            <p className="text-center text-sm font-medium text-slate-500 dark:text-slate-400 py-6">{t('funding.noPools')}</p>
          ) : (
            sortedPools.map((f) => renderPool(f))
          )}

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
          {/* Kind: Group Tab (virtual) vs. Group Vault (real cash pool) */}
          <div className="grid grid-cols-2 gap-2 p-1 rounded-2xl bg-slate-100 dark:bg-slate-700/50">
            {(['virtual', 'real'] as const).map((k) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-colors ${kind === k ? 'bg-white dark:bg-slate-800 shadow-sm ' + (k === 'real' ? 'text-emerald-600 dark:text-emerald-400' : 'text-indigo-600 dark:text-indigo-400') : 'text-slate-500 dark:text-slate-400'}`}
              >
                {k === 'real' ? <Landmark className="w-4 h-4" /> : <Receipt className="w-4 h-4" />}
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
            {includeMe && kind !== 'real' && (
              <Input label={t('funding.myContribution')} type="text" inputMode="decimal" placeholder="0.00" value={myAmount} onChange={(e) => setMyAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
            )}
          </div>

          {/* Other people */}
          <div className="space-y-3">
            <p className="text-sm font-bold text-slate-700 dark:text-slate-300">{t('funding.otherPeople')}</p>
            {others.map((o, i) => (
              <div key={o.key} className="flex items-center gap-2.5">
                <Input className="h-14 flex-1 text-lg placeholder:text-lg placeholder:font-medium" placeholder={t('funding.personName')} value={o.name} onChange={(e) => setOthers((prev) => prev.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                {kind !== 'real' && (
                  <Input className="h-14 w-24 text-lg" type="text" inputMode="decimal" placeholder="0.00" value={o.amount} onChange={(e) => setOthers((prev) => prev.map((x, j) => j === i ? { ...x, amount: e.target.value.replace(/[^0-9.]/g, '') } : x))} />
                )}
                <button onClick={() => setOthers((prev) => prev.length > 1 ? prev.filter((_, j) => j !== i) : prev)} className="text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 shrink-0 p-2 rounded-xl transition-colors" aria-label="Remove"><Trash2 className="w-5 h-5" /></button>
              </div>
            ))}
            <button onClick={() => setOthers((prev) => [...prev, emptyOther()])} className="text-sm font-bold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 inline-flex items-center gap-2 mt-1 px-3 py-2 rounded-xl transition-colors">
              <UserPlus className="w-5 h-5" />{t('funding.addPerson')}
            </button>
          </div>

          {kind === 'real' && (
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-700/40 rounded-xl px-3 py-2">{t('funding.realMembersHint')}</p>
          )}
          {kind !== 'real' && draftTotal > 0 && (
            <p className="text-sm font-bold text-slate-600 dark:text-slate-300 text-center">{t('funding.poolTotal', { amount: formatCurrency(draftTotal) })}</p>
          )}
        </div>
        <div className="sticky bottom-0 bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700/60 -mx-6 sm:-mx-8 px-6 sm:px-8 py-4">
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button className="flex-1 shadow-sm" onClick={createPool} disabled={saving || !desc.trim() || (kind === 'real' ? draftRealCount === 0 : draftTotal <= 0)}>{saving ? t('common.saving') : t('funding.createPool')}</Button>
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
                {!isRealPool(spendFor) && (spendFor.participants.length ?? 0) > 1 && (
                  <button
                    type="button"
                    onClick={() => { const n = spendFor.participants.length; const total = num(spendAmount); if (total > 0 && n > 0) setSpendMine(String(round2(total / n))); }}
                    className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 px-3 py-1.5 rounded-xl transition-colors mt-1.5 inline-block"
                  >
                    {t('funding.splitEqually', { n: spendFor.participants.length })}
                  </button>
                )}
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1.5">{t('funding.myShareHint')}</p>
              </div>
              <Input label={t('funding.noteOptional')} placeholder={t('funding.notePlaceholder')} value={spendDesc} onChange={(e) => setSpendDesc(e.target.value)} />
              <div>
                <p className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">{t('funding.spendCategory')}</p>
                <div className="flex flex-wrap gap-2">
                  {POOL_SPEND_CATEGORIES.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => setSpendCategory(c.value)}
                      className={`text-xs font-bold px-3 py-1.5 rounded-xl border transition-colors ${spendCategory === c.value ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-slate-50 dark:bg-slate-700/40 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600 hover:border-indigo-300 dark:hover:border-indigo-600'}`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
              <Input label={t('funding.date')} type="date" value={spendDate} onChange={(e) => setSpendDate(e.target.value)} />
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
              <Input label={t('funding.date')} type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
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
              <Input label={t('funding.date')} type="date" value={contribDate} onChange={(e) => setContribDate(e.target.value)} />
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

      {/* ── Settle-up confirmation: ask user to archive or keep active ───── */}
      <Modal open={settledFor !== null} onClose={() => confirmSettleArchive(false)} title={t('funding.settledTitle')}>
        <div className="space-y-5 pb-4">
          <div className="flex items-center justify-center w-16 h-16 rounded-full bg-emerald-50 dark:bg-emerald-900/20 mx-auto">
            <PartyPopper className="w-8 h-8 text-emerald-500" />
          </div>
          <p className="text-center text-sm font-medium text-slate-500 dark:text-slate-400">{t('funding.settledDesc')}</p>
        </div>
        <div className="sticky bottom-0 bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700/60 -mx-6 sm:-mx-8 px-6 sm:px-8 py-4">
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => confirmSettleArchive(false)} disabled={saving}>{t('funding.settledKeepActive')}</Button>
            <Button className="flex-1 shadow-sm" onClick={() => confirmSettleArchive(true)} disabled={saving}>{saving ? t('common.saving') : t('funding.settledArchive')}</Button>
          </div>
        </div>
      </Modal>

      {/* ── Delete pool safety guard: show transaction count before confirming ── */}
      <Modal open={deleteFor !== null} onClose={() => setDeleteFor(null)} title={t('funding.deleteTitle')}>
        {deleteFor && (
          <>
            <div className="space-y-4 pb-4">
              <p className="text-base font-bold text-slate-800 dark:text-slate-100">{deleteFor.description}</p>
              <div className="flex items-start gap-3 rounded-2xl bg-rose-50 dark:bg-rose-900/20 border border-rose-100 dark:border-rose-800/40 p-4">
                <AlertCircle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
                <p className="text-sm font-medium text-rose-800 dark:text-rose-300">
                  {poolTxCount(deleteFor) > 0
                    ? t('funding.deleteDesc', { n: poolTxCount(deleteFor) })
                    : t('funding.deleteDescEmpty')}
                </p>
              </div>
            </div>
            <div className="sticky bottom-0 bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700/60 -mx-6 sm:-mx-8 px-6 sm:px-8 py-4">
              <div className="flex gap-3">
                <Button variant="secondary" className="flex-1" onClick={() => setDeleteFor(null)}>{t('common.cancel')}</Button>
                <Button variant="danger" className="flex-1" onClick={confirmDeletePool} disabled={saving}>{saving ? t('common.saving') : t('funding.deleteConfirm')}</Button>
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
