import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getAccounts, upsertAccount, deleteAccount } from '@/lib/sheets';
import { getCache, setCache, invalidateCache, CACHE_TTL } from '@/lib/cache';
import type { Account } from '@/types';

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const key = `accounts:${session.spreadsheetId}`;
  const cached = getCache<Account[]>(key);
  if (cached) return NextResponse.json(cached);

  const accounts = await getAccounts(session.accessToken, session.spreadsheetId);
  setCache(key, accounts, CACHE_TTL.SHORT);
  return NextResponse.json(accounts);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body: Account = await req.json();

  // Keep openingBalance self-maintaining regardless of what the client sends:
  // - new account (no transactions yet) → opening balance equals the starting balance
  // - editing an existing account → preserve the stored opening balance so the
  //   reconciliation basis isn't wiped by an edit that omits the field.
  let account = body;
  if (body.openingBalance == null) {
    const existing = (await getAccounts(session.accessToken, session.spreadsheetId))
      .find((a) => a.id === body.id);
    account = { ...body, openingBalance: existing?.openingBalance ?? body.balance };
  }

  await upsertAccount(session.accessToken, session.spreadsheetId, account);
  invalidateCache(`accounts:${session.spreadsheetId}`);
  invalidateCache(`dashboard:${session.spreadsheetId}`);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await req.json();
  await deleteAccount(session.accessToken, session.spreadsheetId, id);
  invalidateCache(`accounts:${session.spreadsheetId}`);
  invalidateCache(`dashboard:${session.spreadsheetId}`);
  return NextResponse.json({ ok: true });
}
