import { NextResponse } from 'next/server';
import { getGoals, upsertGoal, deleteGoal, reorderGoals } from '@/lib/sheets';
import { invalidateMany, CACHE_TTL, GOAL_CACHES } from '@/lib/cache';
import { cachedGet, withSession } from '@/lib/apiRoute';
import type { Goal } from '@/types';

export const GET = cachedGet({
  resource: 'goals',
  ttl: CACHE_TTL.LONG,
  fetch: ({ accessToken, spreadsheetId }) => getGoals(accessToken, spreadsheetId),
});

export const POST = withSession(async ({ accessToken, spreadsheetId, req }) => {
  const body: Goal = await req.json();
  await upsertGoal(accessToken, spreadsheetId, body);
  invalidateMany(spreadsheetId, GOAL_CACHES);
  return NextResponse.json({ ok: true });
});

export const DELETE = withSession(async ({ accessToken, spreadsheetId, req }) => {
  const { id } = await req.json();
  await deleteGoal(accessToken, spreadsheetId, id);
  invalidateMany(spreadsheetId, GOAL_CACHES);
  return NextResponse.json({ ok: true });
});

export const PATCH = withSession(async ({ accessToken, spreadsheetId, req }) => {
  const items: { id: string; position: number }[] = await req.json();
  await reorderGoals(accessToken, spreadsheetId, items);
  invalidateMany(spreadsheetId, GOAL_CACHES);
  return NextResponse.json({ ok: true });
});
