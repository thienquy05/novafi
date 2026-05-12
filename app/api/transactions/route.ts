import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getTransactions, addTransaction, deleteTransaction, updateTransaction, getAccounts, upsertAccount } from '@/lib/sheets';
import { getCache, setCache, invalidateCache } from '@/lib/cache';
import {
  applyExpenseBalance, applyIncomeBalance, applyTransferFromBalance, applyTransferToBalance,
  reverseExpenseBalance, reverseIncomeBalance, reverseTransferFromBalance, reverseTransferToBalance,
} from '@/lib/calculations';
import type { Transaction } from '@/types';

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const key = `transactions:${session.spreadsheetId}`;
  const cached = getCache<Transaction[]>(key);
  if (cached) return NextResponse.json(cached);

  const transactions = await getTransactions(session.accessToken, session.spreadsheetId);
  setCache(key, transactions, 60_000);
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
      const isDebt = account.type === 'credit' || account.type === 'loan';
      await upsertAccount(session.accessToken, session.spreadsheetId, {
        ...account,
        balance: applyExpenseBalance(account.balance, body.amount, isDebt),
      });
    }
  } else if (body.type === 'income') {
    const account = accounts.find((a) => a.id === body.account);
    if (account) {
      await upsertAccount(session.accessToken, session.spreadsheetId, {
        ...account,
        balance: applyIncomeBalance(account.balance, body.amount),
      });
    }
  } else if (body.type === 'transfer') {
    const fromAccount = accounts.find((a) => a.id === body.account);
    const toAccount = accounts.find((a) => a.id === body.toAccount);
    if (fromAccount) {
      await upsertAccount(session.accessToken, session.spreadsheetId, {
        ...fromAccount,
        balance: applyTransferFromBalance(fromAccount.balance, body.amount),
      });
    }
    if (toAccount) {
      const isDebtPayoff = toAccount.type === 'credit' || toAccount.type === 'loan';
      await upsertAccount(session.accessToken, session.spreadsheetId, {
        ...toAccount,
        balance: applyTransferToBalance(toAccount.balance, body.amount, isDebtPayoff),
      });
    }
  }

  invalidateCache(`transactions:${session.spreadsheetId}`);
  invalidateCache(`accounts:${session.spreadsheetId}`);
  invalidateCache(`dashboard:${session.spreadsheetId}`);
  invalidateCache(`badges:${session.spreadsheetId}`);
  return NextResponse.json({ ok: true });
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { original, updated }: { original: Transaction; updated: Transaction } = await req.json();

  const accounts = await getAccounts(session.accessToken, session.spreadsheetId);
  // Track balance updates in-memory so we don't need a second getAccounts fetch
  const accountMap = new Map(accounts.map((a) => [a.id, { ...a }]));
  const upsert = async (id: string) => {
    const a = accountMap.get(id);
    if (a) await upsertAccount(session.accessToken, session.spreadsheetId, a);
  };

  // Reverse original balance effects
  if (original.type === 'expense') {
    const acc = accountMap.get(original.account);
    if (acc) { const isDebt = acc.type === 'credit' || acc.type === 'loan'; acc.balance = reverseExpenseBalance(acc.balance, original.amount, isDebt); await upsert(acc.id); }
  } else if (original.type === 'income') {
    const acc = accountMap.get(original.account);
    if (acc) { acc.balance = reverseIncomeBalance(acc.balance, original.amount); await upsert(acc.id); }
  } else if (original.type === 'transfer') {
    const fromAcc = accountMap.get(original.account);
    const toAcc = accountMap.get(original.toAccount ?? '');
    if (fromAcc) { fromAcc.balance = reverseTransferFromBalance(fromAcc.balance, original.amount); await upsert(fromAcc.id); }
    if (toAcc) { const isDebt = toAcc.type === 'credit' || toAcc.type === 'loan'; toAcc.balance = reverseTransferToBalance(toAcc.balance, original.amount, isDebt); await upsert(toAcc.id); }
  }

  // Apply new balance effects using the updated in-memory map (no second Sheets fetch)
  if (updated.type === 'expense') {
    const acc = accountMap.get(updated.account);
    if (acc) { const isDebt = acc.type === 'credit' || acc.type === 'loan'; await upsertAccount(session.accessToken, session.spreadsheetId, { ...acc, balance: applyExpenseBalance(acc.balance, updated.amount, isDebt) }); }
  } else if (updated.type === 'income') {
    const acc = accountMap.get(updated.account);
    if (acc) await upsertAccount(session.accessToken, session.spreadsheetId, { ...acc, balance: applyIncomeBalance(acc.balance, updated.amount) });
  } else if (updated.type === 'transfer') {
    const fromAcc = accountMap.get(updated.account);
    const toAcc = accountMap.get(updated.toAccount ?? '');
    if (fromAcc) await upsertAccount(session.accessToken, session.spreadsheetId, { ...fromAcc, balance: applyTransferFromBalance(fromAcc.balance, updated.amount) });
    if (toAcc) { const isDebt = toAcc.type === 'credit' || toAcc.type === 'loan'; await upsertAccount(session.accessToken, session.spreadsheetId, { ...toAcc, balance: applyTransferToBalance(toAcc.balance, updated.amount, isDebt) }); }
  }

  await updateTransaction(session.accessToken, session.spreadsheetId, updated);
  invalidateCache(`transactions:${session.spreadsheetId}`);
  invalidateCache(`accounts:${session.spreadsheetId}`);
  invalidateCache(`dashboard:${session.spreadsheetId}`);
  invalidateCache(`badges:${session.spreadsheetId}`);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await req.json();

  // Reverse the transaction's effect on account balances before deleting
  const [transactions, accounts] = await Promise.all([
    getTransactions(session.accessToken, session.spreadsheetId),
    getAccounts(session.accessToken, session.spreadsheetId),
  ]);
  const tx = transactions.find((t) => t.id === id);
  if (tx) {
    const findAcc = (accId: string) => accounts.find((a) => a.id === accId);
    if (tx.type === 'expense') {
      const acc = findAcc(tx.account);
      if (acc) {
        const isDebt = acc.type === 'credit' || acc.type === 'loan';
        await upsertAccount(session.accessToken, session.spreadsheetId, { ...acc, balance: reverseExpenseBalance(acc.balance, tx.amount, isDebt) });
      }
    } else if (tx.type === 'income') {
      const acc = findAcc(tx.account);
      if (acc) await upsertAccount(session.accessToken, session.spreadsheetId, { ...acc, balance: reverseIncomeBalance(acc.balance, tx.amount) });
    } else if (tx.type === 'transfer') {
      const fromAcc = findAcc(tx.account);
      const toAcc = findAcc(tx.toAccount ?? '');
      if (fromAcc) await upsertAccount(session.accessToken, session.spreadsheetId, { ...fromAcc, balance: reverseTransferFromBalance(fromAcc.balance, tx.amount) });
      if (toAcc) {
        const isDebt = toAcc.type === 'credit' || toAcc.type === 'loan';
        await upsertAccount(session.accessToken, session.spreadsheetId, {
          ...toAcc,
          balance: reverseTransferToBalance(toAcc.balance, tx.amount, isDebt),
        });
      }
    }
  }

  await deleteTransaction(session.accessToken, session.spreadsheetId, id);
  invalidateCache(`transactions:${session.spreadsheetId}`);
  invalidateCache(`accounts:${session.spreadsheetId}`);
  invalidateCache(`dashboard:${session.spreadsheetId}`);
  invalidateCache(`badges:${session.spreadsheetId}`);
  return NextResponse.json({ ok: true });
}
