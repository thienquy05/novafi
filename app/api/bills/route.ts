import { NextResponse } from 'next/server';
import { getBills, upsertBill, deleteBill } from '@/lib/sheets';
import { invalidateMany, CACHE_TTL, BILL_CACHES } from '@/lib/cache';
import { cachedGet, withSession } from '@/lib/apiRoute';
import type { Bill } from '@/types';

export const GET = cachedGet({
  resource: 'bills',
  ttl: CACHE_TTL.LONG,
  fetch: ({ accessToken, spreadsheetId }) => getBills(accessToken, spreadsheetId),
});

export const POST = withSession(async ({ accessToken, spreadsheetId, req }) => {
  const body: Bill = await req.json();
  await upsertBill(accessToken, spreadsheetId, body);
  invalidateMany(spreadsheetId, BILL_CACHES);
  return NextResponse.json({ ok: true });
});

export const DELETE = withSession(async ({ accessToken, spreadsheetId, req }) => {
  const { id } = await req.json();
  await deleteBill(accessToken, spreadsheetId, id);
  invalidateMany(spreadsheetId, BILL_CACHES);
  return NextResponse.json({ ok: true });
});
