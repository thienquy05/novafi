import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getBudgets, upsertBudget, deleteBudget, reorderBudgets } from '@/lib/sheets';
import { getCache, setCache, invalidateCache } from '@/lib/cache';
import type { Budget } from '@/types';

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const key = `budgets:${session.spreadsheetId}`;
  const cached = getCache<Budget[]>(key);
  if (cached) return NextResponse.json(cached);

  const budgets = await getBudgets(session.accessToken, session.spreadsheetId);
  setCache(key, budgets, 60_000);
  return NextResponse.json(budgets);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body: Budget = await req.json();
  await upsertBudget(session.accessToken, session.spreadsheetId, body);
  invalidateCache(`budgets:${session.spreadsheetId}`);
  invalidateCache(`dashboard:${session.spreadsheetId}`);
  invalidateCache(`badges:${session.spreadsheetId}`);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await req.json();
  await deleteBudget(session.accessToken, session.spreadsheetId, id);
  invalidateCache(`budgets:${session.spreadsheetId}`);
  invalidateCache(`dashboard:${session.spreadsheetId}`);
  invalidateCache(`badges:${session.spreadsheetId}`);
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const items: { id: string; position: number }[] = await req.json();
  await reorderBudgets(session.accessToken, session.spreadsheetId, items);
  invalidateCache(`budgets:${session.spreadsheetId}`);
  invalidateCache(`dashboard:${session.spreadsheetId}`);
  return NextResponse.json({ ok: true });
}
