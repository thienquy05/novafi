import type { Account, Transaction } from '@/types';

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

export function calcSavingsRateScore(savingsRate: number): number {
  if (savingsRate >= 20) return 25;
  if (savingsRate >= 10) return 17;
  if (savingsRate >= 5)  return 10;
  if (savingsRate > 0)   return 5;
  return 0;
}

export function calcEmergencyScore(months: number): number {
  if (months >= 6)   return 25;
  if (months >= 3)   return 18;
  if (months >= 1)   return 10;
  if (months >= 0.5) return 5;
  return 0;
}

export function calcBudgetScore(budgetCount: number, overBudgetCount: number): number {
  if (budgetCount === 0) return 12;
  return Math.max(0, 25 - overBudgetCount * 6);
}

export function calcDebtScore(debtRatio: number): number {
  if (debtRatio <= 0.1)  return 25;
  if (debtRatio <= 0.3)  return 20;
  if (debtRatio <= 0.5)  return 15;
  if (debtRatio <= 0.75) return 10;
  return 5;
}

export function calcHealthGrade(score: number): string {
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

// ── Goal Progress ─────────────────────────────────────────────────────────────

export function calcGoalProgress(current: number, target: number): number {
  if (target <= 0) return 0;
  return Math.min(100, (current / target) * 100);
}

// ── Transaction Balance Effects ───────────────────────────────────────────────

export function applyExpenseBalance(balance: number, amount: number, isDebt: boolean): number {
  return isDebt ? balance + amount : balance - amount;
}

export function applyIncomeBalance(balance: number, amount: number): number {
  return balance + amount;
}

export function applyTransferFromBalance(balance: number, amount: number): number {
  return balance - amount;
}

export function applyTransferToBalance(balance: number, amount: number, isDebt: boolean): number {
  return isDebt ? Math.max(0, balance - amount) : balance + amount;
}

export function reverseExpenseBalance(balance: number, amount: number, isDebt: boolean): number {
  return isDebt ? balance - amount : balance + amount;
}

export function reverseIncomeBalance(balance: number, amount: number): number {
  return balance - amount;
}

export function reverseTransferFromBalance(balance: number, amount: number): number {
  return balance + amount;
}

export function reverseTransferToBalance(balance: number, amount: number, isDebt: boolean): number {
  return isDebt ? balance + amount : balance - amount;
}
