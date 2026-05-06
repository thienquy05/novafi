import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getSettings, saveSettings } from '@/lib/sheets';
import type { TaxSettings } from '@/types';

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const settings = await getSettings(session.accessToken, session.spreadsheetId);
  return NextResponse.json(settings);
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body: TaxSettings = await req.json();
  await saveSettings(session.accessToken, session.spreadsheetId, body);
  return NextResponse.json({ ok: true });
}
