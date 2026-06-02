import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getSplits, upsertSplit, deleteSplit } from '@/lib/sheets';
import { getCache, setCache, invalidateCache, CACHE_TTL } from '@/lib/cache';
import type { Split } from '@/types';

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const key = `splits:${session.spreadsheetId}`;
  const cached = getCache<Split[]>(key);
  if (cached) return NextResponse.json(cached);

  const splits = await getSplits(session.accessToken, session.spreadsheetId);
  setCache(key, splits, CACHE_TTL.SHORT);
  return NextResponse.json(splits);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body: Split = await req.json();
  await upsertSplit(session.accessToken, session.spreadsheetId, body);
  invalidateCache(`splits:${session.spreadsheetId}`);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await req.json();
  await deleteSplit(session.accessToken, session.spreadsheetId, id);
  invalidateCache(`splits:${session.spreadsheetId}`);
  return NextResponse.json({ ok: true });
}
