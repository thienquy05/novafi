import type { Funding, FundingContribution, FundingParticipant, FundingRepayment, Transaction } from '@/types';
import { generateId } from './utils';

// Pure helpers for the Funding (virtual group money pool) feature.
//   • The pool is virtual: a budget number, not cash parked in an account.
//   • A spend is charged to a real account you pick. Only the user's share is an
//     `expense`; the rest leaves that account as a `transfer` to an empty
//     destination (fronting the group's money) so it isn't counted as spending.
//   • A repayment is a participant paying you back: a `transfer` INTO one of your
//     accounts tagged 'FundingRepay', so it lands as neither income nor debt.
//   • The user's own pledge is existing money, so it creates no cash row.

// Repayment rows carry their own category so they're excluded from the
// "funding held for others" net-worth adjustment (which only looks at 'Funding').
export const FUNDING_REPAY_CATEGORY = 'FundingRepay';

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export function othersContribution(participants: FundingParticipant[]): number {
  return round(participants.filter((p) => !p.isMe).reduce((s, p) => s + (p.contributed || 0), 0));
}

export function myContribution(participants: FundingParticipant[]): number {
  return round(participants.filter((p) => p.isMe).reduce((s, p) => s + (p.contributed || 0), 0));
}

export function totalContribution(participants: FundingParticipant[]): number {
  return round(participants.reduce((s, p) => s + (p.contributed || 0), 0));
}

export function poolRemaining(f: Pick<Funding, 'totalContributed' | 'spent'>): number {
  return round(f.totalContributed - f.spent);
}

// ── Repayment / settle-up math ────────────────────────────────────────────────
// Each NON-me participant pledged `contributed`; what they still owe you is that
// pledge minus everything they've paid back. The "me" row is the user's own money
// and is never owed. Numbers can't go below 0 (an over-payment just settles them).

export function participantRepaid(repayments: FundingRepayment[], name: string): number {
  return round(repayments.filter((r) => r.participant === name).reduce((s, r) => s + (r.amount || 0), 0));
}

export function participantOwed(p: FundingParticipant, repayments: FundingRepayment[]): number {
  if (p.isMe) return 0;
  return Math.max(0, round((p.contributed || 0) - participantRepaid(repayments, p.name)));
}

export function totalRepaid(repayments: FundingRepayment[]): number {
  return round(repayments.reduce((s, r) => s + (r.amount || 0), 0));
}

// What the group still owes you across everyone (0 once fully settled).
export function totalOwed(f: Pick<Funding, 'participants' | 'repayments'>): number {
  return round(f.participants.reduce((s, p) => s + participantOwed(p, f.repayments), 0));
}

// A pool is "fully settled" once at least one OTHER person actually pledged money
// and nobody owes you anything anymore. The first clause matters: a solo pool (only
// the "me" row) owes nothing from the start, and we don't want to auto-archive that.
// Used to auto-archive on the final payback.
export function isFullySettled(f: Pick<Funding, 'participants' | 'repayments'>): boolean {
  const someoneOwedYou = f.participants.some((p) => !p.isMe && (p.contributed || 0) > 0);
  return someoneOwedYou && totalOwed(f) === 0;
}

// The transfer that brings OTHERS' cash into the holding account (not income).
// Returns null when nobody else contributed (nothing to move).
export function buildContributionTx(
  account: string,
  othersTotal: number,
  description: string,
  date: string,
): Transaction | null {
  if (!(othersTotal > 0) || !account) return null;
  return {
    id: generateId(),
    date,
    description,
    amount: round(othersTotal),
    type: 'transfer',
    category: 'Funding',
    account: '',
    toAccount: account,
    createdAt: new Date().toISOString(),
  };
}

// ── Real money pools ──────────────────────────────────────────────────────────
// A REAL pool holds actual cash in a dedicated `pool`-type account. Contributions
// are real `transfer`s INTO that account; spends are charged to it (so they draw
// the real balance down). The pool's live balance is just totalContributed − spent
// (== the pool account's balance). See the Funding type doc for the cash flows.

export function isRealPool(f: Pick<Funding, 'kind'>): boolean {
  return f.kind === 'real';
}

// The cash row + record for one contribution INTO the pool account.
//   • Your money (isMe): a `transfer` from your spendable account → pool, category
//     'Transfer'. It's still your money, just moved to the shared bucket (so it
//     stays in net worth and is NOT held-for-others).
//   • Someone else's money: a `transfer` from an empty source → pool, category
//     'Funding', so it's held-for-others and netted out of net worth.
export function buildPoolContributionTx(
  poolAccountId: string,
  amount: number,
  participant: string,
  isMe: boolean,
  fromAccount: string,
  description: string,
  date: string,
): { tx: Transaction; contribution: FundingContribution } {
  const amt = round(amount);
  const id = generateId();
  const now = new Date().toISOString();
  const tx: Transaction = isMe
    ? { id, date, description, amount: amt, type: 'transfer', category: 'Transfer', account: fromAccount, toAccount: poolAccountId, createdAt: now }
    : { id, date, description, amount: amt, type: 'transfer', category: 'Funding', account: '', toAccount: poolAccountId, createdAt: now };
  return { tx, contribution: { id, participant, amount: amt, isMe, account: isMe ? fromAccount : '', date } };
}

// Re-derive the participant roster (with each person's total cash in) from the
// itemized contributions. Keeping participants in sync this way lets the shared
// card UI and the contribution helpers above work for real pools unchanged.
export function participantsFromContributions(contributions: FundingContribution[]): FundingParticipant[] {
  const map = new Map<string, FundingParticipant>();
  for (const c of contributions) {
    const cur = map.get(c.participant);
    if (cur) cur.contributed = round(cur.contributed + c.amount);
    else map.set(c.participant, { name: c.participant, contributed: round(c.amount), isMe: c.isMe });
  }
  return [...map.values()];
}

export function contributionsTotal(contributions: FundingContribution[]): number {
  return round(contributions.reduce((s, c) => s + (c.amount || 0), 0));
}

// Funded fraction of a savings-goal target (0..1+, or null when no target is set).
export function poolProgress(totalContributed: number, target?: number): number | null {
  if (!target || target <= 0) return null;
  return totalContributed / target;
}

// ── Ledger → pool reconciliation ──────────────────────────────────────────────
// A pool caches totals (`totalContributed`, `spent`) derived from the cash rows
// it created. Those rows can also be edited/deleted from the generic ledger
// (/api/transactions), which doesn't go through /api/funding — so that route
// reconciles the pool with these helpers. Each returns the corrected Funding,
// or null when the transaction isn't linked to this pool / nothing changed.

// A linked row's amount changed: mirror the delta into the pool.
export function syncFundingTxAmount(f: Funding, original: Transaction, updated: Transaction): Funding | null {
  const delta = round(updated.amount - original.amount);
  if (delta === 0) return null;
  if (f.contributionTxId && f.contributionTxId === updated.id) {
    // The contribution row IS the others' total — rescale each non-me share so
    // the per-person figures keep summing to the cash that actually arrived.
    const base = othersContribution(f.participants);
    const ratio = base > 0 ? updated.amount / base : 0;
    const participants = f.participants.map((p) =>
      p.isMe ? p : { ...p, contributed: round(p.contributed * ratio) },
    );
    return { ...f, participants, totalContributed: round(myContribution(f.participants) + updated.amount) };
  }
  if (f.spendTxIds.includes(updated.id)) {
    return { ...f, spent: Math.max(0, round(f.spent + delta)) };
  }
  return null;
}

// A linked row was deleted: back its amount out of the pool and unlink it.
export function syncFundingTxRemoval(f: Funding, tx: Transaction): Funding | null {
  if (f.contributionTxId && f.contributionTxId === tx.id) {
    // The others' cash never entered the account — zero their shares; the pool
    // keeps only the treasurer's own earmark.
    const participants = f.participants.map((p) => (p.isMe ? p : { ...p, contributed: 0 }));
    return { ...f, participants, contributionTxId: '', totalContributed: myContribution(f.participants) };
  }
  if (f.spendTxIds.includes(tx.id)) {
    return {
      ...f,
      spendTxIds: f.spendTxIds.filter((id) => id !== tx.id),
      spent: Math.max(0, round(f.spent - tx.amount)),
    };
  }
  return null;
}

// The cash rows for a spend from the pool, charged to `chargedAccount` — the real
// account (cash/card) you actually paid with, which need NOT be where any money is
// held. `myShare` (≤ amount) becomes the user's own expense; the remainder leaves
// that account as a transfer (fronting the group's money). Both rows share one
// `createdAt` so they can be regrouped back into a single spend for edit/delete.
// Either row is omitted when its portion is 0.
export function buildSpendTxs(
  chargedAccount: string,
  amount: number,
  myShare: number,
  description: string,
  date: string,
): Transaction[] {
  const total = round(amount);
  const mine = round(Math.min(Math.max(0, myShare), total));
  const others = round(total - mine);
  const txs: Transaction[] = [];
  const now = new Date().toISOString();
  if (mine > 0) {
    txs.push({
      id: generateId(), date, description, amount: mine,
      type: 'expense', category: 'Funding', account: chargedAccount, createdAt: now,
    });
  }
  if (others > 0) {
    txs.push({
      id: generateId(), date, description, amount: others,
      type: 'transfer', category: 'Funding', account: chargedAccount, toAccount: '', createdAt: now,
    });
  }
  return txs;
}

// The cash row for a participant paying you back: money INTO one of your accounts
// from an empty source, so it's not income. Tagged 'FundingRepay' so it never
// counts as your spending and is excluded from the "held for others" net-worth
// adjustment. Returns the row plus the FundingRepayment record to store on the pool.
export function buildRepayTx(
  account: string,
  amount: number,
  participant: string,
  description: string,
  date: string,
): { tx: Transaction; repayment: FundingRepayment } {
  const amt = round(amount);
  const id = generateId();
  return {
    tx: {
      id, date, description, amount: amt,
      type: 'transfer', category: FUNDING_REPAY_CATEGORY, account: '', toAccount: account,
      createdAt: new Date().toISOString(),
    },
    repayment: { id, participant, amount: amt, account, date },
  };
}

// ── Regrouping spend rows ─────────────────────────────────────────────────────
// A spend can be 1–2 ledger rows (my-share expense + others transfer) that share a
// `createdAt`, charged account, description and date. Regroup them so the pool UI
// can list, edit and delete a spend as one unit. Rows without a createdAt (legacy
// or hand-entered) each stand alone, keyed by their own id.
export interface FundingSpend {
  key: string;          // grouping key (shared createdAt, or the row id as a fallback)
  txIds: string[];      // the 1–2 rows that make up this spend
  amount: number;       // total spent (mine + others)
  myShare: number;      // the user's own portion (the expense row)
  chargedAccount: string;
  description: string;
  date: string;
}

export function groupFundingSpends(spendTxIds: string[], transactions: Transaction[]): FundingSpend[] {
  const linked = new Set(spendTxIds);
  const rows = transactions.filter((t) => linked.has(t.id));
  const groups = new Map<string, Transaction[]>();
  for (const t of rows) {
    const key = t.createdAt || t.id;
    const arr = groups.get(key);
    if (arr) arr.push(t);
    else groups.set(key, [t]);
  }
  const spends: FundingSpend[] = [];
  for (const [key, arr] of groups) {
    const expense = arr.find((t) => t.type === 'expense');
    const transfer = arr.find((t) => t.type === 'transfer');
    const myShare = round(expense?.amount ?? 0);
    const others = round(transfer?.amount ?? 0);
    const sample = expense ?? transfer ?? arr[0];
    spends.push({
      key,
      txIds: arr.map((t) => t.id),
      amount: round(myShare + others),
      myShare,
      chargedAccount: sample.account,
      description: sample.description,
      date: sample.date,
    });
  }
  // Newest first (by date, then key which embeds the createdAt timestamp).
  return spends.sort((a, b) => (b.date.localeCompare(a.date)) || b.key.localeCompare(a.key));
}
