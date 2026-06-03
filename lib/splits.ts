// Shared helpers for bill/expense splitting — used by both the Bills page
// (recurring shared bills) and the Transactions page (one-time expense splits).
// Both flows persist to the same `Split` sheet/API; they're told apart by the
// `oneoff:` prefix on a one-time split's `billId` (see isOneOffSplit).
import { generateId } from '@/lib/utils';
import { roundCents } from '@/lib/calculations';
import type { Split, Transaction } from '@/types';

// A one-time expense split (e.g. "dinner for the group") has no backing Bill, so
// its `billId` is a synthetic group id tagged with this prefix. Recurring
// shared-bill splits use the actual Bill's id (no prefix). The tag lets each
// surface filter to only its own kind without loading bills or breaking when a
// bill is later deleted.
export const ONEOFF_PREFIX = 'oneoff:';

export function newOneOffGroupId(): string {
  return ONEOFF_PREFIX + generateId();
}

export function isOneOffSplit(s: Split): boolean {
  return s.billId.startsWith(ONEOFF_PREFIX);
}

// Builds the cash-movement transfer for a split's fronted share or its payback.
// It's a `transfer` with an external (empty) counterparty so it shifts the
// account balance WITHOUT counting as income or expense — the same model as
// loans. `cashOut` fronts the other person's share out of the account when you
// pay; `cashIn` returns it when they settle up.
export function buildSplitTx(
  kind: 'cashOut' | 'cashIn',
  amount: number,
  account: string,
  description: string,
  date: string,
): Transaction {
  const out = kind === 'cashOut';
  return {
    id: generateId(),
    date,
    description,
    amount,
    type: 'transfer',
    category: 'Transfer',
    account: out ? account : '',
    toAccount: out ? '' : account,
    createdAt: new Date().toISOString(),
  };
}

// One bill/expense occurrence with everyone who shares it. Splits are grouped by
// billId + date so a single dinner (many people, same billId & date) collapses
// into one group with a per-person breakdown, while each month's recurring-bill
// payment stays its own group. First-seen order is preserved (callers pre-sort).
export type SplitGroup = { key: string; billName: string; date: string; settledDate: string; total: number; splits: Split[] };

export function groupSplits(list: Split[]): SplitGroup[] {
  const map = new Map<string, SplitGroup>();
  for (const s of list) {
    // Fall back to the split's own id when billId is blank (legacy rows) so
    // unrelated splits never merge into a phantom group.
    const key = `${s.billId || s.id}|${s.date}`;
    let g = map.get(key);
    if (!g) { g = { key, billName: s.billName, date: s.date, settledDate: s.settledDate, total: 0, splits: [] }; map.set(key, g); }
    g.splits.push(s);
    g.total += s.amount;
  }
  return [...map.values()];
}

// Resolves each person's share of a split. `amounts[i]` is that person's typed
// amount, or `null` when their box is left BLANK ("auto"). Blank entries evenly
// divide the remainder (total − the typed amounts) among themselves; when
// `includeMe` is true, you join that auto pool as one extra share. Typed amounts
// are always honored verbatim. Rounding leftovers land on the last auto party
// (you, when included; otherwise the last blank person) so shares sum to exactly
// the total. `myShare` is the part you actually pay (the real expense); `over` is
// true when the typed amounts already exceed the total.
//
// e.g. total 200, typed [50, 70, 35, null]          → shares [50,70,35,45]
//      total 200, typed [50, 70, null, null]         → shares [50,70,40,40]
export function computeSplitShares(
  total: number,
  amounts: (number | null)[],
  includeMe: boolean,
): { shares: number[]; myShare: number; over: boolean } {
  const explicitSum = roundCents(amounts.reduce<number>((s, a) => s + (a ?? 0), 0));
  const blankIdx: number[] = [];
  amounts.forEach((a, i) => { if (a == null) blankIdx.push(i); });
  const autoParties = blankIdx.length + (includeMe ? 1 : 0);
  const remainder = roundCents(total - explicitSum);
  const over = explicitSum > total + 0.005;
  const shares = amounts.map((a) => a ?? 0);
  let myShare: number;

  if (autoParties > 0 && remainder > 0) {
    const per = Math.floor((remainder / autoParties) * 100) / 100;
    // The last auto party absorbs the rounding leftover.
    const absorbed = roundCents(remainder - per * (autoParties - 1));
    if (includeMe) {
      blankIdx.forEach((i) => { shares[i] = per; });
      myShare = absorbed;
    } else {
      blankIdx.forEach((i, k) => { shares[i] = k === blankIdx.length - 1 ? absorbed : per; });
      myShare = 0;
    }
  } else {
    // Nothing left to auto-divide: blank people owe 0 and you cover any leftover.
    blankIdx.forEach((i) => { shares[i] = 0; });
    myShare = roundCents(Math.max(0, total - explicitSum));
  }

  return { shares, myShare, over };
}
