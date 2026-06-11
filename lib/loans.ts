import type { Loan, Transaction } from '@/types';
import { roundCents } from './calculations';
import { today } from './utils';

// ── Ledger → loan reconciliation ──────────────────────────────────────────────
// A loan caches numbers (`principal`, `repaidAmount`, `settled`) derived from
// the cash rows it created (principalTxId / repaymentTxIds). Those rows can
// also be edited or deleted from the generic ledger (/api/transactions), which
// doesn't go through /api/loans — so that route reconciles the loan with these
// helpers. Each returns the corrected Loan, or null when the transaction isn't
// linked to this loan / nothing changed.

// Re-derive the settled flag/date from the (possibly new) principal + repaid.
function recomputeSettlement(l: Loan, principal: number, repaidAmount: number): Loan {
  const settled = principal > 0 && repaidAmount >= roundCents(principal) - 0.005;
  return {
    ...l,
    principal,
    repaidAmount,
    settled,
    settledDate: settled ? (l.settledDate || today()) : '',
  };
}

// A linked row's amount changed: mirror the change into the loan.
export function syncLoanTxAmount(l: Loan, original: Transaction, updated: Transaction): Loan | null {
  const delta = roundCents(updated.amount - original.amount);
  if (delta === 0) return null;
  if (l.principalTxId && l.principalTxId === updated.id) {
    return recomputeSettlement(l, roundCents(updated.amount), l.repaidAmount || 0);
  }
  if ((l.repaymentTxIds ?? []).includes(updated.id)) {
    return recomputeSettlement(l, l.principal, Math.max(0, roundCents((l.repaidAmount || 0) + delta)));
  }
  return null;
}

// A linked row was deleted: back its amount out of the loan and unlink it.
export function syncLoanTxRemoval(l: Loan, tx: Transaction): Loan | null {
  if (l.principalTxId && l.principalTxId === tx.id) {
    // The cash row is gone but the IOU stands — the loan becomes note-only
    // (the same state as a loan recorded without an account).
    return { ...l, principalTxId: '' };
  }
  if ((l.repaymentTxIds ?? []).includes(tx.id)) {
    const next = recomputeSettlement(l, l.principal, Math.max(0, roundCents((l.repaidAmount || 0) - tx.amount)));
    return { ...next, repaymentTxIds: (l.repaymentTxIds ?? []).filter((id) => id !== tx.id) };
  }
  return null;
}
