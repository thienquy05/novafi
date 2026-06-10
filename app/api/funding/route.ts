import { NextResponse } from 'next/server';
import {
  getFundings,
  upsertFunding,
  deleteFunding,
  getTransactions,
  addTransaction,
  deleteTransaction,
  getAccounts,
  persistChangedAccounts,
} from '@/lib/sheets';
import { invalidateMany, CACHE_TTL, TX_CACHES } from '@/lib/cache';
import { cachedGet, withSession } from '@/lib/apiRoute';
import { applyTransactionToBalances } from '@/lib/calculations';
import type { Account, Funding, Transaction } from '@/types';

export const GET = cachedGet({
  resource: 'funding',
  ttl: CACHE_TTL.SHORT,
  fetch: ({ accessToken, spreadsheetId }) => getFundings(accessToken, spreadsheetId),
});

// One write path for both "create pool" and "record spend": apply any cash rows
// (contributions in / spend out), reverse any removed rows, then upsert the pool.
// Bundling the cash with the pool keeps balances and the pool record in lockstep.
//   body = { funding, addTxs?: Transaction[], removeTxIds?: string[] }
export const POST = withSession(async ({ accessToken, spreadsheetId, req }) => {
  const { funding, addTxs, removeTxIds }: { funding: Funding; addTxs?: Transaction[]; removeTxIds?: string[] } =
    await req.json();

  let updatedAccounts: Account[] | null = null;
  if ((addTxs && addTxs.length) || (removeTxIds && removeTxIds.length)) {
    const [transactions, accounts] = await Promise.all([
      getTransactions(accessToken, spreadsheetId),
      getAccounts(accessToken, spreadsheetId),
    ]);
    let working: Account[] = accounts;

    for (const id of removeTxIds ?? []) {
      const old = transactions.find((t) => t.id === id);
      if (old) {
        working = applyTransactionToBalances(working, old, 'reverse');
        await deleteTransaction(accessToken, spreadsheetId, old.id);
      }
    }
    for (const tx of addTxs ?? []) {
      await addTransaction(accessToken, spreadsheetId, tx);
      working = applyTransactionToBalances(working, tx, 'apply');
    }

    await persistChangedAccounts(accessToken, spreadsheetId, accounts, working);
    invalidateMany(spreadsheetId, TX_CACHES);
    updatedAccounts = working;
  }

  await upsertFunding(accessToken, spreadsheetId, funding);
  invalidateMany(spreadsheetId, ['funding']);
  return NextResponse.json({ ok: true, accounts: updatedAccounts });
});

// Delete a pool and reverse every cash row it created (contribution + spends) so
// the holding account returns to exactly where it was. Mirrors loan/split deletes.
export const DELETE = withSession(async ({ accessToken, spreadsheetId, req }) => {
  const { id }: { id: string } = await req.json();

  const fundings = await getFundings(accessToken, spreadsheetId);
  const funding = fundings.find((f) => f.id === id);

  await deleteFunding(accessToken, spreadsheetId, id);

  const txIds = funding
    ? [funding.contributionTxId, ...(funding.spendTxIds ?? [])].filter(Boolean) as string[]
    : [];
  let updatedAccounts: Account[] | null = null;
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
    updatedAccounts = working;
  }

  invalidateMany(spreadsheetId, ['funding']);
  return NextResponse.json({ ok: true, accounts: updatedAccounts });
});
