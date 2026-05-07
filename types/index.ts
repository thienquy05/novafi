export type FilingStatus = 'single' | 'mfj' | 'mfs' | 'hoh';

export interface TaxSettings {
  filingStatus: FilingStatus;
  payPeriodsPerYear: number;
  k401Pct: number;
  hsaAnnual: number;
  iraAnnual: number;
  federalRate: number;      // flat % e.g. 22
  stateRate: number;        // flat % e.g. 3.125
  cityRate: number;         // flat % e.g. 1.5
  ficaSsRate: number;       // 6.2
  ficaSsWageBase: number;   // 176100
  ficaMedicareRate: number; // 1.45
  customExpenseCategories: string[];
  customIncomeCategories: string[];
  hiddenExpenseCategories: string[];
  hiddenIncomeCategories: string[];
}

export interface TaxResult {
  grossPaycheck: number;
  k401: number;
  hsa: number;
  federalTax: number;
  stateTax: number;
  cityTax: number;
  ficaSs: number;
  ficaMedicare: number;
  totalTax: number;
  netPaycheck: number;
  effectiveRate: number;
}

export interface PaycheckEntry {
  id: string;
  date: string;
  grossAmount: number;
  federalWithheld: number;
  stateWithheld: number;
  localWithheld: number;
  k401: number;
  hsa: number;
  netAmount: number;
  notes: string;
}

export interface Transaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  type: 'income' | 'expense' | 'transfer';
  category: string;
  account: string;
  toAccount?: string; // for transfers
}

export interface Account {
  id: string;
  name: string;
  type: 'checking' | 'savings' | 'credit' | 'investment' | 'loan';
  institution: string;
  balance: number;
  last4: string;
  color: string;
  createdAt: string;
}

export interface Budget {
  id: string;
  category: string;
  amount: number;
  period: 'monthly' | 'weekly' | 'yearly';
  position?: number;
}

export interface Bill {
  id: string;
  name: string;
  amount: number;
  frequency: 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';
  nextDue: string;
  account: string;
  category: string;
  isActive: boolean;
}

export interface Goal {
  id: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  deadline: string;
  icon: string;
  linkedAccountId?: string; // optional savings account — balance used as progress
  position?: number;
}

export const EXPENSE_CATEGORIES = [
  'Food',
  'Grocery',
  'Entertainment',
  'Bills',
  'Shopping',
  'Transportation',
  'Health',
  'Transfer',
  'Other',
] as const;

export const INCOME_CATEGORIES = [
  'Paycheck',
  'Freelance',
  'Investment',
  'Transfer',
  'Other Income',
] as const;

export type ExpenseCategory = typeof EXPENSE_CATEGORIES[number];
export type IncomeCategory = typeof INCOME_CATEGORIES[number];

export interface NetWorthSnapshot {
  id: string;
  date: string;   // YYYY-MM-DD
  month: string;  // YYYY-MM (dedup key)
  netWorth: number;
}
