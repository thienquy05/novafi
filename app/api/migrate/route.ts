import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import {
  getSettings as sheetsGetSettings,
  getPaychecks as sheetsGetPaychecks,
  getTransactions as sheetsGetTransactions,
  getAccounts as sheetsGetAccounts,
  getGoals as sheetsGetGoals,
  getBills as sheetsGetBills,
  getBudgets as sheetsGetBudgets,
  getNetWorthHistory as sheetsGetNetWorthHistory,
} from '@/lib/sheets';
import {
  ensureUser,
  saveSettings,
  addPaycheck,
  addTransaction,
  upsertAccount,
  upsertGoal,
  upsertBill,
  upsertBudget,
  appendNetWorthSnapshot,
} from '@/lib/db';

// POST /api/migrate
// One-time endpoint: reads all data from the user's Google Sheet and writes it
// to Vercel Postgres. Safe to run multiple times — all inserts are idempotent.
export async function POST() {
  const session = await auth();
  if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!session.accessToken || !session.spreadsheetId) {
    return NextResponse.json(
      { error: 'Google Sheets session required. Sign out and sign back in, then retry.' },
      { status: 400 }
    );
  }

  const userId = session.userId;
  const at = session.accessToken;
  const sid = session.spreadsheetId;
  const counts: Record<string, number> = {};
  const errors: string[] = [];

  await ensureUser(userId, session.user?.email ?? '', session.user?.name ?? '');

  // Settings
  try {
    const settings = await sheetsGetSettings(at, sid);
    await saveSettings(userId, settings);
    counts.settings = 1;
  } catch (e) { errors.push(`settings: ${String(e)}`); }

  // Accounts (before transactions — FK-like dependency on account IDs)
  try {
    const accounts = await sheetsGetAccounts(at, sid);
    for (const a of accounts) await upsertAccount(userId, a);
    counts.accounts = accounts.length;
  } catch (e) { errors.push(`accounts: ${String(e)}`); }

  // Transactions
  try {
    const transactions = await sheetsGetTransactions(at, sid);
    for (const tx of transactions) await addTransaction(userId, tx);
    counts.transactions = transactions.length;
  } catch (e) { errors.push(`transactions: ${String(e)}`); }

  // Paychecks
  try {
    const paychecks = await sheetsGetPaychecks(at, sid);
    for (const p of paychecks) await addPaycheck(userId, p);
    counts.paychecks = paychecks.length;
  } catch (e) { errors.push(`paychecks: ${String(e)}`); }

  // Goals
  try {
    const goals = await sheetsGetGoals(at, sid);
    for (const g of goals) await upsertGoal(userId, g);
    counts.goals = goals.length;
  } catch (e) { errors.push(`goals: ${String(e)}`); }

  // Bills
  try {
    const bills = await sheetsGetBills(at, sid);
    for (const b of bills) await upsertBill(userId, b);
    counts.bills = bills.length;
  } catch (e) { errors.push(`bills: ${String(e)}`); }

  // Budgets
  try {
    const budgets = await sheetsGetBudgets(at, sid);
    for (const b of budgets) await upsertBudget(userId, b);
    counts.budgets = budgets.length;
  } catch (e) { errors.push(`budgets: ${String(e)}`); }

  // Net Worth History
  try {
    const history = await sheetsGetNetWorthHistory(at, sid);
    for (const s of history) await appendNetWorthSnapshot(userId, s);
    counts.netWorthHistory = history.length;
  } catch (e) { errors.push(`netWorthHistory: ${String(e)}`); }

  return NextResponse.json({ ok: errors.length === 0, counts, errors });
}
