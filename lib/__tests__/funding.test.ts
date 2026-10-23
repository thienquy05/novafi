import { describe, it, expect } from 'vitest';
import {
  othersContribution, myContribution, totalContribution, poolRemaining,
  buildContributionTx, buildSpendTxs, syncFundingTxAmount, syncFundingTxRemoval,
  buildRepayTx, groupFundingSpends, participantOwed, participantRepaid, totalOwed,
  isFullySettled, FUNDING_REPAY_CATEGORY,
  isRealPool, buildPoolContributionTx, participantsFromContributions, contributionsTotal, poolProgress,
  repointRealPoolAccount, planVirtualPoolEdit, referencedTxIds,
  FUNDING_REIMBURSE_CATEGORY, spendReimbursement, needsReimbursement, owedBackTotal, buildReimburseTx,
  rebuildReimbursement, type FundingSpend,
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
  const vault = (o: Partial<Funding> = {}): Funding =>
    makePool({ kind: 'real', poolAccountId: 'sav1', account: 'sav1', contributionTxId: '', ...o });
  const people = (...p: [string, number, boolean][]): FundingParticipant[] =>
    p.map(([name, contributed, isMe]) => ({ name, contributed, isMe }));

  it('holds the others share of what is left, in proportion to who put it in', () => {
    // Me 100 + others 200 = 300, 90 spent → 210 left, 2/3 of it is others'.
    const f = vault({ spent: 90 });
    expect(calcFundingHeldByAccount([f])).toEqual({ sav1: 140 });
    expect(calcFundingHeld([f])).toBe(140);
  });

  it('holds nothing once the pool is spent or overspent', () => {
    // "Iphone" vault: Ba put in 1,000, 1,507.42 spent.
    const f = vault({ participants: people(['Ba', 1000, false]), totalContributed: 1000, spent: 1507.42 });
    expect(calcFundingHeldByAccount([f])).toEqual({});
  });

  it('matches the Family Trip vault: 393.62 left, others put in 1,350.13 of 1,800.13', () => {
    const f = vault({
      participants: people(['Me', 450, true], ['Dad', 450, false], ['Mom', 450, false], ['Hân', 450, false], ['Bình', 0.13, false]),
      totalContributed: 1800.13,
      spent: 1406.51,
    });
    expect(calcFundingHeld([f])).toBe(295.22);
  });

  it('ignores closed pools and pools with only my money', () => {
    expect(calcFundingHeld([vault({ closed: true })])).toBe(0);
    expect(calcFundingHeld([vault({ participants: people(['Me', 300, true]) })])).toBe(0);
  });

  it('a virtual pool is a budget and holds no cash, unless it has a legacy others-contribution row', () => {
    expect(calcFundingHeld([makePool({ contributionTxId: '' })])).toBe(0);
    // Legacy: others' 200 of 300 parked in `account`, 120 spent → 180 left, 2/3 others'.
    expect(calcFundingHeldByAccount([makePool()])).toEqual({ acc1: 120 });
  });

  it('sums pools per holding account', () => {
    const held = calcFundingHeldByAccount([
      vault({ spent: 0 }),
      vault({ id: 'f2', poolAccountId: 'chk1', spent: 0 }),
      vault({ id: 'f3', spent: 150 }),
    ]);
    expect(held).toEqual({ sav1: 300, chk1: 200 });
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

});

describe('settle-up math', () => {
  const repayments: FundingRepayment[] = [
    { id: 'r1', participant: 'Alex', amount: 60, account: 'cash1', date: '2026-06-20' },
    { id: 'r2', participant: 'Alex', amount: 40, account: 'cash1', date: '2026-06-21' },
  ];
  it('sums a participant repayments and nets against their pledge', () => {
    expect(participantRepaid(repayments, { name: 'Alex', contributed: 100, isMe: false })).toBe(100);     // 60 + 40
    expect(participantOwed({ name: 'Alex', contributed: 100, isMe: false }, repayments)).toBe(0); // fully paid
    expect(participantOwed({ name: 'Sam', contributed: 100, isMe: false }, repayments)).toBe(100); // hasn't paid
  });
  it('matches by stable participant id even after a rename, with a name fallback', () => {
    const byId: FundingRepayment[] = [{ id: 'r1', participant: 'Old name', participantId: 'p1', amount: 50, account: 'cash1', date: '2026-06-20' }];
    // The stored name is stale but the id still links the payback to the participant.
    expect(participantRepaid(byId, { id: 'p1', name: 'New name', contributed: 80, isMe: false })).toBe(50);
    // Legacy row (no participantId) still resolves by name.
    expect(participantRepaid(repayments, { id: 'pX', name: 'Alex', contributed: 100, isMe: false })).toBe(100);
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
  it('my money already in the holding account is earmarked with NO cash row', () => {
    // fromAccount === the holding account → the money is already there, nothing moves.
    const { tx, contribution } = buildPoolContributionTx('chk1', 100, 'Me', true, 'chk1', 'Trip', '2026-06-09');
    expect(tx).toBeNull();
    expect(contribution).toMatchObject({ participant: 'Me', amount: 100, isMe: true, account: 'chk1' });
  });

  it('my money funded from another account is a non-held transfer into the holding account', () => {
    const { tx, contribution } = buildPoolContributionTx('chk1', 100, 'Me', true, 'sav1', 'Trip', '2026-06-09');
    expect(tx).not.toBeNull();
    expect(tx!.type).toBe('transfer');
    expect(tx!.category).toBe('Transfer');     // NOT 'Funding' → stays my money, not held
    expect(tx!.account).toBe('sav1');          // leaves my savings
    expect(tx!.toAccount).toBe('chk1');        // into the holding account
    expect(contribution).toMatchObject({ id: tx!.id, participant: 'Me', amount: 100, isMe: true, account: 'sav1' });
  });

  it("another person's contribution is held-for-others cash in the holding account", () => {
    const { tx, contribution } = buildPoolContributionTx('chk1', 200, 'Alex', false, '', 'Trip', '2026-06-09');
    expect(tx).not.toBeNull();
    expect(tx!.category).toBe('Funding');
    expect(tx!.account).toBe('');              // external source → not income
    expect(tx!.toAccount).toBe('chk1');
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
  // A real pool holds its cash in a REAL account (here a savings account). My $100 is
  // funded from checking, Alex's $200 is held-for-others, then a $90 spend (my $30
  // share) is charged to the holding account. The holding account's balance and the
  // held-for-others figure must stay consistent with each leg.
  const acc = (id: string, type: Account['type'], balance: number): Account =>
    ({ id, name: id, type, institution: '', balance, last4: '', color: '#000', createdAt: '2026-01-01' });

  it('moves my money in, holds others money, and a spend draws the right portions', () => {
    let accounts: Account[] = [acc('chk1', 'checking', 1000), acc('sav1', 'savings', 0)];
    const mine = buildPoolContributionTx('sav1', 100, 'Me', true, 'chk1', 'Trip', '2026-06-09').tx!;
    const others = buildPoolContributionTx('sav1', 200, 'Alex', false, '', 'Trip', '2026-06-09').tx!;
    const spend = buildSpendTxs('sav1', 90, 30, 'Dinner', '2026-06-10');
    for (const tx of [mine, others, ...spend]) accounts = applyTransactionToBalances(accounts, tx, 'apply');

    const hold = accounts.find((a) => a.id === 'sav1')!;
    const chk = accounts.find((a) => a.id === 'chk1')!;
    expect(chk.balance).toBe(900);            // my $100 left checking
    expect(hold.balance).toBe(210);           // 100 + 200 − 90
    // 210 left in the pool, split by who put it in: Alex owns 2/3 = $140.
    const pool = makePool({
      kind: 'real', poolAccountId: 'sav1', account: 'sav1', contributionTxId: '',
      participants: [{ name: 'Me', contributed: 100, isMe: true }, { name: 'Alex', contributed: 200, isMe: false }],
      totalContributed: 300, spent: 90,
    });
    const held = calcFundingHeldByAccount([pool]);
    expect(held).toEqual({ sav1: 140 });
    // My money still in the pool = balance − held = 70.
    expect(hold.balance - held.sav1).toBe(70);
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

describe('repointRealPoolAccount (legacy pool migration)', () => {
  const acc = (id: string, type: Account['type'], balance: number): Account =>
    ({ id, name: id, type, institution: '', balance, last4: '', color: '#000', createdAt: '2026-01-01' });

  // A legacy real pool holding Alex's $200 (held-for-others) and a $90 spend ($30 mine)
  // in a synthetic 'pool1' account. Migrating onto real 'chk1' must move every leg's
  // cash onto chk1 and empty pool1 so it can be deleted.
  function legacyPool() {
    const others = buildPoolContributionTx('pool1', 200, 'Alex', false, '', 'Trip', '2026-06-09');
    const spend = buildSpendTxs('pool1', 90, 30, 'Dinner', '2026-06-10');
    const transactions: Transaction[] = [others.tx!, ...spend];
    const f = makePool({
      kind: 'real',
      poolAccountId: 'pool1',
      account: 'pool1',
      spent: 90,
      totalContributed: 200,
      spendTxIds: spend.map((t) => t.id),
      contributions: [others.contribution],
    });
    return { f, transactions };
  }

  it('re-points every cash row onto the chosen account and empties the old one', () => {
    const { f, transactions } = legacyPool();
    const res = repointRealPoolAccount(f, 'chk1', transactions)!;
    expect(res).not.toBeNull();
    // The pool now points at the real account, with refreshed row ids.
    expect(res.funding.poolAccountId).toBe('chk1');
    expect(res.funding.account).toBe('chk1');
    expect(res.removeTxIds.sort()).toEqual(transactions.map((t) => t.id).sort());
    // No re-pointed row still references the old synthetic account.
    for (const t of res.addTxs) {
      expect(t.account).not.toBe('pool1');
      expect(t.toAccount).not.toBe('pool1');
    }
    // The pool's references were updated to the new ids.
    expect(res.funding.contributions![0].id).not.toBe(f.contributions![0].id);
    expect(res.funding.spendTxIds).toEqual(res.addTxs.filter((t) => t.toAccount !== 'chk1').map((t) => t.id));

    // Apply the swap to balances: pool1 ends at 0, chk1 absorbs the net.
    let accounts: Account[] = [acc('pool1', 'pool', 110), acc('chk1', 'checking', 1000)];
    for (const id of res.removeTxIds) {
      const old = transactions.find((t) => t.id === id)!;
      accounts = applyTransactionToBalances(accounts, old, 'reverse');
    }
    for (const tx of res.addTxs) accounts = applyTransactionToBalances(accounts, tx, 'apply');
    expect(accounts.find((a) => a.id === 'pool1')!.balance).toBe(0);   // emptied → safe to delete
    expect(accounts.find((a) => a.id === 'chk1')!.balance).toBe(1110); // 1000 + (200 − 90)
    // Held-for-others now follows the pool onto the real account.
    expect(Object.keys(calcFundingHeldByAccount([res.funding]))).toEqual(['chk1']);
  });

  it('is a no-op when the target equals the current account or there is no holding account', () => {
    const { f, transactions } = legacyPool();
    expect(repointRealPoolAccount(f, 'pool1', transactions)).toBeNull();
    expect(repointRealPoolAccount({ ...f, poolAccountId: undefined }, 'chk1', transactions)).toBeNull();
  });
});

describe('planVirtualPoolEdit', () => {
  it('recomputes the roster + total with no cash rows when nobody is removed', () => {
    const f = makePool({
      participants: [
        { id: 'me', name: 'Me', contributed: 100, isMe: true },
        { id: 'p1', name: 'Alex', contributed: 100, isMe: false },
      ],
      repayments: [{ id: 'r1', participant: 'Alex', participantId: 'p1', amount: 40, account: 'chk1', date: '2026-06-10' }],
      contributionTxId: '',
    });
    const next = [
      { id: 'me', name: 'Me', contributed: 150, isMe: true },     // bumped my pledge
      { id: 'p1', name: 'Alex', contributed: 100, isMe: false },   // unchanged (keeps payback)
      { id: 'p2', name: 'Sam', contributed: 80, isMe: false },     // added
    ];
    const { funding, addTxs, removeTxIds } = planVirtualPoolEdit(f, next, 'Beach trip 2', [], { Me: 'Me', Alex: 'Alex' });
    expect(funding.description).toBe('Beach trip 2');
    expect(funding.totalContributed).toBe(330);
    expect(funding.participants).toEqual(next);
    expect(funding.repayments).toHaveLength(1);   // Alex stays → payback kept
    expect(addTxs).toEqual([]);
    expect(removeTxIds).toEqual([]);
  });

  it('keeps a renamed participant\'s paybacks attached (re-keyed by stable id + name)', () => {
    const f = makePool({
      participants: [
        { id: 'me', name: 'Me', contributed: 100, isMe: true },
        { id: 'p1', name: 'Alex', contributed: 100, isMe: false },
      ],
      repayments: [{ id: 'r1', participant: 'Alex', participantId: 'p1', amount: 40, account: 'chk1', date: '2026-06-10' }],
      contributionTxId: '',
    });
    const { funding, addTxs, removeTxIds } = planVirtualPoolEdit(
      f,
      [{ id: 'me', name: 'Me', contributed: 100, isMe: true }, { id: 'p1', name: 'Alexander', contributed: 100, isMe: false }],
      'Beach trip', [], { Me: 'Me', Alex: 'Alexander' },   // Alex → Alexander
    );
    expect(removeTxIds).toEqual([]);                       // no cash reversed — just a rename
    expect(addTxs).toEqual([]);                            // …and nothing added either
    expect(funding.repayments).toHaveLength(1);
    expect(funding.repayments[0]).toMatchObject({ id: 'r1', participant: 'Alexander', participantId: 'p1', amount: 40 });
  });

  it("reverses a removed participant's paybacks and drops them", () => {
    const f = makePool({
      participants: [
        { id: 'me', name: 'Me', contributed: 100, isMe: true },
        { id: 'p1', name: 'Alex', contributed: 100, isMe: false },
      ],
      repayments: [
        { id: 'r1', participant: 'Alex', participantId: 'p1', amount: 40, account: 'chk1', date: '2026-06-10' },
        { id: 'r2', participant: 'Alex', participantId: 'p1', amount: 60, account: 'chk1', date: '2026-06-11' },
      ],
      contributionTxId: '',
    });
    const { funding, addTxs, removeTxIds } = planVirtualPoolEdit(
      f, [{ id: 'me', name: 'Me', contributed: 100, isMe: true }], 'Beach trip', [], { Me: 'Me' }, // Alex dropped
    );
    expect(removeTxIds.sort()).toEqual(['r1', 'r2']);   // both of Alex's paybacks reversed
    expect(funding.repayments).toEqual([]);
    expect(funding.totalContributed).toBe(100);
    expect(addTxs).toEqual([]);
  });

  it('rebuilds the legacy upfront others-contribution row to the new others total', () => {
    const original: Transaction = {
      id: 'ctx1', date: '2026-06-09', description: 'Funding pool — Beach trip',
      amount: 100, type: 'transfer', category: 'Funding', account: '', toAccount: 'chk1',
    };
    const f = makePool({
      participants: [
        { id: 'me', name: 'Me', contributed: 100, isMe: true },
        { id: 'p1', name: 'Alex', contributed: 100, isMe: false },
      ],
      account: 'chk1', repayments: [], contributionTxId: 'ctx1',
    });
    const { funding, addTxs, removeTxIds } = planVirtualPoolEdit(
      f,
      [{ id: 'me', name: 'Me', contributed: 100, isMe: true }, { id: 'p1', name: 'Alex', contributed: 250, isMe: false }],
      'Beach trip', [original], { Me: 'Me', Alex: 'Alex' },
    );
    expect(removeTxIds).toContain('ctx1');             // old held-cash row reversed
    expect(addTxs).toHaveLength(1);
    expect(addTxs[0].amount).toBe(250);                // rebuilt to the new others total
    expect(addTxs[0].toAccount).toBe('chk1');
    expect(addTxs[0].category).toBe('Funding');
    expect(funding.contributionTxId).toBe(addTxs[0].id);
  });

  it('reverses the legacy row outright when the last other person is removed', () => {
    const original: Transaction = {
      id: 'ctx1', date: '2026-06-09', description: 'held', amount: 100,
      type: 'transfer', category: 'Funding', account: '', toAccount: 'chk1',
    };
    const f = makePool({
      participants: [{ id: 'me', name: 'Me', contributed: 100, isMe: true }, { id: 'p1', name: 'Alex', contributed: 100, isMe: false }],
      account: 'chk1', repayments: [], contributionTxId: 'ctx1',
    });
    const { funding, addTxs, removeTxIds } = planVirtualPoolEdit(
      f, [{ id: 'me', name: 'Me', contributed: 100, isMe: true }], 'Beach trip', [original], { Me: 'Me' },
    );
    expect(removeTxIds).toEqual(['ctx1']);
    expect(addTxs).toEqual([]);                        // nobody else → no held cash
    expect(funding.contributionTxId).toBe('');
  });
});

describe('referencedTxIds', () => {
  it('gathers spend, contribution-row, payback and real-pool cash-in ids, deduped', () => {
    const real = makePool({
      id: 'f2', kind: 'real', contributionTxId: '', spendTxIds: ['stx2', 'stx3'],
      contributions: [
        { id: 'cb1', participant: 'Me', amount: 50, isMe: true, account: 'acc1', date: '2026-06-09' },
        { id: 'cb2', participant: 'Alex', amount: 50, isMe: false, account: '', date: '2026-06-09' },
      ],
    });
    const virtual = makePool({
      repayments: [{ id: 'rp1', participant: 'Alex', amount: 20, account: 'acc1', date: '2026-06-09' }],
    });
    const ids = referencedTxIds([virtual, real]).sort();
    // stx2 appears in both pools → deduped; ctx1 + rp1 from the virtual pool; cb1/cb2 cash-ins.
    expect(ids).toEqual(['cb1', 'cb2', 'ctx1', 'rp1', 'stx1', 'stx2', 'stx3']);
  });

  it('returns [] for pools with no linked rows', () => {
    expect(referencedTxIds([makePool({ contributionTxId: '', spendTxIds: [], repayments: [] })])).toEqual([]);
  });
});

// ── Real pool: spend paid with another account, reimbursed later ──────────────

describe('reimbursing a real pool spend paid with another account', () => {
  const acc = (id: string, type: Account['type'], balance: number): Account =>
    ({ id, name: id, type, institution: '', balance, last4: '', color: '#000', createdAt: '2026-01-01' });
  const vault = (o: Partial<Funding> = {}): Funding =>
    makePool({ kind: 'real', poolAccountId: 'sav1', account: 'sav1', contributionTxId: '', reimbursements: [], ...o });
  const spend = (o: Partial<FundingSpend> = {}): FundingSpend => ({
    key: 'k1', txIds: ['s1'], amount: 90, myShare: 30, chargedAccount: 'card1',
    description: 'Dinner', date: '2026-06-10', category: 'Food', ...o,
  });

  it('only a real pool spend charged to another account is owed back', () => {
    expect(needsReimbursement(vault(), spend())).toBe(true);
    expect(needsReimbursement(vault(), spend({ chargedAccount: 'sav1' }))).toBe(false); // paid from the pool itself
    expect(needsReimbursement(makePool(), spend())).toBe(false);                       // virtual pools hold no cash
    expect(owedBackTotal(vault(), [spend(), spend({ key: 'k2', amount: 10 }), spend({ key: 'k3', chargedAccount: 'sav1' })])).toBe(100);
  });

  it('builds one transfer from the pool account to the card for the full spend', () => {
    const built = buildReimburseTx(vault(), spend(), 'Pool payback: Dinner', '2026-06-12')!;
    expect(built.tx).toMatchObject({
      type: 'transfer', category: FUNDING_REIMBURSE_CATEGORY, amount: 90, account: 'sav1', toAccount: 'card1', date: '2026-06-12',
    });
    expect(built.reimbursement).toEqual({ id: built.tx.id, spendKey: 'k1', amount: 90, account: 'card1', date: '2026-06-12' });
    expect(buildReimburseTx(vault(), spend({ chargedAccount: 'sav1' }), 'x', '2026-06-12')).toBeNull();

    const f = vault({ reimbursements: [built.reimbursement] });
    expect(spendReimbursement(f, 'k1')).toEqual(built.reimbursement);
    expect(needsReimbursement(f, spend())).toBe(false);
    expect(referencedTxIds([f])).toContain(built.tx.id);
  });

  it('paying with a card then reimbursing leaves the card whole and the pool account down by the spend', () => {
    let accounts: Account[] = [acc('sav1', 'savings', 500), acc('card1', 'credit', 0)];
    const txs = buildSpendTxs('card1', 90, 30, 'Dinner', '2026-06-10');
    for (const tx of txs) accounts = applyTransactionToBalances(accounts, tx, 'apply');
    expect(accounts.find((a) => a.id === 'card1')!.balance).toBe(90); // card owes 90
    const built = buildReimburseTx(vault(), spend({ key: txs[0].createdAt! }), 'x', '2026-06-12')!;
    accounts = applyTransactionToBalances(accounts, built.tx, 'apply');
    expect(accounts.find((a) => a.id === 'card1')!.balance).toBe(0);
    expect(accounts.find((a) => a.id === 'sav1')!.balance).toBe(410);
  });

  it('editing a paid-back spend re-creates its payback for the new amount; paying from the pool drops it', () => {
    const first = buildReimburseTx(vault(), spend(), 'x', '2026-06-12')!;
    const f = vault({ reimbursements: [first.reimbursement] });
    const moved = rebuildReimbursement(f, 'k1', { key: 'k9', chargedAccount: 'card2', amount: 120 }, 'y');
    expect(moved.removeTxIds).toEqual([first.tx.id]);
    expect(moved.addTxs[0]).toMatchObject({ amount: 120, account: 'sav1', toAccount: 'card2', date: '2026-06-12' });
    expect(moved.reimbursements).toEqual([{ id: moved.addTxs[0].id, spendKey: 'k9', amount: 120, account: 'card2', date: '2026-06-12' }]);

    const toPool = rebuildReimbursement(f, 'k1', { key: 'k9', chargedAccount: 'sav1', amount: 120 }, 'y');
    expect(toPool).toEqual({ reimbursements: [], addTxs: [], removeTxIds: [first.tx.id] });
    expect(rebuildReimbursement(vault(), 'k1', { key: 'k9', chargedAccount: 'card2', amount: 1 }, 'y'))
      .toEqual({ reimbursements: [], addTxs: [], removeTxIds: [] });
  });

  it('keeps the payback record in sync with ledger edits and deletes', () => {
    const built = buildReimburseTx(vault(), spend(), 'x', '2026-06-12')!;
    const f = vault({ reimbursements: [built.reimbursement] });
    expect(syncFundingTxAmount(f, built.tx, { ...built.tx, amount: 80 })!.reimbursements![0].amount).toBe(80);
    expect(syncFundingTxRemoval(f, built.tx)!.reimbursements).toEqual([]);
  });

  it('re-points paybacks when a legacy pool moves to a real account', () => {
    const built = buildReimburseTx(vault({ poolAccountId: 'pool1' }), spend(), 'x', '2026-06-12')!;
    const f = vault({ poolAccountId: 'pool1', account: 'pool1', spendTxIds: [], reimbursements: [built.reimbursement] });
    const res = repointRealPoolAccount(f, 'chk1', [built.tx])!;
    expect(res.addTxs[0]).toMatchObject({ account: 'chk1', toAccount: 'card1' });
    expect(res.funding.reimbursements![0].id).toBe(res.addTxs[0].id);
  });
});
