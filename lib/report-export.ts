import { formatCurrency } from '@/lib/utils';

/** Aggregated annual figures the Reports page already computes for one year. */
export type ReportExportData = {
  year: number;
  yearIncome: number;
  yearExpense: number;
  yearSavings: number;
  savingsRate: number;
  monthlyData: { month: string; income: number; expenses: number }[];
  categoryData: { name: string; value: number }[];
  topMerchants: { name: string; total: number; count: number }[];
};

/** Localized labels for the printable report (sourced from i18n on the page). */
export type ReportLabels = {
  title: string;
  generatedOn: string;
  totalIncome: string;
  totalSpent: string;
  netSaved: string;
  savingsRate: string;
  monthlyBreakdown: string;
  month: string;
  income: string;
  spent: string;
  saved: string;
  total: string;
  spendingByCategory: string;
  category: string;
  amount: string;
  share: string;
  topMerchants: string;
  merchant: string;
  visits: string;
};

function csvField(value: unknown): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

const row = (cells: unknown[]) => cells.map(csvField).join(',');

/**
 * Serializes a full-year report to a multi-section RFC-4180 CSV (pure — no DOM).
 * Sections: Summary, Monthly Breakdown, Spending by Category, Top Merchants.
 * Amounts are plain 2-decimal numbers (no currency symbol) for spreadsheet use.
 */
export function reportToCsv(data: ReportExportData): string {
  const { year, yearIncome, yearExpense, yearSavings, savingsRate, monthlyData, categoryData, topMerchants } = data;
  const lines: string[] = [];

  lines.push(row([`NovaFi Annual Report`, year]));
  lines.push('');

  lines.push(row(['Summary']));
  lines.push(row(['Total Income', yearIncome.toFixed(2)]));
  lines.push(row(['Total Spent', yearExpense.toFixed(2)]));
  lines.push(row(['Net Saved', yearSavings.toFixed(2)]));
  lines.push(row(['Savings Rate', `${savingsRate.toFixed(1)}%`]));
  lines.push('');

  lines.push(row(['Monthly Breakdown']));
  lines.push(row(['Month', 'Income', 'Spent', 'Saved']));
  for (const m of monthlyData) {
    lines.push(row([m.month, m.income.toFixed(2), m.expenses.toFixed(2), (m.income - m.expenses).toFixed(2)]));
  }
  lines.push(row(['Total', yearIncome.toFixed(2), yearExpense.toFixed(2), yearSavings.toFixed(2)]));
  lines.push('');

  lines.push(row(['Spending by Category']));
  lines.push(row(['Category', 'Amount', '% of Spending']));
  for (const c of categoryData) {
    const pct = yearExpense > 0 ? (c.value / yearExpense) * 100 : 0;
    lines.push(row([c.name, c.value.toFixed(2), `${pct.toFixed(1)}%`]));
  }
  lines.push('');

  lines.push(row(['Top Merchants']));
  lines.push(row(['Merchant', 'Total', 'Visits']));
  for (const mch of topMerchants) {
    lines.push(row([mch.name, mch.total.toFixed(2), mch.count]));
  }

  return lines.join('\n');
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) =>
    ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '"' ? '&quot;' : '&#39;',
  );
}

/**
 * Builds a self-contained, print-ready HTML document for the annual report
 * (pure — returns a string). The Reports page writes this into an off-screen
 * iframe and calls print(), letting the user "Save as PDF" without any heavy
 * client-side PDF library.
 */
export function reportToHtml(data: ReportExportData, labels: ReportLabels): string {
  const { year, yearIncome, yearExpense, yearSavings, savingsRate, monthlyData, categoryData, topMerchants } = data;
  const savedColor = yearSavings >= 0 ? '#4f46e5' : '#e11d48';

  const monthRows = monthlyData
    .map((m) => {
      const saved = m.income - m.expenses;
      const dim = m.income === 0 && m.expenses === 0;
      return `<tr${dim ? ' class="dim"' : ''}>
        <td>${esc(m.month)}</td>
        <td class="num inc">${m.income ? formatCurrency(m.income) : '—'}</td>
        <td class="num exp">${m.expenses ? formatCurrency(m.expenses) : '—'}</td>
        <td class="num ${saved >= 0 ? 'pos' : 'neg'}">${dim ? '—' : formatCurrency(saved)}</td>
      </tr>`;
    })
    .join('');

  const catRows = categoryData
    .map((c) => {
      const pct = yearExpense > 0 ? (c.value / yearExpense) * 100 : 0;
      return `<tr><td>${esc(c.name)}</td><td class="num">${formatCurrency(c.value)}</td><td class="num">${pct.toFixed(1)}%</td></tr>`;
    })
    .join('');

  const merchantRows = topMerchants
    .map((m) => `<tr><td>${esc(m.name)}</td><td class="num">${formatCurrency(m.total)}</td><td class="num">${m.count}</td></tr>`)
    .join('');

  const generated = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${esc(labels.title)} ${year}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #0f172a; margin: 0; padding: 32px; }
  .head { display: flex; align-items: center; gap: 14px; border-bottom: 3px solid #4f46e5; padding-bottom: 16px; margin-bottom: 24px; }
  .head img { width: 44px; height: 44px; border-radius: 11px; }
  .head h1 { font-size: 22px; margin: 0; letter-spacing: -0.02em; }
  .head .sub { color: #64748b; font-size: 12px; margin-top: 2px; }
  .cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 28px; }
  .card { border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px; }
  .card .lbl { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; }
  .card .val { font-size: 20px; font-weight: 800; margin-top: 6px; }
  h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.05em; color: #334155; margin: 28px 0 10px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; border-bottom: 2px solid #e2e8f0; padding: 8px 10px; }
  td { padding: 7px 10px; border-bottom: 1px solid #f1f5f9; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  th.num { text-align: right; }
  .inc, .pos { color: #059669; }
  .exp, .neg { color: #e11d48; }
  .dim { color: #cbd5e1; }
  tr.total td { font-weight: 800; border-top: 2px solid #cbd5e1; background: #f8fafc; }
  .foot { margin-top: 32px; color: #94a3b8; font-size: 11px; text-align: center; }
  @media print { body { padding: 0; } h2 { page-break-after: avoid; } table { page-break-inside: auto; } tr { page-break-inside: avoid; } }
</style>
</head>
<body>
  <div class="head">
    <img src="/icon-192.png" alt="NovaFi" />
    <div>
      <h1>${esc(labels.title)} · ${year}</h1>
      <div class="sub">${esc(labels.generatedOn)} ${esc(generated)}</div>
    </div>
  </div>

  <div class="cards">
    <div class="card"><div class="lbl">${esc(labels.totalIncome)}</div><div class="val inc">${formatCurrency(yearIncome)}</div></div>
    <div class="card"><div class="lbl">${esc(labels.totalSpent)}</div><div class="val exp">${formatCurrency(yearExpense)}</div></div>
    <div class="card"><div class="lbl">${esc(labels.netSaved)}</div><div class="val" style="color:${savedColor}">${formatCurrency(yearSavings)}</div></div>
    <div class="card"><div class="lbl">${esc(labels.savingsRate)}</div><div class="val">${savingsRate.toFixed(1)}%</div></div>
  </div>

  <h2>${esc(labels.monthlyBreakdown)}</h2>
  <table>
    <thead><tr><th>${esc(labels.month)}</th><th class="num">${esc(labels.income)}</th><th class="num">${esc(labels.spent)}</th><th class="num">${esc(labels.saved)}</th></tr></thead>
    <tbody>
      ${monthRows}
      <tr class="total"><td>${esc(labels.total)}</td><td class="num">${formatCurrency(yearIncome)}</td><td class="num">${formatCurrency(yearExpense)}</td><td class="num">${formatCurrency(yearSavings)}</td></tr>
    </tbody>
  </table>

  ${
    categoryData.length
      ? `<h2>${esc(labels.spendingByCategory)}</h2>
  <table>
    <thead><tr><th>${esc(labels.category)}</th><th class="num">${esc(labels.amount)}</th><th class="num">${esc(labels.share)}</th></tr></thead>
    <tbody>${catRows}</tbody>
  </table>`
      : ''
  }

  ${
    topMerchants.length
      ? `<h2>${esc(labels.topMerchants)}</h2>
  <table>
    <thead><tr><th>${esc(labels.merchant)}</th><th class="num">${esc(labels.amount)}</th><th class="num">${esc(labels.visits)}</th></tr></thead>
    <tbody>${merchantRows}</tbody>
  </table>`
      : ''
  }

  <div class="foot">NovaFi — ${esc(labels.title)} · ${year}</div>
</body>
</html>`;
}
