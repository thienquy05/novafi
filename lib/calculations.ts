import type { Account, Transaction, Bill, Budget } from '@/types';

// ── Net Worth ─────────────────────────────────────────────────────────────────

export function calcTraditionalNetWorth(accounts: Account[]): number {
  return accounts.reduce(
    (sum, a) => sum + (a.type === 'credit' || a.type === 'loan' ? -a.balance : a.balance),
    0
  );
}

export function calcLiquidNetWorth(accounts: Account[]): number {
  return accounts.reduce(
    (sum, a) => sum + (a.type === 'credit' ? -a.balance : a.type === 'loan' ? 0 : a.balance),
    0
  );
}

export function calcTotalAssets(accounts: Account[]): number {
  return accounts
    .filter((a) => a.type !== 'credit' && a.type !== 'loan')
    .reduce((s, a) => s + a.balance, 0);
}

export function calcTotalDebt(accounts: Account[]): number {
  return accounts
    .filter((a) => (a.type === 'credit' || a.type === 'loan') && a.balance > 0)
    .reduce((s, a) => s + a.balance, 0);
}

export function calcLiquidSavings(accounts: Account[]): number {
  return accounts
    .filter((a) => a.type === 'checking' || a.type === 'savings')
    .reduce((s, a) => s + a.balance, 0);
}

// ── Cash Flow ─────────────────────────────────────────────────────────────────

export function calcMonthIncome(transactions: Transaction[], monthKey: string): number {
  return transactions
    .filter((t) => t.type === 'income' && t.date.startsWith(monthKey))
    .reduce((s, t) => s + t.amount, 0);
}

export function calcMonthExpense(transactions: Transaction[], monthKey: string): number {
  return transactions
    .filter((t) => t.type === 'expense' && t.date.startsWith(monthKey))
    .reduce((s, t) => s + t.amount, 0);
}

export function calcSavingsRate(income: number, spending: number): number {
  if (income <= 0) return 0;
  return Math.max(0, ((income - spending) / income) * 100);
}

export function calcSafeToSpend(income: number, spending: number, bills: number): number {
  return Math.max(0, income - spending - bills);
}

export function pctChange(current: number, prev: number): number | null {
  if (prev === 0) return null;
  return ((current - prev) / prev) * 100;
}

// ── Budget ────────────────────────────────────────────────────────────────────

export function normalizeMonthlyBudget(amount: number, period: 'monthly' | 'weekly' | 'yearly'): number {
  if (period === 'monthly') return amount;
  if (period === 'weekly') return amount * 4.33;
  return amount / 12;
}

// ── Budget Rollover (deficit-only) ────────────────────────────────────────────
// The budget cap itself stays FIXED every month. Rollover only carries last
// month's OVERSPEND forward into this month's usage:
//   rolledOverDeficit = max(0, prevMonthSpend − baseBudget)
//
//   • Underspending (a surplus) does NOT roll over — you do not get extra room.
//   • A budget with no prior-month spend (e.g. brand new) carries nothing over,
//     since prevMonthSpend ≤ baseBudget ⇒ deficit = 0. This avoids the old bug
//     where an untouched budget appeared doubled.
export function calcRolloverDeficit(baseBudget: number, prevMonthSpend: number): number {
  return Math.max(0, prevMonthSpend - baseBudget);
}

// Effective usage this month = actual spend + deficit carried over from last month.
// The cap is unchanged; only the "used" side grows by the rolled-over overspend.
export function calcEffectiveSpent(spent: number, rolledOverDeficit: number): number {
  return spent + rolledOverDeficit;
}

// ── Spending Pace / Velocity ──────────────────────────────────────────────────
// Extrapolates current spending rate to project end-of-month total.
// Formula: projected = (spent / daysElapsed) × daysInMonth
export function calcProjectedSpend(spent: number, daysElapsed: number, daysInMonth: number): number {
  if (daysElapsed <= 0) return 0;
  return (spent / daysElapsed) * daysInMonth;
}

export type SpendingPaceItem = {
  category: string;
  budget: number;
  spent: number;
  projected: number;
  pace: number;          // daily spend rate
  status: 'over' | 'atRisk' | 'onTrack';
  overshootAmt: number;  // projected - budget (0 if onTrack/over)
};

export function calcSpendingPace(
  budgets: Budget[],
  categorySpend: Record<string, number>,
  daysElapsed: number,
  daysInMonth: number,
): SpendingPaceItem[] {
  return budgets.map((b) => {
    const budget = normalizeMonthlyBudget(b.amount, b.period);
    const spent = categorySpend[b.category] ?? 0;
    const projected = calcProjectedSpend(spent, daysElapsed, daysInMonth);
    const pace = daysElapsed > 0 ? spent / daysElapsed : 0;
    const status: SpendingPaceItem['status'] =
      spent > budget ? 'over' :
      projected > budget ? 'atRisk' :
      'onTrack';
    const overshootAmt = status === 'atRisk' ? projected - budget : 0;
    return { category: b.category, budget, spent, projected, pace, status, overshootAmt };
  });
}

// ── Emergency Fund ────────────────────────────────────────────────────────────

export function calcAvgMonthlyExpense(monthlySums: number[]): number {
  if (monthlySums.length === 0) return 0;
  return monthlySums.reduce((s, v) => s + v, 0) / monthlySums.length;
}

export function calcEmergencyFundMonths(liquidSavings: number, avgMonthlyExpense: number): number {
  if (avgMonthlyExpense <= 0) return 0;
  return liquidSavings / avgMonthlyExpense;
}

// ── Health Score Components ───────────────────────────────────────────────────
// 6-factor weighted composite (total 100 pts):
//   Savings Rate           25
//   Emergency Fund         20
//   Budget Adherence       15
//   Debt-to-Income         20
//   Net Worth Trend        10
//   Spending Volatility    10

export function calcSavingsRateScore(savingsRate: number): number {
  if (savingsRate >= 25) return 25;
  if (savingsRate >= 20) return 22;
  if (savingsRate >= 15) return 18;
  if (savingsRate >= 10) return 14;
  if (savingsRate >= 5)  return 9;
  if (savingsRate > 0)   return 4;
  return 0;
}

export function calcEmergencyScore(months: number): number {
  if (months >= 6)   return 20;
  if (months >= 4)   return 16;
  if (months >= 3)   return 13;
  if (months >= 2)   return 9;
  if (months >= 1)   return 6;
  if (months >= 0.5) return 3;
  return 0;
}

export function calcBudgetScore(budgetCount: number, overBudgetCount: number): number {
  if (budgetCount === 0) return 7; // neutral mid-score when user has no budgets defined
  const adherence = (budgetCount - overBudgetCount) / budgetCount;
  if (adherence >= 1)    return 15;
  if (adherence >= 0.8)  return 12;
  if (adherence >= 0.6)  return 9;
  if (adherence >= 0.4)  return 6;
  if (adherence >= 0.2)  return 3;
  return 0;
}

/**
 * Debt-to-Income ratio: total outstanding debt ÷ annualized monthly income.
 * Replaces debt-to-asset (which exploded to absurd values when assets ≈ 0).
 *
 *   dti = totalDebt / (avgMonthlyIncome * 12)
 *
 *   0     → no debt, full credit
 *   ≤0.36 → healthy (mortgage-rule threshold)
 *   ≤1.0  → moderate
 *   ≤2.0  → stretched
 *   ≤3.0  → high stress
 *   >3.0  → critical
 */
export function calcDebtToIncomeScore(dti: number): number {
  if (dti <= 0)    return 20;
  if (dti <= 0.36) return 18;
  if (dti <= 0.6)  return 15;
  if (dti <= 1.0)  return 12;
  if (dti <= 1.5)  return 9;
  if (dti <= 2.0)  return 6;
  if (dti <= 3.0)  return 3;
  return 0;
}

/**
 * Net Worth Trend: average month-over-month % growth across the last 3 snapshots.
 * Pass `null` when there isn't enough history — returns the neutral midpoint.
 */
export function calcNetWorthTrendScore(avgMomPct: number | null): number {
  if (avgMomPct === null) return 5; // neutral when not enough history
  if (avgMomPct >= 3)    return 10;
  if (avgMomPct >= 1.5)  return 8;
  if (avgMomPct >= 0.5)  return 6;
  if (avgMomPct >= 0)    return 5;
  if (avgMomPct >= -1)   return 3;
  if (avgMomPct >= -3)   return 1;
  return 0;
}

/**
 * Spending Volatility: coefficient of variation (stddev / mean) over last 3 months.
 * Low CV = predictable spending = better budgeting capacity.
 * Pass `null` when mean ≤ 0 or insufficient data.
 */
export function calcSpendingVolatilityScore(cv: number | null): number {
  if (cv === null) return 5; // neutral
  if (cv <= 0.1)   return 10;
  if (cv <= 0.2)   return 8;
  if (cv <= 0.3)   return 6;
  if (cv <= 0.5)   return 4;
  if (cv <= 0.75)  return 2;
  return 0;
}

export function calcDebtToIncomeRatio(totalDebt: number, avgMonthlyIncome: number): number {
  if (avgMonthlyIncome <= 0) return totalDebt > 0 ? Infinity : 0;
  return totalDebt / (avgMonthlyIncome * 12);
}

export function calcAvgMomPct(values: number[]): number | null {
  // values: chronological net worth snapshots. Need ≥2 to compute one MoM change.
  if (values.length < 2) return null;
  const pcts: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1];
    if (prev === 0) continue; // skip undefined-growth points
    pcts.push(((values[i] - prev) / Math.abs(prev)) * 100);
  }
  if (pcts.length === 0) return null;
  return pcts.reduce((s, v) => s + v, 0) / pcts.length;
}

export function calcCoefficientOfVariation(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  if (mean <= 0) return null;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

export function calcHealthGrade(score: number): string {
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

/** Legacy debt-to-asset score, retained for back-compat with older callers/tests. */
export function calcDebtScore(debtRatio: number): number {
  if (debtRatio <= 0.1)  return 25;
  if (debtRatio <= 0.3)  return 20;
  if (debtRatio <= 0.5)  return 15;
  if (debtRatio <= 0.75) return 10;
  return 5;
}

// ── Goal Progress ─────────────────────────────────────────────────────────────

export function calcGoalProgress(current: number, target: number): number {
  if (target <= 0) return 0;
  return Math.min(100, (current / target) * 100);
}

// ── Transaction Balance Effects ───────────────────────────────────────────────

function roundCents(n: number): number {
  return Math.round(n * 100) / 100;
}

export function applyExpenseBalance(balance: number, amount: number, isDebt: boolean): number {
  return roundCents(isDebt ? balance + amount : balance - amount);
}

export function applyIncomeBalance(balance: number, amount: number, isDebt: boolean = false): number {
  return roundCents(isDebt ? balance - amount : balance + amount);
}

export function applyTransferFromBalance(balance: number, amount: number): number {
  return roundCents(balance - amount);
}

export function applyTransferToBalance(balance: number, amount: number, isDebt: boolean): number {
  return isDebt ? roundCents(Math.max(0, balance - amount)) : roundCents(balance + amount);
}

export function reverseExpenseBalance(balance: number, amount: number, isDebt: boolean): number {
  return roundCents(isDebt ? balance - amount : balance + amount);
}

export function reverseIncomeBalance(balance: number, amount: number, isDebt: boolean = false): number {
  return roundCents(isDebt ? balance + amount : balance - amount);
}

export function reverseTransferFromBalance(balance: number, amount: number): number {
  return roundCents(balance + amount);
}

export function reverseTransferToBalance(balance: number, amount: number, isDebt: boolean): number {
  return roundCents(isDebt ? balance + amount : balance - amount);
}

// ── Unified ledger application ────────────────────────────────────────────────
// Single source of truth for how one transaction affects account balances.
// Previously this logic was duplicated across the POST/PUT/DELETE handlers in
// the transactions API route (8 call sites), which made balance drift easy to
// introduce. Both the route and the reconciler now go through here.

export type LedgerMode = 'apply' | 'reverse';

// Resulting balance for a SINGLE account after `tx` is applied or reversed.
// If the account is unrelated to the transaction, the balance is unchanged.
export function nextBalanceForAccount(
  account: Account,
  tx: Transaction,
  mode: LedgerMode,
): number {
  const isDebt = account.type === 'credit' || account.type === 'loan';
  const isPrimary = tx.account === account.id;
  const isTransferTarget = tx.type === 'transfer' && tx.toAccount === account.id;

  if (mode === 'apply') {
    if (tx.type === 'expense' && isPrimary) return applyExpenseBalance(account.balance, tx.amount, isDebt);
    if (tx.type === 'income' && isPrimary) return applyIncomeBalance(account.balance, tx.amount, isDebt);
    if (tx.type === 'transfer' && isPrimary) return applyTransferFromBalance(account.balance, tx.amount);
    if (isTransferTarget) return applyTransferToBalance(account.balance, tx.amount, isDebt);
  } else {
    if (tx.type === 'expense' && isPrimary) return reverseExpenseBalance(account.balance, tx.amount, isDebt);
    if (tx.type === 'income' && isPrimary) return reverseIncomeBalance(account.balance, tx.amount, isDebt);
    if (tx.type === 'transfer' && isPrimary) return reverseTransferFromBalance(account.balance, tx.amount);
    if (isTransferTarget) return reverseTransferToBalance(account.balance, tx.amount, isDebt);
  }
  return account.balance;
}

// Applies/reverses a transaction across all accounts, returning a NEW array.
// Accounts untouched by the transaction keep their original reference.
export function applyTransactionToBalances(
  accounts: Account[],
  tx: Transaction,
  mode: LedgerMode,
): Account[] {
  return accounts.map((acc) => {
    const balance = nextBalanceForAccount(acc, tx, mode);
    return balance === acc.balance ? acc : { ...acc, balance };
  });
}

// ── Reconciliation ────────────────────────────────────────────────────────────
// Replays an account's full ledger from its opening balance, in chronological
// order, honoring the same apply rules (including the debt-overpayment clamp in
// applyTransferToBalance). Returns the balance the account SHOULD have, so drift
// from partial-write failures or concurrent updates can be detected and repaired.

function compareTxChronological(a: Transaction, b: Transaction): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const ca = a.createdAt ?? '';
  const cb = b.createdAt ?? '';
  if (ca !== cb) return ca < cb ? -1 : 1;
  return 0;
}

function ledgerForAccount(accountId: string, transactions: Transaction[]): Transaction[] {
  return transactions
    .filter((t) => t.account === accountId || t.toAccount === accountId)
    .sort(compareTxChronological);
}

export function reconcileAccountBalance(account: Account, transactions: Transaction[]): number {
  // Without a baselined opening balance the ledger can't be replayed safely
  // (replaying on top of the current balance would double-count). Treat as
  // consistent until deriveOpeningBalance() backfills it.
  if (account.openingBalance == null) return account.balance;
  let working: Account = { ...account, balance: roundCents(account.openingBalance) };
  for (const tx of ledgerForAccount(account.id, transactions)) {
    working = { ...working, balance: nextBalanceForAccount(working, tx, 'apply') };
  }
  return working.balance;
}

// Backfills the opening balance for accounts that predate opening-balance
// tracking: reverse-replays the ledger from the current balance to the start so
// that a forward replay reproduces today's balance. Accurate unless a historical
// debt-overpayment clamp fired (rare, and inherently ambiguous in that case).
export function deriveOpeningBalance(account: Account, transactions: Transaction[]): number {
  const ledger = ledgerForAccount(account.id, transactions);
  let working: Account = { ...account };
  for (let i = ledger.length - 1; i >= 0; i--) {
    working = { ...working, balance: nextBalanceForAccount(working, ledger[i], 'reverse') };
  }
  return roundCents(working.balance);
}

export type BalanceDrift = {
  accountId: string;
  name: string;
  stored: number;
  expected: number;
  diff: number;
};

// Lists accounts whose stored balance diverges from the reconciled balance by
// more than `tolerance` (in currency units). Accounts without an opening balance
// are skipped (not yet baselined).
export function detectBalanceDrift(
  accounts: Account[],
  transactions: Transaction[],
  tolerance = 0.01,
): BalanceDrift[] {
  const drifts: BalanceDrift[] = [];
  for (const acc of accounts) {
    if (acc.openingBalance == null) continue;
    const expected = reconcileAccountBalance(acc, transactions);
    const diff = roundCents(acc.balance - expected);
    if (Math.abs(diff) > tolerance) {
      drifts.push({ accountId: acc.id, name: acc.name, stored: acc.balance, expected, diff });
    }
  }
  return drifts;
}

// Plan describing exactly what a reconcile run would change. Computing it as a
// pure function means the dry-run PREVIEW and the actual APPLY share identical
// logic — what the user is shown can never diverge from what gets written.
export type ReconcileBackfill = { accountId: string; name: string; openingBalance: number };
export type ReconcilePlan = { toBackfill: ReconcileBackfill[]; toRepair: BalanceDrift[] };

export function planReconcile(
  accounts: Account[],
  transactions: Transaction[],
  tolerance = 0.01,
): ReconcilePlan {
  const toBackfill: ReconcileBackfill[] = [];
  const toRepair: BalanceDrift[] = [];
  for (const acc of accounts) {
    // Establish a reconciliation basis if this account has never had one.
    let withBasis = acc;
    if (acc.openingBalance == null) {
      const openingBalance = deriveOpeningBalance(acc, transactions);
      withBasis = { ...acc, openingBalance };
      toBackfill.push({ accountId: acc.id, name: acc.name, openingBalance });
    }
    // Compare stored balance against the replayed ledger.
    const expected = reconcileAccountBalance(withBasis, transactions);
    const diff = roundCents(withBasis.balance - expected);
    if (Math.abs(diff) > tolerance) {
      toRepair.push({ accountId: acc.id, name: acc.name, stored: withBasis.balance, expected, diff });
    }
  }
  return { toBackfill, toRepair };
}

// ── Transaction querying (pure) ───────────────────────────────────────────────
// Server-side filtering/pagination so views don't ship and re-scan the entire
// ledger on every navigation.

export type TxFilter = {
  search?: string;                       // matches description or category (case-insensitive)
  type?: Transaction['type'] | 'all';
  category?: string;                     // exact category match
  account?: string;                      // matches account or toAccount
  from?: string;                         // inclusive lower bound (YYYY-MM-DD)
  to?: string;                           // inclusive upper bound (YYYY-MM-DD)
  monthKey?: string;                     // 'YYYY-MM' shorthand; overrides from/to when set
};

export function filterTransactions(transactions: Transaction[], f: TxFilter): Transaction[] {
  const q = f.search?.toLowerCase().trim();
  return transactions.filter((t) => {
    if (f.type && f.type !== 'all' && t.type !== f.type) return false;
    if (f.category && t.category !== f.category) return false;
    if (f.account && t.account !== f.account && t.toAccount !== f.account) return false;
    if (f.monthKey) {
      if (!t.date.startsWith(f.monthKey)) return false;
    } else {
      if (f.from && t.date < f.from) return false;
      if (f.to && t.date > f.to) return false;
    }
    if (q && !(t.description.toLowerCase().includes(q) || t.category.toLowerCase().includes(q))) return false;
    return true;
  });
}

export type Page<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export function paginate<T>(items: T[], page: number, pageSize: number): Page<T> {
  const total = items.length;
  const totalPages = pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  const safePage = Math.min(Math.max(1, Math.floor(page) || 1), totalPages);
  const start = (safePage - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), page: safePage, pageSize, total, totalPages };
}

// ── Aggregation (pure) ────────────────────────────────────────────────────────
// Pre-aggregate the ledger once so dashboards/reports read compact summaries
// instead of rescanning every row per metric. History is never mutated.

export type MonthlyTotal = { monthKey: string; income: number; expense: number; net: number };

export function aggregateMonthlyTotals(transactions: Transaction[]): MonthlyTotal[] {
  const map = new Map<string, MonthlyTotal>();
  for (const t of transactions) {
    if (t.type === 'transfer') continue;       // transfers move money, not income/expense
    const monthKey = t.date.slice(0, 7);
    if (monthKey.length !== 7) continue;
    const row = map.get(monthKey) ?? { monthKey, income: 0, expense: 0, net: 0 };
    if (t.type === 'income') row.income = roundCents(row.income + t.amount);
    else row.expense = roundCents(row.expense + t.amount);
    row.net = roundCents(row.income - row.expense);
    map.set(monthKey, row);
  }
  return [...map.values()].sort((a, b) => (a.monthKey < b.monthKey ? -1 : 1));
}

export function aggregateCategoryTotals(
  transactions: Transaction[],
  monthKey?: string,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of transactions) {
    if (t.type !== 'expense') continue;
    if (monthKey && !t.date.startsWith(monthKey)) continue;
    out[t.category] = roundCents((out[t.category] ?? 0) + t.amount);
  }
  return out;
}

// ── Bill helpers ──────────────────────────────────────────────────────────────

export function billToTransactionDefaults(bill: Bill, date: string): Omit<Transaction, 'id'> {
  return {
    date,
    description: bill.name,
    amount: bill.amount,
    type: 'expense',
    category: bill.category,
    account: bill.account ?? '',
  };
}

// ── Net Worth Projection ──────────────────────────────────────────────────────
// Extends historical net worth series N months forward using avg MoM growth rate.
// Each projected point = previous × (1 + avgMoMRate).
export function calcNetWorthProjection(
  history: { netWorth: number }[],
  months: number,
): number[] {
  if (history.length < 2) return [];
  const avgMoM = calcAvgMomPct(history.map((h) => h.netWorth));
  if (avgMoM === null) return [];
  const rate = avgMoM / 100;
  const last = history[history.length - 1].netWorth;
  return Array.from({ length: months }, (_, i) => {
    return last * Math.pow(1 + rate, i + 1);
  });
}

// ── Category Percentage ───────────────────────────────────────────────────────
export function calcCategoryPct(spent: number, totalSpend: number): number {
  if (totalSpend <= 0) return 0;
  return (spent / totalSpend) * 100;
}

// ── Paycheck Effective Tax Rate ───────────────────────────────────────────────
// effectiveTaxRate = (federal + state + local withheld) / gross
// totalDeductionRate includes pre-tax contributions (401k, HSA)
export function calcPaycheckEffectiveRate(
  grossAmount: number,
  federalWithheld: number,
  stateWithheld: number,
  localWithheld: number,
): number {
  if (grossAmount <= 0) return 0;
  return ((federalWithheld + stateWithheld + localWithheld) / grossAmount) * 100;
}

// ── Badge Counts ──────────────────────────────────────────────────────────────

export function calcOverdueBills(bills: Bill[], now: Date): number {
  return bills.filter((b) => b.isActive && new Date(b.nextDue) < now).length;
}

export function calcOverBudget(
  budgets: Budget[],
  transactions: Transaction[],
  monthKey: string,
): number {
  const monthExpenses = transactions.filter(
    (t) => t.type === 'expense' && t.date.startsWith(monthKey),
  );
  return budgets.filter((b) => {
    const monthly =
      b.period === 'monthly' ? b.amount
      : b.period === 'weekly'  ? b.amount * 4.33
      : b.amount / 12;
    const spent = monthExpenses
      .filter((t) => t.category === b.category)
      .reduce((s, t) => s + t.amount, 0);
    return spent > monthly;
  }).length;
}
