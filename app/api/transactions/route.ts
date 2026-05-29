import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getTransactions, addTransaction, deleteTransaction, updateTransaction, getAccounts, upsertAccount } from '@/lib/sheets';
import { getCache, setCache, invalidateCache, CACHE_TTL } from '@/lib/cache';
import { applyTransactionToBalances } from '@/lib/calculations';
import type { Account, Transaction } from '@/types';

// Persists only the accounts whose balance actually changed. applyTransactionToBalances
// returns the same object reference for untouched accounts, so an identity check is enough.
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

function invalidateTxCaches(spreadsheetId: string): void {
  invalidateCache(`transactions:${spreadsheetId}`);
  invalidateCache(`accounts:${spreadsheetId}`);
  invalidateCache(`dashboard:${spreadsheetId}`);
  invalidateCache(`badges:${spreadsheetId}`);
}

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const key = `transactions:${session.spreadsheetId}`;
  const cached = getCache<Transaction[]>(key);
  if (cached) return NextResponse.json(cached);

  const transactions = await getTransactions(session.accessToken, session.spreadsheetId);
  setCache(key, transactions, CACHE_TTL.SHORT);
  return NextResponse.json(transactions);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body: Transaction = await req.json();

  // Write the ledger row first — it is the source of truth. If the balance
  // update below fails, the reconcile endpoint recomputes balances from this row.
  await addTransaction(session.accessToken, session.spreadsheetId, body);

  const accounts = await getAccounts(session.accessToken, session.spreadsheetId);
  const updated = applyTransactionToBalances(accounts, body, 'apply');
  await persistChanged(session.accessToken, session.spreadsheetId, accounts, updated);

  invalidateTxCaches(session.spreadsheetId);
  return NextResponse.json({ ok: true });
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { original, updated }: { original: Transaction; updated: Transaction } = await req.json();

  await updateTransaction(session.accessToken, session.spreadsheetId, updated);

  // Reverse the original effect, then apply the new one — single in-memory pass,
  // single source of truth for the balance math.
  const accounts = await getAccounts(session.accessToken, session.spreadsheetId);
  const reversed = applyTransactionToBalances(accounts, original, 'reverse');
  const reapplied = applyTransactionToBalances(reversed, updated, 'apply');
  await persistChanged(session.accessToken, session.spreadsheetId, accounts, reapplied);

  invalidateTxCaches(session.spreadsheetId);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await req.json();

  const [transactions, accounts] = await Promise.all([
    getTransactions(session.accessToken, session.spreadsheetId),
    getAccounts(session.accessToken, session.spreadsheetId),
  ]);
  const tx = transactions.find((t) => t.id === id);

  await deleteTransaction(session.accessToken, session.spreadsheetId, id);

  if (tx) {
    const updated = applyTransactionToBalances(accounts, tx, 'reverse');
    await persistChanged(session.accessToken, session.spreadsheetId, accounts, updated);
  }

  invalidateTxCaches(session.spreadsheetId);
  return NextResponse.json({ ok: true });
}
