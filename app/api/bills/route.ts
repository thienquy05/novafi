import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getBills, upsertBill, deleteBill } from '@/lib/db';
import { getCache, setCache, invalidateCache } from '@/lib/cache';
import type { Bill } from '@/types';

export async function GET() {
  const session = await auth();
  if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const key = `bills:${session.userId}`;
  const cached = getCache<Bill[]>(key);
  if (cached) return NextResponse.json(cached);

  const bills = await getBills(session.userId);
  setCache(key, bills, 60_000);
  return NextResponse.json(bills);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body: Bill = await req.json();
  await upsertBill(session.userId, body);
  invalidateCache(`bills:${session.userId}`);
  invalidateCache(`dashboard:${session.userId}`);
  invalidateCache(`badges:${session.userId}`);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await req.json();
  await deleteBill(session.userId, id);
  invalidateCache(`bills:${session.userId}`);
  invalidateCache(`dashboard:${session.userId}`);
  invalidateCache(`badges:${session.userId}`);
  return NextResponse.json({ ok: true });
}
