import { describe, it, expect } from 'vitest';
import { computeSplitShares, sumPerPersonShares, isOneOffSplit, newOneOffGroupId, groupSplits } from '@/lib/splits';
import type { Split } from '@/types';

describe('sumPerPersonShares', () => {
  it('sums typed amounts into the total (you excluded)', () => {
    const { shares, total, myShare, over } = sumPerPersonShares([50, 70, 35], 0, false);
    expect(shares).toEqual([50, 70, 35]);
    expect(total).toBe(155);
    expect(myShare).toBe(0);
    expect(over).toBe(false);
  });

  it('adds your own share to the total when included', () => {
    const { total, myShare } = sumPerPersonShares([40, 60], 25, true);
    expect(myShare).toBe(25);
    expect(total).toBe(125);
  });

  it('treats blank entries as 0 (no auto-divide)', () => {
    const { shares, total } = sumPerPersonShares([40, null, 20], 0, false);
    expect(shares).toEqual([40, 0, 20]);
    expect(total).toBe(60);
  });
});

describe('computeSplitShares', () => {
  it('one blank absorbs the remaining balance', () => {
    // $200, three typed (50/70/35), one blank → blank owes 45, you owe 0.
    const { shares, myShare, over } = computeSplitShares(200, [50, 70, 35, null], false);
    expect(shares).toEqual([50, 70, 35, 45]);
    expect(myShare).toBe(0);
    expect(over).toBe(false);
  });

  it('two blanks split the remainder equally', () => {
    // $200, two typed (50/70), two blank → each blank owes 40.
    const { shares, myShare } = computeSplitShares(200, [50, 70, null, null], false);
    expect(shares).toEqual([50, 70, 40, 40]);
    expect(myShare).toBe(0);
  });

  it('honors all-typed amounts and leaves the leftover as my share', () => {
    const { shares, myShare } = computeSplitShares(200, [50, 70, 35], false);
    expect(shares).toEqual([50, 70, 35]);
    expect(myShare).toBe(45); // I cover the rest
  });

  it('includeMe puts you in the even split', () => {
    // $200, three blank others + me → 50 each, my share 50.
    const { shares, myShare } = computeSplitShares(200, [null, null, null], true);
    expect(shares).toEqual([50, 50, 50]);
    expect(myShare).toBe(50);
  });

  it('distributes rounding leftover to the last auto party', () => {
    // $100 / 3 blanks (no me): 33.33, 33.33, 33.34.
    const { shares, myShare } = computeSplitShares(100, [null, null, null], false);
    expect(shares).toEqual([33.33, 33.33, 33.34]);
    expect(myShare).toBe(0);
    // ...with me included it's a 4-way split; my share absorbs the leftover cent.
    const me = computeSplitShares(100, [null, null, null], true);
    expect(me.shares).toEqual([25, 25, 25]);
    expect(me.myShare).toBe(25);
  });

  it('flags over-allocation when typed amounts exceed the total', () => {
    const { over } = computeSplitShares(100, [60, 70], false);
    expect(over).toBe(true);
  });

  it('mixes typed + blank with includeMe', () => {
    // $120, one typed 60, one blank, + me → remainder 60 split over 2 = 30 each.
    const { shares, myShare } = computeSplitShares(120, [60, null], true);
    expect(shares).toEqual([60, 30]);
    expect(myShare).toBe(30);
  });
});

describe('one-off split tagging', () => {
  it('round-trips the oneoff prefix', () => {
    const id = newOneOffGroupId();
    expect(isOneOffSplit({ billId: id } as Split)).toBe(true);
    expect(isOneOffSplit({ billId: 'bill_123' } as Split)).toBe(false);
  });
});

describe('groupSplits', () => {
  const mk = (id: string, billId: string, date: string, amount: number): Split => ({
    id, billId, billName: 'Dinner', contactId: 'c' + id, contactName: 'P' + id,
    amount, category: 'Food', account: '', date, settled: false, settledDate: '',
    frontedTxId: '', settleTxId: '',
  });
  it('groups same billId + date and sums the total', () => {
    const groups = groupSplits([mk('1', 'g1', '2026-06-01', 50), mk('2', 'g1', '2026-06-01', 70)]);
    expect(groups).toHaveLength(1);
    expect(groups[0].total).toBe(120);
    expect(groups[0].splits).toHaveLength(2);
  });
  it('keeps different dates of the same bill separate', () => {
    const groups = groupSplits([mk('1', 'g1', '2026-06-01', 50), mk('2', 'g1', '2026-07-01', 50)]);
    expect(groups).toHaveLength(2);
  });
});
