import { NextResponse } from 'next/server';
import { getSettings, saveSettings } from '@/lib/sheets';
import { invalidateMany, CACHE_TTL } from '@/lib/cache';
import { cachedGet, withSession } from '@/lib/apiRoute';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '@/types';

export const GET = cachedGet({
  resource: 'categories',
  ttl: CACHE_TTL.MEDIUM,
  fetch: async ({ accessToken, spreadsheetId }) => {
    const settings = await getSettings(accessToken, spreadsheetId);
    // `hidden*` is the archive set — it applies to BOTH built-in and custom
    // categories. Archived categories are excluded from the entry dropdowns
    // (expense/incomeCategories) but returned separately as archived* so
    // transaction-history filters can still surface past transactions.
    const hiddenExp = new Set(settings.hiddenExpenseCategories ?? []);
    const hiddenInc = new Set(settings.hiddenIncomeCategories ?? []);
    const allExp = [...EXPENSE_CATEGORIES, ...(settings.customExpenseCategories ?? [])];
    const allInc = [...INCOME_CATEGORIES, ...(settings.customIncomeCategories ?? [])];
    return {
      expenseCategories: allExp.filter((c) => !hiddenExp.has(c)),
      incomeCategories: allInc.filter((c) => !hiddenInc.has(c)),
      archivedExpenseCategories: allExp.filter((c) => hiddenExp.has(c)),
      archivedIncomeCategories: allInc.filter((c) => hiddenInc.has(c)),
    };
  },
});

export const PUT = withSession(async ({ accessToken, spreadsheetId, req }) => {
  const { customExpenseCategories, customIncomeCategories }: {
    customExpenseCategories: string[];
    customIncomeCategories: string[];
  } = await req.json();

  const settings = await getSettings(accessToken, spreadsheetId);
  await saveSettings(accessToken, spreadsheetId, {
    ...settings,
    customExpenseCategories: customExpenseCategories ?? [],
    customIncomeCategories: customIncomeCategories ?? [],
  });
  invalidateMany(spreadsheetId, ['categories', 'settings']);
  return NextResponse.json({ ok: true });
});
