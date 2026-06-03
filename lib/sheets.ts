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
  Contact,
  Split,
  Loan,
} from '@/types';
import { DEFAULT_TAX_SETTINGS } from './utils';
import { withRetryProxy } from './retry';

function getSheetsClient(accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  // Wrap so every Sheets API call transparently retries transient rate-limit /
  // network errors (see lib/retry.ts) — the main resilience win for scaling.
  return withRetryProxy(google.sheets({ version: 'v4', auth }));
}

// ── Sheet-ID cache ──────────────────────────────────────────────────────────
// A tab's numeric sheetId is stable for the spreadsheet's lifetime, but several
// write paths (row deletes) need it. Caching avoids a `spreadsheets.get` metadata
// round-trip on every write — cutting those operations from ~3 API calls to ~2.
const sheetIdCache = new Map<string, number>(); // key: `${spreadsheetId}:${title}`

type SheetsClient = ReturnType<typeof getSheetsClient>;

async function getSheetId(
  sheets: SheetsClient,
  spreadsheetId: string,
  title: string,
): Promise<number | null> {
  const key = `${spreadsheetId}:${title}`;
  const cached = sheetIdCache.get(key);
  if (cached !== undefined) return cached;
  // One metadata fetch populates every tab's id for this spreadsheet.
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  for (const s of meta.data.sheets ?? []) {
    const t = s.properties?.title;
    const id = s.properties?.sheetId;
    if (t && typeof id === 'number') sheetIdCache.set(`${spreadsheetId}:${t}`, id);
  }
  return sheetIdCache.get(key) ?? null;
}

// Drops cached ids for a spreadsheet (call after adding/removing a tab).
function invalidateSheetIdCache(spreadsheetId: string): void {
  for (const key of sheetIdCache.keys()) {
    if (key.startsWith(`${spreadsheetId}:`)) sheetIdCache.delete(key);
  }
}

// Creates a tab (with its header row) on demand if it doesn't exist yet. Lets
// features added after a user's spreadsheet was provisioned (Contacts, Splits)
// work without a migration — the tab is materialized on first read/write.
async function ensureSheet(
  sheets: SheetsClient,
  spreadsheetId: string,
  title: string,
  header: string[],
): Promise<void> {
  const existingId = await getSheetId(sheets, spreadsheetId, title);
  if (existingId !== null) return;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title } } }] },
  });
  invalidateSheetIdCache(spreadsheetId); // new tab → refresh cached ids on next read
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${title}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [header] },
  });
}

const CONTACTS_HEADER = ['id', 'name', 'created_at'];
const SPLITS_HEADER = [
  'id', 'bill_id', 'bill_name', 'contact_id', 'contact_name', 'amount',
  'category', 'account', 'date', 'settled', 'settled_date',
  'fronted_tx_id', 'settle_tx_id',
];
const LOANS_HEADER = [
  'id', 'direction', 'contact_id', 'contact_name', 'account', 'principal',
  'repaid_amount', 'date', 'note', 'settled', 'settled_date',
  'principal_tx_id', 'repayment_tx_ids', 'category',
];

// A `values.get` against a tab that doesn't exist fails with HTTP 400 ("Unable
// to parse range"). We use that to distinguish "tab not provisioned yet" (lazy-
// create it) from real failures (network/auth/5xx), which must propagate rather
// than be masked as an empty result.
function isMissingTabError(err: unknown): boolean {
  const e = err as { code?: number; status?: number; message?: string } | null;
  const code = e?.code ?? e?.status;
  const msg = String(e?.message ?? '');
  return code === 400 || /Unable to parse range/i.test(msg);
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
    displayName: get('display_name', ''),
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
    budgetRollover: get('budget_rollover', 'false') === 'true',
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
    ['display_name', settings.displayName ?? ''],
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
    ['budget_rollover', settings.budgetRollover ? 'true' : 'false'],
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
    range: 'Paychecks!A2:L',
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
    ficaWithheld: Number(r[11] ?? 0),
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
        entry.ficaWithheld ?? 0,
      ]],
    },
  });
}

export async function deletePaycheck(
  accessToken: string,
  spreadsheetId: string,
  id: string
): Promise<void> {
  await deleteRowById(accessToken, spreadsheetId, 'Paychecks', id, 'L');
}

// ── Transactions ──────────────────────────────────────────────────────────────

export async function getTransactions(
  accessToken: string,
  spreadsheetId: string
): Promise<Transaction[]> {
  const sheets = getSheetsClient(accessToken);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Transactions!A2:I',
    valueRenderOption: 'UNFORMATTED_VALUE',
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
    createdAt: r[8] ?? '',
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
      values: [[tx.id, tx.date, tx.description, tx.amount, tx.type, tx.category, tx.account, tx.toAccount ?? '', tx.createdAt ?? '']],
    },
  });
}

export async function deleteTransaction(
  accessToken: string,
  spreadsheetId: string,
  id: string
): Promise<void> {
  await deleteRowById(accessToken, spreadsheetId, 'Transactions', id, 'I');
}

export async function updateTransaction(
  accessToken: string,
  spreadsheetId: string,
  tx: Transaction
): Promise<void> {
  await deleteRowById(accessToken, spreadsheetId, 'Transactions', tx.id, 'I');
  const sheets = getSheetsClient(accessToken);
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'Transactions!A1',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [[tx.id, tx.date, tx.description, tx.amount, tx.type, tx.category, tx.account, tx.toAccount ?? '', tx.createdAt ?? '']],
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
    range: 'Accounts!A2:I200',
    // Raw cell value: a currency-formatted cell stays a number rather than
    // coming back as "$100.00" → NaN.
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  return (res.data.values ?? []).map(rowToAccount);
}

function rowToAccount(r: string[]): Account {
  return {
    id: String(r[0] ?? ''),
    name: String(r[1] ?? ''),
    type: (r[2] ?? 'checking') as Account['type'],
    institution: String(r[3] ?? ''),
    balance: Number(r[4]) || 0,
    last4: String(r[5] ?? ''),
    color: String(r[6] ?? '#6366f1'),
    createdAt: String(r[7] ?? ''),
    // Column I is optional: the starting balance captured when the account was
    // created. Empty/blank → undefined (not 0).
    openingBalance: r[8] === undefined || r[8] === '' ? undefined : Number(r[8]),
  };
}

export async function upsertAccount(
  accessToken: string,
  spreadsheetId: string,
  account: Account
): Promise<void> {
  await deleteRowById(accessToken, spreadsheetId, 'Accounts', account.id, 'I');
  const sheets = getSheetsClient(accessToken);
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'Accounts!A1',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [[account.id, account.name, account.type, account.institution, account.balance, account.last4, account.color, account.createdAt, account.openingBalance ?? '']],
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
  return parseGoals(res.data.values ?? []);
}

function rowToGoal(r: string[], i: number): Goal {
  return {
    id: r[0] ?? '',
    name: r[1] ?? '',
    targetAmount: Number(r[2] ?? 0),
    currentAmount: Number(r[3] ?? 0),
    deadline: r[4] ?? '',
    icon: r[5] ?? '🎯',
    linkedAccountId: r[6] ?? '',
    position: r[7] !== undefined && r[7] !== '' ? Number(r[7]) : i,
  };
}

function parseGoals(rows: string[][]): Goal[] {
  return rows.map(rowToGoal).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
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
    range: 'Bills!A2:K200',
  });
  return (res.data.values ?? []).map(rowToBill);
}

// Shared Bill row parser. Columns I/J (legacy single split) and K (multi-person
// split participants, JSON) are absent on older rows → the bill is treated as
// unsplit or single-split respectively.
function rowToBill(r: string[]): Bill {
  const splitContactId = r[8] ?? '';
  return {
    id: r[0] ?? '',
    name: r[1] ?? '',
    amount: Number(r[2] ?? 0),
    frequency: (r[3] ?? 'monthly') as Bill['frequency'],
    nextDue: r[4] ?? '',
    account: r[5] ?? '',
    category: r[6] ?? '',
    isActive: r[7] === 'true',
    splitContactId,
    splitAmount: splitContactId && r[9] !== undefined && r[9] !== '' ? Number(r[9]) : undefined,
    splitParticipants: parseBillParticipants(r[10]),
  };
}

// Column K stores the multi-person split as a JSON array of {contactId, amount}.
// Tolerant of blank/legacy/corrupt cells (→ undefined, i.e. fall back to legacy).
function parseBillParticipants(cell: string | undefined): Bill['splitParticipants'] {
  if (!cell) return undefined;
  try {
    const parsed = JSON.parse(cell);
    if (!Array.isArray(parsed)) return undefined;
    const rows = parsed
      .map((p) => ({ contactId: String(p?.contactId ?? ''), amount: Number(p?.amount ?? 0) }))
      .filter((p) => p.contactId && p.amount > 0);
    return rows.length > 0 ? rows : undefined;
  } catch {
    return undefined;
  }
}

export async function upsertBill(
  accessToken: string,
  spreadsheetId: string,
  bill: Bill
): Promise<void> {
  await deleteRowById(accessToken, spreadsheetId, 'Bills', bill.id, 'K');
  const sheets = getSheetsClient(accessToken);
  const participants = bill.splitParticipants && bill.splitParticipants.length > 0
    ? JSON.stringify(bill.splitParticipants)
    : '';
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'Bills!A1',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [[
        bill.id, bill.name, bill.amount, bill.frequency, bill.nextDue,
        bill.account, bill.category, String(bill.isActive),
        bill.splitContactId ?? '', bill.splitAmount ?? '', participants,
      ]],
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
  return parseBudgets(res.data.values ?? []);
}

function rowToBudget(r: string[], i: number): Budget {
  return {
    id: r[0] ?? '',
    category: r[1] ?? '',
    amount: Number(r[2] ?? 0),
    period: (r[3] ?? 'monthly') as Budget['period'],
    position: r[4] !== undefined && r[4] !== '' ? Number(r[4]) : i,
  };
}

function parseBudgets(rows: string[][]): Budget[] {
  return rows.map(rowToBudget).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
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
  await deleteRowById(accessToken, spreadsheetId, 'Bills', id, 'J');
}

// ── Contacts (people you split bills with) ─────────────────────────────────────

export async function getContacts(
  accessToken: string,
  spreadsheetId: string
): Promise<Contact[]> {
  const sheets = getSheetsClient(accessToken);
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Contacts!A2:C500',
    });
    return (res.data.values ?? []).map((r) => ({
      id: r[0] ?? '',
      name: r[1] ?? '',
      createdAt: r[2] ?? '',
    }));
  } catch (err) {
    // Only treat a missing tab (spreadsheet provisioned before this feature) as
    // "empty + create"; let real errors surface.
    if (!isMissingTabError(err)) throw err;
    await ensureSheet(sheets, spreadsheetId, 'Contacts', CONTACTS_HEADER);
    return [];
  }
}

export async function upsertContact(
  accessToken: string,
  spreadsheetId: string,
  contact: Contact
): Promise<void> {
  const sheets = getSheetsClient(accessToken);
  await ensureSheet(sheets, spreadsheetId, 'Contacts', CONTACTS_HEADER);
  await deleteRowById(accessToken, spreadsheetId, 'Contacts', contact.id, 'C');
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'Contacts!A1',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [[contact.id, contact.name, contact.createdAt]] },
  });
}

export async function deleteContact(
  accessToken: string,
  spreadsheetId: string,
  id: string
): Promise<void> {
  await deleteRowById(accessToken, spreadsheetId, 'Contacts', id, 'C');
}

// ── Splits (per-payment "owed to you" records) ─────────────────────────────────

export async function getSplits(
  accessToken: string,
  spreadsheetId: string
): Promise<Split[]> {
  const sheets = getSheetsClient(accessToken);
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Splits!A2:M1000',
    });
    return (res.data.values ?? []).map((r) => ({
      id: r[0] ?? '',
      billId: r[1] ?? '',
      billName: r[2] ?? '',
      contactId: r[3] ?? '',
      contactName: r[4] ?? '',
      amount: Number(r[5] ?? 0),
      category: r[6] ?? '',
      account: r[7] ?? '',
      date: r[8] ?? '',
      settled: r[9] === 'true',
      settledDate: r[10] ?? '',
      frontedTxId: r[11] ?? '',
      settleTxId: r[12] ?? '',
    }));
  } catch (err) {
    if (!isMissingTabError(err)) throw err;
    await ensureSheet(sheets, spreadsheetId, 'Splits', SPLITS_HEADER);
    return [];
  }
}

export async function upsertSplit(
  accessToken: string,
  spreadsheetId: string,
  split: Split
): Promise<void> {
  const sheets = getSheetsClient(accessToken);
  await ensureSheet(sheets, spreadsheetId, 'Splits', SPLITS_HEADER);
  await deleteRowById(accessToken, spreadsheetId, 'Splits', split.id, 'M');
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'Splits!A1',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [[
        split.id, split.billId, split.billName, split.contactId, split.contactName,
        split.amount, split.category, split.account, split.date,
        String(split.settled), split.settledDate,
        split.frontedTxId ?? '', split.settleTxId ?? '',
      ]],
    },
  });
}

export async function deleteSplit(
  accessToken: string,
  spreadsheetId: string,
  id: string
): Promise<void> {
  await deleteRowById(accessToken, spreadsheetId, 'Splits', id, 'M');
}

// ── Loans (personal lend/borrow IOUs) ──────────────────────────────────────────

export async function getLoans(
  accessToken: string,
  spreadsheetId: string
): Promise<Loan[]> {
  const sheets = getSheetsClient(accessToken);
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Loans!A2:N1000',
    });
    return (res.data.values ?? []).map((r) => ({
      id: r[0] ?? '',
      direction: (r[1] === 'borrowed' ? 'borrowed' : 'lent') as Loan['direction'],
      contactId: r[2] ?? '',
      contactName: r[3] ?? '',
      account: r[4] ?? '',
      principal: Number(r[5] ?? 0),
      repaidAmount: Number(r[6] ?? 0),
      date: r[7] ?? '',
      note: r[8] ?? '',
      settled: r[9] === 'true',
      settledDate: r[10] ?? '',
      principalTxId: r[11] ?? '',
      repaymentTxIds: String(r[12] ?? '').split('|').filter(Boolean),
      category: r[13] ?? '', // legacy rows (col absent) → uncategorized
    }));
  } catch (err) {
    if (!isMissingTabError(err)) throw err;
    await ensureSheet(sheets, spreadsheetId, 'Loans', LOANS_HEADER);
    return [];
  }
}

export async function upsertLoan(
  accessToken: string,
  spreadsheetId: string,
  loan: Loan
): Promise<void> {
  const sheets = getSheetsClient(accessToken);
  await ensureSheet(sheets, spreadsheetId, 'Loans', LOANS_HEADER);
  await deleteRowById(accessToken, spreadsheetId, 'Loans', loan.id, 'M');
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'Loans!A1',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [[
        loan.id, loan.direction, loan.contactId, loan.contactName, loan.account,
        loan.principal, loan.repaidAmount, loan.date, loan.note,
        String(loan.settled), loan.settledDate, loan.principalTxId,
        (loan.repaymentTxIds ?? []).join('|'), loan.category ?? '',
      ]],
    },
  });
}

export async function deleteLoan(
  accessToken: string,
  spreadsheetId: string,
  id: string
): Promise<void> {
  await deleteRowById(accessToken, spreadsheetId, 'Loans', id, 'M');
}

// ── Net Worth History ─────────────────────────────────────────────────────────

async function ensureNetWorthHistorySheet(
  accessToken: string,
  spreadsheetId: string
): Promise<void> {
  const sheets = getSheetsClient(accessToken);
  const existingId = await getSheetId(sheets, spreadsheetId, 'NetWorthHistory');
  if (existingId !== null) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title: 'NetWorthHistory' } } }],
    },
  });
  invalidateSheetIdCache(spreadsheetId); // new tab → refresh cached ids on next read
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
      range: 'NetWorthHistory!A2:D',
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

  // When snapshots reach 1000, drop the oldest 500 to keep the sheet lean.
  const countRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'NetWorthHistory!A2:A',
  });
  const rowCount = (countRes.data.values ?? []).length;
  if (rowCount >= 1000) {
    const sheetId = (await getSheetId(sheets, spreadsheetId, 'NetWorthHistory')) ?? 0;
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          deleteDimension: {
            range: {
              sheetId,
              dimension: 'ROWS',
              startIndex: 1,   // row 2 (oldest data row), 0-indexed
              endIndex: 501,   // delete 500 rows
            },
          },
        }],
      },
    });
  }
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
    'Bills!A2:K200',
    'Budgets!A2:D200',
    'Transactions!A2:I',
  ];
  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges,
    // Numeric cells must come back as numbers — currency-formatted cells
    // would otherwise return "$100.00" strings that Number() turns into NaN.
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const vr = res.data.valueRanges ?? [];
  const bills: Bill[] = (vr[0]?.values ?? []).map(rowToBill);
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
    createdAt: r[8] ?? '',
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
    'Paychecks!A2:L',
    'Transactions!A2:I',
    'Accounts!A2:I200',
    'Bills!A2:K200',
    'Budgets!A2:D200',
    'Goals!A2:G200',
  ];
  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges,
    // Numeric cells must come back as numbers — currency-formatted cells
    // would otherwise return "$100.00" strings that Number() turns into NaN.
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
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
    ficaWithheld: Number(r[11] ?? 0),
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
    createdAt: r[8] ?? '',
  }));
  const accounts: Account[] = (vr[2]?.values ?? []).map((r) => ({
    id: String(r[0] ?? ''),
    name: String(r[1] ?? ''),
    type: (r[2] ?? 'checking') as Account['type'],
    institution: String(r[3] ?? ''),
    balance: Number(r[4]) || 0,
    last4: String(r[5] ?? ''),
    color: String(r[6] ?? '#6366f1'),
    createdAt: String(r[7] ?? ''),
    openingBalance: r[8] === undefined || r[8] === '' ? undefined : Number(r[8]),
  }));
  const bills: Bill[] = (vr[3]?.values ?? []).map(rowToBill);
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

/**
 * Generic multi-sheet batch read used by the /api/batch endpoint so a page can
 * pull everything it needs in one round trip (and one Sheets quota hit) instead
 * of N parallel requests — same idea as batchGetDashboardData, but driven by the
 * caller's requested keys.
 *
 * The always-present sheets are fetched in a single spreadsheets.values.batchGet.
 * Contacts/Splits are NOT batched: their tabs may not exist on older spreadsheets
 * and a missing range fails the whole batchGet — so they go through their own
 * getters, which auto-create the tab on first use. All reads run concurrently.
 */
export type BatchKey = keyof BatchResult;

type BatchResult = {
  accounts: Account[];
  transactions: Transaction[];
  bills: Bill[];
  paychecks: PaycheckEntry[];
  budgets: Budget[];
  goals: Goal[];
  contacts: Contact[];
  splits: Split[];
};

// Sheets that always exist and carry no auto-create fallback — safe to batchGet.
const BATCHABLE_SHEETS: Record<
  Exclude<BatchKey, 'contacts' | 'splits'>,
  { range: string; parse: (rows: string[][]) => unknown[] }
> = {
  accounts:     { range: 'Accounts!A2:I200',  parse: (rows) => rows.map(rowToAccount) },
  transactions: { range: 'Transactions!A2:I', parse: (rows) => rows.map(rowToTransaction) },
  bills:        { range: 'Bills!A2:K200',     parse: (rows) => rows.map(rowToBill) },
  paychecks:    { range: 'Paychecks!A2:L',    parse: (rows) => rows.map(rowToPaycheck) },
  budgets:      { range: 'Budgets!A2:E200',   parse: parseBudgets },
  goals:        { range: 'Goals!A2:H200',     parse: parseGoals },
};

export const BATCH_KEYS = [
  ...Object.keys(BATCHABLE_SHEETS),
  'contacts',
  'splits',
] as BatchKey[];

export async function batchGetSheets(
  accessToken: string,
  spreadsheetId: string,
  keys: BatchKey[]
): Promise<Partial<BatchResult>> {
  const out: Partial<BatchResult> = {};
  const assign = out as Record<BatchKey, unknown>;

  const batched = keys.filter(
    (k): k is Exclude<BatchKey, 'contacts' | 'splits'> => k in BATCHABLE_SHEETS
  );

  const tasks: Promise<void>[] = [];

  if (batched.length > 0) {
    tasks.push((async () => {
      const sheets = getSheetsClient(accessToken);
      const res = await sheets.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges: batched.map((k) => BATCHABLE_SHEETS[k].range),
        // Numeric cells must come back as numbers, not "$100.00" strings → NaN.
        valueRenderOption: 'UNFORMATTED_VALUE',
      });
      const vr = res.data.valueRanges ?? [];
      batched.forEach((k, i) => {
        assign[k] = BATCHABLE_SHEETS[k].parse((vr[i]?.values ?? []) as string[][]);
      });
    })());
  }

  if (keys.includes('contacts')) {
    tasks.push(getContacts(accessToken, spreadsheetId).then((c) => { assign.contacts = c; }));
  }
  if (keys.includes('splits')) {
    tasks.push(getSplits(accessToken, spreadsheetId).then((s) => { assign.splits = s; }));
  }

  await Promise.all(tasks);
  return out;
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
  const sheetId = await getSheetId(sheets, spreadsheetId, sheetName);
  if (sheetId === null) return;

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
