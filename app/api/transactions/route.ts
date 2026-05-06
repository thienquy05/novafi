import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getTransactions, addTransaction, deleteTransaction } from '@/lib/sheets';
import type { Transaction } from '@/types';

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const transactions = await getTransactions(session.accessToken, session.spreadsheetId);
  return NextResponse.json(transactions);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body: Transaction = await req.json();
  await addTransaction(session.accessToken, session.spreadsheetId, body);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await req.json();
  await deleteTransaction(session.accessToken, session.spreadsheetId, id);
  return NextResponse.json({ ok: true });
}
