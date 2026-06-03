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

// In the "keep the full paycheck" model the entire amount you received is real
// money deposited to your account — no tax is withheld. The federal/state/local
// /FICA fields are the tax you should SET ASIDE (save) for later, not money that
// was taken out. `netAmount` therefore equals the wages kept (= grossAmount) and
// `k401`/`hsa` are 0 (nothing is auto-deducted).
export interface PaycheckEntry {
  id: string;
  date: string;
  grossAmount: number;      // taxable wages (tips peeled off)
  federalWithheld: number;  // federal income tax to set aside
  stateWithheld: number;    // state income tax to set aside
  localWithheld: number;    // city/local income tax to set aside
  ficaWithheld: number;     // FICA (Social Security + Medicare) to set aside
  k401: number;             // pre-tax 401(k) deduction (0 in the full-deposit model)
  hsa: number;              // pre-tax HSA deduction (0 in the full-deposit model)
  netAmount: number;        // wages kept (= grossAmount); deposit = netAmount + gratuityAmount
  notes: string;            // checking account ID where the paycheck was deposited
  gratuityAmount: number;   // tips/gratuity (non-taxable), part of the real money deposited
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

// One "owed to you" record, created each time a split bill is paid. The other
// person's share is treated like a Loan receivable: when the bill is paid you
// front their share out of the assigned account as a `transfer` (so the account
// reflects the FULL amount you really paid, while your expense counts only your
// share). When they pay you back, marking it settled writes a `transfer` back
// into the account (cash in, not income). Both cash movements are tracked here
// so deleting the record reverses the balances atomically.
export interface Split {
  id: string;
  billId: string;
  billName: string;    // denormalized for display without a bill lookup
  contactId: string;
  contactName: string; // denormalized for display
  amount: number;      // the other person's share they owe you
  category: string;    // the bill's category at payment time (captured for context)
  account: string;     // account the bill was paid from; where fronted cash leaves/returns
  date: string;        // YYYY-MM-DD the bill was paid
  settled: boolean;    // they've paid you their share
  settledDate: string; // YYYY-MM-DD they settled up ('' until settled)
  frontedTxId?: string; // id of the `transfer` that fronted their share out of `account` ('' = note only)
  settleTxId?: string;  // id of the `transfer` that returned their share on settle ('' until settled)
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

// A personal loan / IOU: money you lent out (someone owes you) or borrowed
// (you owe someone). The cash movement is recorded as `transfer` transactions
// with an external (empty) counterparty so it shifts the account balance without
// counting as spending/income. Partial paybacks accumulate in `repaidAmount`.
export interface Loan {
  id: string;
  direction: 'lent' | 'borrowed';
  contactId: string;
  contactName: string;       // denormalized for display
  account: string;           // account the cash moved from/into ('' = note only, no cash tx)
  category: string;          // descriptive bucket for history/filtering ('' = uncategorized); stays out of spending
  principal: number;         // original amount
  repaidAmount: number;      // cumulative amount paid back so far
  date: string;              // YYYY-MM-DD the loan was created
  note: string;              // optional description
  settled: boolean;          // fully repaid (repaidAmount >= principal)
  settledDate: string;       // YYYY-MM-DD fully repaid ('' until settled)
  principalTxId: string;     // id of the cash transfer for the principal ('' if note only)
  repaymentTxIds: string[];  // ids of the cash transfers for each payback
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
