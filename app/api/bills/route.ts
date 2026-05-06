import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getBills, upsertBill, deleteBill } from '@/lib/sheets';
import { getCache, setCache, invalidateCache } from '@/lib/cache';
import type { Bill } from '@/types';

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const key = `bills:${session.spreadsheetId}`;
  const cached = getCache<Bill[]>(key);
  if (cached) return NextResponse.json(cached);

  const bills = await getBills(session.accessToken, session.spreadsheetId);
  setCache(key, bills);
  return NextResponse.json(bills);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body: Bill = await req.json();
  await upsertBill(session.accessToken, session.spreadsheetId, body);
  invalidateCache(`bills:${session.spreadsheetId}`);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await req.json();
  await deleteBill(session.accessToken, session.spreadsheetId, id);
  invalidateCache(`bills:${session.spreadsheetId}`);
  return NextResponse.json({ ok: true });
}
