import { NextResponse } from 'next/server';
import { getTransactions, addTransaction, addTransactions, deleteTransaction, updateTransaction, getAccounts, persistChangedAccounts } from '@/lib/sheets';
import { invalidateMany, CACHE_TTL, TX_CACHES } from '@/lib/cache';
import { cachedGet, withSession } from '@/lib/apiRoute';
import { applyTransactionToBalances } from '@/lib/calculations';
import type { Account, Transaction } from '@/types';

export const GET = cachedGet({
  resource: 'transactions',
  ttl: CACHE_TTL.SHORT,
  fetch: ({ accessToken, spreadsheetId }) => getTransactions(accessToken, spreadsheetId),
});

// A split-group write: append `splits` (rows sharing a splitGroupId), optionally
// replacing a single source row (`replaceId`, e.g. splitting an existing expense)
// or an existing group (`replaceGroupId`, when editing a split).
type SplitPostBody = { splits: Transaction[]; replaceId?: string; replaceGroupId?: string };

function isSplitPost(b: unknown): b is SplitPostBody {
  return !!b && typeof b === 'object' && Array.isArray((b as SplitPostBody).splits);
}

export const POST = withSession(async ({ accessToken, spreadsheetId, req }) => {
  const body: Transaction | SplitPostBody = await req.json();

  if (isSplitPost(body)) {
    const { splits, replaceId, replaceGroupId } = body;
    const accounts = await getAccounts(accessToken, spreadsheetId);
    let working: Account[] = accounts;

    // Reverse + delete whatever the split replaces, so the account balance only
    // reflects the net change (sum of splits − original total).
    if (replaceId || replaceGroupId) {
      const existing = await getTransactions(accessToken, spreadsheetId);
      const removed = replaceGroupId
        ? existing.filter((t) => t.splitGroupId && t.splitGroupId === replaceGroupId)
        : existing.filter((t) => t.id === replaceId);
      for (const tx of removed) {
        await deleteTransaction(accessToken, spreadsheetId, tx.id);
        working = applyTransactionToBalances(working, tx, 'reverse');
      }
    }

    // Append the new rows in one call, then apply each to balances.
    await addTransactions(accessToken, spreadsheetId, splits);
    for (const s of splits) working = applyTransactionToBalances(working, s, 'apply');

    await persistChangedAccounts(accessToken, spreadsheetId, accounts, working);
    invalidateMany(spreadsheetId, TX_CACHES);
    return NextResponse.json({ ok: true, accounts: working });
  }

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
  const { id, groupId }: { id?: string; groupId?: string } = await req.json();

  const [transactions, accounts] = await Promise.all([
    getTransactions(accessToken, spreadsheetId),
    getAccounts(accessToken, spreadsheetId),
  ]);
  // Delete a whole split group (all rows sharing splitGroupId) or a single row.
  const targets = groupId
    ? transactions.filter((t) => t.splitGroupId && t.splitGroupId === groupId)
    : transactions.filter((t) => t.id === id);

  let nextAccounts = accounts;
  for (const tx of targets) {
    await deleteTransaction(accessToken, spreadsheetId, tx.id);
    nextAccounts = applyTransactionToBalances(nextAccounts, tx, 'reverse');
  }
  if (targets.length > 0) {
    await persistChangedAccounts(accessToken, spreadsheetId, accounts, nextAccounts);
  }

  invalidateMany(spreadsheetId, TX_CACHES);
  return NextResponse.json({ ok: true, accounts: nextAccounts });
});
