import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getAccounts, upsertAccount, deleteAccount } from '@/lib/db';
import { getCache, setCache, invalidateCache } from '@/lib/cache';
import type { Account } from '@/types';

export async function GET() {
  const session = await auth();
  if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const key = `accounts:${session.userId}`;
  const cached = getCache<Account[]>(key);
  if (cached) return NextResponse.json(cached);

  const accounts = await getAccounts(session.userId);
  setCache(key, accounts, 60_000);
  return NextResponse.json(accounts);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body: Account = await req.json();
  await upsertAccount(session.userId, body);
  invalidateCache(`accounts:${session.userId}`);
  invalidateCache(`dashboard:${session.userId}`);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await req.json();
  await deleteAccount(session.userId, id);
  invalidateCache(`accounts:${session.userId}`);
  invalidateCache(`dashboard:${session.userId}`);
  return NextResponse.json({ ok: true });
}
