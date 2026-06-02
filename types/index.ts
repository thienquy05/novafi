export type FilingStatus = 'single' | 'mfj' | 'mfs' | 'hoh';
export type Language = 'en' | 'vi';

export interface TaxSettings {
  displayName: string; // user-chosen name shown in greetings; empty = fall back to Google account name
  filingStatus: FilingStatus;
  payPeriodsPerYear: number;
  k401Pct: number;
  hsaAnnual: number;
  iraAnnual: number;
  federalRate: number;         // flat % — used when useFederalBrackets is false
  stateRate: number;
  cityRate: number;
  ficaSsRate: number;
  ficaSsWageBase: number;
  ficaMedicareRate: number;
  useFederalBrackets: boolean; // when true, uses 2026 IRS progressive brackets instead of federalRate
  excludeLoansFromNetWorth: boolean; // when true, loan balances are excluded from net worth headline
  budgetRollover: boolean; // when true, unused/overspent budget carries forward to next month
  customExpenseCategories: string[];
  customIncomeCategories: string[];
  hiddenExpenseCategories: string[];
  hiddenIncomeCategories: string[];
  language: Language;
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
  marginalRate?: number;   // highest federal bracket hit (only set when useFederalBrackets is true)
  taxableIncome?: number;  // annualized income after deductions (only set when useFederalBrackets is true)
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
  gratuityAmount: number;
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
  createdAt?: string; // ISO timestamp for same-day ordering; absent on pre-existing rows
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
  openingBalance?: number; // balance before any transactions; basis for reconciliation. Backfilled for legacy rows.
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
  splitContactId?: string; // when set, this bill is shared with a contact
  splitAmount?: number;    // the other person's share of `amount` (the part they owe you); your share = amount - splitAmount
}

// A person you share bills with. Deliberately minimal & reusable across bills.
export interface Contact {
  id: string;
  name: string;
  createdAt: string;
}

// One "owed to you" record, created each time a split bill is paid. Tracks the
// other person's share for that payment and whether they've paid you back.
export interface Split {
  id: string;
  billId: string;
  billName: string;    // denormalized for display without a bill lookup
  contactId: string;
  contactName: string; // denormalized for display
  amount: number;      // the other person's share they owe you
  category: string;    // the bill's category — used for the offsetting refund
  account: string;     // account the bill was paid from / the refund returns to
  date: string;        // YYYY-MM-DD the bill was paid (offset is dated to match)
  settled: boolean;    // they transferred the money back to you
  settledDate: string; // YYYY-MM-DD they paid you back ('' until settled)
  refundTxId: string;  // id of the offsetting refund transaction ('' until settled)
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
