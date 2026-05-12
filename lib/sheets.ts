import { google } from 'googleapis';
import type {
  TaxSettings,
  Language,
  PaycheckEntry,
  Transaction,
  Account,
  Budget,
  Bill,
  Goal,
  NetWorthSnapshot,
} from '@/types';
import { DEFAULT_TAX_SETTINGS } from './utils';

function getSheetsClient(accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.sheets({ version: 'v4', auth });
}

// ── Settings ─────────────────────────────────────────────────────────────────

export async function getSettings(
  accessToken: string,
  spreadsheetId: string
): Promise<TaxSettings> {
  const sheets = getSheetsClient(accessToken);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Settings!A2:B100',
  });
  const rows = res.data.values ?? [];
  const map: Record<string, string> = {};
  for (const [k, v] of rows) map[k] = v;

  const get = (key: string, fallback: string) => map[key] ?? fallback;

  return {
    filingStatus: (get('filing_status', DEFAULT_TAX_SETTINGS.filingStatus)) as TaxSettings['filingStatus'],
    payPeriodsPerYear: Number(get('pay_periods_per_year', '26')),
    k401Pct: Number(get('k401_pct', '5')),
    hsaAnnual: Number(get('hsa_annual', '1600')),
    iraAnnual: Number(get('ira_annual', '0')),
    federalRate: Number(get('federal_rate', '22')),
    stateRate: Number(get('state_rate', '3.125')),
    cityRate: Number(get('city_rate', '1.5')),
    ficaSsRate: Number(get('fica_ss_rate', '6.2')),
    ficaSsWageBase: Number(get('fica_ss_wage_base', '176100')),
    ficaMedicareRate: Number(get('fica_medicare_rate', '1.45')),
    useFederalBrackets: get('use_federal_brackets', 'false') === 'true',
    excludeLoansFromNetWorth: get('exclude_loans_from_networth', 'false') === 'true',
    customExpenseCategories: get('custom_expense_categories', '').split('|').filter(Boolean),
    customIncomeCategories: get('custom_income_categories', '').split('|').filter(Boolean),
    hiddenExpenseCategories: get('hidden_expense_categories', '').split('|').filter(Boolean),
    hiddenIncomeCategories: get('hidden_income_categories', '').split('|').filter(Boolean),
    language: (get('language', 'en') as Language),
  };
}

export async function saveSettings(
  accessToken: string,
  spreadsheetId: string,
  settings: TaxSettings
): Promise<void> {
  const sheets = getSheetsClient(accessToken);
  const rows: [string, string][] = [
    ['filing_status', settings.filingStatus],
    ['pay_periods_per_year', String(settings.payPeriodsPerYear)],
    ['k401_pct', String(settings.k401Pct)],
    ['hsa_annual', String(settings.hsaAnnual)],
    ['ira_annual', String(settings.iraAnnual)],
    ['federal_rate', String(settings.federalRate)],
    ['state_rate', String(settings.stateRate)],
    ['city_rate', String(settings.cityRate)],
    ['fica_ss_rate', String(settings.ficaSsRate)],
    ['fica_ss_wage_base', String(settings.ficaSsWageBase)],
    ['fica_medicare_rate', String(settings.ficaMedicareRate)],
    ['use_federal_brackets', settings.useFederalBrackets ? 'true' : 'false'],
    ['exclude_loans_from_networth', settings.excludeLoansFromNetWorth ? 'true' : 'false'],
    ['custom_expense_categories', (settings.customExpenseCategories ?? []).join('|')],
    ['custom_income_categories', (settings.customIncomeCategories ?? []).join('|')],
    ['hidden_expense_categories', (settings.hiddenExpenseCategories ?? []).join('|')],
    ['hidden_income_categories', (settings.hiddenIncomeCategories ?? []).join('|')],
    ['language', settings.language ?? 'en'],
  ];
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'Settings!A2',
    valueInputOption: 'RAW',
    requestBody: { values: rows },
  });
}

// ── Paychecks ─────────────────────────────────────────────────────────────────

export async function getPaychecks(
  accessToken: string,
  spreadsheetId: string
): Promise<PaycheckEntry[]> {
  const sheets = getSheetsClient(accessToken);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Paychecks!A2:K1000',
  });
  return (res.data.values ?? []).map(rowToPaycheck);
}

function rowToPaycheck(r: string[]): PaycheckEntry {
  return {
    id: r[0] ?? '',
    date: r[1] ?? '',
    grossAmount: Number(r[2] ?? 0),
    federalWithheld: Number(r[3] ?? 0),
    stateWithheld: Number(r[4] ?? 0),
    localWithheld: Number(r[5] ?? 0),
    k401: Number(r[6] ?? 0),
    hsa: Number(r[7] ?? 0),
    netAmount: Number(r[8] ?? 0),
    notes: r[9] ?? '',
    gratuityAmount: Number(r[10] ?? 0),
  };
}

export async function addPaycheck(
  accessToken: string,
  spreadsheetId: string,
  entry: PaycheckEntry
): Promise<void> {
  const sheets = getSheetsClient(accessToken);
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'Paychecks!A1',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [[
        entry.id,
        entry.date,
        entry.grossAmount,
        entry.federalWithheld,
        entry.stateWithheld,
        entry.localWithheld,
        entry.k401,
        entry.hsa,
        entry.netAmount,
        entry.notes,
        entry.gratuityAmount ?? 0,
      ]],
    },
  });
}

export async function deletePaycheck(
  accessToken: string,
  spreadsheetId: string,
  id: string
): Promise<void> {
  await deleteRowById(accessToken, spreadsheetId, 'Paychecks', id, 'K');
}

// ── Transactions ──────────────────────────────────────────────────────────────

export async function getTransactions(
  accessToken: string,
  spreadsheetId: string
): Promise<Transaction[]> {
  const sheets = getSheetsClient(accessToken);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Transactions!A2:H1000',
  });
  return (res.data.values ?? []).map(rowToTransaction);
}

function rowToTransaction(r: string[]): Transaction {
  return {
    id: r[0] ?? '',
    date: r[1] ?? '',
    description: r[2] ?? '',
    amount: Number(r[3] ?? 0),
    type: (r[4] ?? 'expense') as Transaction['type'],
    category: r[5] ?? '',
    account: r[6] ?? '',
    toAccount: r[7] ?? '',
  };
}

export async function addTransaction(
  accessToken: string,
  spreadsheetId: string,
  tx: Transaction
): Promise<void> {
  const sheets = getSheetsClient(accessToken);
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'Transactions!A1',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [[tx.id, tx.date, tx.description, tx.amount, tx.type, tx.category, tx.account, tx.toAccount ?? '']],
    },
  });
}

export async function deleteTransaction(
  accessToken: string,
  spreadsheetId: string,
  id: string
): Promise<void> {
  await deleteRowById(accessToken, spreadsheetId, 'Transactions', id, 'H');
}

export async function updateTransaction(
  accessToken: string,
  spreadsheetId: string,
  tx: Transaction
): Promise<void> {
  await deleteRowById(accessToken, spreadsheetId, 'Transactions', tx.id, 'H');
  const sheets = getSheetsClient(accessToken);
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'Transactions!A1',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [[tx.id, tx.date, tx.description, tx.amount, tx.type, tx.category, tx.account, tx.toAccount ?? '']],
    },
  });
}

// ── Accounts ──────────────────────────────────────────────────────────────────

export async function getAccounts(
  accessToken: string,
  spreadsheetId: string
): Promise<Account[]> {
  const sheets = getSheetsClient(accessToken);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Accounts!A2:H200',
  });
  return (res.data.values ?? []).map((r) => ({
    id: r[0] ?? '',
    name: r[1] ?? '',
    type: (r[2] ?? 'checking') as Account['type'],
    institution: r[3] ?? '',
    balance: Number(r[4] ?? 0),
    last4: r[5] ?? '',
    color: r[6] ?? '#6366f1',
    createdAt: r[7] ?? '',
  }));
}

export async function upsertAccount(
  accessToken: string,
  spreadsheetId: string,
  account: Account
): Promise<void> {
  await deleteRowById(accessToken, spreadsheetId, 'Accounts', account.id, 'H');
  const sheets = getSheetsClient(accessToken);
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'Accounts!A1',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [[account.id, account.name, account.type, account.institution, account.balance, account.last4, account.color, account.createdAt]],
    },
  });
}

export async function deleteAccount(
  accessToken: string,
  spreadsheetId: string,
  id: string
): Promise<void> {
  await deleteRowById(accessToken, spreadsheetId, 'Accounts', id, 'H');
}

// ── Goals ─────────────────────────────────────────────────────────────────────

export async function getGoals(
  accessToken: string,
  spreadsheetId: string
): Promise<Goal[]> {
  const sheets = getSheetsClient(accessToken);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Goals!A2:H200',
  });
  const rows = res.data.values ?? [];
  return rows
    .map((r, i) => ({
      id: r[0] ?? '',
      name: r[1] ?? '',
      targetAmount: Number(r[2] ?? 0),
      currentAmount: Number(r[3] ?? 0),
      deadline: r[4] ?? '',
      icon: r[5] ?? '🎯',
      linkedAccountId: r[6] ?? '',
      position: r[7] !== undefined && r[7] !== '' ? Number(r[7]) : i,
    }))
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

export async function upsertGoal(
  accessToken: string,
  spreadsheetId: string,
  goal: Goal
): Promise<void> {
  const existing = await getGoals(accessToken, spreadsheetId);
  const maxPos = existing.reduce((m, g) => g.id !== goal.id ? Math.max(m, g.position ?? 0) : m, -1);
  const position = goal.position ?? maxPos + 1;
  await deleteRowById(accessToken, spreadsheetId, 'Goals', goal.id, 'H');
  const sheets = getSheetsClient(accessToken);
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'Goals!A1',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [[goal.id, goal.name, goal.targetAmount, goal.currentAmount, goal.deadline, goal.icon, goal.linkedAccountId ?? '', position]],
    },
  });
}

export async function reorderGoals(
  accessToken: string,
  spreadsheetId: string,
  items: { id: string; position: number }[]
): Promise<void> {
  const sheets = getSheetsClient(accessToken);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Goals!A2:A200',
  });
  const rows = res.data.values ?? [];
  const updates = items.map(({ id, position }) => {
    const rowIdx = rows.findIndex((r) => r[0] === id);
    if (rowIdx === -1) return null;
    const sheetRow = rowIdx + 2;
    return {
      range: `Goals!H${sheetRow}`,
      values: [[position]],
    };
  }).filter(Boolean) as { range: string; values: number[][] }[];

  if (updates.length === 0) return;
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: 'RAW', data: updates },
  });
}

export async function deleteGoal(
  accessToken: string,
  spreadsheetId: string,
  id: string
): Promise<void> {
  await deleteRowById(accessToken, spreadsheetId, 'Goals', id, 'H');
}

// ── Bills ─────────────────────────────────────────────────────────────────────

export async function getBills(
  accessToken: string,
  spreadsheetId: string
): Promise<Bill[]> {
  const sheets = getSheetsClient(accessToken);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Bills!A2:H200',
  });
  return (res.data.values ?? []).map((r) => ({
    id: r[0] ?? '',
    name: r[1] ?? '',
    amount: Number(r[2] ?? 0),
    frequency: (r[3] ?? 'monthly') as Bill['frequency'],
    nextDue: r[4] ?? '',
    account: r[5] ?? '',
    category: r[6] ?? '',
    isActive: r[7] === 'true',
  }));
}

export async function upsertBill(
  accessToken: string,
  spreadsheetId: string,
  bill: Bill
): Promise<void> {
  await deleteRowById(accessToken, spreadsheetId, 'Bills', bill.id, 'H');
  const sheets = getSheetsClient(accessToken);
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'Bills!A1',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [[bill.id, bill.name, bill.amount, bill.frequency, bill.nextDue, bill.account, bill.category, String(bill.isActive)]],
    },
  });
}

// ── Budgets ───────────────────────────────────────────────────────────────────

export async function getBudgets(
  accessToken: string,
  spreadsheetId: string
): Promise<Budget[]> {
  const sheets = getSheetsClient(accessToken);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Budgets!A2:E200',
  });
  const rows = res.data.values ?? [];
  return rows
    .map((r, i) => ({
      id: r[0] ?? '',
      category: r[1] ?? '',
      amount: Number(r[2] ?? 0),
      period: (r[3] ?? 'monthly') as Budget['period'],
      position: r[4] !== undefined && r[4] !== '' ? Number(r[4]) : i,
    }))
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

export async function upsertBudget(
  accessToken: string,
  spreadsheetId: string,
  budget: Budget
): Promise<void> {
  const existing = await getBudgets(accessToken, spreadsheetId);
  const maxPos = existing.reduce((m, b) => b.id !== budget.id ? Math.max(m, b.position ?? 0) : m, -1);
  const position = budget.position ?? maxPos + 1;
  await deleteRowById(accessToken, spreadsheetId, 'Budgets', budget.id, 'E');
  const sheets = getSheetsClient(accessToken);
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'Budgets!A1',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [[budget.id, budget.category, budget.amount, budget.period, position]],
    },
  });
}

export async function reorderBudgets(
  accessToken: string,
  spreadsheetId: string,
  items: { id: string; position: number }[]
): Promise<void> {
  const sheets = getSheetsClient(accessToken);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Budgets!A2:A200',
  });
  const rows = res.data.values ?? [];
  const updates = items.map(({ id, position }) => {
    const rowIdx = rows.findIndex((r) => r[0] === id);
    if (rowIdx === -1) return null;
    const sheetRow = rowIdx + 2; // 1-indexed + header
    return {
      range: `Budgets!E${sheetRow}`,
      values: [[position]],
    };
  }).filter(Boolean) as { range: string; values: number[][] }[];

  if (updates.length === 0) return;
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: 'RAW', data: updates },
  });
}

export async function deleteBudget(
  accessToken: string,
  spreadsheetId: string,
  id: string
): Promise<void> {
  await deleteRowById(accessToken, spreadsheetId, 'Budgets', id, 'E');
}

export async function deleteBill(
  accessToken: string,
  spreadsheetId: string,
  id: string
): Promise<void> {
  await deleteRowById(accessToken, spreadsheetId, 'Bills', id, 'H');
}

// ── Net Worth History ─────────────────────────────────────────────────────────

async function ensureNetWorthHistorySheet(
  accessToken: string,
  spreadsheetId: string
): Promise<void> {
  const sheets = getSheetsClient(accessToken);
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = meta.data.sheets?.some(
    (s) => s.properties?.title === 'NetWorthHistory'
  );
  if (exists) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title: 'NetWorthHistory' } } }],
    },
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'NetWorthHistory!A1',
    valueInputOption: 'RAW',
    requestBody: { values: [['id', 'date', 'month', 'netWorth']] },
  });
}

export async function getNetWorthHistory(
  accessToken: string,
  spreadsheetId: string
): Promise<NetWorthSnapshot[]> {
  const sheets = getSheetsClient(accessToken);
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'NetWorthHistory!A2:D1000',
    });
    return (res.data.values ?? []).map((r) => ({
      id: r[0] ?? '',
      date: r[1] ?? '',
      month: r[2] ?? '',
      netWorth: Number(r[3] ?? 0),
    }));
  } catch {
    await ensureNetWorthHistorySheet(accessToken, spreadsheetId);
    return [];
  }
}

export async function appendNetWorthSnapshot(
  accessToken: string,
  spreadsheetId: string,
  snapshot: NetWorthSnapshot
): Promise<void> {
  await ensureNetWorthHistorySheet(accessToken, spreadsheetId);
  const sheets = getSheetsClient(accessToken);
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'NetWorthHistory!A1',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [[snapshot.id, snapshot.date, snapshot.month, snapshot.netWorth]],
    },
  });
}

// ── Batch reads (reduces quota usage) ────────────────────────────────────────

/**
 * Fetches Bills, Budgets, and Transactions in a single batchGet API call.
 * Used by the /api/badges endpoint instead of 3 separate requests.
 */
export async function batchGetBadgesData(
  accessToken: string,
  spreadsheetId: string
): Promise<{ bills: Bill[]; budgets: Budget[]; transactions: Transaction[] }> {
  const sheets = getSheetsClient(accessToken);
  const ranges = [
    'Bills!A2:H200',
    'Budgets!A2:D200',
    'Transactions!A2:H1000',
  ];
  const res = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges });
  const vr = res.data.valueRanges ?? [];
  const bills: Bill[] = (vr[0]?.values ?? []).map((r) => ({
    id: r[0] ?? '',
    name: r[1] ?? '',
    amount: Number(r[2] ?? 0),
    frequency: (r[3] ?? 'monthly') as Bill['frequency'],
    nextDue: r[4] ?? '',
    account: r[5] ?? '',
    category: r[6] ?? '',
    isActive: r[7] === 'true',
  }));
  const budgets: Budget[] = (vr[1]?.values ?? []).map((r) => ({
    id: r[0] ?? '',
    category: r[1] ?? '',
    amount: Number(r[2] ?? 0),
    period: (r[3] ?? 'monthly') as Budget['period'],
  }));
  const transactions: Transaction[] = (vr[2]?.values ?? []).map((r) => ({
    id: r[0] ?? '',
    date: r[1] ?? '',
    description: r[2] ?? '',
    amount: Number(r[3] ?? 0),
    type: (r[4] ?? 'expense') as Transaction['type'],
    category: r[5] ?? '',
    account: r[6] ?? '',
    toAccount: r[7] ?? '',
  }));
  return { bills, budgets, transactions };
}

/**
 * Fetches all 6 main data sheets in a single batchGet API call.
 * Used by the dashboard instead of 6 separate requests.
 * NetWorthHistory is fetched separately because it may not exist yet.
 */
export async function batchGetDashboardData(
  accessToken: string,
  spreadsheetId: string
): Promise<{
  paychecks: PaycheckEntry[];
  transactions: Transaction[];
  accounts: Account[];
  bills: Bill[];
  budgets: Budget[];
  goals: Goal[];
}> {
  const sheets = getSheetsClient(accessToken);
  const ranges = [
    'Paychecks!A2:K1000',
    'Transactions!A2:H1000',
    'Accounts!A2:H200',
    'Bills!A2:H200',
    'Budgets!A2:D200',
    'Goals!A2:G200',
  ];
  const res = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges });
  const vr = res.data.valueRanges ?? [];

  const paychecks: PaycheckEntry[] = (vr[0]?.values ?? []).map((r) => ({
    id: r[0] ?? '',
    date: r[1] ?? '',
    grossAmount: Number(r[2] ?? 0),
    federalWithheld: Number(r[3] ?? 0),
    stateWithheld: Number(r[4] ?? 0),
    localWithheld: Number(r[5] ?? 0),
    k401: Number(r[6] ?? 0),
    hsa: Number(r[7] ?? 0),
    netAmount: Number(r[8] ?? 0),
    notes: r[9] ?? '',
    gratuityAmount: Number(r[10] ?? 0),
  }));
  const transactions: Transaction[] = (vr[1]?.values ?? []).map((r) => ({
    id: r[0] ?? '',
    date: r[1] ?? '',
    description: r[2] ?? '',
    amount: Number(r[3] ?? 0),
    type: (r[4] ?? 'expense') as Transaction['type'],
    category: r[5] ?? '',
    account: r[6] ?? '',
    toAccount: r[7] ?? '',
  }));
  const accounts: Account[] = (vr[2]?.values ?? []).map((r) => ({
    id: r[0] ?? '',
    name: r[1] ?? '',
    type: (r[2] ?? 'checking') as Account['type'],
    institution: r[3] ?? '',
    balance: Number(r[4] ?? 0),
    last4: r[5] ?? '',
    color: r[6] ?? '#6366f1',
    createdAt: r[7] ?? '',
  }));
  const bills: Bill[] = (vr[3]?.values ?? []).map((r) => ({
    id: r[0] ?? '',
    name: r[1] ?? '',
    amount: Number(r[2] ?? 0),
    frequency: (r[3] ?? 'monthly') as Bill['frequency'],
    nextDue: r[4] ?? '',
    account: r[5] ?? '',
    category: r[6] ?? '',
    isActive: r[7] === 'true',
  }));
  const budgets: Budget[] = (vr[4]?.values ?? []).map((r) => ({
    id: r[0] ?? '',
    category: r[1] ?? '',
    amount: Number(r[2] ?? 0),
    period: (r[3] ?? 'monthly') as Budget['period'],
  }));
  const goals: Goal[] = (vr[5]?.values ?? []).map((r) => ({
    id: r[0] ?? '',
    name: r[1] ?? '',
    targetAmount: Number(r[2] ?? 0),
    currentAmount: Number(r[3] ?? 0),
    deadline: r[4] ?? '',
    icon: r[5] ?? '🎯',
    linkedAccountId: r[6] ?? '',
  }));

  return { paychecks, transactions, accounts, bills, budgets, goals };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function deleteRowById(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string,
  id: string,
  _lastCol: string
) {
  const sheets = getSheetsClient(accessToken);
  const sheetMeta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheetObj = sheetMeta.data.sheets?.find(
    (s) => s.properties?.title === sheetName
  );
  if (!sheetObj) return;
  const sheetId = sheetObj.properties?.sheetId ?? 0;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A2:A2000`,
  });
  const ids = (res.data.values ?? []).map((r) => r[0]);
  const rowIndex = ids.indexOf(id);
  if (rowIndex === -1) return;

  const rowNumber = rowIndex + 2; // 1-indexed, skip header
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId,
              dimension: 'ROWS',
              startIndex: rowNumber - 1,
              endIndex: rowNumber,
            },
          },
        },
      ],
    },
  });
}
