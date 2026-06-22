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
  deleteAccount,
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
// `addAccount` creates the dedicated holding account for a REAL pool atomically, so
// the contribution rows below have somewhere to land. `removeAccountId` drops an
// account once it's been emptied — used when migrating a legacy real pool off its
// auto-created `pool` account (its rows are re-pointed via addTxs/removeTxIds first).
//   body = { funding, addTxs?, removeTxIds?, addAccount?, removeAccountId? }
export const POST = withSession(async ({ accessToken, spreadsheetId, req }) => {
  const { funding, addTxs, removeTxIds, addAccount, removeAccountId }: {
    funding: Funding; addTxs?: Transaction[]; removeTxIds?: string[]; addAccount?: Account; removeAccountId?: string;
  } = await req.json();

  let updatedAccounts: Account[] | null = null;
  if ((addTxs && addTxs.length) || (removeTxIds && removeTxIds.length) || addAccount || removeAccountId) {
    const [transactions, accounts] = await Promise.all([
      getTransactions(accessToken, spreadsheetId),
      getAccounts(accessToken, spreadsheetId),
    ]);
    // The new pool account is appended so existing indexes stay aligned for
    // persistChangedAccounts (which diffs by index); it then gets written as a new row.
    let working: Account[] =
      addAccount && !accounts.some((a) => a.id === addAccount.id) ? [...accounts, addAccount] : accounts;

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
    // Drop the emptied account last (after its zeroed balance is persisted), keeping
    // the index alignment persistChangedAccounts relies on intact until then.
    if (removeAccountId && working.some((a) => a.id === removeAccountId)) {
      await deleteAccount(accessToken, spreadsheetId, removeAccountId);
      working = working.filter((a) => a.id !== removeAccountId);
    }
    updatedAccounts = working;
  }

  await upsertFunding(accessToken, spreadsheetId, funding);
  invalidateMany(spreadsheetId, ['funding']);
  return NextResponse.json({ ok: true, accounts: updatedAccounts });
});

// Delete a pool and reverse every cash row it created (contribution + spends +
// repayments) so all touched accounts return exactly where they were. Mirrors
// loan/split deletes.
export const DELETE = withSession(async ({ accessToken, spreadsheetId, req }) => {
  const { id }: { id: string } = await req.json();

  const fundings = await getFundings(accessToken, spreadsheetId);
  const funding = fundings.find((f) => f.id === id);

  await deleteFunding(accessToken, spreadsheetId, id);

  const txIds = funding
    ? [
        funding.contributionTxId,
        ...(funding.spendTxIds ?? []),
        ...(funding.repayments ?? []).map((r) => r.id),
        ...(funding.contributions ?? []).map((c) => c.id),
      ].filter(Boolean) as string[]
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
    // Only drop the pool account if it's a legacy auto-created `pool`-type account.
    // Real deposit accounts (checking/savings/cash) chosen by the user must never
    // be deleted when a pool is removed — the account belongs to the user, not the pool.
    const legacyPoolAcct = working.find((a) => a.id === funding?.poolAccountId && a.type === 'pool');
    if (legacyPoolAcct) {
      await deleteAccount(accessToken, spreadsheetId, legacyPoolAcct.id);
      working = working.filter((a) => a.id !== legacyPoolAcct.id);
    }
    updatedAccounts = working;
  } else if (funding?.poolAccountId) {
    // No cash rows to reverse — still drop the empty legacy pool account if applicable.
    const accounts = await getAccounts(accessToken, spreadsheetId);
    const legacyPoolAcct = accounts.find((a) => a.id === funding.poolAccountId && a.type === 'pool');
    if (legacyPoolAcct) {
      await deleteAccount(accessToken, spreadsheetId, legacyPoolAcct.id);
      updatedAccounts = accounts.filter((a) => a.id !== legacyPoolAcct.id);
    } else {
      updatedAccounts = accounts;
    }
  }

  invalidateMany(spreadsheetId, ['funding']);
  return NextResponse.json({ ok: true, accounts: updatedAccounts });
});
