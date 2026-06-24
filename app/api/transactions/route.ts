import { NextResponse } from 'next/server';
import { getTransactions, addTransaction, addTransactions, deleteTransaction, updateTransaction, getAccounts, persistChangedAccounts, getFundings, upsertFunding, getLoans, upsertLoan, getSplits, upsertSplit } from '@/lib/sheets';
import { invalidateMany, cachedOrFetch, CACHE_TTL, TX_CACHES } from '@/lib/cache';
import { withSession } from '@/lib/apiRoute';
import { applyTransactionToBalances } from '@/lib/calculations';
import { syncFundingTxAmount, syncFundingTxRemoval } from '@/lib/funding';
import { syncLoanTxAmount, syncLoanTxRemoval } from '@/lib/loans';
import { syncSplitTxAmount, syncSplitTxRemoval } from '@/lib/splits';
import type { Account, Transaction } from '@/types';

// GET /api/transactions            → the whole ledger (default).
// GET /api/transactions?ids=a,b,c  → only those rows.
//
// The `ids` filter lets feature pages (Funding, …) resolve just the handful of
// ledger rows their records reference — spend/contribution transactions — without
// pulling the entire sheet over the wire. Filtering runs off the SAME cached
// full list under the `transactions:<sheet>` key, so it adds no Sheets quota and
// stays consistent with the cache invalidation the mutating handlers already do.
export const GET = withSession(async ({ accessToken, spreadsheetId, req }) => {
  const all = await cachedOrFetch(
    `transactions:${spreadsheetId}`,
    CACHE_TTL.SHORT,
    () => getTransactions(accessToken, spreadsheetId),
  );
  const idsParam = new URL(req.url).searchParams.get('ids');
  if (idsParam === null) return NextResponse.json(all);
  const wanted = new Set(idsParam.split(',').map((s) => s.trim()).filter(Boolean));
  return NextResponse.json(wanted.size === 0 ? [] : all.filter((t) => wanted.has(t.id)));
});

type TxEdit = { original: Transaction; updated: Transaction };

// Fold the sync helpers over every record of one kind, persisting each record
// a linked mutation actually changed. Returns whether anything was written.
async function reconcileRecords<T>(
  records: T[],
  edits: TxEdit[],
  removals: Transaction[],
  syncAmount: (record: T, original: Transaction, updated: Transaction) => T | null,
  syncRemoval: (record: T, tx: Transaction) => T | null,
  persist: (record: T) => Promise<void>,
): Promise<boolean> {
  let changedAny = false;
  for (const record of records) {
    let current = record;
    let changed = false;
    for (const { original, updated } of edits) {
      const next = syncAmount(current, original, updated);
      if (next) { current = next; changed = true; }
    }
    for (const tx of removals) {
      const next = syncRemoval(current, tx);
      if (next) { current = next; changed = true; }
    }
    if (changed) {
      await persist(current);
      changedAny = true;
    }
  }
  return changedAny;
}

// Funding pools, loans, and splits cache numbers (spent/contributed, principal/
// repaid, share/repaid + settled) derived from cash rows they created. Editing
// or deleting such a row HERE — the generic ledger route, which those features'
// own APIs do not go through — must reconcile the owning record, or its page
// would keep showing stale figures. Owned cash rows always carry their
// feature's category ('Funding' / 'Loan' / 'Split'), so anything else skips the
// extra Sheets reads. (A split's `myShareTxId` row is a normal user-categorized
// expense and is not caught here; the transactions UI locks it instead, and
// group-edit tolerates a missing row.)
async function reconcileLinkedRecords(
  accessToken: string,
  spreadsheetId: string,
  edits: TxEdit[],
  removals: Transaction[],
): Promise<void> {
  const categories = new Set(
    [...edits.flatMap((e) => [e.original, e.updated]), ...removals].map((t) => t.category),
  );
  const stale: string[] = [];

  if (categories.has('Funding')) {
    const fundings = await getFundings(accessToken, spreadsheetId);
    if (await reconcileRecords(fundings, edits, removals, syncFundingTxAmount, syncFundingTxRemoval,
      (f) => upsertFunding(accessToken, spreadsheetId, f))) stale.push('funding');
  }
  if (categories.has('Loan')) {
    const loans = await getLoans(accessToken, spreadsheetId);
    if (await reconcileRecords(loans, edits, removals, syncLoanTxAmount, syncLoanTxRemoval,
      (l) => upsertLoan(accessToken, spreadsheetId, l))) stale.push('loans');
  }
  if (categories.has('Split')) {
    const splits = await getSplits(accessToken, spreadsheetId);
    if (await reconcileRecords(splits, edits, removals, syncSplitTxAmount, syncSplitTxRemoval,
      (s) => upsertSplit(accessToken, spreadsheetId, s))) stale.push('splits');
  }

  if (stale.length) invalidateMany(spreadsheetId, stale);
}

// A split-group write: append `splits` (rows sharing a splitGroupId), optionally
// replacing a single source row (`replaceId`, e.g. splitting an existing expense)
// or an existing group (`replaceGroupId`, when editing a split).
type SplitPostBody = { splits: Transaction[]; replaceId?: string; replaceGroupId?: string };

function isSplitPost(b: unknown): b is SplitPostBody {
  return !!b && typeof b === 'object' && Array.isArray((b as SplitPostBody).splits);
}

export const POST = withSession(async ({ accessToken, spreadsheetId, req }) => {
  const body: Transaction | SplitPostBody = await req.json();

  if (isSplitPost(body)) {
    const { splits, replaceId, replaceGroupId } = body;
    const accounts = await getAccounts(accessToken, spreadsheetId);
    let working: Account[] = accounts;

    // Reverse + delete whatever the split replaces, so the account balance only
    // reflects the net change (sum of splits − original total).
    if (replaceId || replaceGroupId) {
      const existing = await getTransactions(accessToken, spreadsheetId);
      const removed = replaceGroupId
        ? existing.filter((t) => t.splitGroupId && t.splitGroupId === replaceGroupId)
        : existing.filter((t) => t.id === replaceId);
      for (const tx of removed) {
        await deleteTransaction(accessToken, spreadsheetId, tx.id);
        working = applyTransactionToBalances(working, tx, 'reverse');
      }
      // Splitting an owned row replaces it with NEW (unlinked) rows, so for the
      // owning funding/loan/split record it is a removal.
      await reconcileLinkedRecords(accessToken, spreadsheetId, [], removed);
    }

    // Append the new rows in one call, then apply each to balances.
    await addTransactions(accessToken, spreadsheetId, splits);
    for (const s of splits) working = applyTransactionToBalances(working, s, 'apply');

    await persistChangedAccounts(accessToken, spreadsheetId, accounts, working);
    invalidateMany(spreadsheetId, TX_CACHES);
    return NextResponse.json({ ok: true, accounts: working });
  }

  // Write the ledger row first — it is the source of truth. If the balance
  // update below fails, the row is still recorded and the balance can be
  // corrected manually.
  await addTransaction(accessToken, spreadsheetId, body);

  const accounts = await getAccounts(accessToken, spreadsheetId);
  const updated = applyTransactionToBalances(accounts, body, 'apply');
  await persistChangedAccounts(accessToken, spreadsheetId, accounts, updated);

  invalidateMany(spreadsheetId, TX_CACHES);
  // Return the authoritative post-write accounts so the client can update
  // balances without a second round trip (it already holds the new tx row).
  return NextResponse.json({ ok: true, accounts: updated });
});

export const PUT = withSession(async ({ accessToken, spreadsheetId, req }) => {
  const { original, updated }: { original: Transaction; updated: Transaction } = await req.json();

  await updateTransaction(accessToken, spreadsheetId, updated);

  // Reverse the original effect, then apply the new one — single in-memory pass,
  // single source of truth for the balance math.
  const accounts = await getAccounts(accessToken, spreadsheetId);
  const reversed = applyTransactionToBalances(accounts, original, 'reverse');
  const reapplied = applyTransactionToBalances(reversed, updated, 'apply');
  await persistChangedAccounts(accessToken, spreadsheetId, accounts, reapplied);

  await reconcileLinkedRecords(accessToken, spreadsheetId, [{ original, updated }], []);

  invalidateMany(spreadsheetId, TX_CACHES);
  return NextResponse.json({ ok: true, accounts: reapplied });
});

export const DELETE = withSession(async ({ accessToken, spreadsheetId, req }) => {
  const { id, groupId }: { id?: string; groupId?: string } = await req.json();

  const [transactions, accounts] = await Promise.all([
    getTransactions(accessToken, spreadsheetId),
    getAccounts(accessToken, spreadsheetId),
  ]);
  // Delete a whole split group (all rows sharing splitGroupId) or a single row.
  const targets = groupId
    ? transactions.filter((t) => t.splitGroupId && t.splitGroupId === groupId)
    : transactions.filter((t) => t.id === id);

  let nextAccounts = accounts;
  for (const tx of targets) {
    await deleteTransaction(accessToken, spreadsheetId, tx.id);
    nextAccounts = applyTransactionToBalances(nextAccounts, tx, 'reverse');
  }
  if (targets.length > 0) {
    await persistChangedAccounts(accessToken, spreadsheetId, accounts, nextAccounts);
    await reconcileLinkedRecords(accessToken, spreadsheetId, [], targets);
  }

  invalidateMany(spreadsheetId, TX_CACHES);
  return NextResponse.json({ ok: true, accounts: nextAccounts });
});
