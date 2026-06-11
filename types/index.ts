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
  // Category split: one purchase recorded as several rows (each its own category +
  // amount) sharing this id. Absent/'' = a normal standalone transaction. Distinct
  // from the people-split (Split type) which shares a cost across contacts.
  splitGroupId?: string;
}

export interface Account {
  id: string;
  name: string;
  type: 'checking' | 'savings' | 'credit' | 'investment' | 'loan' | 'cash';
  institution: string;
  balance: number;
  last4: string;
  color: string;
  createdAt: string;
  openingBalance?: number; // balance before any transactions; basis for reconciliation. Backfilled for legacy rows.
  // Credit cards only: the card's total credit limit. Powers the Smart Credit
  // Report (utilization = balance ÷ creditLimit). Absent/0 = not set yet (we
  // never invent a denominator — utilization shows as "unknown" until set).
  creditLimit?: number;
  // Credit cards only: statement closing day-of-month (1–31). Bureaus report the
  // statement balance, so this drives "pay before your statement closes" nudges.
  // Absent = not set.
  statementDay?: number;
  // Credit cards AND loans: the APR as a percent (e.g. 24.99 / 6.5). For cards it
  // powers the Balance-Transfer Optimizer; for loans it drives the amortization /
  // payoff math. Absent = not set; 0 is a real 0% APR.
  apr?: number;
  // Loan accounts only: the scheduled monthly payment. Drives payoff time, total
  // interest and the "pay extra" advisor. Absent/0 = not set.
  monthlyPayment?: number;
  // Loan accounts only: the original loan term in months (e.g. 60). Informational
  // (shown alongside the live payoff estimate). Absent/0 = not set.
  termMonths?: number;
  // Loan accounts only: id of the account the monthly payment is drawn FROM (a
  // checking/savings/credit). Used by the in-app "Make payment" action. Absent = none.
  paymentAccountId?: string;
  // Spendable deposit accounts only (checking/savings/cash): the low-balance
  // safeguard buffer. The minimum you want to keep in this account AFTER the bills
  // drawn from it are paid. When the projected balance (current − upcoming bills)
  // falls below this, the overdraft safeguard flags it — and the Quick-Add form
  // warns before a payment would breach it. Absent/0 = guard at $0 (warn only on a
  // real overdraft, i.e. projected below zero).
  minBalance?: number;
}

export interface Budget {
  id: string;
  category: string;
  amount: number;
  period: 'monthly' | 'weekly' | 'yearly';
  position?: number;
}

// One other person on a shared bill and the share they owe you. "Me" is never a
// participant row — my share is always the remainder (amount − sum of theirs).
export interface BillSplitParticipant {
  contactId: string;
  amount: number;
}

export interface Bill {
  id: string;
  name: string;
  amount: number;
  // 'once' is a non-recurring, one-time charge — paying it deactivates the bill
  // instead of advancing the due date.
  frequency: 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly' | 'once';
  nextDue: string;
  account: string;
  category: string;
  isActive: boolean;
  // Flexible/variable-amount bill (e.g. energy, gas): `amount` is an estimate; the
  // actual charge differs each cycle. Shown as "~$amount"; paying a non-split
  // variable bill updates the estimate to what you actually paid.
  variable?: boolean;
  // Legacy single-contact split (read for back-compat; superseded by
  // splitParticipants when that is present).
  splitContactId?: string; // when set, this bill is shared with a contact
  splitAmount?: number;    // the other person's share of `amount` (the part they owe you); your share = amount - splitAmount
  // Multi-person split: each entry is one other person's share they owe you.
  // Your share is the remainder (amount − sum). Empty/absent = unsplit.
  splitParticipants?: BillSplitParticipant[];
  // When set, this bill pays down a `loan`-type account: recording the payment
  // books the interest portion as an expense and transfers the principal into the
  // loan (reducing its balance) instead of logging a plain expense. Absent = a
  // normal bill. The pay-from account is the bill's `account`.
  loanAccountId?: string;
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
  amount: number;      // the other person's share they owe you (the original total)
  category: string;    // the bill's category at payment time (captured for context)
  account: string;     // account the bill was paid from; where fronted cash leaves/returns
  date: string;        // YYYY-MM-DD the bill was paid
  settled: boolean;    // fully paid back (repaidAmount >= amount)
  settledDate: string; // YYYY-MM-DD they fully settled up ('' until settled)
  repaidAmount: number;     // cumulative amount paid back so far (partial paybacks accumulate, like loans)
  repaymentTxIds: string[]; // ids of the cash-in `transfer`s for each payback
  frontedTxId?: string; // id of the `transfer` that fronted their share out of `account` ('' = note only)
  settleTxId?: string;  // legacy: id of a single full-settle `transfer` (older rows; superseded by repaymentTxIds)
  myShareTxId?: string; // id of YOUR own `expense` row for this split group, denormalized onto every member ('' = you weren't included). Lets group-edit find & reconcile your personal share.
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
  groupId?: string;          // shared id linking per-person loans created together (multi-person); absent = standalone
}

// A money pool the user (treasurer) holds on behalf of a group — e.g. everyone
// chips in for a trip and the user keeps the cash. Modeled after Split but
// INVERTED: the user collects contributions up front, then disburses. Key rules:
//   • Contributions from OTHERS land in a real account but are NOT income — they're
//     held on the group's behalf (recorded as a `transfer` from an empty source).
//   • The user's own contribution is their existing money (no cash row) — just an
//     earmark, tracked for the pool total.
//   • When money is spent from the pool, only the user's OWN share counts as their
//     expense; the rest leaves the account as a `transfer` (spending others' money).
export interface FundingParticipant {
  name: string;        // display name ('' allowed only for the "me" row, which sets isMe)
  contributed: number; // amount this person put into the pool
  isMe: boolean;       // true for the treasurer's own contribution
}

export interface Funding {
  id: string;
  description: string;
  account: string;          // real account holding the pooled cash
  date: string;             // YYYY-MM-DD created
  participants: FundingParticipant[];
  totalContributed: number; // sum of all participants' contributions (pool size)
  spent: number;            // cumulative amount disbursed from the pool
  // Cash rows this pool created, so deletion reverses them atomically:
  contributionTxId: string; // the external→account transfer for OTHERS' contributions ('' = none)
  spendTxIds: string[];     // ids of every spend row (my-share expenses + others transfers)
  closed: boolean;          // user marked the pool wrapped up
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
  // Overall credit utilization % captured the same month (Smart Credit Report
  // trend). null/absent when no card had a limit set at snapshot time.
  creditUtil?: number | null;
}
