import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getAccounts, upsertAccount, deleteAccount } from '@/lib/sheets';
import { getCache, setCache, invalidateCache } from '@/lib/cache';
import type { Account } from '@/types';

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const key = `accounts:${session.spreadsheetId}`;
  const cached = getCache<Account[]>(key);
  if (cached) return NextResponse.json(cached);

  const accounts = await getAccounts(session.accessToken, session.spreadsheetId);
  setCache(key, accounts);
  return NextResponse.json(accounts);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body: Account = await req.json();
  await upsertAccount(session.accessToken, session.spreadsheetId, body);
  invalidateCache(`accounts:${session.spreadsheetId}`);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await req.json();
  await deleteAccount(session.accessToken, session.spreadsheetId, id);
  invalidateCache(`accounts:${session.spreadsheetId}`);
  return NextResponse.json({ ok: true });
}
