import { describe, it, expect } from 'vitest';
import { calcOwedToYou } from '@/lib/receivables';
import { calcNetWorth } from '@/lib/calculations';
import type { Account, Funding, Split } from '@/types';

const split = (over: Partial<Split> = {}): Split => ({
  id: 's1', billId: 'b1', billName: 'Rent', contactId: 'c1', contactName: 'Alex',
  amount: 100, category: 'Bills', account: 'a1', date: '2026-10-01',
  settled: false, settledDate: '', repaidAmount: 0, repaymentTxIds: [],
  ...over,
});

const pool = (over: Partial<Funding> = {}): Funding => ({
  id: 'f1', description: 'Trip', account: 'a1', date: '2026-10-01', kind: 'virtual',
  participants: [
    { name: 'Me', contributed: 100, isMe: true },
    { name: 'Alex', contributed: 100, isMe: false },
    { name: 'Sam', contributed: 50, isMe: false },
  ],
  totalContributed: 250, spent: 0, contributionTxId: '', spendTxIds: [],
  repayments: [], closed: false,
  ...over,
});

describe('calcOwedToYou', () => {
  it('is zero with nothing recorded', () => {
    expect(calcOwedToYou([], [])).toEqual({ splits: 0, funding: 0, total: 0 });
  });

  it('counts the remaining share of bill splits and one-off splits alike', () => {
    const splits = [
      split({ id: 's1', amount: 100, repaidAmount: 40 }),
      split({ id: 's2', billId: 'oneoff:g1', amount: 30 }),
    ];
    expect(calcOwedToYou(splits, []).splits).toBe(90); // (100 − 40) + 30
  });

  it('ignores settled splits', () => {
    expect(calcOwedToYou([split({ settled: true, repaidAmount: 100 })], []).total).toBe(0);
  });

  it('counts unpaid pledges of others on open virtual tabs, never your own', () => {
    expect(calcOwedToYou([], [pool()]).funding).toBe(150); // Alex 100 + Sam 50, not Me
  });

  it('nets partial repayments on a funding tab', () => {
    const f = pool({ repayments: [{ id: 'r1', participant: 'Alex', amount: 60, account: 'a1', date: '2026-10-05' }] });
    expect(calcOwedToYou([], [f]).funding).toBe(90);
  });

  it('skips closed tabs and real pools (everyone already paid in)', () => {
    expect(calcOwedToYou([], [pool({ closed: true }), pool({ id: 'f2', kind: 'real' })]).funding).toBe(0);
  });

  it('totals splits and funding without float drift', () => {
    const r = calcOwedToYou([split({ amount: 0.1 }), split({ id: 's2', amount: 0.2 })], [pool()]);
    expect(r.splits).toBe(0.3);
    expect(r.total).toBe(150.3);
  });

  it('never changes net worth — it is reported separately from the accounts', () => {
    const accounts: Account[] = [
      { id: 'a1', name: 'Checking', type: 'checking', institution: '', balance: 900, last4: '', color: '', createdAt: '' },
    ];
    const before = calcNetWorth(accounts, [], 'liquid');
    calcOwedToYou([split()], [pool()]);
    expect(calcNetWorth(accounts, [], 'liquid')).toBe(before);
  });
});
