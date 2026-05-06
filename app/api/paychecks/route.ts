import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getPaychecks, addPaycheck, deletePaycheck } from '@/lib/sheets';
import type { PaycheckEntry } from '@/types';

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const paychecks = await getPaychecks(session.accessToken, session.spreadsheetId);
  return NextResponse.json(paychecks);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body: PaycheckEntry = await req.json();
  await addPaycheck(session.accessToken, session.spreadsheetId, body);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await req.json();
  await deletePaycheck(session.accessToken, session.spreadsheetId, id);
  return NextResponse.json({ ok: true });
}
