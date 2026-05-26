import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getPaychecks, addPaycheck, deletePaycheck } from '@/lib/db';
import { getCache, setCache, invalidateCache } from '@/lib/cache';
import type { PaycheckEntry } from '@/types';

export async function GET() {
  const session = await auth();
  if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const key = `paychecks:${session.userId}`;
  const cached = getCache<PaycheckEntry[]>(key);
  if (cached) return NextResponse.json(cached);

  const paychecks = await getPaychecks(session.userId);
  setCache(key, paychecks, 60_000);
  return NextResponse.json(paychecks);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body: PaycheckEntry = await req.json();
  await addPaycheck(session.userId, body);
  invalidateCache(`paychecks:${session.userId}`);
  invalidateCache(`accounts:${session.userId}`);
  invalidateCache(`dashboard:${session.userId}`);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await req.json();
  await deletePaycheck(session.userId, id);
  invalidateCache(`paychecks:${session.userId}`);
  invalidateCache(`dashboard:${session.userId}`);
  return NextResponse.json({ ok: true });
}
