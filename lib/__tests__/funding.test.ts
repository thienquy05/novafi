import { describe, it, expect } from 'vitest';
import {
  othersContribution, myContribution, totalContribution, poolRemaining,
  buildContributionTx, buildSpendTxs, syncFundingTxAmount, syncFundingTxRemoval,
  buildRepayTx, groupFundingSpends, participantOwed, participantRepaid, totalOwed,
  isFullySettled, FUNDING_REPAY_CATEGORY,
  isRealPool, buildPoolContributionTx, participantsFromContributions, contributionsTotal, poolProgress,
} from '@/lib/funding';
import { applyTransactionToBalances, calcFundingHeld, calcFundingHeldByAccount } from '@/lib/calculations';
import type { Account, Funding, FundingContribution, FundingParticipant, FundingRepayment, Transaction } from '@/types';

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
    id: 'f1', description: 'Beach trip', account: 'acc1', date: '2026-06-09', kind: 'virtual',
    participants: PEOPLE.map((p) => ({ ...p })),
    totalContributed: 300, spent: 120,
    contributionTxId: 'ctx1', spendTxIds: ['stx1', 'stx2'], repayments: [], closed: false,
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

// ── Virtual pool: charged account, repayments, settle-up ──────────────────────

describe('buildSpendTxs charges the chosen account', () => {
  it('books both rows against the charged account, not where money is held', () => {
    const txs = buildSpendTxs('card1', 300, 100, 'Hotel', '2026-06-10');
    expect(txs.every((t) => t.account === 'card1')).toBe(true);
    expect(txs.find((t) => t.type === 'expense')!.amount).toBe(100);
    expect(txs.find((t) => t.type === 'transfer')!.amount).toBe(200);
  });
});

describe('buildRepayTx', () => {
  it('records money INTO an account as a non-income, non-held transfer', () => {
    const { tx, repayment } = buildRepayTx('cash1', 120, 'Alex', 'Alex paid back', '2026-06-20');
    expect(tx.type).toBe('transfer');
    expect(tx.category).toBe(FUNDING_REPAY_CATEGORY);
    expect(tx.account).toBe('');        // from the participant (external), not income
    expect(tx.toAccount).toBe('cash1'); // lands in your account
    expect(tx.amount).toBe(120);
    expect(repayment).toEqual({ id: tx.id, participant: 'Alex', amount: 120, account: 'cash1', date: '2026-06-20' });
  });

  it('a repayment is excluded from the funding-held net-worth adjustment', () => {
    // Only category 'Funding' transfers count as held; a 'FundingRepay' must not.
    const { tx } = buildRepayTx('cash1', 200, 'Alex', 'x', '2026-06-20');
    expect(calcFundingHeld([tx])).toBe(0);
    expect(calcFundingHeldByAccount([tx])).toEqual({});
  });
});

describe('settle-up math', () => {
  const repayments: FundingRepayment[] = [
    { id: 'r1', participant: 'Alex', amount: 60, account: 'cash1', date: '2026-06-20' },
    { id: 'r2', participant: 'Alex', amount: 40, account: 'cash1', date: '2026-06-21' },
  ];
  it('sums a participant repayments and nets against their pledge', () => {
    expect(participantRepaid(repayments, 'Alex')).toBe(100);     // 60 + 40
    expect(participantOwed({ name: 'Alex', contributed: 100, isMe: false }, repayments)).toBe(0); // fully paid
    expect(participantOwed({ name: 'Sam', contributed: 100, isMe: false }, repayments)).toBe(100); // hasn't paid
  });
  it('the me row never owes', () => {
    expect(participantOwed({ name: 'Me', contributed: 100, isMe: true }, repayments)).toBe(0);
  });
  it('totalOwed is the sum still outstanding across everyone', () => {
    const pool = makePool({ repayments });
    expect(totalOwed(pool)).toBe(100); // Alex settled, Sam still owes 100, me owes 0
  });
});

describe('isFullySettled (auto-archive trigger)', () => {
  it('false while anyone still owes you', () => {
    const pool = makePool({ repayments: [{ id: 'r1', participant: 'Alex', amount: 60, account: 'cash1', date: '2026-06-20' }] });
    expect(isFullySettled(pool)).toBe(false); // Alex partial, Sam unpaid
  });

  it('true once every other participant has paid you back', () => {
    const repayments: FundingRepayment[] = [
      { id: 'r1', participant: 'Alex', amount: 100, account: 'cash1', date: '2026-06-20' },
      { id: 'r2', participant: 'Sam', amount: 100, account: 'cash1', date: '2026-06-21' },
    ];
    expect(isFullySettled(makePool({ repayments }))).toBe(true);
  });

  it('false for a solo pool where only "me" pledged (nothing to settle)', () => {
    const solo = makePool({ participants: [{ name: 'Me', contributed: 100, isMe: true }], repayments: [] });
    expect(isFullySettled(solo)).toBe(false); // nobody else owed → not an auto-archive case
  });
});

// ── Real money pools ──────────────────────────────────────────────────────────

describe('real pool: contribution building', () => {
  it('my contribution is a non-held transfer from my account into the pool', () => {
    const { tx, contribution } = buildPoolContributionTx('pool1', 100, 'Me', true, 'chk1', 'Trip', '2026-06-09');
    expect(tx.type).toBe('transfer');
    expect(tx.category).toBe('Transfer');     // NOT 'Funding' → stays my money, not held
    expect(tx.account).toBe('chk1');          // leaves my account
    expect(tx.toAccount).toBe('pool1');       // into the pool
    expect(calcFundingHeld([tx])).toBe(0);    // my own money is never "held for others"
    expect(contribution).toMatchObject({ id: tx.id, participant: 'Me', amount: 100, isMe: true, account: 'chk1' });
  });

  it("another person's contribution is held-for-others cash in the pool", () => {
    const { tx, contribution } = buildPoolContributionTx('pool1', 200, 'Alex', false, '', 'Trip', '2026-06-09');
    expect(tx.category).toBe('Funding');
    expect(tx.account).toBe('');              // external source → not income
    expect(tx.toAccount).toBe('pool1');
    expect(calcFundingHeldByAccount([tx])).toEqual({ pool1: 200 });
    expect(contribution.account).toBe('');    // others' money isn't drawn from one of my accounts
  });
});

describe('participantsFromContributions / contributionsTotal', () => {
  const contributions: FundingContribution[] = [
    { id: 'c1', participant: 'Me', amount: 100, isMe: true, account: 'chk1', date: '2026-06-09' },
    { id: 'c2', participant: 'Alex', amount: 200, isMe: false, account: '', date: '2026-06-09' },
    { id: 'c3', participant: 'Me', amount: 50, isMe: true, account: 'chk1', date: '2026-06-12' }, // a top-up
  ];
  it('rolls each person up to their total cash in', () => {
    expect(participantsFromContributions(contributions)).toEqual([
      { name: 'Me', contributed: 150, isMe: true },
      { name: 'Alex', contributed: 200, isMe: false },
    ]);
    expect(contributionsTotal(contributions)).toBe(350);
  });
});

describe('poolProgress (savings-goal target)', () => {
  it('null when there is no target', () => {
    expect(poolProgress(100)).toBeNull();
    expect(poolProgress(100, 0)).toBeNull();
  });
  it('is the funded fraction of the target', () => {
    expect(poolProgress(150, 300)).toBeCloseTo(0.5);
    expect(poolProgress(400, 300)).toBeCloseTo(1.333, 2); // over-funded
  });
});

describe('isRealPool', () => {
  it('reads the pool kind', () => {
    expect(isRealPool({ kind: 'real' })).toBe(true);
    expect(isRealPool({ kind: 'virtual' })).toBe(false);
  });
});

describe('real pool: full cash-flow keeps net worth honest', () => {
  // A real pool holds my $100 + Alex's $200 in a dedicated pool account, then a $90
  // spend (my $30 share) is charged to it. The pool account's balance and the
  // held-for-others figure must stay consistent with each leg.
  const acc = (id: string, type: Account['type'], balance: number): Account =>
    ({ id, name: id, type, institution: '', balance, last4: '', color: '#000', createdAt: '2026-01-01' });

  it('moves my money in, holds others money, and a spend draws the right portions', () => {
    let accounts: Account[] = [acc('chk1', 'checking', 1000), acc('pool1', 'pool', 0)];
    const mine = buildPoolContributionTx('pool1', 100, 'Me', true, 'chk1', 'Trip', '2026-06-09').tx;
    const others = buildPoolContributionTx('pool1', 200, 'Alex', false, '', 'Trip', '2026-06-09').tx;
    const spend = buildSpendTxs('pool1', 90, 30, 'Dinner', '2026-06-10');
    for (const tx of [mine, others, ...spend]) accounts = applyTransactionToBalances(accounts, tx, 'apply');

    const pool = accounts.find((a) => a.id === 'pool1')!;
    const chk = accounts.find((a) => a.id === 'chk1')!;
    expect(chk.balance).toBe(900);            // my $100 left checking
    expect(pool.balance).toBe(210);           // 100 + 200 − 90
    // Of the pool balance, $140 is Alex's held cash (200 in − 60 of his share spent).
    const held = calcFundingHeldByAccount([mine, others, ...spend]);
    expect(held).toEqual({ pool1: 140 });
    // My money still in the pool = balance − held = 70 (my 100 in − 30 of my share spent).
    expect(pool.balance - held.pool1).toBe(70);
  });
});

describe('groupFundingSpends', () => {
  it('regroups the 1–2 rows of a spend by shared createdAt', () => {
    const spendTxs = buildSpendTxs('card1', 300, 100, 'Hotel', '2026-06-10'); // 2 rows, same createdAt
    const standalone: Transaction = { id: 'solo', date: '2026-06-11', description: 'Cab', amount: 40, type: 'transfer', category: 'Funding', account: 'cash1', toAccount: '', createdAt: '2026-06-11T00:00:00.000Z' };
    const f = makePool({ spendTxIds: [...spendTxs.map((t) => t.id), 'solo'] });
    const groups = groupFundingSpends(f.spendTxIds, [...spendTxs, standalone]);
    expect(groups).toHaveLength(2);
    const hotel = groups.find((g) => g.description === 'Hotel')!;
    expect(hotel.amount).toBe(300);
    expect(hotel.myShare).toBe(100);
    expect(hotel.chargedAccount).toBe('card1');
    expect(hotel.txIds).toHaveLength(2);
    const cab = groups.find((g) => g.description === 'Cab')!;
    expect(cab.amount).toBe(40);
    expect(cab.myShare).toBe(0);
  });
});
