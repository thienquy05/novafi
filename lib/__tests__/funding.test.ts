import { describe, it, expect } from 'vitest';
import {
  othersContribution, myContribution, totalContribution, poolRemaining,
  buildContributionTx, buildSpendTxs,
} from '@/lib/funding';
import type { FundingParticipant } from '@/types';

const PEOPLE: FundingParticipant[] = [
  { name: 'Me', contributed: 100, isMe: true },
  { name: 'Alex', contributed: 100, isMe: false },
  { name: 'Sam', contributed: 100, isMe: false },
];

describe('funding contribution math', () => {
  it('splits my vs others vs total', () => {
    expect(myContribution(PEOPLE)).toBe(100);
    expect(othersContribution(PEOPLE)).toBe(200);
    expect(totalContribution(PEOPLE)).toBe(300);
  });

  it('poolRemaining = total − spent', () => {
    expect(poolRemaining({ totalContributed: 300, spent: 120 })).toBe(180);
  });
});

describe('buildContributionTx', () => {
  it('moves others cash into the account as a non-income transfer', () => {
    const tx = buildContributionTx('acc1', 200, 'Beach trip', '2026-06-09');
    expect(tx).not.toBeNull();
    expect(tx!.type).toBe('transfer');
    expect(tx!.account).toBe('');       // external source → not income
    expect(tx!.toAccount).toBe('acc1'); // raises the holding account
    expect(tx!.amount).toBe(200);
  });

  it('returns null when nobody else contributed', () => {
    expect(buildContributionTx('acc1', 0, 'x', '2026-06-09')).toBeNull();
  });
});

describe('buildSpendTxs', () => {
  it('books my share as an expense and the rest as an outgoing transfer', () => {
    const txs = buildSpendTxs('acc1', 300, 100, 'Dinner', '2026-06-09');
    expect(txs).toHaveLength(2);
    const expense = txs.find((t) => t.type === 'expense')!;
    const transfer = txs.find((t) => t.type === 'transfer')!;
    expect(expense.amount).toBe(100);
    expect(expense.account).toBe('acc1');
    expect(transfer.amount).toBe(200);
    expect(transfer.account).toBe('acc1');
    expect(transfer.toAccount).toBe(''); // leaves the account, not my expense
  });

  it('all-mine spend → single expense row', () => {
    const txs = buildSpendTxs('acc1', 50, 50, 'Snacks', '2026-06-09');
    expect(txs).toHaveLength(1);
    expect(txs[0].type).toBe('expense');
  });

  it('none-mine spend → single transfer row', () => {
    const txs = buildSpendTxs('acc1', 50, 0, 'Group gift', '2026-06-09');
    expect(txs).toHaveLength(1);
    expect(txs[0].type).toBe('transfer');
  });
});
