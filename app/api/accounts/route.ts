import { NextResponse } from 'next/server';
import { getAccounts, upsertAccount, deleteAccount, getTransactions } from '@/lib/sheets';
import { invalidateMany, CACHE_TTL, ACCOUNT_CACHES } from '@/lib/cache';
import { cachedGet, withSession } from '@/lib/apiRoute';
import type { Account } from '@/types';

export const GET = cachedGet({
  resource: 'accounts',
  ttl: CACHE_TTL.SHORT,
  fetch: ({ accessToken, spreadsheetId }) => getAccounts(accessToken, spreadsheetId),
});

export const POST = withSession(async ({ accessToken, spreadsheetId, req }) => {
  const body: Account = await req.json();

  // Keep openingBalance self-maintaining regardless of what the client sends:
  // - new account (no transactions yet) → opening balance equals the starting balance
  // - editing an existing account → preserve the stored opening balance so the
  //   reconciliation basis isn't wiped by an edit that omits the field.
  let account = body;
  if (body.openingBalance == null) {
    const existing = (await getAccounts(accessToken, spreadsheetId)).find((a) => a.id === body.id);
    account = { ...body, openingBalance: existing?.openingBalance ?? body.balance };
  }

  await upsertAccount(accessToken, spreadsheetId, account);
  invalidateMany(spreadsheetId, ACCOUNT_CACHES);
  return NextResponse.json({ ok: true });
});

export const DELETE = withSession(async ({ accessToken, spreadsheetId, req }) => {
  const { id } = await req.json();

  // Block deletion while the account still has transactions referencing it
  // (as source `account` or transfer `toAccount`). Removing it anyway would
  // leave orphan ledger rows pointing at a non-existent account. The user must
  // reassign or delete those transactions (and any linked paycheck/loan) first.
  const transactions = await getTransactions(accessToken, spreadsheetId);
  const linkedCount = transactions.filter((t) => t.account === id || t.toAccount === id).length;
  if (linkedCount > 0) {
    return NextResponse.json(
      { error: 'account_has_transactions', count: linkedCount },
      { status: 409 },
    );
  }

  await deleteAccount(accessToken, spreadsheetId, id);
  invalidateMany(spreadsheetId, ACCOUNT_CACHES);
  return NextResponse.json({ ok: true });
});
