import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getTransactions, addTransaction, deleteTransaction, getAccounts, upsertAccount } from '@/lib/sheets';
import type { Transaction } from '@/types';

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const transactions = await getTransactions(session.accessToken, session.spreadsheetId);
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

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await req.json();
  await deleteTransaction(session.accessToken, session.spreadsheetId, id);
  return NextResponse.json({ ok: true });
}
