import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getGoals, upsertGoal, deleteGoal, reorderGoals } from '@/lib/db';
import { getCache, setCache, invalidateCache } from '@/lib/cache';
import type { Goal } from '@/types';

export async function GET() {
  const session = await auth();
  if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const key = `goals:${session.userId}`;
  const cached = getCache<Goal[]>(key);
  if (cached) return NextResponse.json(cached);

  const goals = await getGoals(session.userId);
  setCache(key, goals, 60_000);
  return NextResponse.json(goals);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body: Goal = await req.json();
  await upsertGoal(session.userId, body);
  invalidateCache(`goals:${session.userId}`);
  invalidateCache(`dashboard:${session.userId}`);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await req.json();
  await deleteGoal(session.userId, id);
  invalidateCache(`goals:${session.userId}`);
  invalidateCache(`dashboard:${session.userId}`);
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const items: { id: string; position: number }[] = await req.json();
  await reorderGoals(session.userId, items);
  invalidateCache(`goals:${session.userId}`);
  invalidateCache(`dashboard:${session.userId}`);
  return NextResponse.json({ ok: true });
}
