import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getNetWorthHistory, appendNetWorthSnapshot } from '@/lib/sheets';
import type { NetWorthSnapshot } from '@/types';

export async function GET() {
  try {
    const session = await auth();
    if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const history = await getNetWorthHistory(session.accessToken, session.spreadsheetId);
    return NextResponse.json(history);
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body: NetWorthSnapshot = await req.json();
    if (!body.id || !body.date || !body.month || typeof body.netWorth !== 'number') {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }
    await appendNetWorthSnapshot(session.accessToken, session.spreadsheetId, body);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
