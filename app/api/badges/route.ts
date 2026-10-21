import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { currentWriteVersion, getDashboardData } from '@/lib/apiRoute';
import { calcOverdueBills, calcOverBudget, calcCreditAlerts } from '@/lib/calculations';
import { zonedNow } from '@/lib/utils';

type Badges = { overdueBills: number; overBudget: number; creditAlerts: number };

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ overdueBills: 0, overBudget: 0, creditAlerts: 0 });

  try {
    // Shares the dashboard payload (see getDashboardData) so the badges, bell,
    // Money Flow and Home cost one Sheets read; the counts are cheap to recompute.
    const { bills, budgets, transactions, accounts, settings } = await getDashboardData(
      session.accessToken,
      session.spreadsheetId,
      await currentWriteVersion(),
    );

    // Anchor "now" to the user's time zone so overdue/over-budget counts flip at
    // the same local midnight the rest of the app uses (not the server's UTC).
    const now = zonedNow(settings.timeZone);
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const overdueBills = calcOverdueBills(bills, now);
    const overBudget = calcOverBudget(budgets, transactions, thisMonth, settings.budgetRollover);
    const creditAlerts = calcCreditAlerts(accounts);

    const result: Badges = { overdueBills, overBudget, creditAlerts };
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ overdueBills: 0, overBudget: 0, creditAlerts: 0 });
  }
}
