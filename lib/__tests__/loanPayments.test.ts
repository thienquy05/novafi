import { describe, it, expect } from 'vitest';
import { buildLoanPaymentTxs } from '@/lib/loanPayments';

describe('buildLoanPaymentTxs', () => {
  it('emits an interest expense + a principal transfer', () => {
    const txs = buildLoanPaymentTxs('chk', 'loan1', 10000, 6, 200, 'Car payment', 'Transportation', '2026-06-09');
    expect(txs).toHaveLength(2);
    const interest = txs.find((t) => t.type === 'expense')!;
    const principal = txs.find((t) => t.type === 'transfer')!;
    expect(interest.amount).toBe(50);
    expect(interest.account).toBe('chk');
    expect(interest.toAccount).toBeUndefined();
    expect(principal.amount).toBe(150);
    expect(principal.account).toBe('chk');
    expect(principal.toAccount).toBe('loan1'); // into the loan → reduces balance
  });

  it('0% APR → single principal transfer (no interest expense)', () => {
    const txs = buildLoanPaymentTxs('chk', 'loan1', 5000, 0, 300, 'Loan', 'Bills', '2026-06-09');
    expect(txs).toHaveLength(1);
    expect(txs[0].type).toBe('transfer');
    expect(txs[0].amount).toBe(300);
  });

  it('payment below interest → single interest expense (no paydown)', () => {
    const txs = buildLoanPaymentTxs('chk', 'loan1', 10000, 24, 100, 'Loan', 'Bills', '2026-06-09');
    expect(txs).toHaveLength(1);
    expect(txs[0].type).toBe('expense');
    expect(txs[0].amount).toBe(100);
  });
});
