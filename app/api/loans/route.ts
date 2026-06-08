import { NextResponse } from 'next/server';
import {
  getLoans,
  upsertLoan,
  deleteLoan,
  getTransactions,
  addTransaction,
  deleteTransaction,
  getAccounts,
  persistChangedAccounts,
} from '@/lib/sheets';
import { invalidateMany, CACHE_TTL, TX_CACHES } from '@/lib/cache';
import { cachedGet, withSession } from '@/lib/apiRoute';
import { applyTransactionToBalances } from '@/lib/calculations';
import type { Account, Loan, Transaction } from '@/types';

export const GET = cachedGet({
  resource: 'loans',
  ttl: CACHE_TTL.SHORT,
  fetch: ({ accessToken, spreadsheetId }) => getLoans(accessToken, spreadsheetId),
});

export const POST = withSession(async ({ accessToken, spreadsheetId, req }) => {
  // Accepts either a bare Loan or `{ loan, tx }`. When a cash transaction is
  // included (lending/repaying through an account), write it and apply its
  // balance effect in the SAME request as the loan upsert — so a loan that
  // claims to have moved cash always has the matching ledger row, and vice
  // versa. `tx` is omitted for note-only loans (no account selected).
  const body = (await req.json()) as Loan | { loan: Loan; tx?: Transaction };
  const loan: Loan = 'loan' in body ? body.loan : body;
  const tx: Transaction | undefined = 'loan' in body ? body.tx : undefined;

  if (tx) {
    // Write the ledger row first (source of truth), then update balances.
    await addTransaction(accessToken, spreadsheetId, tx);
    const accounts = await getAccounts(accessToken, spreadsheetId);
    const updated = applyTransactionToBalances(accounts, tx, 'apply');
    await persistChangedAccounts(accessToken, spreadsheetId, accounts, updated);
    invalidateMany(spreadsheetId, TX_CACHES);
  }

  await upsertLoan(accessToken, spreadsheetId, loan);
  invalidateMany(spreadsheetId, ['loans']);
  return NextResponse.json({ ok: true });
});

// Edits a loan, adjusting its principal cash movement in the SAME request so
// balances never desync. The client computes the new loan and (optionally) a
// freshly built principal transfer, and tells us which old principal transfer
// to retire. We reverse the old transfer, apply the new one, and upsert the
// loan in a single in-memory balance pass. Paybacks are untouched — only the
// principal cash row is rebuilt.
export const PUT = withSession(async ({ accessToken, spreadsheetId, req }) => {
  const { updated, newTx, removeTxId }: { updated: Loan; newTx?: Transaction; removeTxId?: string } =
    await req.json();

  if (removeTxId || newTx) {
    const [transactions, accounts] = await Promise.all([
      getTransactions(accessToken, spreadsheetId),
      getAccounts(accessToken, spreadsheetId),
    ]);
    let working: Account[] = accounts;

    // Retire the old principal transfer first (reverse its balance, drop the row).
    if (removeTxId) {
      const old = transactions.find((t) => t.id === removeTxId);
      if (old) {
        working = applyTransactionToBalances(working, old, 'reverse');
        await deleteTransaction(accessToken, spreadsheetId, old.id);
      }
    }
    // Write the new principal transfer and apply its balance.
    if (newTx) {
      await addTransaction(accessToken, spreadsheetId, newTx);
      working = applyTransactionToBalances(working, newTx, 'apply');
    }

    await persistChangedAccounts(accessToken, spreadsheetId, accounts, working);
    invalidateMany(spreadsheetId, TX_CACHES);
  }

  await upsertLoan(accessToken, spreadsheetId, updated);
  invalidateMany(spreadsheetId, ['loans']);
  return NextResponse.json({ ok: true });
});

export const DELETE = withSession(async ({ accessToken, spreadsheetId, req }) => {
  const { id } = await req.json();

  // A loan owns the cash-movement transfers it created (principal + each
  // payback). Find them BEFORE deleting the loan, then delete each one and
  // reverse its balance effect so the linked accounts return to where they were.
  // Doing this server-side in a single request makes it atomic — the old
  // client-side delete loop could leave orphan transfers (still distorting
  // balances) if the page closed mid-loop.
  const loans = await getLoans(accessToken, spreadsheetId);
  const loan = loans.find((l) => l.id === id);

  await deleteLoan(accessToken, spreadsheetId, id);

  const txIds = loan ? [loan.principalTxId, ...loan.repaymentTxIds].filter(Boolean) : [];
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

  invalidateMany(spreadsheetId, ['loans']);
  return NextResponse.json({ ok: true });
});
