import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getTransactions, addTransaction, deleteTransaction, updateTransaction, getAccounts, upsertAccount } from '@/lib/sheets';
import { getCache, setCache, invalidateCache } from '@/lib/cache';
import type { Transaction } from '@/types';

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const key = `transactions:${session.spreadsheetId}`;
  const cached = getCache<Transaction[]>(key);
  if (cached) return NextResponse.json(cached);

  const transactions = await getTransactions(session.accessToken, session.spreadsheetId);
  setCache(key, transactions);
  return NextResponse.json(transactions);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body: Transaction = await req.json();

  await addTransaction(session.accessToken, session.spreadsheetId, body);

  // Update account balance(s) based on transaction type
  const accounts = await getAccounts(session.accessToken, session.spreadsheetId);

  if (body.type === 'expense') {
    const account = accounts.find((a) => a.id === body.account);
    if (account) {
      await upsertAccount(session.accessToken, session.spreadsheetId, {
        ...account,
        balance: account.balance - body.amount,
      });
    }
  } else if (body.type === 'income') {
    const account = accounts.find((a) => a.id === body.account);
    if (account) {
      await upsertAccount(session.accessToken, session.spreadsheetId, {
        ...account,
        balance: account.balance + body.amount,
      });
    }
  } else if (body.type === 'transfer') {
    const fromAccount = accounts.find((a) => a.id === body.account);
    const toAccount = accounts.find((a) => a.id === body.toAccount);
    if (fromAccount) {
      await upsertAccount(session.accessToken, session.spreadsheetId, {
        ...fromAccount,
        balance: fromAccount.balance - body.amount,
      });
    }
    if (toAccount) {
      // Paying to a credit/loan account reduces what's owed, not adds to it
      const isDebtPayoff = toAccount.type === 'credit' || toAccount.type === 'loan';
      const newBalance = isDebtPayoff
        ? Math.max(0, toAccount.balance - body.amount)
        : toAccount.balance + body.amount;
      await upsertAccount(session.accessToken, session.spreadsheetId, {
        ...toAccount,
        balance: newBalance,
      });
    }
  }

  invalidateCache(`transactions:${session.spreadsheetId}`);
  invalidateCache(`accounts:${session.spreadsheetId}`);
  return NextResponse.json({ ok: true });
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { original, updated }: { original: Transaction; updated: Transaction } = await req.json();

  const accounts = await getAccounts(session.accessToken, session.spreadsheetId);
  const findAcc = (id: string) => accounts.find((a) => a.id === id);

  // Reverse original balance effects
  if (original.type === 'expense') {
    const acc = findAcc(original.account);
    if (acc) await upsertAccount(session.accessToken, session.spreadsheetId, { ...acc, balance: acc.balance + original.amount });
  } else if (original.type === 'income') {
    const acc = findAcc(original.account);
    if (acc) await upsertAccount(session.accessToken, session.spreadsheetId, { ...acc, balance: acc.balance - original.amount });
  } else if (original.type === 'transfer') {
    const fromAcc = findAcc(original.account);
    const toAcc = findAcc(original.toAccount ?? '');
    if (fromAcc) await upsertAccount(session.accessToken, session.spreadsheetId, { ...fromAcc, balance: fromAcc.balance + original.amount });
    if (toAcc) {
      const isDebt = toAcc.type === 'credit' || toAcc.type === 'loan';
      await upsertAccount(session.accessToken, session.spreadsheetId, {
        ...toAcc,
        balance: isDebt ? toAcc.balance + original.amount : toAcc.balance - original.amount,
      });
    }
  }

  // Fetch fresh accounts after reversal
  const fresh = await getAccounts(session.accessToken, session.spreadsheetId);
  const findFresh = (id: string) => fresh.find((a) => a.id === id);

  // Apply new balance effects
  if (updated.type === 'expense') {
    const acc = findFresh(updated.account);
    if (acc) await upsertAccount(session.accessToken, session.spreadsheetId, { ...acc, balance: acc.balance - updated.amount });
  } else if (updated.type === 'income') {
    const acc = findFresh(updated.account);
    if (acc) await upsertAccount(session.accessToken, session.spreadsheetId, { ...acc, balance: acc.balance + updated.amount });
  } else if (updated.type === 'transfer') {
    const fromAcc = findFresh(updated.account);
    const toAcc = findFresh(updated.toAccount ?? '');
    if (fromAcc) await upsertAccount(session.accessToken, session.spreadsheetId, { ...fromAcc, balance: fromAcc.balance - updated.amount });
    if (toAcc) {
      const isDebt = toAcc.type === 'credit' || toAcc.type === 'loan';
      const newBalance = isDebt ? Math.max(0, toAcc.balance - updated.amount) : toAcc.balance + updated.amount;
      await upsertAccount(session.accessToken, session.spreadsheetId, { ...toAcc, balance: newBalance });
    }
  }

  await updateTransaction(session.accessToken, session.spreadsheetId, updated);
  invalidateCache(`transactions:${session.spreadsheetId}`);
  invalidateCache(`accounts:${session.spreadsheetId}`);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await req.json();
  await deleteTransaction(session.accessToken, session.spreadsheetId, id);
  invalidateCache(`transactions:${session.spreadsheetId}`);
  return NextResponse.json({ ok: true });
}
