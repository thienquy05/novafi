import { NextResponse } from 'next/server';
import { upsertBudgets } from '@/lib/sheets';
import { invalidateMany, BUDGET_CACHES } from '@/lib/cache';
import { withSession } from '@/lib/apiRoute';
import type { Budget } from '@/types';

/**
 * Write several budgets at once — the "Apply 50/30/20" generator proposes a whole
 * bucket of categories, and looping POST /api/budgets would cost 3 Sheets calls
 * per row and race on row indices (see upsertBudgets). Invalidates the same
 * BUDGET_CACHES set as the single-row POST, so the over-budget badge and the
 * dashboard recompute exactly as they already do.
 */
export const POST = withSession(async ({ accessToken, spreadsheetId, req }) => {
  const { budgets }: { budgets: Budget[] } = await req.json();
  if (!Array.isArray(budgets)) {
    return NextResponse.json({ error: 'budgets must be an array' }, { status: 400 });
  }
  await upsertBudgets(accessToken, spreadsheetId, budgets);
  invalidateMany(spreadsheetId, BUDGET_CACHES);
  return NextResponse.json({ ok: true });
});
