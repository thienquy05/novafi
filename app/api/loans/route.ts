import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import {
  getLoans,
  upsertLoan,
  deleteLoan,
  getTransactions,
  addTransaction,
  deleteTransaction,
  getAccounts,
  upsertAccount,
} from '@/lib/sheets';
import { getCache, setCache, invalidateCache, CACHE_TTL } from '@/lib/cache';
import { applyTransactionToBalances } from '@/lib/calculations';
import type { Account, Loan, Transaction } from '@/types';

// Persist only the accounts whose balance actually changed. applyTransactionToBalances
// returns the same reference for untouched accounts, so an identity check suffices.
async function persistChanged(
  accessToken: string,
  spreadsheetId: string,
  before: Account[],
  after: Account[],
): Promise<void> {
  for (let i = 0; i < after.length; i++) {
    if (after[i] !== before[i]) {
      await upsertAccount(accessToken, spreadsheetId, after[i]);
    }
  }
}

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const key = `loans:${session.spreadsheetId}`;
  const cached = getCache<Loan[]>(key);
  if (cached) return NextResponse.json(cached);

  const loans = await getLoans(session.accessToken, session.spreadsheetId);
  setCache(key, loans, CACHE_TTL.SHORT);
  return NextResponse.json(loans);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Accepts either a bare Loan or `{ loan, tx }`. When a cash transaction is
  // included (lending/repaying through an account), write it and apply its
  // balance effect in the SAME request as the loan upsert — so a loan that
  // claims to have moved cash always has the matching ledger row, and vice
  // versa. `tx` is omitted for note-only loans (no account selected).
  const body = (await req.json()) as Loan | { loan: Loan; tx?: Transaction };
  const loan: Loan = 'loan' in body ? body.loan : body;
  const tx: Transaction | undefined = 'loan' in body ? body.tx : undefined;

  if (tx) {
    // Write the ledger row first (source of truth), then update balances.
    await addTransaction(session.accessToken, session.spreadsheetId, tx);
    const accounts = await getAccounts(session.accessToken, session.spreadsheetId);
    const updated = applyTransactionToBalances(accounts, tx, 'apply');
    await persistChanged(session.accessToken, session.spreadsheetId, accounts, updated);
    invalidateCache(`transactions:${session.spreadsheetId}`);
    invalidateCache(`accounts:${session.spreadsheetId}`);
    invalidateCache(`dashboard:${session.spreadsheetId}`);
    invalidateCache(`badges:${session.spreadsheetId}`);
  }

  await upsertLoan(session.accessToken, session.spreadsheetId, loan);
  invalidateCache(`loans:${session.spreadsheetId}`);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await req.json();

  // A loan owns the cash-movement transfers it created (principal + each
  // payback). Find them BEFORE deleting the loan, then delete each one and
  // reverse its balance effect so the linked accounts return to where they were.
  // Doing this server-side in a single request makes it atomic — the old
  // client-side delete loop could leave orphan transfers (still distorting
  // balances) if the page closed mid-loop.
  const loans = await getLoans(session.accessToken, session.spreadsheetId);
  const loan = loans.find((l) => l.id === id);

  await deleteLoan(session.accessToken, session.spreadsheetId, id);

  const txIds = loan ? [loan.principalTxId, ...loan.repaymentTxIds].filter(Boolean) : [];
  if (txIds.length) {
    const idSet = new Set(txIds);
    const [transactions, accounts] = await Promise.all([
      getTransactions(session.accessToken, session.spreadsheetId),
      getAccounts(session.accessToken, session.spreadsheetId),
    ]);
    let working: Account[] = accounts;
    for (const tx of transactions.filter((t) => idSet.has(t.id))) {
      working = applyTransactionToBalances(working, tx, 'reverse');
      await deleteTransaction(session.accessToken, session.spreadsheetId, tx.id);
    }
    await persistChanged(session.accessToken, session.spreadsheetId, accounts, working);
    invalidateCache(`transactions:${session.spreadsheetId}`);
    invalidateCache(`accounts:${session.spreadsheetId}`);
    invalidateCache(`dashboard:${session.spreadsheetId}`);
    invalidateCache(`badges:${session.spreadsheetId}`);
  }

  invalidateCache(`loans:${session.spreadsheetId}`);
  return NextResponse.json({ ok: true });
}
