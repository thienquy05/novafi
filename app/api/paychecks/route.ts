import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import {
  getPaychecks,
  addPaycheck,
  deletePaycheck,
  getTransactions,
  deleteTransaction,
  getAccounts,
  upsertAccount,
} from '@/lib/sheets';
import { getCache, setCache, invalidateCache } from '@/lib/cache';
import { applyTransactionToBalances } from '@/lib/calculations';
import type { PaycheckEntry } from '@/types';

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const key = `paychecks:${session.spreadsheetId}`;
  const cached = getCache<PaycheckEntry[]>(key);
  if (cached) return NextResponse.json(cached);

  const paychecks = await getPaychecks(session.accessToken, session.spreadsheetId);
  setCache(key, paychecks, 60_000);
  return NextResponse.json(paychecks);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body: PaycheckEntry = await req.json();
  await addPaycheck(session.accessToken, session.spreadsheetId, body);
  invalidateCache(`paychecks:${session.spreadsheetId}`);
  invalidateCache(`accounts:${session.spreadsheetId}`);
  invalidateCache(`dashboard:${session.spreadsheetId}`);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await req.json();

  await deletePaycheck(session.accessToken, session.spreadsheetId, id);

  // A paycheck owns its deposit transaction (same id). Deleting the paycheck must
  // also remove that ledger row and reverse its balance effect — otherwise the
  // deposit lingers and the account balance stays inflated. Mirrors DELETE in the
  // transactions route. No-ops cleanly for paychecks logged without a deposit
  // account (no matching transaction) and for legacy entries whose unrelated
  // random-id transaction can't be linked.
  const [transactions, accounts] = await Promise.all([
    getTransactions(session.accessToken, session.spreadsheetId),
    getAccounts(session.accessToken, session.spreadsheetId),
  ]);
  const tx = transactions.find((t) => t.id === id);
  if (tx) {
    await deleteTransaction(session.accessToken, session.spreadsheetId, id);
    const updated = applyTransactionToBalances(accounts, tx, 'reverse');
    for (let i = 0; i < updated.length; i++) {
      if (updated[i] !== accounts[i]) {
        await upsertAccount(session.accessToken, session.spreadsheetId, updated[i]);
      }
    }
    invalidateCache(`transactions:${session.spreadsheetId}`);
    invalidateCache(`badges:${session.spreadsheetId}`);
  }

  invalidateCache(`paychecks:${session.spreadsheetId}`);
  invalidateCache(`accounts:${session.spreadsheetId}`);
  invalidateCache(`dashboard:${session.spreadsheetId}`);
  return NextResponse.json({ ok: true });
}
