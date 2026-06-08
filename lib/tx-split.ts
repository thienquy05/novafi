import type { Transaction } from '@/types';

// ── Category split ────────────────────────────────────────────────────────────
// One purchase split across several budget categories, stored as separate
// Transaction rows sharing a `splitGroupId` (each row is a normal expense with
// its own category + amount). This keeps every existing aggregation — budgets,
// dashboard pie, reports, account balances — working unchanged, because each
// split is just an ordinary transaction. This module holds the pure logic.
//
// NOTE: unrelated to the people-split (`Split` type / lib/splits.ts), which
// tracks a cost shared with contacts ("owed to you").

export interface SplitLine {
  /** Stable key for React list rendering / editing. */
  id: string;
  category: string;
  /** Raw input string from the form; parsed via splitLineAmount. */
  amount: string;
}

/** Parse one line's amount; non-numeric / negative → 0. */
export function splitLineAmount(line: { amount: string }): number {
  const n = parseFloat(line.amount);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Round to cents to avoid float dust when summing / comparing. */
export function roundCents(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Sum of all line amounts, rounded to cents. */
export function splitLinesTotal(lines: { amount: string }[]): number {
  return roundCents(lines.reduce((s, l) => s + splitLineAmount(l), 0));
}

/** A line counts once it has a category and a positive amount. */
export function isCompleteLine(line: SplitLine): boolean {
  return line.category.trim() !== '' && splitLineAmount(line) > 0;
}

/**
 * Validate a set of split lines.
 * - Needs at least two complete lines (a one-line "split" is just a normal tx).
 * - Every non-empty line must have both a category and a positive amount.
 * - When `lockedTotal` is given (splitting an existing expense / editing a
 *   group), the lines must sum to it within a cent so the account balance can't
 *   silently drift.
 */
export function validateSplit(
  lines: SplitLine[],
  lockedTotal?: number | null,
): { ok: boolean; total: number; remaining: number; completeCount: number } {
  const total = splitLinesTotal(lines);
  const completeCount = lines.filter(isCompleteLine).length;
  // A line that has only one of {category, amount} filled is half-entered → invalid.
  const noHalfLines = lines.every(
    (l) => (l.category.trim() === '' && splitLineAmount(l) === 0) || isCompleteLine(l),
  );
  const remaining = lockedTotal != null ? roundCents(lockedTotal - total) : 0;
  const totalsMatch = lockedTotal == null ? true : Math.abs(remaining) <= 0.005;
  const ok = completeCount >= 2 && noHalfLines && total > 0 && totalsMatch;
  return { ok, total, remaining, completeCount };
}

/**
 * Build the Transaction rows for a split group from shared base fields and the
 * complete lines. All rows are expenses sharing `groupId`, the same date /
 * description / account, and an identical `createdAt` so they sort together.
 */
export function buildSplitTransactions(
  base: { date: string; description: string; account: string; createdAt: string },
  lines: SplitLine[],
  groupId: string,
  genId: () => string,
): Transaction[] {
  return lines.filter(isCompleteLine).map((l) => ({
    id: genId(),
    date: base.date,
    description: base.description,
    amount: roundCents(splitLineAmount(l)),
    type: 'expense' as const,
    category: l.category,
    account: base.account,
    createdAt: base.createdAt,
    splitGroupId: groupId,
  }));
}

export interface SplitGroupView {
  splitGroupId: string;
  transactions: Transaction[];
  total: number;
}

export type LedgerItem =
  | { kind: 'single'; tx: Transaction }
  | { kind: 'group'; group: SplitGroupView };

/**
 * Collapse a flat (already date- and time-sorted) transaction list into ledger
 * items: rows sharing a non-empty `splitGroupId` fold into one group item,
 * positioned where the group first appears; everything else stays a single row.
 * A group that has been reduced to a single surviving row renders as a single.
 */
export function groupLedgerItems(txns: Transaction[]): LedgerItem[] {
  const groups = new Map<string, Transaction[]>();
  for (const tx of txns) {
    const gid = tx.splitGroupId;
    if (gid) {
      const arr = groups.get(gid);
      if (arr) arr.push(tx);
      else groups.set(gid, [tx]);
    }
  }
  const emitted = new Set<string>();
  const items: LedgerItem[] = [];
  for (const tx of txns) {
    const gid = tx.splitGroupId;
    const members = gid ? groups.get(gid) : undefined;
    if (gid && members && members.length > 1) {
      if (emitted.has(gid)) continue;
      emitted.add(gid);
      items.push({
        kind: 'group',
        group: { splitGroupId: gid, transactions: members, total: roundCents(members.reduce((s, m) => s + m.amount, 0)) },
      });
    } else {
      items.push({ kind: 'single', tx });
    }
  }
  return items;
}
