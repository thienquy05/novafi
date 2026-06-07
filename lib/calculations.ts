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

// Cash you can actually spend right now: the balance of your checking
// account(s) only. Savings is deliberately excluded — money moved to savings is
// treated as set aside, not spendable — which is what "safe to spend" builds on.
export function calcCheckingBalance(accounts: Account[]): number {
  return accounts
    .filter((a) => a.type === 'checking')
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

// Money left to spend for the REST of the month, on a CASH-ON-HAND basis: the
// cash actually sitting in your checking account(s) right now minus the bills
// still due this month. We use the real balance (not this month's income minus
// spending) so the figure reflects money you genuinely have — the income-flow
// basis falsely showed a deep deficit early in the month, before payday was
// logged, because it implicitly assumed you started the month with $0. Can go
// negative when the bills still due exceed your checking cash; we surface that
// shortfall instead of flooring at 0 so you see exactly how far short you are.
// Pair with `calcSafeToSpendDaily` to turn this leftover into a per-day allowance.
export function calcSafeToSpend(availableCash: number, billsDue: number): number {
  return roundCents(availableCash - billsDue);
}

// Forward-looking daily allowance: spread the money left to spend evenly across
// the days remaining in the month (today included, so `daysRemaining` is never
// 0). This is what makes "safe to spend" actionable — it answers "how much can I
// spend today and still cover the rest of the month" rather than restating
// income − spending (which savings rate and net cash flow already cover). When
// already overspent (leftToSpend < 0) there's no allowance to give, so we return
// the shortfall unchanged for the caller to surface as-is.
export function calcSafeToSpendDaily(leftToSpend: number, daysRemaining: number): number {
  if (leftToSpend < 0) return leftToSpend;
  if (daysRemaining <= 0) return roundCents(leftToSpend);
  return roundCents(leftToSpend / daysRemaining);
}

// Cash-basis spending for "safe to spend": the real money that left (or is
// leaving) your bank this month. Two kinds count:
//   1. Expenses paid from a cash/deposit account (checking, savings, cash, etc.)
//   2. Payments toward debt — transfers INTO a credit or loan account.
// Purchases CHARGED to a card are deliberately NOT counted here: no cash has
// left yet, so they only reduce safe-to-spend when you actually pay the card.
// This is what keeps a card purchase and its later payoff from being counted
// twice. (Accrual-style metrics like savings rate still use calcMonthExpense,
// which counts the charge when it's incurred — that's a separate concept.)
export function calcMonthCashSpending(
  transactions: Transaction[],
  accounts: Account[],
  monthKey: string,
): number {
  const debtIds = new Set(
    accounts.filter((a) => a.type === 'credit' || a.type === 'loan').map((a) => a.id),
  );
  return transactions.reduce((sum, t) => {
    if (!t.date.startsWith(monthKey)) return sum;
    if (t.type === 'expense' && !debtIds.has(t.account)) return roundCents(sum + t.amount);
    if (t.type === 'transfer' && t.toAccount && debtIds.has(t.toAccount)) return roundCents(sum + t.amount);
    return sum;
  }, 0);
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

// ── Budget Rollover ───────────────────────────────────────────────────────────
// The budget cap stays FIXED. Only last month's OVERSPEND carries forward, and
// it adds to this month's usage (the "used" side of the bar) — never to the cap.
//   rolledOverDeficit = max(0, prevMonthSpend − baseBudget)
//
//   • Underspending (a surplus) does NOT roll over — a new month starts at 0 used.
//   • A category with no prior-month spend (e.g. a brand-new budget) carries
//     nothing, since prevMonthSpend ≤ baseBudget ⇒ deficit = 0.
export function calcRolloverDeficit(baseBudget: number, prevMonthSpend: number): number {
  return Math.max(0, prevMonthSpend - baseBudget);
}

// Effective usage this month = actual spend + deficit carried over from last
// month. The cap is unchanged; only the "used" side grows by the overspend.
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

// `rolloverDeficit` carries last month's overspend per category (pass {} or omit
// when budget rollover is off). It adds to BOTH the effective "used" amount and
// the projection as a FLAT carryover — it is not part of this month's daily rate,
// so `pace` and the rate-based extrapolation stay derived from the actual spend.
// Without this a rolled-over category already over budget would wrongly report
// `onTrack` because the carried deficit was ignored entirely.
export function calcSpendingPace(
  budgets: Budget[],
  categorySpend: Record<string, number>,
  daysElapsed: number,
  daysInMonth: number,
  rolloverDeficit: Record<string, number> = {},
): SpendingPaceItem[] {
  return budgets.map((b) => {
    const budget = normalizeMonthlyBudget(b.amount, b.period);
    const rawSpent = categorySpend[b.category] ?? 0;
    const deficit = rolloverDeficit[b.category] ?? 0;
    const spent = calcEffectiveSpent(rawSpent, deficit);
    const projected = calcProjectedSpend(rawSpent, daysElapsed, daysInMonth) + deficit;
    const pace = daysElapsed > 0 ? rawSpent / daysElapsed : 0;
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

// ── Transaction Balance Effects ───────────────────────────────────────────────

export function roundCents(n: number): number {
  return Math.round(n * 100) / 100;
}

export function applyExpenseBalance(balance: number, amount: number, isDebt: boolean): number {
  return roundCents(isDebt ? balance + amount : balance - amount);
}

export function applyIncomeBalance(balance: number, amount: number, isDebt: boolean = false): number {
  return roundCents(isDebt ? balance - amount : balance + amount);
}

export function applyTransferFromBalance(balance: number, amount: number, isDebt: boolean): number {
  // Cash leaving an asset account lowers its balance. Moving money OUT of a debt
  // account (a cash advance, or lending money charged to a credit card) is a new
  // charge — it INCREASES what you owe. Treating a debt account's "from" side
  // like an asset wrongly looked like a payoff: lending on a credit card cut the
  // owed balance instead of growing it. The loan stays a `transfer` so it never
  // counts as real income/expense — only the account balance moves.
  return roundCents(isDebt ? balance + amount : balance - amount);
}

export function applyTransferToBalance(balance: number, amount: number, isDebt: boolean): number {
  // A transfer INTO a debt account is a payment → it reduces the owed balance.
  // We intentionally do NOT clamp at zero: overpaying a card leaves a legitimate
  // credit balance (the bank owes you), and clamping silently discards money.
  // Crucially, the clamp also broke reconciliation — it made apply/reverse
  // non-inverse, so a chronological replay that applied a payment before the
  // charge it covers (e.g. a backdated payment, or an opening balance set to the
  // current owed amount while history exists) would clamp the payment away and
  // inflate the result. Subtracting unconditionally keeps it symmetric with
  // reverseTransferToBalance.
  return roundCents(isDebt ? balance - amount : balance + amount);
}

export function reverseExpenseBalance(balance: number, amount: number, isDebt: boolean): number {
  return roundCents(isDebt ? balance - amount : balance + amount);
}

export function reverseIncomeBalance(balance: number, amount: number, isDebt: boolean = false): number {
  return roundCents(isDebt ? balance + amount : balance - amount);
}

export function reverseTransferFromBalance(balance: number, amount: number, isDebt: boolean): number {
  // Exact inverse of applyTransferFromBalance: an asset gets the cash back, a
  // debt account's charge is undone (owed goes back down).
  return roundCents(isDebt ? balance - amount : balance + amount);
}

export function reverseTransferToBalance(balance: number, amount: number, isDebt: boolean): number {
  return roundCents(isDebt ? balance + amount : balance - amount);
}

// ── Unified ledger application ────────────────────────────────────────────────
// Single source of truth for how one transaction affects account balances.
// Previously this logic was duplicated across the POST/PUT/DELETE handlers in
// the transactions API route (8 call sites), which made balance drift easy to
// introduce. The route's apply/reverse paths all go through here.

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
    if (tx.type === 'transfer' && isPrimary) return applyTransferFromBalance(account.balance, tx.amount, isDebt);
    if (isTransferTarget) return applyTransferToBalance(account.balance, tx.amount, isDebt);
  } else {
    if (tx.type === 'expense' && isPrimary) return reverseExpenseBalance(account.balance, tx.amount, isDebt);
    if (tx.type === 'income' && isPrimary) return reverseIncomeBalance(account.balance, tx.amount, isDebt);
    if (tx.type === 'transfer' && isPrimary) return reverseTransferFromBalance(account.balance, tx.amount, isDebt);
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

// Splits a bill total into your share and the other person's share. `theirShare`
// is the amount the other person owes you; it's clamped to [0, total] so a bad
// input can never produce a negative "your share" or claim more than the total.
export function calcSplitShares(total: number, theirShare: number): { mine: number; theirs: number } {
  const theirs = Math.min(Math.max(0, roundCents(theirShare || 0)), roundCents(total || 0));
  return { theirs, mine: roundCents((total || 0) - theirs) };
}

// Normalizes a bill's other-people shares into one list, hiding the legacy vs
// multi-person storage difference. Prefers `splitParticipants` (multi-person);
// falls back to the legacy single `splitContactId`/`splitAmount`; else empty.
// Only valid rows (a contact + a positive share) are returned.
export function billParticipants(bill: Bill): { contactId: string; amount: number }[] {
  if (bill.splitParticipants && bill.splitParticipants.length > 0) {
    return bill.splitParticipants.filter((p) => p.contactId && p.amount > 0);
  }
  if (bill.splitContactId && bill.splitAmount) {
    return [{ contactId: bill.splitContactId, amount: bill.splitAmount }];
  }
  return [];
}

// Total the OTHER people owe you on a shared bill, clamped to [0, amount] so bad
// input can never exceed the bill or go negative.
export function billOthersShare(bill: Bill): number {
  const sum = billParticipants(bill).reduce((s, p) => s + (p.amount || 0), 0);
  return Math.min(Math.max(0, roundCents(sum)), roundCents(bill.amount || 0));
}

// The portion of a bill that is actually YOUR cost = amount − everyone else's
// shares (the rest is theirs, tracked as receivables). Single source of truth so
// summaries, forecasts, and the dashboard reflect what you really pay — not the
// full bill. Works for unsplit, legacy single-split, and multi-person bills.
export function myBillShare(bill: Bill): number {
  return roundCents((bill.amount || 0) - billOthersShare(bill));
}

// Outstanding balance on a loan/IOU: principal minus everything paid back so
// far, floored at 0 (over-repayment never produces a negative remaining).
export function calcLoanRemaining(principal: number, repaidAmount: number): number {
  return Math.max(0, roundCents((principal || 0) - (repaidAmount || 0)));
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

// ── Paycheck Tax To Set Aside ─────────────────────────────────────────────────
// In the full-deposit model the whole paycheck is real money you keep, so this is
// the tax you should SAVE for later: income tax (federal + state + local) + FICA
// (Social Security + Medicare). New entries store each piece explicitly. Legacy
// entries (logged under the old "net deposited" model) didn't store FICA and
// recorded net < gross, so fall back to the old gross − net − deductions basis to
// recover their full tax figure.
export function calcPaycheckTaxToSave(p: {
  grossAmount: number;
  netAmount: number;
  k401: number;
  hsa: number;
  federalWithheld: number;
  stateWithheld: number;
  localWithheld: number;
  ficaWithheld: number;
}): number {
  const explicit = p.federalWithheld + p.stateWithheld + p.localWithheld + p.ficaWithheld;
  const legacy = Math.max(0, p.grossAmount - p.netAmount - p.k401 - p.hsa);
  return roundCents(Math.max(explicit, legacy));
}

// ── Paycheck Deposited (real money) ───────────────────────────────────────────
// The full amount that actually landed in the account: gross wages + tips. In the
// full-deposit model NO tax is withheld, so this is always gross + gratuity — the
// real money — regardless of how a (possibly legacy) entry's netAmount was stored.
// This is the single source of truth for "what was deposited" across the app.
export function calcPaycheckDeposited(p: {
  grossAmount: number;
  gratuityAmount?: number;
}): number {
  return roundCents(p.grossAmount + (p.gratuityAmount ?? 0));
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
