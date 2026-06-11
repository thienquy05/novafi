import { describe, it, expect } from 'vitest';
import {
  othersContribution, myContribution, totalContribution, poolRemaining,
  buildContributionTx, buildSpendTxs, syncFundingTxAmount, syncFundingTxRemoval,
} from '@/lib/funding';
import { calcFundingHeld, calcFundingHeldByAccount } from '@/lib/calculations';
import type { Funding, FundingParticipant, Transaction } from '@/types';

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

// ── Ledger → pool reconciliation ──────────────────────────────────────────────

function makePool(o: Partial<Funding> = {}): Funding {
  return {
    id: 'f1', description: 'Beach trip', account: 'acc1', date: '2026-06-09',
    participants: PEOPLE.map((p) => ({ ...p })),
    totalContributed: 300, spent: 120,
    contributionTxId: 'ctx1', spendTxIds: ['stx1', 'stx2'], closed: false,
    ...o,
  };
}
function makeTx(o: Partial<Transaction> & { id: string }): Transaction {
  return { date: '2026-06-09', description: '', amount: 0, type: 'expense', category: 'Funding', account: 'acc1', ...o };
}

describe('syncFundingTxAmount', () => {
  it('mirrors a spend-row amount change into spent', () => {
    const next = syncFundingTxAmount(makePool(), makeTx({ id: 'stx1', amount: 100 }), makeTx({ id: 'stx1', amount: 80 }));
    expect(next!.spent).toBe(100); // 120 − 20
    expect(next!.spendTxIds).toEqual(['stx1', 'stx2']); // still linked
  });

  it('rescales others shares when the contribution row changes', () => {
    // Others total 200 → 150: each non-me share scales by 0.75; mine untouched.
    const next = syncFundingTxAmount(makePool(), makeTx({ id: 'ctx1', amount: 200, type: 'transfer' }), makeTx({ id: 'ctx1', amount: 150, type: 'transfer' }));
    expect(next!.totalContributed).toBe(250); // my 100 + others 150
    expect(next!.participants).toEqual([
      { name: 'Me', contributed: 100, isMe: true },
      { name: 'Alex', contributed: 75, isMe: false },
      { name: 'Sam', contributed: 75, isMe: false },
    ]);
  });

  it('returns null for unlinked rows and unchanged amounts', () => {
    expect(syncFundingTxAmount(makePool(), makeTx({ id: 'other', amount: 10 }), makeTx({ id: 'other', amount: 99 }))).toBeNull();
    expect(syncFundingTxAmount(makePool(), makeTx({ id: 'stx1', amount: 50 }), makeTx({ id: 'stx1', amount: 50 }))).toBeNull();
  });

  it('never drives spent negative', () => {
    const next = syncFundingTxAmount(makePool({ spent: 10 }), makeTx({ id: 'stx1', amount: 100 }), makeTx({ id: 'stx1', amount: 50 }));
    expect(next!.spent).toBe(0);
  });
});

describe('syncFundingTxRemoval', () => {
  it('unlinks a deleted spend row and backs its amount out of spent', () => {
    const next = syncFundingTxRemoval(makePool(), makeTx({ id: 'stx2', amount: 70 }));
    expect(next!.spent).toBe(50); // 120 − 70
    expect(next!.spendTxIds).toEqual(['stx1']);
  });

  it('zeroes others shares when the contribution row is deleted', () => {
    const next = syncFundingTxRemoval(makePool(), makeTx({ id: 'ctx1', amount: 200, type: 'transfer' }));
    expect(next!.contributionTxId).toBe('');
    expect(next!.totalContributed).toBe(100); // only my earmark remains
    expect(next!.participants.filter((p) => !p.isMe).every((p) => p.contributed === 0)).toBe(true);
  });

  it('returns null for unlinked rows', () => {
    expect(syncFundingTxRemoval(makePool(), makeTx({ id: 'other', amount: 10 }))).toBeNull();
  });
});

// ── Funding held for others → excluded from net worth ─────────────────────────

describe('calcFundingHeldByAccount / calcFundingHeld', () => {
  it('treats an others-contribution transfer as money held in that account', () => {
    const txs = [buildContributionTx('acc1', 200, 'Beach trip', '2026-06-09')!];
    expect(calcFundingHeldByAccount(txs)).toEqual({ acc1: 200 });
    expect(calcFundingHeld(txs)).toBe(200);
  });

  it('spending others share draws the held amount back down, my expense does not', () => {
    // 200 in from others, then a 300 spend with my 100 share: only the 200 others
    // portion leaves the account (transfer), so nothing is left held.
    const txs = [
      buildContributionTx('acc1', 200, 'Beach trip', '2026-06-09')!,
      ...buildSpendTxs('acc1', 300, 100, 'Dinner', '2026-06-10'),
    ];
    expect(calcFundingHeld(txs)).toBe(0);
  });

  it('keeps the unspent others portion held', () => {
    const txs = [
      buildContributionTx('acc1', 200, 'Beach trip', '2026-06-09')!,
      ...buildSpendTxs('acc1', 80, 30, 'Snacks', '2026-06-10'), // 50 of others spent
    ];
    expect(calcFundingHeld(txs)).toBe(150); // 200 − 50
  });

  it('ignores non-Funding transfers and never goes negative', () => {
    const txs: Transaction[] = [
      { id: 't1', date: '2026-06-09', description: 'move', amount: 500, type: 'transfer', category: 'Transfer', account: '', toAccount: 'acc1' },
      { id: 't2', date: '2026-06-09', description: 'spend', amount: 75, type: 'transfer', category: 'Funding', account: 'acc1', toAccount: '' },
    ];
    expect(calcFundingHeldByAccount(txs)).toEqual({}); // funding out with no funding in → floored away
    expect(calcFundingHeld(txs)).toBe(0);
  });

  it('tracks held money per account independently', () => {
    const txs = [
      buildContributionTx('acc1', 200, 'Trip', '2026-06-09')!,
      buildContributionTx('acc2', 50, 'Gift', '2026-06-09')!,
    ];
    expect(calcFundingHeldByAccount(txs)).toEqual({ acc1: 200, acc2: 50 });
    expect(calcFundingHeld(txs)).toBe(250);
  });
});
