import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getBudgets, upsertBudget, deleteBudget, reorderBudgets } from '@/lib/db';
import { getCache, setCache, invalidateCache } from '@/lib/cache';
import type { Budget } from '@/types';

export async function GET() {
  const session = await auth();
  if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const key = `budgets:${session.userId}`;
  const cached = getCache<Budget[]>(key);
  if (cached) return NextResponse.json(cached);

  const budgets = await getBudgets(session.userId);
  setCache(key, budgets, 60_000);
  return NextResponse.json(budgets);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body: Budget = await req.json();
  await upsertBudget(session.userId, body);
  invalidateCache(`budgets:${session.userId}`);
  invalidateCache(`dashboard:${session.userId}`);
  invalidateCache(`badges:${session.userId}`);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await req.json();
  await deleteBudget(session.userId, id);
  invalidateCache(`budgets:${session.userId}`);
  invalidateCache(`dashboard:${session.userId}`);
  invalidateCache(`badges:${session.userId}`);
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const items: { id: string; position: number }[] = await req.json();
  await reorderBudgets(session.userId, items);
  invalidateCache(`budgets:${session.userId}`);
  invalidateCache(`dashboard:${session.userId}`);
  return NextResponse.json({ ok: true });
}
