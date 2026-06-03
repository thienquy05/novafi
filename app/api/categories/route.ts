import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getSettings, saveSettings } from '@/lib/sheets';
import { getCache, setCache, invalidateCache } from '@/lib/cache';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '@/types';

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const cacheKey = `categories:${session.spreadsheetId}`;
  const cached = getCache<{
    expenseCategories: string[]; incomeCategories: string[];
    archivedExpenseCategories: string[]; archivedIncomeCategories: string[];
  }>(cacheKey);
  if (cached) return NextResponse.json(cached);

  const settings = await getSettings(session.accessToken, session.spreadsheetId);
  // `hidden*` is the archive set — it applies to BOTH built-in and custom
  // categories. Archived categories are excluded from the entry dropdowns
  // (expense/incomeCategories) but returned separately as archived* so
  // transaction-history filters can still surface past transactions.
  const hiddenExp = new Set(settings.hiddenExpenseCategories ?? []);
  const hiddenInc = new Set(settings.hiddenIncomeCategories ?? []);
  const allExp = [...EXPENSE_CATEGORIES, ...(settings.customExpenseCategories ?? [])];
  const allInc = [...INCOME_CATEGORIES, ...(settings.customIncomeCategories ?? [])];
  const result = {
    expenseCategories: allExp.filter((c) => !hiddenExp.has(c)),
    incomeCategories: allInc.filter((c) => !hiddenInc.has(c)),
    archivedExpenseCategories: allExp.filter((c) => hiddenExp.has(c)),
    archivedIncomeCategories: allInc.filter((c) => hiddenInc.has(c)),
  };
  setCache(cacheKey, result, 30_000);
  return NextResponse.json(result);
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { customExpenseCategories, customIncomeCategories }: {
    customExpenseCategories: string[];
    customIncomeCategories: string[];
  } = await req.json();

  const settings = await getSettings(session.accessToken, session.spreadsheetId);
  await saveSettings(session.accessToken, session.spreadsheetId, {
    ...settings,
    customExpenseCategories: customExpenseCategories ?? [],
    customIncomeCategories: customIncomeCategories ?? [],
  });
  invalidateCache(`categories:${session.spreadsheetId}`);
  invalidateCache(`settings:${session.spreadsheetId}`);
  return NextResponse.json({ ok: true });
}
