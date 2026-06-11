import { describe, it, expect } from 'vitest';
import { syncLoanTxAmount, syncLoanTxRemoval } from '@/lib/loans';
import type { Loan, Transaction } from '@/types';

// Ledger → loan reconciliation (linked cash row edited/deleted outside /api/loans).

function makeLoan(o: Partial<Loan> = {}): Loan {
  return {
    id: 'l1', direction: 'lent', contactId: 'c1', contactName: 'Alex',
    account: 'a1', category: '', principal: 200, repaidAmount: 50,
    date: '2026-06-01', note: '', settled: false, settledDate: '',
    principalTxId: 'pr1', repaymentTxIds: ['rp1'],
    ...o,
  };
}
function makeTx(o: Partial<Transaction> & { id: string }): Transaction {
  return { date: '2026-06-01', description: '', amount: 0, type: 'transfer', category: 'Loan', account: 'a1', ...o };
}

describe('syncLoanTxAmount', () => {
  it('mirrors a principal amount change (and re-derives settlement)', () => {
    const next = syncLoanTxAmount(makeLoan(), makeTx({ id: 'pr1', amount: 200 }), makeTx({ id: 'pr1', amount: 50 }));
    expect(next!.principal).toBe(50);
    expect(next!.settled).toBe(true); // already repaid 50 ≥ new principal 50
    expect(next!.settledDate).toBeTruthy();
  });

  it('mirrors a payback amount change into repaidAmount', () => {
    const next = syncLoanTxAmount(makeLoan(), makeTx({ id: 'rp1', amount: 50 }), makeTx({ id: 'rp1', amount: 80 }));
    expect(next!.repaidAmount).toBe(80); // 50 − 50 + 80
    expect(next!.settled).toBe(false);
  });

  it('un-settles a settled loan when its payback shrinks', () => {
    const settled = makeLoan({ repaidAmount: 200, settled: true, settledDate: '2026-06-05', repaymentTxIds: ['rp1'] });
    const next = syncLoanTxAmount(settled, makeTx({ id: 'rp1', amount: 200 }), makeTx({ id: 'rp1', amount: 120 }));
    expect(next!.repaidAmount).toBe(120);
    expect(next!.settled).toBe(false);
    expect(next!.settledDate).toBe('');
  });

  it('returns null for unlinked rows and unchanged amounts', () => {
    expect(syncLoanTxAmount(makeLoan(), makeTx({ id: 'other', amount: 1 }), makeTx({ id: 'other', amount: 2 }))).toBeNull();
    expect(syncLoanTxAmount(makeLoan(), makeTx({ id: 'rp1', amount: 50 }), makeTx({ id: 'rp1', amount: 50 }))).toBeNull();
  });

  it('never drives repaidAmount negative', () => {
    const next = syncLoanTxAmount(makeLoan({ repaidAmount: 10 }), makeTx({ id: 'rp1', amount: 50 }), makeTx({ id: 'rp1', amount: 20 }));
    expect(next!.repaidAmount).toBe(0);
  });
});

describe('syncLoanTxRemoval', () => {
  it('deleting the principal transfer leaves a note-only loan', () => {
    const next = syncLoanTxRemoval(makeLoan(), makeTx({ id: 'pr1', amount: 200 }));
    expect(next!.principalTxId).toBe('');
    expect(next!.principal).toBe(200); // the IOU stands
  });

  it('unlinks a deleted payback and backs its amount out', () => {
    const next = syncLoanTxRemoval(makeLoan(), makeTx({ id: 'rp1', amount: 50 }));
    expect(next!.repaidAmount).toBe(0);
    expect(next!.repaymentTxIds).toEqual([]);
  });

  it('un-settles a settled loan when its covering payback is deleted', () => {
    const settled = makeLoan({ repaidAmount: 200, settled: true, settledDate: '2026-06-05' });
    const next = syncLoanTxRemoval(settled, makeTx({ id: 'rp1', amount: 200 }));
    expect(next!.settled).toBe(false);
    expect(next!.settledDate).toBe('');
  });

  it('returns null for unlinked rows', () => {
    expect(syncLoanTxRemoval(makeLoan(), makeTx({ id: 'other', amount: 5 }))).toBeNull();
  });
});
