import { describe, it, expect } from 'vitest';
import { parseSettingsRows, parseNetWorthRows } from '@/lib/sheets';
import { DEFAULT_TAX_SETTINGS } from '@/lib/utils';

describe('parseSettingsRows', () => {
  it('maps key/value rows to a TaxSettings object', () => {
    const rows = [
      ['display_name', 'Quy'],
      ['filing_status', 'single'],
      ['pay_periods_per_year', '24'],
      ['k401_pct', '10'],
      ['budget_rollover', 'true'],
      ['exclude_loans_from_networth', 'true'],
      ['custom_expense_categories', 'Coffee|Pets'],
      ['hidden_income_categories', 'Bonus'],
      ['language', 'vi'],
    ];
    const s = parseSettingsRows(rows);
    expect(s.displayName).toBe('Quy');
    expect(s.filingStatus).toBe('single');
    expect(s.payPeriodsPerYear).toBe(24);
    expect(s.k401Pct).toBe(10);
    expect(s.budgetRollover).toBe(true);
    expect(s.excludeLoansFromNetWorth).toBe(true);
    expect(s.customExpenseCategories).toEqual(['Coffee', 'Pets']);
    expect(s.hiddenIncomeCategories).toEqual(['Bonus']);
    expect(s.language).toBe('vi');
  });

  it('falls back to defaults for missing keys (empty sheet)', () => {
    const s = parseSettingsRows([]);
    expect(s.filingStatus).toBe(DEFAULT_TAX_SETTINGS.filingStatus);
    expect(s.payPeriodsPerYear).toBe(26);
    expect(s.budgetRollover).toBe(false);
    expect(s.excludeLoansFromNetWorth).toBe(false);
    expect(s.customExpenseCategories).toEqual([]);
    expect(s.language).toBe('en');
  });
});

describe('parseNetWorthRows', () => {
  it('maps rows to NetWorthSnapshot[]', () => {
    expect(parseNetWorthRows([['nw1', '2026-01-31', '2026-01', '1000.5']])).toEqual([
      { id: 'nw1', date: '2026-01-31', month: '2026-01', netWorth: 1000.5 },
    ]);
  });

  it('returns an empty array for no rows', () => {
    expect(parseNetWorthRows([])).toEqual([]);
  });
});
