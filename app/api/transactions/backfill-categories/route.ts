import { NextResponse } from 'next/server';
import {
  getLoans,
  getSplits,
  getTransactions,
  setTransactionCategories,
} from '@/lib/sheets';
import { invalidateMany } from '@/lib/cache';
import { withSession } from '@/lib/apiRoute';

// One-shot migration: retag the cash-movement transfers that belong to loans and
// splits with their dedicated 'Loan'/'Split' category (new transfers already get
// it at creation). Idempotent — only rows whose category differs are written, so
// re-running is a no-op. Triggered once per browser from the transactions page.
export const POST = withSession(async ({ accessToken, spreadsheetId }) => {
  const [loans, splits, transactions] = await Promise.all([
    getLoans(accessToken, spreadsheetId),
    getSplits(accessToken, spreadsheetId),
    getTransactions(accessToken, spreadsheetId),
  ]);

  // Map each loan/split-owned transfer id to its target category.
  const target = new Map<string, string>();
  for (const l of loans) {
    if (l.principalTxId) target.set(l.principalTxId, 'Loan');
    for (const id of l.repaymentTxIds ?? []) if (id) target.set(id, 'Loan');
  }
  for (const s of splits) {
    if (s.frontedTxId) target.set(s.frontedTxId, 'Split');
    if (s.settleTxId) target.set(s.settleTxId, 'Split');
  }

  // Only rows that exist and aren't already correctly tagged.
  const updates = transactions
    .filter((t) => target.has(t.id) && t.category !== target.get(t.id))
    .map((t) => ({ id: t.id, category: target.get(t.id)! }));

  const updated = await setTransactionCategories(accessToken, spreadsheetId, updates);

  if (updated > 0) {
    invalidateMany(spreadsheetId, ['transactions', 'dashboard']);
  }

  return NextResponse.json({ ok: true, updated });
});
