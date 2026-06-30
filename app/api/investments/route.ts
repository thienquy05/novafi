import { NextResponse } from 'next/server';
import {
  getHoldings, upsertHolding, deleteHolding,
  getAccounts, upsertAccount,
} from '@/lib/sheets';
import { invalidateMany, CACHE_TTL, INVESTMENT_CACHES } from '@/lib/cache';
import { cachedGet, withSession } from '@/lib/apiRoute';
import { accountInvestmentValue } from '@/lib/investments';
import { roundCents } from '@/lib/calculations';
import type { Holding } from '@/types';

export const GET = cachedGet({
  resource: 'holdings',
  ttl: CACHE_TTL.SHORT,
  fetch: ({ accessToken, spreadsheetId }) => getHoldings(accessToken, spreadsheetId),
});

/**
 * Keep an investment account's balance equal to the total market value of the
 * holdings it contains. Called after any holding mutation so net worth, the
 * dashboard, and reports (which all read account.balance) reflect the portfolio
 * with no extra client wiring. Only writes when the balance actually changed,
 * and never touches a non-investment account.
 */
async function syncAccountBalance(
  accessToken: string,
  spreadsheetId: string,
  accountId: string,
): Promise<void> {
  if (!accountId) return;
  const [accounts, holdings] = await Promise.all([
    getAccounts(accessToken, spreadsheetId),
    getHoldings(accessToken, spreadsheetId),
  ]);
  const account = accounts.find((a) => a.id === accountId);
  if (!account || account.type !== 'investment') return;
  const value = accountInvestmentValue(holdings, accountId);
  if (roundCents(account.balance) === value) return;
  await upsertAccount(accessToken, spreadsheetId, { ...account, balance: value });
}

export const POST = withSession(async ({ accessToken, spreadsheetId, req }) => {
  const body = (await req.json()) as Holding;
  await upsertHolding(accessToken, spreadsheetId, body);
  await syncAccountBalance(accessToken, spreadsheetId, body.accountId);
  invalidateMany(spreadsheetId, INVESTMENT_CACHES);
  return NextResponse.json({ ok: true });
});

export const DELETE = withSession(async ({ accessToken, spreadsheetId, req }) => {
  const { id, accountId } = (await req.json()) as { id: string; accountId?: string };
  await deleteHolding(accessToken, spreadsheetId, id);
  if (accountId) await syncAccountBalance(accessToken, spreadsheetId, accountId);
  invalidateMany(spreadsheetId, INVESTMENT_CACHES);
  return NextResponse.json({ ok: true });
});
