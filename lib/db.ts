import { sql } from '@vercel/postgres';
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

// ── User management ────────────────────────────────────────────────────────────

export async function ensureUser(userId: string, email: string, name: string): Promise<void> {
  await sql`
    INSERT INTO users (id, email, name)
    VALUES (${userId}, ${email}, ${name})
    ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name
  `;
}

// ── Settings ──────────────────────────────────────────────────────────────────

export async function getSettings(userId: string): Promise<TaxSettings> {
  const { rows } = await sql`SELECT * FROM settings WHERE user_id = ${userId}`;
  if (rows.length === 0) return { ...DEFAULT_TAX_SETTINGS };
  const r = rows[0];
  return {
    filingStatus: r.filing_status as TaxSettings['filingStatus'],
    payPeriodsPerYear: Number(r.pay_periods_per_year),
    k401Pct: Number(r.k401_pct),
    hsaAnnual: Number(r.hsa_annual),
    iraAnnual: Number(r.ira_annual),
    federalRate: Number(r.federal_rate),
    stateRate: Number(r.state_rate),
    cityRate: Number(r.city_rate),
    ficaSsRate: Number(r.fica_ss_rate),
    ficaSsWageBase: Number(r.fica_ss_wage_base),
    ficaMedicareRate: Number(r.fica_medicare_rate),
    useFederalBrackets: Boolean(r.use_federal_brackets),
    excludeLoansFromNetWorth: Boolean(r.exclude_loans_from_networth),
    customExpenseCategories: r.custom_expense_categories ? String(r.custom_expense_categories).split('|').filter(Boolean) : [],
    customIncomeCategories: r.custom_income_categories ? String(r.custom_income_categories).split('|').filter(Boolean) : [],
    hiddenExpenseCategories: r.hidden_expense_categories ? String(r.hidden_expense_categories).split('|').filter(Boolean) : [],
    hiddenIncomeCategories: r.hidden_income_categories ? String(r.hidden_income_categories).split('|').filter(Boolean) : [],
    language: (r.language ?? 'en') as Language,
  };
}

export async function saveSettings(userId: string, s: TaxSettings): Promise<void> {
  await sql`
    INSERT INTO settings (
      user_id, filing_status, pay_periods_per_year, k401_pct, hsa_annual, ira_annual,
      federal_rate, state_rate, city_rate, fica_ss_rate, fica_ss_wage_base, fica_medicare_rate,
      use_federal_brackets, exclude_loans_from_networth,
      custom_expense_categories, custom_income_categories,
      hidden_expense_categories, hidden_income_categories, language
    ) VALUES (
      ${userId}, ${s.filingStatus}, ${s.payPeriodsPerYear}, ${s.k401Pct}, ${s.hsaAnnual}, ${s.iraAnnual},
      ${s.federalRate}, ${s.stateRate}, ${s.cityRate}, ${s.ficaSsRate}, ${s.ficaSsWageBase}, ${s.ficaMedicareRate},
      ${s.useFederalBrackets}, ${s.excludeLoansFromNetWorth},
      ${(s.customExpenseCategories ?? []).join('|')}, ${(s.customIncomeCategories ?? []).join('|')},
      ${(s.hiddenExpenseCategories ?? []).join('|')}, ${(s.hiddenIncomeCategories ?? []).join('|')},
      ${s.language ?? 'en'}
    )
    ON CONFLICT (user_id) DO UPDATE SET
      filing_status               = EXCLUDED.filing_status,
      pay_periods_per_year        = EXCLUDED.pay_periods_per_year,
      k401_pct                    = EXCLUDED.k401_pct,
      hsa_annual                  = EXCLUDED.hsa_annual,
      ira_annual                  = EXCLUDED.ira_annual,
      federal_rate                = EXCLUDED.federal_rate,
      state_rate                  = EXCLUDED.state_rate,
      city_rate                   = EXCLUDED.city_rate,
      fica_ss_rate                = EXCLUDED.fica_ss_rate,
      fica_ss_wage_base           = EXCLUDED.fica_ss_wage_base,
      fica_medicare_rate          = EXCLUDED.fica_medicare_rate,
      use_federal_brackets        = EXCLUDED.use_federal_brackets,
      exclude_loans_from_networth = EXCLUDED.exclude_loans_from_networth,
      custom_expense_categories   = EXCLUDED.custom_expense_categories,
      custom_income_categories    = EXCLUDED.custom_income_categories,
      hidden_expense_categories   = EXCLUDED.hidden_expense_categories,
      hidden_income_categories    = EXCLUDED.hidden_income_categories,
      language                    = EXCLUDED.language
  `;
}

// ── Paychecks ─────────────────────────────────────────────────────────────────

export async function getPaychecks(userId: string): Promise<PaycheckEntry[]> {
  const { rows } = await sql`
    SELECT * FROM paychecks WHERE user_id = ${userId} ORDER BY date DESC
  `;
  return rows.map(rowToPaycheck);
}

function rowToPaycheck(r: Record<string, unknown>): PaycheckEntry {
  return {
    id: r.id as string,
    date: r.date as string,
    grossAmount: Number(r.gross_amount),
    federalWithheld: Number(r.federal_withheld),
    stateWithheld: Number(r.state_withheld),
    localWithheld: Number(r.local_withheld),
    k401: Number(r.k401),
    hsa: Number(r.hsa),
    netAmount: Number(r.net_amount),
    notes: (r.notes as string) ?? '',
    gratuityAmount: Number(r.gratuity_amount ?? 0),
  };
}

export async function addPaycheck(userId: string, e: PaycheckEntry): Promise<void> {
  await sql`
    INSERT INTO paychecks (id, user_id, date, gross_amount, federal_withheld, state_withheld, local_withheld, k401, hsa, net_amount, notes, gratuity_amount)
    VALUES (${e.id}, ${userId}, ${e.date}, ${e.grossAmount}, ${e.federalWithheld}, ${e.stateWithheld}, ${e.localWithheld}, ${e.k401}, ${e.hsa}, ${e.netAmount}, ${e.notes ?? ''}, ${e.gratuityAmount ?? 0})
    ON CONFLICT (id, user_id) DO NOTHING
  `;
}

export async function deletePaycheck(userId: string, id: string): Promise<void> {
  await sql`DELETE FROM paychecks WHERE id = ${id} AND user_id = ${userId}`;
}

// ── Transactions ──────────────────────────────────────────────────────────────

export async function getTransactions(userId: string): Promise<Transaction[]> {
  const { rows } = await sql`
    SELECT * FROM transactions WHERE user_id = ${userId} ORDER BY date DESC, created_at DESC
  `;
  return rows.map(rowToTransaction);
}

function rowToTransaction(r: Record<string, unknown>): Transaction {
  return {
    id: r.id as string,
    date: r.date as string,
    description: r.description as string,
    amount: Number(r.amount),
    type: r.type as Transaction['type'],
    category: r.category as string,
    account: r.account as string,
    toAccount: (r.to_account as string) ?? '',
    createdAt: (r.created_at as string) ?? '',
  };
}

export async function addTransaction(userId: string, tx: Transaction): Promise<void> {
  await sql`
    INSERT INTO transactions (id, user_id, date, description, amount, type, category, account, to_account, created_at)
    VALUES (${tx.id}, ${userId}, ${tx.date}, ${tx.description}, ${tx.amount}, ${tx.type}, ${tx.category}, ${tx.account}, ${tx.toAccount ?? ''}, ${tx.createdAt ?? ''})
    ON CONFLICT (id, user_id) DO NOTHING
  `;
}

export async function deleteTransaction(userId: string, id: string): Promise<void> {
  await sql`DELETE FROM transactions WHERE id = ${id} AND user_id = ${userId}`;
}

export async function updateTransaction(userId: string, tx: Transaction): Promise<void> {
  await sql`
    UPDATE transactions
    SET date = ${tx.date}, description = ${tx.description}, amount = ${tx.amount},
        type = ${tx.type}, category = ${tx.category}, account = ${tx.account},
        to_account = ${tx.toAccount ?? ''}, created_at = ${tx.createdAt ?? ''}
    WHERE id = ${tx.id} AND user_id = ${userId}
  `;
}

// ── Accounts ──────────────────────────────────────────────────────────────────

export async function getAccounts(userId: string): Promise<Account[]> {
  const { rows } = await sql`
    SELECT * FROM accounts WHERE user_id = ${userId} ORDER BY created_at ASC
  `;
  return rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    type: r.type as Account['type'],
    institution: r.institution as string,
    balance: Number(r.balance),
    last4: r.last4 as string,
    color: r.color as string,
    createdAt: r.created_at as string,
  }));
}

export async function upsertAccount(userId: string, a: Account): Promise<void> {
  await sql`
    INSERT INTO accounts (id, user_id, name, type, institution, balance, last4, color, created_at)
    VALUES (${a.id}, ${userId}, ${a.name}, ${a.type}, ${a.institution}, ${a.balance}, ${a.last4}, ${a.color}, ${a.createdAt})
    ON CONFLICT (id, user_id) DO UPDATE SET
      name        = EXCLUDED.name,
      type        = EXCLUDED.type,
      institution = EXCLUDED.institution,
      balance     = EXCLUDED.balance,
      last4       = EXCLUDED.last4,
      color       = EXCLUDED.color
  `;
}

export async function deleteAccount(userId: string, id: string): Promise<void> {
  await sql`DELETE FROM accounts WHERE id = ${id} AND user_id = ${userId}`;
}

// ── Goals ─────────────────────────────────────────────────────────────────────

export async function getGoals(userId: string): Promise<Goal[]> {
  const { rows } = await sql`
    SELECT * FROM goals WHERE user_id = ${userId} ORDER BY position ASC
  `;
  return rows.map((r, i) => ({
    id: r.id as string,
    name: r.name as string,
    targetAmount: Number(r.target_amount),
    currentAmount: Number(r.current_amount),
    deadline: r.deadline as string,
    icon: r.icon as string,
    linkedAccountId: (r.linked_account_id as string) ?? '',
    position: r.position !== null ? Number(r.position) : i,
  }));
}

export async function upsertGoal(userId: string, g: Goal): Promise<void> {
  let position = g.position;
  if (position === undefined) {
    const { rows } = await sql`
      SELECT COALESCE(MAX(position), -1) + 1 AS next_pos FROM goals
      WHERE user_id = ${userId} AND id != ${g.id}
    `;
    position = Number(rows[0].next_pos);
  }
  await sql`
    INSERT INTO goals (id, user_id, name, target_amount, current_amount, deadline, icon, linked_account_id, position)
    VALUES (${g.id}, ${userId}, ${g.name}, ${g.targetAmount}, ${g.currentAmount}, ${g.deadline}, ${g.icon}, ${g.linkedAccountId ?? ''}, ${position})
    ON CONFLICT (id, user_id) DO UPDATE SET
      name              = EXCLUDED.name,
      target_amount     = EXCLUDED.target_amount,
      current_amount    = EXCLUDED.current_amount,
      deadline          = EXCLUDED.deadline,
      icon              = EXCLUDED.icon,
      linked_account_id = EXCLUDED.linked_account_id,
      position          = EXCLUDED.position
  `;
}

export async function reorderGoals(userId: string, items: { id: string; position: number }[]): Promise<void> {
  for (const { id, position } of items) {
    await sql`UPDATE goals SET position = ${position} WHERE id = ${id} AND user_id = ${userId}`;
  }
}

export async function deleteGoal(userId: string, id: string): Promise<void> {
  await sql`DELETE FROM goals WHERE id = ${id} AND user_id = ${userId}`;
}

// ── Bills ─────────────────────────────────────────────────────────────────────

export async function getBills(userId: string): Promise<Bill[]> {
  const { rows } = await sql`
    SELECT * FROM bills WHERE user_id = ${userId} ORDER BY next_due ASC
  `;
  return rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    amount: Number(r.amount),
    frequency: r.frequency as Bill['frequency'],
    nextDue: r.next_due as string,
    account: r.account as string,
    category: r.category as string,
    isActive: Boolean(r.is_active),
  }));
}

export async function upsertBill(userId: string, b: Bill): Promise<void> {
  await sql`
    INSERT INTO bills (id, user_id, name, amount, frequency, next_due, account, category, is_active)
    VALUES (${b.id}, ${userId}, ${b.name}, ${b.amount}, ${b.frequency}, ${b.nextDue}, ${b.account}, ${b.category}, ${b.isActive})
    ON CONFLICT (id, user_id) DO UPDATE SET
      name      = EXCLUDED.name,
      amount    = EXCLUDED.amount,
      frequency = EXCLUDED.frequency,
      next_due  = EXCLUDED.next_due,
      account   = EXCLUDED.account,
      category  = EXCLUDED.category,
      is_active = EXCLUDED.is_active
  `;
}

export async function deleteBill(userId: string, id: string): Promise<void> {
  await sql`DELETE FROM bills WHERE id = ${id} AND user_id = ${userId}`;
}

// ── Budgets ───────────────────────────────────────────────────────────────────

export async function getBudgets(userId: string): Promise<Budget[]> {
  const { rows } = await sql`
    SELECT * FROM budgets WHERE user_id = ${userId} ORDER BY position ASC
  `;
  return rows.map((r, i) => ({
    id: r.id as string,
    category: r.category as string,
    amount: Number(r.amount),
    period: r.period as Budget['period'],
    position: r.position !== null ? Number(r.position) : i,
  }));
}

export async function upsertBudget(userId: string, b: Budget): Promise<void> {
  let position = b.position;
  if (position === undefined) {
    const { rows } = await sql`
      SELECT COALESCE(MAX(position), -1) + 1 AS next_pos FROM budgets
      WHERE user_id = ${userId} AND id != ${b.id}
    `;
    position = Number(rows[0].next_pos);
  }
  await sql`
    INSERT INTO budgets (id, user_id, category, amount, period, position)
    VALUES (${b.id}, ${userId}, ${b.category}, ${b.amount}, ${b.period}, ${position})
    ON CONFLICT (id, user_id) DO UPDATE SET
      category = EXCLUDED.category,
      amount   = EXCLUDED.amount,
      period   = EXCLUDED.period,
      position = EXCLUDED.position
  `;
}

export async function reorderBudgets(userId: string, items: { id: string; position: number }[]): Promise<void> {
  for (const { id, position } of items) {
    await sql`UPDATE budgets SET position = ${position} WHERE id = ${id} AND user_id = ${userId}`;
  }
}

export async function deleteBudget(userId: string, id: string): Promise<void> {
  await sql`DELETE FROM budgets WHERE id = ${id} AND user_id = ${userId}`;
}

// ── Net Worth History ─────────────────────────────────────────────────────────

export async function getNetWorthHistory(userId: string): Promise<NetWorthSnapshot[]> {
  const { rows } = await sql`
    SELECT * FROM net_worth_history WHERE user_id = ${userId} ORDER BY date ASC
  `;
  return rows.map((r) => ({
    id: r.id as string,
    date: r.date as string,
    month: r.month as string,
    netWorth: Number(r.net_worth),
  }));
}

export async function appendNetWorthSnapshot(userId: string, s: NetWorthSnapshot): Promise<void> {
  await sql`
    INSERT INTO net_worth_history (id, user_id, date, month, net_worth)
    VALUES (${s.id}, ${userId}, ${s.date}, ${s.month}, ${s.netWorth})
    ON CONFLICT (id, user_id) DO UPDATE SET
      date      = EXCLUDED.date,
      month     = EXCLUDED.month,
      net_worth = EXCLUDED.net_worth
  `;
}

// ── Batch reads ───────────────────────────────────────────────────────────────

export async function batchGetBadgesData(
  userId: string
): Promise<{ bills: Bill[]; budgets: Budget[]; transactions: Transaction[] }> {
  const [bills, budgets, transactions] = await Promise.all([
    getBills(userId),
    getBudgets(userId),
    getTransactions(userId),
  ]);
  return { bills, budgets, transactions };
}

export async function batchGetDashboardData(userId: string): Promise<{
  paychecks: PaycheckEntry[];
  transactions: Transaction[];
  accounts: Account[];
  bills: Bill[];
  budgets: Budget[];
  goals: Goal[];
}> {
  const [paychecks, transactions, accounts, bills, budgets, goals] = await Promise.all([
    getPaychecks(userId),
    getTransactions(userId),
    getAccounts(userId),
    getBills(userId),
    getBudgets(userId),
    getGoals(userId),
  ]);
  return { paychecks, transactions, accounts, bills, budgets, goals };
}
