import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getGoals, upsertGoal, deleteGoal, reorderGoals } from '@/lib/sheets';
import { getCache, setCache, invalidateCache } from '@/lib/cache';
import type { Goal } from '@/types';

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const key = `goals:${session.spreadsheetId}`;
  const cached = getCache<Goal[]>(key);
  if (cached) return NextResponse.json(cached);

  const goals = await getGoals(session.accessToken, session.spreadsheetId);
  setCache(key, goals, 60_000);
  return NextResponse.json(goals);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body: Goal = await req.json();
  await upsertGoal(session.accessToken, session.spreadsheetId, body);
  invalidateCache(`goals:${session.spreadsheetId}`);
  invalidateCache(`dashboard:${session.spreadsheetId}`);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await req.json();
  await deleteGoal(session.accessToken, session.spreadsheetId, id);
  invalidateCache(`goals:${session.spreadsheetId}`);
  invalidateCache(`dashboard:${session.spreadsheetId}`);
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const items: { id: string; position: number }[] = await req.json();
  await reorderGoals(session.accessToken, session.spreadsheetId, items);
  invalidateCache(`goals:${session.spreadsheetId}`);
  invalidateCache(`dashboard:${session.spreadsheetId}`);
  return NextResponse.json({ ok: true });
}
