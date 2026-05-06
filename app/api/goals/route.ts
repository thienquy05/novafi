import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getGoals, upsertGoal, deleteGoal } from '@/lib/sheets';
import type { Goal } from '@/types';

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const goals = await getGoals(session.accessToken, session.spreadsheetId);
  return NextResponse.json(goals);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body: Goal = await req.json();
  await upsertGoal(session.accessToken, session.spreadsheetId, body);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await req.json();
  await deleteGoal(session.accessToken, session.spreadsheetId, id);
  return NextResponse.json({ ok: true });
}
