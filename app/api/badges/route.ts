import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { batchGetBadgesData } from '@/lib/sheets';
import { getCache, setCache } from '@/lib/cache';
import { calcOverdueBills, calcOverBudget, calcCreditAlerts } from '@/lib/calculations';

type Badges = { overdueBills: number; overBudget: number; creditAlerts: number };

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ overdueBills: 0, overBudget: 0, creditAlerts: 0 });

  try {
    const badgeKey = `badges:${session.spreadsheetId}`;
    const cachedBadge = getCache<Badges>(badgeKey);
    if (cachedBadge) return NextResponse.json(cachedBadge);

    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const { bills, budgets, transactions, accounts } = await batchGetBadgesData(
      session.accessToken,
      session.spreadsheetId
    );

    const overdueBills = calcOverdueBills(bills, now);
    const overBudget = calcOverBudget(budgets, transactions, thisMonth);
    const creditAlerts = calcCreditAlerts(accounts);

    const result: Badges = { overdueBills, overBudget, creditAlerts };
    setCache(badgeKey, result, 60_000);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ overdueBills: 0, overBudget: 0, creditAlerts: 0 });
  }
}
