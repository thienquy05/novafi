import { NextResponse } from 'next/server';
import { getAccounts, upsertAccount } from '@/lib/sheets';
import { invalidateMany, INVESTMENT_CACHES } from '@/lib/cache';
import { withSession } from '@/lib/apiRoute';
import { roundCents } from '@/lib/calculations';

/**
 * Investments are money flow, not brokerage lots (see lib/investments.ts).
 *
 * Contributions and withdrawals are ordinary `transfer` transactions booked
 * through /api/transactions — that path already debits the source account and
 * keeps every balance correct, so it isn't duplicated here.
 *
 * This route does the one thing transfers can't: set an investment account's
 * CURRENT VALUE (its balance) directly, so the portfolio can reflect market
 * movement. Cost basis is derived from the transfers, so it isn't touched here —
 * only the current value moves, which is exactly what makes gain = value −
 * invested.
 */
export const POST = withSession(async ({ accessToken, spreadsheetId, req }) => {
  const { accountId, value } = (await req.json()) as { accountId: string; value: number };

  const accounts = await getAccounts(accessToken, spreadsheetId);
  const account = accounts.find((a) => a.id === accountId);
  if (!account || account.type !== 'investment') {
    return NextResponse.json({ error: 'not_investment_account' }, { status: 400 });
  }

  const next = roundCents(Number(value) || 0);
  // Only write (and bust caches) when the value actually changed.
  if (roundCents(account.balance) !== next) {
    await upsertAccount(accessToken, spreadsheetId, { ...account, balance: next });
    invalidateMany(spreadsheetId, INVESTMENT_CACHES);
  }

  return NextResponse.json({ ok: true });
});
