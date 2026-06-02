import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getLoans, upsertLoan, deleteLoan } from '@/lib/sheets';
import { getCache, setCache, invalidateCache, CACHE_TTL } from '@/lib/cache';
import type { Loan } from '@/types';

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const key = `loans:${session.spreadsheetId}`;
  const cached = getCache<Loan[]>(key);
  if (cached) return NextResponse.json(cached);

  const loans = await getLoans(session.accessToken, session.spreadsheetId);
  setCache(key, loans, CACHE_TTL.SHORT);
  return NextResponse.json(loans);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body: Loan = await req.json();
  await upsertLoan(session.accessToken, session.spreadsheetId, body);
  invalidateCache(`loans:${session.spreadsheetId}`);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await req.json();
  await deleteLoan(session.accessToken, session.spreadsheetId, id);
  invalidateCache(`loans:${session.spreadsheetId}`);
  return NextResponse.json({ ok: true });
}
