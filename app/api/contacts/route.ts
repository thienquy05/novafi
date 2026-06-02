import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getContacts, upsertContact, deleteContact } from '@/lib/sheets';
import { getCache, setCache, invalidateCache, CACHE_TTL } from '@/lib/cache';
import type { Contact } from '@/types';

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const key = `contacts:${session.spreadsheetId}`;
  const cached = getCache<Contact[]>(key);
  if (cached) return NextResponse.json(cached);

  const contacts = await getContacts(session.accessToken, session.spreadsheetId);
  setCache(key, contacts, CACHE_TTL.LONG);
  return NextResponse.json(contacts);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body: Contact = await req.json();
  await upsertContact(session.accessToken, session.spreadsheetId, body);
  invalidateCache(`contacts:${session.spreadsheetId}`);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await req.json();
  await deleteContact(session.accessToken, session.spreadsheetId, id);
  invalidateCache(`contacts:${session.spreadsheetId}`);
  return NextResponse.json({ ok: true });
}
