import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import {
  getLoans,
  upsertLoan,
  deleteLoan,
  getTransactions,
  deleteTransaction,
  getAccounts,
  upsertAccount,
} from '@/lib/sheets';
import { getCache, setCache, invalidateCache, CACHE_TTL } from '@/lib/cache';
import { applyTransactionToBalances } from '@/lib/calculations';
import type { Account, Loan } from '@/types';

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
  const body: Loan = await req.json();
  await upsertLoan(session.accessToken, session.spreadsheetId, body);
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
    for (let i = 0; i < working.length; i++) {
      if (working[i] !== accounts[i]) {
        await upsertAccount(session.accessToken, session.spreadsheetId, working[i]);
      }
    }
    invalidateCache(`transactions:${session.spreadsheetId}`);
    invalidateCache(`accounts:${session.spreadsheetId}`);
    invalidateCache(`dashboard:${session.spreadsheetId}`);
    invalidateCache(`badges:${session.spreadsheetId}`);
  }

  invalidateCache(`loans:${session.spreadsheetId}`);
  return NextResponse.json({ ok: true });
}
