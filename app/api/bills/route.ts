import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getBills, upsertBill, deleteBill } from '@/lib/sheets';
import type { Bill } from '@/types';

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const bills = await getBills(session.accessToken, session.spreadsheetId);
  return NextResponse.json(bills);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body: Bill = await req.json();
  await upsertBill(session.accessToken, session.spreadsheetId, body);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await req.json();
  await deleteBill(session.accessToken, session.spreadsheetId, id);
  return NextResponse.json({ ok: true });
}
