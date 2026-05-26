import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { batchGetBadgesData } from '@/lib/db';
import { getCache, setCache } from '@/lib/cache';

export async function GET() {
  const session = await auth();
  if (!session?.userId) return NextResponse.json({ overdueBills: 0, overBudget: 0 });

  try {
    const badgeKey = `badges:${session.userId}`;
    const cachedBadge = getCache<{ overdueBills: number; overBudget: number }>(badgeKey);
    if (cachedBadge) return NextResponse.json(cachedBadge);

    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const { bills, budgets, transactions } = await batchGetBadgesData(session.userId);

    const overdueBills = bills.filter((b) => {
      if (!b.isActive) return false;
      const due = new Date(b.nextDue);
      return due < now;
    }).length;

    const monthExpenses = transactions.filter((t) => t.date.startsWith(thisMonth) && t.type === 'expense');

    const overBudget = budgets.filter((b) => {
      const monthly =
        b.period === 'monthly' ? b.amount
        : b.period === 'weekly' ? b.amount * 4.33
        : b.amount / 12;
      const spent = monthExpenses.filter((t) => t.category === b.category).reduce((s, t) => s + t.amount, 0);
      return spent > monthly;
    }).length;

    const result = { overdueBills, overBudget };
    setCache(badgeKey, result, 60_000);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ overdueBills: 0, overBudget: 0 });
  }
}
