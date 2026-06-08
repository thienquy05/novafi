import { describe, it, expect } from 'vitest';
import { reportToCsv, reportToHtml, type ReportExportData } from '@/lib/report-export';

const data: ReportExportData = {
  year: 2026,
  yearIncome: 12000,
  yearExpense: 8000,
  yearSavings: 4000,
  savingsRate: 33.333,
  monthlyData: [
    { month: 'Jan', income: 1000, expenses: 600 },
    { month: 'Feb', income: 0, expenses: 0 },
  ],
  categoryData: [
    { name: 'Food', value: 5000 },
    { name: 'Bills', value: 3000 },
  ],
  topMerchants: [{ name: 'Spotify', total: 120, count: 12 }],
};

describe('reportToCsv', () => {
  it('includes a titled section for each report area', () => {
    const csv = reportToCsv(data);
    expect(csv).toContain('"NovaFi Annual Report","2026"');
    expect(csv).toContain('"Summary"');
    expect(csv).toContain('"Monthly Breakdown"');
    expect(csv).toContain('"Spending by Category"');
    expect(csv).toContain('"Top Merchants"');
  });

  it('writes summary figures with two decimals', () => {
    const csv = reportToCsv(data);
    expect(csv).toContain('"Total Income","12000.00"');
    expect(csv).toContain('"Net Saved","4000.00"');
    expect(csv).toContain('"Savings Rate","33.3%"');
  });

  it('computes per-month saved and a totals row', () => {
    const csv = reportToCsv(data);
    expect(csv).toContain('"Jan","1000.00","600.00","400.00"');
    expect(csv).toContain('"Total","12000.00","8000.00","4000.00"');
  });

  it('computes category share of total spending', () => {
    const csv = reportToCsv(data);
    // 5000 / 8000 = 62.5%
    expect(csv).toContain('"Food","5000.00","62.5%"');
  });
});

describe('reportToHtml', () => {
  const labels = {
    title: 'Annual Report', generatedOn: 'Generated', totalIncome: 'Total Income',
    totalSpent: 'Total Spent', netSaved: 'Net Saved', savingsRate: 'Savings Rate',
    monthlyBreakdown: 'Monthly Breakdown', month: 'Month', income: 'Income', spent: 'Spent',
    saved: 'Saved', total: 'Total', spendingByCategory: 'Spending by Category', category: 'Category',
    amount: 'Amount', share: 'Share', topMerchants: 'Top Merchants', merchant: 'Merchant', visits: 'Visits',
  };

  it('produces a full HTML document with the year in the title', () => {
    const html = reportToHtml(data, labels);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('Annual Report');
    expect(html).toContain('2026');
  });

  it('escapes HTML-special characters in category names', () => {
    const html = reportToHtml(
      { ...data, categoryData: [{ name: 'Food & <Drinks>', value: 100 }] },
      labels,
    );
    expect(html).toContain('Food &amp; &lt;Drinks&gt;');
    expect(html).not.toContain('Food & <Drinks>');
  });
});
