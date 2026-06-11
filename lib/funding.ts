import type { Funding, FundingParticipant, Transaction } from '@/types';
import { generateId } from './utils';

// Pure helpers for the Funding (treasurer-held money pool) feature. The cash
// mechanics mirror the inverse of a Split:
//   • Contributions from OTHERS raise the holding account but aren't income — a
//     `transfer` from an empty source INTO the account.
//   • The user's own contribution is existing money, so it creates no cash row.
//   • A spend books only the user's share as an `expense`; the rest leaves the
//     account as a `transfer` to an empty destination (spending others' money).

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

// The cash rows for a spend from the pool. `myShare` (≤ amount) becomes the
// user's own expense; the remainder leaves the account as a transfer (others'
// money). Either row is omitted when its portion is 0.
export function buildSpendTxs(
  account: string,
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
      type: 'expense', category: 'Funding', account, createdAt: now,
    });
  }
  if (others > 0) {
    txs.push({
      id: generateId(), date, description, amount: others,
      type: 'transfer', category: 'Funding', account, toAccount: '', createdAt: now,
    });
  }
  return txs;
}
