import { NextResponse } from 'next/server';
import { getContacts, upsertContact, deleteContact } from '@/lib/sheets';
import { invalidateMany, CACHE_TTL } from '@/lib/cache';
import { cachedGet, withSession } from '@/lib/apiRoute';
import type { Contact } from '@/types';

export const GET = cachedGet({
  resource: 'contacts',
  ttl: CACHE_TTL.LONG,
  fetch: ({ accessToken, spreadsheetId }) => getContacts(accessToken, spreadsheetId),
});

export const POST = withSession(async ({ accessToken, spreadsheetId, req }) => {
  const body: Contact = await req.json();
  await upsertContact(accessToken, spreadsheetId, body);
  invalidateMany(spreadsheetId, ['contacts']);
  return NextResponse.json({ ok: true });
});

export const DELETE = withSession(async ({ accessToken, spreadsheetId, req }) => {
  const { id } = await req.json();
  await deleteContact(accessToken, spreadsheetId, id);
  invalidateMany(spreadsheetId, ['contacts']);
  return NextResponse.json({ ok: true });
});
