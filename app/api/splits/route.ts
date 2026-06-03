import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import {
  getSplits,
  upsertSplit,
  deleteSplit,
  getTransactions,
  addTransaction,
  deleteTransaction,
  getAccounts,
  upsertAccount,
} from '@/lib/sheets';
import { getCache, setCache, invalidateCache, CACHE_TTL } from '@/lib/cache';
import { applyTransactionToBalances } from '@/lib/calculations';
import type { Account, Split, Transaction } from '@/types';

// Persist only the accounts whose balance actually changed. applyTransactionToBalances
// returns the same reference for untouched accounts, so an identity check suffices.
async function persistChanged(
  accessToken: string,
  spreadsheetId: string,
  before: Account[],
  after: Account[],
): Promise<void> {
  for (let i = 0; i < after.length; i++) {
    if (after[i] !== before[i]) {
      await upsertAccount(accessToken, spreadsheetId, after[i]);
    }
  }
}

function invalidateAfterCash(spreadsheetId: string): void {
  invalidateCache(`transactions:${spreadsheetId}`);
  invalidateCache(`accounts:${spreadsheetId}`);
  invalidateCache(`dashboard:${spreadsheetId}`);
  invalidateCache(`badges:${spreadsheetId}`);
}

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const key = `splits:${session.spreadsheetId}`;
  const cached = getCache<Split[]>(key);
  if (cached) return NextResponse.json(cached);

  const splits = await getSplits(session.accessToken, session.spreadsheetId);
  setCache(key, splits, CACHE_TTL.SHORT);
  return NextResponse.json(splits);
}

// Accepts:
//   • a bare Split                       → metadata-only upsert (no cash movement)
//   • { split, tx }                      → write `tx` + apply its balance effect, then
//                                          upsert the split. Used to front the other
//                                          person's share on payment, and to record
//                                          the cash-in when they settle.
//   • { split, removeTxId }              → reverse + delete `removeTxId`'s balance
//                                          effect, then upsert the split. Used to
//                                          undo a settle.
// Bundling the cash row with the split keeps a receivable that claims to have
// moved cash always backed by the matching ledger row (and vice versa).
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json()) as
    | Split
    | { split: Split; tx?: Transaction; removeTxId?: string };
  const split: Split = 'split' in body ? body.split : body;
  const tx: Transaction | undefined = 'split' in body ? body.tx : undefined;
  const removeTxId: string | undefined = 'split' in body ? body.removeTxId : undefined;

  if (tx) {
    // Ledger row first (source of truth), then balances.
    await addTransaction(session.accessToken, session.spreadsheetId, tx);
    const accounts = await getAccounts(session.accessToken, session.spreadsheetId);
    const updated = applyTransactionToBalances(accounts, tx, 'apply');
    await persistChanged(session.accessToken, session.spreadsheetId, accounts, updated);
    invalidateAfterCash(session.spreadsheetId);
  } else if (removeTxId) {
    const [transactions, accounts] = await Promise.all([
      getTransactions(session.accessToken, session.spreadsheetId),
      getAccounts(session.accessToken, session.spreadsheetId),
    ]);
    const target = transactions.find((t) => t.id === removeTxId);
    if (target) {
      const reversed = applyTransactionToBalances(accounts, target, 'reverse');
      await deleteTransaction(session.accessToken, session.spreadsheetId, target.id);
      await persistChanged(session.accessToken, session.spreadsheetId, accounts, reversed);
      invalidateAfterCash(session.spreadsheetId);
    }
  }

  await upsertSplit(session.accessToken, session.spreadsheetId, split);
  invalidateCache(`splits:${session.spreadsheetId}`);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await req.json();

  // A split owns the cash transfers it created (the fronted share + the settle
  // payback). Find them BEFORE deleting, then reverse each balance effect and
  // delete the row — atomically, server-side — so the linked account returns to
  // exactly where it was. Mirrors the loan-deletion model.
  const splits = await getSplits(session.accessToken, session.spreadsheetId);
  const split = splits.find((s) => s.id === id);

  await deleteSplit(session.accessToken, session.spreadsheetId, id);

  const txIds = split ? [split.frontedTxId, split.settleTxId, ...(split.repaymentTxIds ?? [])].filter(Boolean) as string[] : [];
  if (txIds.length) {
    const idSet = new Set(txIds);
    const [transactions, accounts] = await Promise.all([
      getTransactions(session.accessToken, session.spreadsheetId),
      getAccounts(session.accessToken, session.spreadsheetId),
    ]);
    let working: Account[] = accounts;
    for (const tx of transactions.filter((t) => idSet.has(t.id))) {
      working = applyTransactionToBalances(working, tx, 'reverse');
      await deleteTransaction(session.accessToken, session.spreadsheetId, tx.id);
    }
    await persistChanged(session.accessToken, session.spreadsheetId, accounts, working);
    invalidateAfterCash(session.spreadsheetId);
  }

  invalidateCache(`splits:${session.spreadsheetId}`);
  return NextResponse.json({ ok: true });
}
