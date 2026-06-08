import { NextResponse } from 'next/server';
import { getTransactions, addTransaction, deleteTransaction, updateTransaction, getAccounts, persistChangedAccounts } from '@/lib/sheets';
import { invalidateMany, CACHE_TTL, TX_CACHES } from '@/lib/cache';
import { cachedGet, withSession } from '@/lib/apiRoute';
import { applyTransactionToBalances } from '@/lib/calculations';
import type { Transaction } from '@/types';

export const GET = cachedGet({
  resource: 'transactions',
  ttl: CACHE_TTL.SHORT,
  fetch: ({ accessToken, spreadsheetId }) => getTransactions(accessToken, spreadsheetId),
});

export const POST = withSession(async ({ accessToken, spreadsheetId, req }) => {
  const body: Transaction = await req.json();

  // Write the ledger row first — it is the source of truth. If the balance
  // update below fails, the row is still recorded and the balance can be
  // corrected manually.
  await addTransaction(accessToken, spreadsheetId, body);

  const accounts = await getAccounts(accessToken, spreadsheetId);
  const updated = applyTransactionToBalances(accounts, body, 'apply');
  await persistChangedAccounts(accessToken, spreadsheetId, accounts, updated);

  invalidateMany(spreadsheetId, TX_CACHES);
  // Return the authoritative post-write accounts so the client can update
  // balances without a second round trip (it already holds the new tx row).
  return NextResponse.json({ ok: true, accounts: updated });
});

export const PUT = withSession(async ({ accessToken, spreadsheetId, req }) => {
  const { original, updated }: { original: Transaction; updated: Transaction } = await req.json();

  await updateTransaction(accessToken, spreadsheetId, updated);

  // Reverse the original effect, then apply the new one — single in-memory pass,
  // single source of truth for the balance math.
  const accounts = await getAccounts(accessToken, spreadsheetId);
  const reversed = applyTransactionToBalances(accounts, original, 'reverse');
  const reapplied = applyTransactionToBalances(reversed, updated, 'apply');
  await persistChangedAccounts(accessToken, spreadsheetId, accounts, reapplied);

  invalidateMany(spreadsheetId, TX_CACHES);
  return NextResponse.json({ ok: true, accounts: reapplied });
});

export const DELETE = withSession(async ({ accessToken, spreadsheetId, req }) => {
  const { id } = await req.json();

  const [transactions, accounts] = await Promise.all([
    getTransactions(accessToken, spreadsheetId),
    getAccounts(accessToken, spreadsheetId),
  ]);
  const tx = transactions.find((t) => t.id === id);

  await deleteTransaction(accessToken, spreadsheetId, id);

  let nextAccounts = accounts;
  if (tx) {
    nextAccounts = applyTransactionToBalances(accounts, tx, 'reverse');
    await persistChangedAccounts(accessToken, spreadsheetId, accounts, nextAccounts);
  }

  invalidateMany(spreadsheetId, TX_CACHES);
  return NextResponse.json({ ok: true, accounts: nextAccounts });
});
