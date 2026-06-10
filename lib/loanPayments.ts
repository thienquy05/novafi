import type { Transaction } from '@/types';
import { generateId } from './utils';
import { calcLoanPaymentSplit } from './calculations';

// Builds the ledger rows for one loan payment. A real payment is part interest
// (a genuine expense) and part principal (which just reduces the balance), so we
// emit up to two rows:
//   • interest → an `expense` from the pay-from account (shows in spending/budgets)
//   • principal → a `transfer` from the pay-from account INTO the loan account
//     (lowers the owed balance; not counted as spending)
// Cash leaves the pay-from account exactly once (interest + principal = payment),
// the loan drops by principal only, and net worth falls by just the interest —
// the correct treatment. Either row is omitted when its portion is 0.
export function buildLoanPaymentTxs(
  payFromAccount: string,
  loanAccountId: string,
  balance: number,
  apr: number,
  payment: number,
  description: string,
  category: string,
  date: string,
): Transaction[] {
  const { interest, principal } = calcLoanPaymentSplit(balance, apr, payment);
  const now = new Date().toISOString();
  const txs: Transaction[] = [];
  if (interest > 0) {
    txs.push({
      id: generateId(), date, description, amount: interest,
      type: 'expense', category, account: payFromAccount, createdAt: now,
    });
  }
  if (principal > 0) {
    txs.push({
      id: generateId(), date, description, amount: principal,
      type: 'transfer', category, account: payFromAccount, toAccount: loanAccountId, createdAt: now,
    });
  }
  return txs;
}
