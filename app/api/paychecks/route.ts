import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getPaychecks, addPaycheck, deletePaycheck } from '@/lib/sheets';
import { getCache, setCache, invalidateCache } from '@/lib/cache';
import type { PaycheckEntry } from '@/types';

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const key = `paychecks:${session.spreadsheetId}`;
  const cached = getCache<PaycheckEntry[]>(key);
  if (cached) return NextResponse.json(cached);

  const paychecks = await getPaychecks(session.accessToken, session.spreadsheetId);
  setCache(key, paychecks);
  return NextResponse.json(paychecks);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body: PaycheckEntry = await req.json();
  await addPaycheck(session.accessToken, session.spreadsheetId, body);
  invalidateCache(`paychecks:${session.spreadsheetId}`);
  invalidateCache(`accounts:${session.spreadsheetId}`);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await req.json();
  await deletePaycheck(session.accessToken, session.spreadsheetId, id);
  invalidateCache(`paychecks:${session.spreadsheetId}`);
  return NextResponse.json({ ok: true });
}
