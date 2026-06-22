import { NextResponse } from 'next/server';
import { getSubscriptions, upsertSubscription, deleteSubscription } from '@/lib/sheets';
import { invalidateMany, CACHE_TTL } from '@/lib/cache';
import { cachedGet, withSession } from '@/lib/apiRoute';
import type { TrackedSubscription } from '@/types';

const SUB_CACHES = ['subscriptions'] as const;

export const GET = cachedGet({
  resource: 'subscriptions',
  ttl: CACHE_TTL.LONG,
  fetch: ({ accessToken, spreadsheetId }) => getSubscriptions(accessToken, spreadsheetId),
});

export const POST = withSession(async ({ accessToken, spreadsheetId, req }) => {
  const body = (await req.json()) as TrackedSubscription;
  await upsertSubscription(accessToken, spreadsheetId, body);
  invalidateMany(spreadsheetId, SUB_CACHES);
  return NextResponse.json({ ok: true });
});

export const DELETE = withSession(async ({ accessToken, spreadsheetId, req }) => {
  const { id } = (await req.json()) as { id: string };
  await deleteSubscription(accessToken, spreadsheetId, id);
  invalidateMany(spreadsheetId, SUB_CACHES);
  return NextResponse.json({ ok: true });
});
