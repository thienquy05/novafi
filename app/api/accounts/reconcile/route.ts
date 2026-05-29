import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getAccounts, getTransactions, upsertAccount } from '@/lib/sheets';
import { invalidateCache } from '@/lib/cache';
import { planReconcile } from '@/lib/calculations';

/**
 * Reconciles stored account balances against the transaction ledger.
 *
 * Two phases, both derived from the SAME pure `planReconcile`:
 *  1. Backfill `openingBalance` for accounts that predate opening-balance tracking
 *     (establishes a reconciliation basis; does NOT change displayed balances).
 *  2. Repair balances that drifted from the replayed ledger (e.g. after a failed
 *     write or a direct spreadsheet edit).
 *
 * Body `{ dryRun: true }` returns the plan WITHOUT writing anything — this powers
 * the "check balances" preview so the user sees before/after before confirming.
 * Transaction history is never modified; only account balances/opening balances.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const dryRun = await req.json().then((b) => b?.dryRun === true).catch(() => false);

  const [accounts, transactions] = await Promise.all([
    getAccounts(session.accessToken, session.spreadsheetId),
    getTransactions(session.accessToken, session.spreadsheetId),
  ]);

  const plan = planReconcile(accounts, transactions);

  if (dryRun) {
    return NextResponse.json({ ok: true, dryRun: true, ...plan });
  }

  // Apply: backfill opening balances and repair drifted balances.
  const repairIds = new Set(plan.toRepair.map((r) => r.accountId));
  const expectedById = new Map(plan.toRepair.map((r) => [r.accountId, r.expected]));
  const openingById = new Map(plan.toBackfill.map((b) => [b.accountId, b.openingBalance]));

  for (const account of accounts) {
    const touched = openingById.has(account.id) || repairIds.has(account.id);
    if (!touched) continue;
    await upsertAccount(session.accessToken, session.spreadsheetId, {
      ...account,
      openingBalance: openingById.get(account.id) ?? account.openingBalance,
      balance: repairIds.has(account.id) ? expectedById.get(account.id)! : account.balance,
    });
  }

  if (plan.toBackfill.length || plan.toRepair.length) {
    invalidateCache(`accounts:${session.spreadsheetId}`);
    invalidateCache(`dashboard:${session.spreadsheetId}`);
    invalidateCache(`badges:${session.spreadsheetId}`);
  }

  return NextResponse.json({
    ok: true,
    dryRun: false,
    backfilledCount: plan.toBackfill.length,
    repairedCount: plan.toRepair.length,
    repaired: plan.toRepair,
  });
}
