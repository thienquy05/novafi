import { NextResponse } from 'next/server';
import {
  getPaychecks,
  addPaycheck,
  deletePaycheck,
  getTransactions,
  deleteTransaction,
  getAccounts,
  persistChangedAccounts,
} from '@/lib/sheets';
import { invalidateMany, CACHE_TTL } from '@/lib/cache';
import { cachedGet, withSession } from '@/lib/apiRoute';
import { applyTransactionToBalances } from '@/lib/calculations';
import type { PaycheckEntry } from '@/types';

export const GET = cachedGet({
  resource: 'paychecks',
  ttl: CACHE_TTL.LONG,
  fetch: ({ accessToken, spreadsheetId }) => getPaychecks(accessToken, spreadsheetId),
});

export const POST = withSession(async ({ accessToken, spreadsheetId, req }) => {
  const body: PaycheckEntry = await req.json();
  await addPaycheck(accessToken, spreadsheetId, body);
  invalidateMany(spreadsheetId, ['paychecks', 'accounts', 'dashboard']);
  return NextResponse.json({ ok: true });
});

export const DELETE = withSession(async ({ accessToken, spreadsheetId, req }) => {
  const { id } = await req.json();

  await deletePaycheck(accessToken, spreadsheetId, id);

  // A paycheck owns its deposit transaction (same id). Deleting the paycheck must
  // also remove that ledger row and reverse its balance effect — otherwise the
  // deposit lingers and the account balance stays inflated. Mirrors DELETE in the
  // transactions route. No-ops cleanly for paychecks logged without a deposit
  // account (no matching transaction) and for legacy entries whose unrelated
  // random-id transaction can't be linked.
  const [transactions, accounts] = await Promise.all([
    getTransactions(accessToken, spreadsheetId),
    getAccounts(accessToken, spreadsheetId),
  ]);
  const tx = transactions.find((t) => t.id === id);
  if (tx) {
    await deleteTransaction(accessToken, spreadsheetId, id);
    const updated = applyTransactionToBalances(accounts, tx, 'reverse');
    await persistChangedAccounts(accessToken, spreadsheetId, accounts, updated);
    invalidateMany(spreadsheetId, ['transactions', 'badges']);
  }

  invalidateMany(spreadsheetId, ['paychecks', 'accounts', 'dashboard']);
  return NextResponse.json({ ok: true });
});
