/**
 * DEV-ONLY seed data for the in-memory Sheets mock (lib/devMock.ts). Three
 * profiles stress different users:
 *  - extreme:  billion-dollar balances, very long English + Vietnamese names and
 *              descriptions, long tags, >2,000 transactions over 14 months,
 *              real subscriptions next to look-alike restaurant spending.
 *  - negative: debt-heavy — overdrawn checking, a card over its limit, a big
 *              loan, overdue bills → negative net worth and every warning.
 *  - empty:    brand-new user (settings only) → empty states + setup checklist.
 * Deterministic (seeded PRNG) and dated relative to "today", so it always looks
 * current. Rows follow the exact column layouts in lib/sheets.ts.
 */
export type MockProfile = 'extreme' | 'negative' | 'empty';
type Cell = string | number | boolean;

const HEADERS: Record<string, string[]> = {
  Settings: ['key', 'value'],
  Accounts: ['id', 'name', 'type', 'institution', 'balance', 'last4', 'color', 'created_at', 'opening_balance', 'credit_limit', 'statement_day', 'apr', 'monthly_payment', 'term_months', 'payment_account_id', 'min_balance', 'due_day', 'min_payment'],
  Transactions: ['id', 'date', 'description', 'amount', 'type', 'category', 'account', 'to_account', 'created_at', 'split_group_id', 'tags'],
  Paychecks: ['id', 'date', 'gross_amount', 'federal_withheld', 'state_withheld', 'local_withheld', 'k401', 'hsa', 'net_amount', 'notes', 'gratuity', 'fica'],
  Budgets: ['id', 'category', 'amount', 'period', 'position'],
  Bills: ['id', 'name', 'amount', 'frequency', 'next_due', 'account', 'category', 'is_active', 'split_contact_id', 'split_amount', 'split_participants', 'variable', 'loan_account_id'],
  Goals: ['id', 'name', 'target_amount', 'current_amount', 'deadline', 'icon', 'linked_account_id', 'position'],
  NetWorthHistory: ['id', 'date', 'month', 'netWorth', 'creditUtil', 'total', 'liquid'],
  Subscriptions: ['id', 'merchant', 'amount', 'frequency', 'start_date', 'category', 'account', 'is_active', 'notes'],
};

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const cents = (n: number) => Math.round(n * 100) / 100;

function settings(displayName: string, extra: [string, string][] = []): Cell[][] {
  return [
    ['display_name', displayName], ['filing_status', 'single'], ['pay_periods_per_year', '26'],
    ['k401_pct', '5'], ['hsa_annual', '1600'], ['ira_annual', '0'], ['federal_rate', '22'],
    ['state_rate', '3.125'], ['city_rate', '1.5'], ['fica_ss_rate', '6.2'], ['fica_ss_wage_base', '176100'],
    ['fica_medicare_rate', '1.45'], ['use_federal_brackets', 'false'], ['exclude_loans_from_networth', 'false'],
    ['budget_rollover', 'true'], ['language', 'en'], ['time_zone', 'America/New_York'], ...extra,
  ];
}

export function buildFixture(profile: MockProfile, today = new Date()): Record<string, Cell[][]> {
  const tabs: Record<string, Cell[][]> = Object.fromEntries(Object.entries(HEADERS).map(([k, h]) => [k, [h]]));
  const push = (tab: string, ...rows: Cell[][]) => tabs[tab].push(...rows);

  if (profile === 'empty') {
    push('Settings', ...settings(''));
    return tabs;
  }

  const r = rng(profile === 'extreme' ? 42 : 7);
  const big = profile === 'extreme';
  let txN = 0;
  const tx = (date: Date, description: string, amount: number, type: 'income' | 'expense' | 'transfer', category: string, account: string, toAccount = '', tags = '') =>
    push('Transactions', [`mtx_${++txN}`, iso(date), description, cents(amount), type, category, account, toAccount, `${iso(date)}T12:00:${String(txN % 60).padStart(2, '0')}.000Z`, '', tags]);

  if (big) {
    push('Settings', ...settings('Nguyễn Thị Phương Thảo Elizabeth-Alexandra Montgomery', [
      ['custom_expense_categories', 'Chi phí sinh hoạt gia đình hàng tháng rất dài|Pet care & veterinary insurance premiums'],
    ]));
    push('Accounts',
      ['chk', 'Everyday Checking — Joint Household Account With An Unusually Long Display Name', 'checking', 'JPMorgan Chase Bank, National Association', 9876543210.99, '4821', '#2563eb', '2024-01-02', 1000, '', '', '', '', '', '', 2500, '', ''],
      ['sav', 'Tài khoản tiết kiệm Ngân hàng TMCP Ngoại thương Việt Nam (Vietcombank) kỳ hạn linh hoạt', 'savings', 'Vietcombank', 1234567.89, '0099', '#059669', '2024-01-02', 500, '', '', 4.25, '', '', '', '', '', ''],
      ['cash', 'Cash', 'cash', '', 42.5, '', '#64748b', '2024-01-02', 0, '', '', '', '', '', '', '', '', ''],
      ['cc1', 'Chase Sapphire Preferred Visa Signature Travel Rewards', 'credit', 'Chase', 18750.45, '7731', '#1e3a8a', '2024-01-02', 0, 25000, 28, 24.99, '', '', '', '', 25, 375],
      ['cc2', 'Amex Gold', 'credit', 'American Express', -150, '1002', '#ca8a04', '2024-01-02', 0, 5000, 3, 29.99, '', '', '', '', 28, 40],
      ['loan', 'Mortgage — 30-year fixed, primary residence (refinanced)', 'loan', 'Wells Fargo Home Mortgage', 2450000, '', '#b91c1c', '2024-01-02', 2600000, '', '', 6.5, 15500, 360, 'chk', '', '', ''],
      ['inv', 'Robinhood Brokerage — Individual Taxable Account', 'investment', 'Robinhood', 98765432.1, '', '#16a34a', '2024-01-02', 50000000, '', '', '', '', '', '', '', '', ''],
    );
  } else {
    push('Settings', ...settings('Sam', [['exclude_loans_from_networth', 'false']]));
    push('Accounts',
      ['chk', 'Checking', 'checking', 'Local Credit Union', -245.18, '1111', '#2563eb', '2025-06-01', 300, '', '', '', '', '', '', 100, '', ''],
      ['cc1', 'Platinum Card', 'credit', 'Capital One', 5320.77, '2222', '#1e3a8a', '2025-06-01', 0, 5000, 12, 27.99, '', '', '', '', 7, 135],
      ['loan', 'Student Loan', 'loan', 'Nelnet', 48210.33, '', '#b91c1c', '2025-06-01', 52000, '', '', 6.8, 520, 120, 'chk', '', '', ''],
      ['car', 'Auto Loan', 'loan', 'Ally', 21400, '', '#b91c1c', '2025-06-01', 25000, '', '', 9.5, 480, 60, 'chk', '', '', ''],
    );
  }

  // ~14 months of activity
  const start = new Date(today.getFullYear(), today.getMonth() - 13, 1);
  const pay = big ? 125000 : 1850;
  const spendScale = big ? 40 : 1;
  const longDescs = [
    'PAYPAL *SUPERLONGMERCHANTNAMETHATKEEPSGOINGANDGOINGWITHOUTSPACES 4029357733 CA',
    'Thanh toán hóa đơn tiền điện EVN Hà Nội kỳ tháng này (bao gồm thuế GTGT)',
    'Whole Foods Market #10234 Brooklyn NY — weekly groceries for the whole family',
  ];
  const everyday: [string, string, number][] = [
    ['Chick-fil-A', 'Food', 14], ['Starbucks', 'Food', 7], ['Trader Joe\'s', 'Grocery', 85],
    ['Shell Gas Station', 'Transportation', 48], ['Target', 'Shopping', 64], ['CVS Pharmacy', 'Health', 22],
  ];
  for (let d = new Date(start); d <= today; d = addDays(d, 1)) {
    const dom = d.getDate();
    if (dom === 1 || dom === 15) tx(d, big ? 'ACME GLOBAL HOLDINGS PAYROLL DIRECT DEPOSIT — SEMI-MONTHLY' : 'Payroll', pay, 'income', 'Paycheck', 'chk');
    const perDay = big ? 7 : 1;
    for (let k = 0; k < perDay; k++) {
      if (r() < 0.25) continue;
      const [name, cat, base] = everyday[Math.floor(r() * everyday.length)];
      const desc = big && r() < 0.08 ? longDescs[Math.floor(r() * longDescs.length)] : name;
      const tags = big && r() < 0.05 ? 'Japan trip 2026 with the whole extended family|Work' : big && r() < 0.03 ? 'Chuyến du lịch Đà Nẵng' : '';
      tx(d, desc, base * spendScale * (0.5 + r()), 'expense', cat, r() < 0.6 ? 'cc1' : 'chk', '', tags);
    }
    if (dom === 5) tx(d, 'Netflix.com', d < addDays(today, -120) ? 15.49 : 17.99, 'expense', 'Entertainment', 'cc1');
    if (dom === 9) tx(d, 'SPOTIFY USA', 11.99, 'expense', 'Entertainment', 'cc1');
    if (dom === 20) tx(d, 'Planet Fitness Monthly Club Fee', 24.99, 'expense', 'Health', 'chk');
    if (dom === 3) tx(d, 'Rent — Apartment 12B', big ? 18500 : 1450, 'expense', 'Bills', 'chk');
    if (dom === 26) tx(d, 'Card payment', big ? 30000 : 150, 'transfer', 'Transfer', 'chk', 'cc1');
    if (dom === 10 && big) tx(d, 'Mortgage payment (principal)', 2300, 'transfer', 'Loan', 'chk', 'loan');
    if (dom === 10 && big) tx(d, 'Mortgage payment (interest)', 13200, 'expense', 'Loan', 'chk');
  }

  push('Bills',
    ['b1', big ? 'Comcast Xfinity Internet + TV + Home Phone Triple Play Bundle (promotional rate ends soon)' : 'Internet', big ? 289.99 : 79.99, 'monthly', iso(addDays(today, -4)), 'chk', 'Bills', 'true', '', '', '', 'false', ''],
    ['b2', 'Electric — Con Edison', 142.3, 'monthly', iso(addDays(today, 2)), 'chk', 'Bills', 'true', '', '', '', 'true', ''],
    ['b3', 'Car insurance (6-month premium)', big ? 9876543.21 : 640, 'yearly', iso(addDays(today, 9)), 'cc1', 'Bills', 'true', '', '', '', 'false', ''],
    ['b4', 'Gym (paused)', 30, 'monthly', iso(addDays(today, 15)), 'chk', 'Health', 'false', '', '', '', 'false', ''],
  );
  push('Budgets',
    ['bud1', 'Food', big ? 900 : 250, 'monthly', 0],
    ['bud2', 'Grocery', big ? 120000 : 300, 'monthly', 1],
    ['bud3', 'Shopping', big ? 50 : 100, 'weekly', 2],
    ['bud4', 'Entertainment', 40, 'monthly', 3],
  );
  push('Goals',
    ['g1', big ? 'Emergency fund covering twelve full months of household expenses in high-yield savings' : 'Emergency fund', big ? 1000000000 : 3000, big ? 12.5 : 0, iso(addDays(today, 400)), '🛟', big ? 'sav' : '', 0],
    ['g2', big ? 'Chuyến du lịch Nhật Bản cùng cả gia đình năm 2027' : 'Pay off card', big ? 25000 : 5320, big ? 26000 : 0, iso(addDays(today, 90)), '✈️', '', 1],
  );
  push('Paychecks',
    ['p1', iso(addDays(today, -14)), pay * 1.3, pay * 0.12, pay * 0.04, pay * 0.01, pay * 0.05, 30, pay, big ? 'Includes Q3 retention bonus + RSU vest true-up (see HR email)' : '', 0, pay * 0.0765],
  );
  push('Subscriptions',
    ['s1', big ? 'Adobe Creative Cloud All Apps — Teams License (annual, billed monthly)' : 'Netflix', big ? 89.99 : 17.99, 'monthly', '2025-01-05', 'Entertainment', 'cc1', 'true', ''],
    ['s2', 'Old magazine', 9.99, 'monthly', '2024-02-01', 'Entertainment', 'chk', 'true', 'probably unused'],
  );
  const hist = [6, 4, 2].map((back) => {
    const d = new Date(today.getFullYear(), today.getMonth() - back, 28);
    const v = big ? 10_000_000_000 - back * 1e8 : -60000 - back * 900;
    return [`nw_${iso(d).slice(0, 7)}`, iso(d), iso(d).slice(0, 7), v, big ? 75 : 106, v, big ? v + 2450000 : v + 69610];
  });
  push('NetWorthHistory', ...hist);
  return tabs;
}
