import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getSettings, saveSettings } from '@/lib/db';
import type { TaxSettings } from '@/types';

export async function GET() {
  const session = await auth();
  if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const settings = await getSettings(session.userId);
  return NextResponse.json(settings);
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body: TaxSettings = await req.json();
  await saveSettings(session.userId, body);
  return NextResponse.json({ ok: true });
}
