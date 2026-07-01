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
  timeZone: string; // IANA time zone (e.g. 'America/New_York') — anchors every "today"/"now" across the app so server and client agree
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
  // 'pool' is a legacy holding bucket auto-created for early REAL Funding pools (see
  // Funding below). Real pools now hold their cash in a real account you choose, so no
  // new 'pool' accounts are created — but existing ones live on until migrated. It
  // counts as an asset in net worth, but is managed entirely by the Funding feature —
  // hidden from the Accounts page and the generic transaction/bill account pickers so
  // it can't be mis-posted to.
  type: 'checking' | 'savings' | 'credit' | 'investment' | 'loan' | 'cash' | 'pool';
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
// chips in for a trip. A pool is one of two KINDS:
//
//   • VIRTUAL — the group's agreed budget, not cash parked anywhere. Real balances
//     are touched only on SPEND (charged to a real account you pick; only your own
//     share is an expense, the rest is a `transfer` fronting the group's money) and
//     REPAY (a participant pays you back — a `transfer` INTO your account tagged
//     'FundingRepay'). Your own pledge is just an earmark (no cash row).
//
//   • REAL — actual cash is held in a REAL account YOU choose (`poolAccountId` points
//     at one of your deposit accounts), so that account's balance reflects the pooled
//     money flowing in and out. The pool's live balance is its own running figure
//     (totalContributed − spent), which need not equal the account balance. Cash flows:
//       – your contribution → no cash row when the money's already in the holding
//         account (just earmarked); a `transfer` (category 'Transfer') INTO it if you
//         fund your share from a different account.
//       – others' contributions → a `transfer` (empty source) INTO the holding account
//         tagged 'Funding', so it's held-for-others and netted out of net worth.
//       – a SPEND is charged to the holding account: your share is an expense, the rest
//         a `transfer` OUT (tagged 'Funding'), drawing the held money back down.
//     Real pools settle nothing afterwards (everyone already paid in), so they carry
//     no repayments. An optional `target` turns the pool into a group savings goal.
//     (Legacy real pools created earlier reference an auto-created `pool`-type holding
//     account; the Funding page offers to migrate them onto a real account.)
export interface FundingParticipant {
  // Stable identity, preserved across edits so a participant can be renamed without
  // detaching their paybacks. Optional only for legacy rows / real-pool participants
  // derived from contributions (which carry no paybacks); assigned for virtual pools.
  id?: string;
  name: string;        // display name ('' allowed only for the "me" row, which sets isMe)
  contributed: number; // virtual: this person's pledge; real: actual cash they put in
  isMe: boolean;       // true for the treasurer's own contribution
}

// One real-pool contribution (cash actually put into the pool). Self-contained so a
// single contribution can be edited/deleted and the pool re-derived without parsing
// the ledger. `id` is the ledger `transfer` it created (into the pool account), so a
// pool delete reverses it atomically. Only used by REAL pools.
export interface FundingContribution {
  id: string;          // the ledger transfer row id this created
  participant: string; // who put the money in (matches FundingParticipant.name)
  amount: number;
  isMe: boolean;       // true when it's the treasurer's own money
  account: string;     // your source account the cash came from (isMe); '' for others
  date: string;        // YYYY-MM-DD
}

// One participant paying you back. Self-contained so the pool can edit/delete a
// single repayment and re-derive who still owes what without parsing the ledger.
// `id` is the ledger transfer this created (category 'FundingRepay'), so a pool
// delete reverses it atomically.
export interface FundingRepayment {
  id: string;          // the FundingRepay transfer row id
  participant: string; // which participant paid (display name; kept in sync on rename)
  participantId?: string; // stable link to FundingParticipant.id (survives renames); absent on legacy rows → matched by name
  amount: number;
  account: string;     // the account the money landed in
  date: string;        // YYYY-MM-DD
}

export interface Funding {
  id: string;
  description: string;
  account: string;          // default account to charge / receive into (a suggestion)
  date: string;             // YYYY-MM-DD created
  kind: 'virtual' | 'real'; // virtual budget vs. real cash held in a pool account
  participants: FundingParticipant[];
  totalContributed: number; // pool size = sum of every participant's pledge/contribution
  spent: number;            // cumulative amount spent from the pool
  // Cash rows this pool created, so deletion reverses them atomically:
  contributionTxId: string; // legacy upfront others-contribution transfer ('' for virtual pools)
  spendTxIds: string[];     // ids of every spend row (my-share expenses + others transfers)
  repayments: FundingRepayment[]; // virtual only: participants paying you back (settle-up)
  closed: boolean;          // user marked the pool wrapped up
  // ── REAL pools only ──
  poolAccountId?: string;   // the account holding the real cash — a chosen deposit account (legacy pools reference an auto-created `pool` account until migrated)
  target?: number;          // optional savings-goal target (drives a progress bar); 0/absent = none
  contributions?: FundingContribution[]; // itemized cash put into the pool
}

// Investments are tracked as money flow, not as brokerage lots. An
// `investment`-type Account holds your money; you fund it with ordinary
// `transfer` transactions from a spending account (which keep that account's
// balance and your overall money flow correct), and its `balance` is the
// investment's *current value* — the figure you occasionally update to reflect
// where the market has taken it. Cost basis ("invested") is derived from those
// transfers plus the opening balance, so gain = current value − invested. See
// lib/investments.ts for the pure math.

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

// A manually-tracked recurring subscription (Netflix, Spotify, etc.).
// Distinct from the auto-detected `Subscription` type in lib/calculations.ts
// which is a read-only view derived from transaction history.
export interface TrackedSubscription {
  id: string;
  merchant: string;
  amount: number;
  frequency: 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';
  startDate: string;  // YYYY-MM-DD
  category: string;
  account: string;
  isActive: boolean;
  notes: string;
}
