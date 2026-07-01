import type { Account, Transaction } from '@/types';
import { roundCents } from './calculations';

/**
 * Pure investment math, independent of the UI and the Sheets layer (mirrors
 * lib/calculations.ts so it can be unit-tested in isolation).
 *
 * The model is deliberately simple — money flow, not brokerage lots:
 *
 *   • An `investment`-type Account's `balance` is its CURRENT VALUE — what the
 *     position is worth right now. You update it occasionally (the number that
 *     "changes frequently but not necessarily"); net worth, the dashboard, and
 *     reports all read `balance`, so they stay correct with no extra wiring.
 *
 *   • INVESTED (cost basis) is the real money you've put in: the account's
 *     opening balance plus every `transfer` INTO it, minus every `transfer` OUT.
 *     Because contributions are ordinary transfers, the source account is
 *     debited and your money flow stays correct automatically — and any transfer
 *     you make from the normal Transactions page counts here too.
 *
 *   • GAIN = current value − invested. That's the "something to show about the
 *     investment process" without tracking a single share price.
 */

// Contributions/withdrawals are booked as transfers under this category so they
// read distinctly in the ledger (CategoryIcon already maps it to a chart icon).
export const CONTRIBUTION_CATEGORY = 'Investment';

/**
 * Cost basis of one investment account: opening balance + net transfers in.
 * A transfer whose `toAccount` is this account adds money; a transfer whose
 * `account` is this account removes it. Everything is rounded to cents.
 */
export function investedInAccount(account: Account, transactions: Transaction[]): number {
  let invested = account.openingBalance ?? 0;
  for (const t of transactions) {
    if (t.type !== 'transfer') continue;
    if (t.toAccount === account.id) invested += t.amount;
    else if (t.account === account.id) invested -= t.amount;
  }
  return roundCents(invested);
}

export interface AccountInvestment {
  accountId: string;
  value: number;          // current market value (= account.balance)
  invested: number;       // cost basis (opening balance + net transfers)
  gain: number;           // value − invested
  gainPct: number | null; // gain as a % of invested — null when nothing invested
}

/** Value / invested / gain for a single investment account. */
export function accountInvestment(account: Account, transactions: Transaction[]): AccountInvestment {
  const value = roundCents(account.balance);
  const invested = investedInAccount(account, transactions);
  const gain = roundCents(value - invested);
  return {
    accountId: account.id,
    value,
    invested,
    gain,
    gainPct: invested > 0 ? (gain / invested) * 100 : null,
  };
}

export interface PortfolioStats {
  value: number;          // total current value across investment accounts
  invested: number;       // total cost basis
  gain: number;           // total gain ($)
  gainPct: number | null; // total return (%) — null when nothing invested
  count: number;          // number of investment accounts
}

/** Aggregate value / invested / gain across a set of investment accounts. */
export function portfolioStats(accounts: Account[], transactions: Transaction[]): PortfolioStats {
  let value = 0;
  let invested = 0;
  for (const a of accounts) {
    value += roundCents(a.balance);
    invested += investedInAccount(a, transactions);
  }
  value = roundCents(value);
  invested = roundCents(invested);
  const gain = roundCents(value - invested);
  return {
    value,
    invested,
    gain,
    gainPct: invested > 0 ? (gain / invested) * 100 : null,
    count: accounts.length,
  };
}

/**
 * The transfers that fund (or draw from) one investment account, newest first —
 * the "money flow" history shown on the account. In = transfer to the account,
 * out = transfer from it.
 */
export function contributionHistory(
  account: Account,
  transactions: Transaction[],
): { tx: Transaction; direction: 'in' | 'out' }[] {
  return transactions
    .filter((t) => t.type === 'transfer' && (t.toAccount === account.id || t.account === account.id))
    .map((t) => ({ tx: t, direction: t.toAccount === account.id ? ('in' as const) : ('out' as const) }))
    .sort((a, b) => (a.tx.date < b.tx.date ? 1 : a.tx.date > b.tx.date ? -1 : 0));
}
