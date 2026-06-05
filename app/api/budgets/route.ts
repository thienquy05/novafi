import { NextResponse } from 'next/server';
import { getBudgets, upsertBudget, deleteBudget, reorderBudgets } from '@/lib/sheets';
import { invalidateMany, CACHE_TTL, BUDGET_CACHES } from '@/lib/cache';
import { cachedGet, withSession } from '@/lib/apiRoute';
import type { Budget } from '@/types';

export const GET = cachedGet({
  resource: 'budgets',
  ttl: CACHE_TTL.LONG,
  fetch: ({ accessToken, spreadsheetId }) => getBudgets(accessToken, spreadsheetId),
});

export const POST = withSession(async ({ accessToken, spreadsheetId, req }) => {
  const body: Budget = await req.json();
  await upsertBudget(accessToken, spreadsheetId, body);
  invalidateMany(spreadsheetId, BUDGET_CACHES);
  return NextResponse.json({ ok: true });
});

export const DELETE = withSession(async ({ accessToken, spreadsheetId, req }) => {
  const { id } = await req.json();
  await deleteBudget(accessToken, spreadsheetId, id);
  invalidateMany(spreadsheetId, BUDGET_CACHES);
  return NextResponse.json({ ok: true });
});

export const PATCH = withSession(async ({ accessToken, spreadsheetId, req }) => {
  const items: { id: string; position: number }[] = await req.json();
  await reorderBudgets(accessToken, spreadsheetId, items);
  // Reorder doesn't change amounts → no badge recompute needed (matches prior behavior).
  invalidateMany(spreadsheetId, ['budgets', 'dashboard']);
  return NextResponse.json({ ok: true });
});
