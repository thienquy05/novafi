import { describe, it, expect } from 'vitest';
import {
  investedInAccount, accountInvestment, portfolioStats, contributionHistory,
} from '@/lib/investments';
import type { Account, Transaction } from '@/types';

function makeAccount(over: Partial<Account> = {}): Account {
  return {
    id: 'inv1',
    name: 'Robinhood',
    type: 'investment',
    institution: 'Robinhood',
    balance: 0,
    last4: '',
    color: '#6366f1',
    createdAt: '2026-01-01',
    openingBalance: 0,
    ...over,
  };
}

function transfer(over: Partial<Transaction> = {}): Transaction {
  return {
    id: Math.random().toString(36).slice(2),
    date: '2026-02-01',
    description: 'Contribution',
    amount: 100,
    type: 'transfer',
    category: 'Investment',
    account: 'checking',
    toAccount: 'inv1',
    ...over,
  };
}

describe('investedInAccount', () => {
  it('starts from the opening balance', () => {
    const acc = makeAccount({ openingBalance: 500 });
    expect(investedInAccount(acc, [])).toBe(500);
  });

  it('adds transfers in and subtracts transfers out', () => {
    const acc = makeAccount({ openingBalance: 0 });
    const txs = [
      transfer({ amount: 100, toAccount: 'inv1', account: 'checking' }), // +100
      transfer({ amount: 250, toAccount: 'inv1', account: 'savings' }),  // +250
      transfer({ amount: 50, toAccount: 'checking', account: 'inv1' }),  // −50 (withdrawal)
    ];
    expect(investedInAccount(acc, txs)).toBe(300);
  });

  it('ignores non-transfers and transfers for other accounts', () => {
    const acc = makeAccount();
    const txs = [
      transfer({ amount: 100, toAccount: 'other' }),                        // other account
      { ...transfer({ amount: 100 }), type: 'expense' as const },           // not a transfer
    ];
    expect(investedInAccount(acc, txs)).toBe(0);
  });
});

describe('accountInvestment', () => {
  it('computes value, invested, gain and percent', () => {
    const acc = makeAccount({ balance: 1200, openingBalance: 0 });
    const txs = [transfer({ amount: 1000 })]; // invested 1000, value 1200
    const s = accountInvestment(acc, txs);
    expect(s.value).toBe(1200);
    expect(s.invested).toBe(1000);
    expect(s.gain).toBe(200);
    expect(s.gainPct).toBeCloseTo(20, 5);
  });

  it('handles a loss', () => {
    const acc = makeAccount({ balance: 800, openingBalance: 0 });
    const s = accountInvestment(acc, [transfer({ amount: 1000 })]);
    expect(s.gain).toBe(-200);
    expect(s.gainPct).toBeCloseTo(-20, 5);
  });

  it('returns null percent when nothing is invested', () => {
    const acc = makeAccount({ balance: 0, openingBalance: 0 });
    expect(accountInvestment(acc, []).gainPct).toBeNull();
  });
});

describe('portfolioStats', () => {
  it('aggregates across investment accounts', () => {
    const a = makeAccount({ id: 'a', balance: 1200, openingBalance: 0 });
    const b = makeAccount({ id: 'b', balance: 5000, openingBalance: 2000 });
    const txs = [
      transfer({ amount: 1000, toAccount: 'a' }), // a invested 1000, value 1200
      transfer({ amount: 1000, toAccount: 'b' }), // b invested 2000+1000=3000, value 5000
    ];
    const s = portfolioStats([a, b], txs);
    expect(s.value).toBe(6200);
    expect(s.invested).toBe(4000);
    expect(s.gain).toBe(2200);
    expect(s.gainPct).toBeCloseTo((2200 / 4000) * 100, 5);
    expect(s.count).toBe(2);
  });

  it('is empty-safe', () => {
    expect(portfolioStats([], [])).toEqual({ value: 0, invested: 0, gain: 0, gainPct: null, count: 0 });
  });
});

describe('contributionHistory', () => {
  it('lists the account transfers newest first, tagged by direction', () => {
    const acc = makeAccount();
    const txs = [
      transfer({ id: 't1', date: '2026-01-05', amount: 100, toAccount: 'inv1', account: 'checking' }),
      transfer({ id: 't2', date: '2026-03-01', amount: 40, toAccount: 'checking', account: 'inv1' }),
      transfer({ id: 't3', date: '2026-02-01', amount: 200, toAccount: 'other', account: 'checking' }), // unrelated
    ];
    const hist = contributionHistory(acc, txs);
    expect(hist.map((h) => h.tx.id)).toEqual(['t2', 't1']);
    expect(hist[0].direction).toBe('out');
    expect(hist[1].direction).toBe('in');
  });
});
