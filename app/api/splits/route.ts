import { NextResponse } from 'next/server';
import {
  getSplits,
  upsertSplit,
  deleteSplit,
  getTransactions,
  addTransaction,
  deleteTransaction,
  getAccounts,
  persistChangedAccounts,
} from '@/lib/sheets';
import { invalidateMany, CACHE_TTL, TX_CACHES } from '@/lib/cache';
import { cachedGet, withSession } from '@/lib/apiRoute';
import { applyTransactionToBalances } from '@/lib/calculations';
import type { Account, Split, Transaction } from '@/types';

export const GET = cachedGet({
  resource: 'splits',
  ttl: CACHE_TTL.SHORT,
  fetch: ({ accessToken, spreadsheetId }) => getSplits(accessToken, spreadsheetId),
});

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
export const POST = withSession(async ({ accessToken, spreadsheetId, req }) => {
  const body = (await req.json()) as
    | Split
    | { split: Split; tx?: Transaction; removeTxId?: string };
  const split: Split = 'split' in body ? body.split : body;
  const tx: Transaction | undefined = 'split' in body ? body.tx : undefined;
  const removeTxId: string | undefined = 'split' in body ? body.removeTxId : undefined;

  if (tx) {
    // Ledger row first (source of truth), then balances.
    await addTransaction(accessToken, spreadsheetId, tx);
    const accounts = await getAccounts(accessToken, spreadsheetId);
    const updated = applyTransactionToBalances(accounts, tx, 'apply');
    await persistChangedAccounts(accessToken, spreadsheetId, accounts, updated);
    invalidateMany(spreadsheetId, TX_CACHES);
  } else if (removeTxId) {
    const [transactions, accounts] = await Promise.all([
      getTransactions(accessToken, spreadsheetId),
      getAccounts(accessToken, spreadsheetId),
    ]);
    const target = transactions.find((t) => t.id === removeTxId);
    if (target) {
      const reversed = applyTransactionToBalances(accounts, target, 'reverse');
      await deleteTransaction(accessToken, spreadsheetId, target.id);
      await persistChangedAccounts(accessToken, spreadsheetId, accounts, reversed);
      invalidateMany(spreadsheetId, TX_CACHES);
    }
  }

  await upsertSplit(accessToken, spreadsheetId, split);
  invalidateMany(spreadsheetId, ['splits']);
  return NextResponse.json({ ok: true });
});

// Edit an existing split's metadata and, when the share amount/account changes,
// rebuild the fronted cash transfer: reverse the old one, apply the new one, and
// upsert the split — in a single in-memory balance pass. Paybacks (repaidAmount /
// repaymentTxIds) are untouched; only the fronted principal row is rebuilt. This
// mirrors the loans PUT so the two surfaces reconcile cash the same way.
export const PUT = withSession(async ({ accessToken, spreadsheetId, req }) => {
  const { updated, newTx, removeTxId }: { updated: Split; newTx?: Transaction; removeTxId?: string } =
    await req.json();

  if (removeTxId || newTx) {
    const [transactions, accounts] = await Promise.all([
      getTransactions(accessToken, spreadsheetId),
      getAccounts(accessToken, spreadsheetId),
    ]);
    let working: Account[] = accounts;

    // Retire the old fronted transfer first (reverse its balance, drop the row).
    if (removeTxId) {
      const old = transactions.find((t) => t.id === removeTxId);
      if (old) {
        working = applyTransactionToBalances(working, old, 'reverse');
        await deleteTransaction(accessToken, spreadsheetId, old.id);
      }
    }
    // Write the new fronted transfer and apply its balance.
    if (newTx) {
      await addTransaction(accessToken, spreadsheetId, newTx);
      working = applyTransactionToBalances(working, newTx, 'apply');
    }

    await persistChangedAccounts(accessToken, spreadsheetId, accounts, working);
    invalidateMany(spreadsheetId, TX_CACHES);
  }

  await upsertSplit(accessToken, spreadsheetId, updated);
  invalidateMany(spreadsheetId, ['splits']);
  return NextResponse.json({ ok: true });
});

export const DELETE = withSession(async ({ accessToken, spreadsheetId, req }) => {
  const { id } = await req.json();

  // A split owns the cash transfers it created (the fronted share + the settle
  // payback). Find them BEFORE deleting, then reverse each balance effect and
  // delete the row — atomically, server-side — so the linked account returns to
  // exactly where it was. Mirrors the loan-deletion model.
  const splits = await getSplits(accessToken, spreadsheetId);
  const split = splits.find((s) => s.id === id);

  await deleteSplit(accessToken, spreadsheetId, id);

  const txIds = split ? [split.frontedTxId, split.settleTxId, ...(split.repaymentTxIds ?? [])].filter(Boolean) as string[] : [];
  if (txIds.length) {
    const idSet = new Set(txIds);
    const [transactions, accounts] = await Promise.all([
      getTransactions(accessToken, spreadsheetId),
      getAccounts(accessToken, spreadsheetId),
    ]);
    let working: Account[] = accounts;
    for (const tx of transactions.filter((t) => idSet.has(t.id))) {
      working = applyTransactionToBalances(working, tx, 'reverse');
      await deleteTransaction(accessToken, spreadsheetId, tx.id);
    }
    await persistChangedAccounts(accessToken, spreadsheetId, accounts, working);
    invalidateMany(spreadsheetId, TX_CACHES);
  }

  invalidateMany(spreadsheetId, ['splits']);
  return NextResponse.json({ ok: true });
});
