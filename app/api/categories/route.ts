import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getSettings, saveSettings } from '@/lib/sheets';
import { getCache, setCache, invalidateCache } from '@/lib/cache';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '@/types';

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const cacheKey = `categories:${session.spreadsheetId}`;
  const cached = getCache<{ expenseCategories: string[]; incomeCategories: string[] }>(cacheKey);
  if (cached) return NextResponse.json(cached);

  const settings = await getSettings(session.accessToken, session.spreadsheetId);
  const hiddenExp = new Set(settings.hiddenExpenseCategories ?? []);
  const hiddenInc = new Set(settings.hiddenIncomeCategories ?? []);
  const result = {
    expenseCategories: [...EXPENSE_CATEGORIES.filter((c) => !hiddenExp.has(c)), ...(settings.customExpenseCategories ?? [])],
    incomeCategories: [...INCOME_CATEGORIES.filter((c) => !hiddenInc.has(c)), ...(settings.customIncomeCategories ?? [])],
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
