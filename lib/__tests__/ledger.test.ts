import { describe, it, expect } from 'vitest';
import {
  nextBalanceForAccount,
  applyTransactionToBalances,
  reconcileAccountBalance,
  deriveOpeningBalance,
  detectBalanceDrift,
  planReconcile,
  filterTransactions,
  paginate,
  aggregateMonthlyTotals,
  aggregateCategoryTotals,
} from '@/lib/calculations';
import type { Account, Transaction } from '@/types';

function makeAccount(overrides: Partial<Account> & { id: string; type: Account['type'] }): Account {
  return { name: 'Acct', institution: '', balance: 0, last4: '', color: '#000', createdAt: '2026-01-01', ...overrides };
}

function makeTx(overrides: Partial<Transaction> & { type: Transaction['type'] }): Transaction {
  return { id: 'tx', date: '2026-05-01', description: '', amount: 100, category: 'Food', account: 'chk', ...overrides };
}

// ── nextBalanceForAccount ───────────────────────────────────────────────────

describe('nextBalanceForAccount', () => {
  const chk = makeAccount({ id: 'chk', type: 'checking', balance: 500 });
  const card = makeAccount({ id: 'card', type: 'credit', balance: 200 });

  it('debits a cash account on expense', () => {
    expect(nextBalanceForAccount(chk, makeTx({ type: 'expense', amount: 100, account: 'chk' }), 'apply')).toBe(400);
  });

  it('increases owed balance on a credit expense', () => {
    expect(nextBalanceForAccount(card, makeTx({ type: 'expense', amount: 100, account: 'card' }), 'apply')).toBe(300);
  });

  it('credits a cash account on income', () => {
    expect(nextBalanceForAccount(chk, makeTx({ type: 'income', amount: 100, account: 'chk' }), 'apply')).toBe(600);
  });

  it('leaves unrelated accounts unchanged', () => {
    expect(nextBalanceForAccount(card, makeTx({ type: 'expense', amount: 100, account: 'chk' }), 'apply')).toBe(200);
  });

  it('lets a debt payoff transfer overshoot into a credit balance', () => {
    // Overpaying a card leaves a credit balance (the bank owes you). We do NOT
    // clamp at zero: clamping discarded money and broke reconciliation by making
    // apply/reverse non-inverse.
    const tx = makeTx({ type: 'transfer', amount: 300, account: 'chk', toAccount: 'card' });
    expect(nextBalanceForAccount(card, tx, 'apply')).toBe(-100); // 200 - 300
  });

  it('reverse is the inverse of apply for a debt payoff transfer', () => {
    const tx = makeTx({ type: 'transfer', amount: 300, account: 'chk', toAccount: 'card' });
    const applied = nextBalanceForAccount(card, tx, 'apply');
    expect(nextBalanceForAccount({ ...card, balance: applied }, tx, 'reverse')).toBe(200);
  });

  it('reverse is the inverse of apply for a cash expense', () => {
    const tx = makeTx({ type: 'expense', amount: 100, account: 'chk' });
    const applied = nextBalanceForAccount(chk, tx, 'apply');
    expect(nextBalanceForAccount({ ...chk, balance: applied }, tx, 'reverse')).toBe(500);
  });
});

// ── applyTransactionToBalances ──────────────────────────────────────────────

describe('applyTransactionToBalances', () => {
  const accounts = [
    makeAccount({ id: 'chk', type: 'checking', balance: 1000 }),
    makeAccount({ id: 'sav', type: 'savings', balance: 500 }),
  ];

  it('updates only the affected account and preserves references for the rest', () => {
    const tx = makeTx({ type: 'transfer', amount: 200, account: 'chk', toAccount: 'sav' });
    const result = applyTransactionToBalances(accounts, tx, 'apply');
    expect(result[0].balance).toBe(800);
    expect(result[1].balance).toBe(700);
    // untouched? both touched here; test a non-touching case:
    const expense = makeTx({ type: 'expense', amount: 50, account: 'chk' });
    const r2 = applyTransactionToBalances(accounts, expense, 'apply');
    expect(r2[1]).toBe(accounts[1]); // same reference, unchanged
  });
});

// ── Reconciliation ──────────────────────────────────────────────────────────

describe('reconcileAccountBalance', () => {
  it('replays the ledger from the opening balance', () => {
    const acc = makeAccount({ id: 'chk', type: 'checking', balance: 0, openingBalance: 1000 });
    const txns = [
      makeTx({ id: 't1', type: 'income', amount: 500, account: 'chk', date: '2026-05-01' }),
      makeTx({ id: 't2', type: 'expense', amount: 200, account: 'chk', date: '2026-05-02' }),
    ];
    expect(reconcileAccountBalance(acc, txns)).toBe(1300);
  });

  it('returns the stored balance untouched when no opening balance is set', () => {
    const acc = makeAccount({ id: 'chk', type: 'checking', balance: 42 });
    const txns = [makeTx({ type: 'income', amount: 500, account: 'chk' })];
    expect(reconcileAccountBalance(acc, txns)).toBe(42);
  });

  it('honors chronological order via date then createdAt', () => {
    const acc = makeAccount({ id: 'chk', type: 'checking', balance: 0, openingBalance: 100 });
    const txns = [
      makeTx({ id: 'b', type: 'expense', amount: 50, account: 'chk', date: '2026-05-01', createdAt: '2026-05-01T10:00:00Z' }),
      makeTx({ id: 'a', type: 'income', amount: 500, account: 'chk', date: '2026-05-01', createdAt: '2026-05-01T09:00:00Z' }),
    ];
    // income first (+500 → 600), then expense (-50 → 550)
    expect(reconcileAccountBalance(acc, txns)).toBe(550);
  });

  it('counts a card payment even when it replays before the charge it covers', () => {
    // Regression: a payment dated earlier than the charge it covers (backdated,
    // or opening balance set to the current owed amount while history exists)
    // used to be clamped away to zero, inflating the reconciled owed balance as
    // if only the expenses counted. Real owed balance here is 0, not 1000.
    const card = makeAccount({ id: 'card', type: 'credit', balance: 0, openingBalance: 0 });
    const txns = [
      makeTx({ id: 'pay', type: 'transfer', amount: 1000, account: 'chk', toAccount: 'card',
        date: '2026-05-10', createdAt: '2026-05-20T00:00:00Z' }),
      makeTx({ id: 'exp', type: 'expense', amount: 1000, account: 'card',
        date: '2026-05-15', createdAt: '2026-05-15T00:00:00Z' }),
    ];
    expect(reconcileAccountBalance(card, txns)).toBe(0);
  });
});

describe('deriveOpeningBalance', () => {
  it('reverse-replays so a forward replay reproduces the current balance', () => {
    const txns = [
      makeTx({ id: 't1', type: 'income', amount: 500, account: 'chk', date: '2026-05-01' }),
      makeTx({ id: 't2', type: 'expense', amount: 200, account: 'chk', date: '2026-05-02' }),
    ];
    const acc = makeAccount({ id: 'chk', type: 'checking', balance: 1300 });
    const opening = deriveOpeningBalance(acc, txns);
    expect(opening).toBe(1000);
    // round-trip: reconcile with derived opening reproduces stored balance
    expect(reconcileAccountBalance({ ...acc, openingBalance: opening }, txns)).toBe(1300);
  });

  it('equals the current balance for an account with no transactions', () => {
    const acc = makeAccount({ id: 'chk', type: 'checking', balance: 750 });
    expect(deriveOpeningBalance(acc, [])).toBe(750);
  });
});

describe('detectBalanceDrift', () => {
  const txns = [makeTx({ id: 't1', type: 'expense', amount: 200, account: 'chk', date: '2026-05-01' })];

  it('flags accounts whose stored balance diverges from the ledger', () => {
    const acc = makeAccount({ id: 'chk', type: 'checking', balance: 900, openingBalance: 1000 });
    // expected = 1000 - 200 = 800, stored 900 → drift +100
    const drift = detectBalanceDrift([acc], txns);
    expect(drift).toHaveLength(1);
    expect(drift[0]).toMatchObject({ accountId: 'chk', expected: 800, stored: 900, diff: 100 });
  });

  it('reports no drift when balances reconcile', () => {
    const acc = makeAccount({ id: 'chk', type: 'checking', balance: 800, openingBalance: 1000 });
    expect(detectBalanceDrift([acc], txns)).toHaveLength(0);
  });

  it('skips accounts that have no opening balance baseline', () => {
    const acc = makeAccount({ id: 'chk', type: 'checking', balance: 999 });
    expect(detectBalanceDrift([acc], txns)).toHaveLength(0);
  });
});

describe('planReconcile', () => {
  const txns = [
    makeTx({ id: 't1', type: 'income', amount: 500, account: 'chk', date: '2026-05-01' }),
    makeTx({ id: 't2', type: 'expense', amount: 200, account: 'chk', date: '2026-05-02' }),
  ];

  it('plans a backfill (no repair) for a legacy account whose balance is consistent', () => {
    // balance 1300 = derived opening 1000 replayed → no drift, just establish basis
    const acc = makeAccount({ id: 'chk', type: 'checking', balance: 1300 });
    const plan = planReconcile([acc], txns);
    expect(plan.toBackfill).toEqual([{ accountId: 'chk', name: 'Acct', openingBalance: 1000 }]);
    expect(plan.toRepair).toHaveLength(0);
  });

  it('plans a repair when a baselined balance has drifted', () => {
    const acc = makeAccount({ id: 'chk', type: 'checking', balance: 1350, openingBalance: 1000 });
    const plan = planReconcile([acc], txns);
    expect(plan.toBackfill).toHaveLength(0);
    expect(plan.toRepair).toEqual([{ accountId: 'chk', name: 'Acct', stored: 1350, expected: 1300, diff: 50 }]);
  });

  it('plans nothing when a baselined balance already matches', () => {
    const acc = makeAccount({ id: 'chk', type: 'checking', balance: 1300, openingBalance: 1000 });
    const plan = planReconcile([acc], txns);
    expect(plan.toBackfill).toHaveLength(0);
    expect(plan.toRepair).toHaveLength(0);
  });
});

// ── Querying ────────────────────────────────────────────────────────────────

describe('filterTransactions', () => {
  const txns: Transaction[] = [
    makeTx({ id: '1', type: 'expense', description: 'Coffee', category: 'Food', account: 'chk', date: '2026-05-03', amount: 5 }),
    makeTx({ id: '2', type: 'income', description: 'Salary', category: 'Income', account: 'chk', date: '2026-05-01', amount: 3000 }),
    makeTx({ id: '3', type: 'transfer', description: 'Move', category: 'Transfer', account: 'chk', toAccount: 'sav', date: '2026-04-15', amount: 100 }),
  ];

  it('filters by type', () => {
    expect(filterTransactions(txns, { type: 'expense' }).map((t) => t.id)).toEqual(['1']);
  });
  it('treats type "all" as no filter', () => {
    expect(filterTransactions(txns, { type: 'all' })).toHaveLength(3);
  });
  it('searches description and category case-insensitively', () => {
    expect(filterTransactions(txns, { search: 'coff' }).map((t) => t.id)).toEqual(['1']);
    expect(filterTransactions(txns, { search: 'INCOME' }).map((t) => t.id)).toEqual(['2']);
  });
  it('matches account on either side of a transfer', () => {
    expect(filterTransactions(txns, { account: 'sav' }).map((t) => t.id)).toEqual(['3']);
  });
  it('filters by monthKey', () => {
    expect(filterTransactions(txns, { monthKey: '2026-05' }).map((t) => t.id)).toEqual(['1', '2']);
  });
  it('filters by inclusive date range', () => {
    expect(filterTransactions(txns, { from: '2026-05-01', to: '2026-05-02' }).map((t) => t.id)).toEqual(['2']);
  });
});

describe('paginate', () => {
  const items = [1, 2, 3, 4, 5];
  it('returns the requested page slice', () => {
    expect(paginate(items, 2, 2)).toMatchObject({ items: [3, 4], page: 2, total: 5, totalPages: 3 });
  });
  it('clamps out-of-range pages to the last page', () => {
    expect(paginate(items, 99, 2).items).toEqual([5]);
  });
  it('clamps non-positive pages to the first page', () => {
    expect(paginate(items, 0, 2).page).toBe(1);
  });
});

// ── Aggregation ─────────────────────────────────────────────────────────────

describe('aggregateMonthlyTotals', () => {
  it('rolls income/expense per month and ignores transfers', () => {
    const txns: Transaction[] = [
      makeTx({ id: '1', type: 'income', amount: 3000, date: '2026-05-01' }),
      makeTx({ id: '2', type: 'expense', amount: 200, date: '2026-05-10' }),
      makeTx({ id: '3', type: 'expense', amount: 100, date: '2026-04-10' }),
      makeTx({ id: '4', type: 'transfer', amount: 999, date: '2026-05-15', toAccount: 'sav' }),
    ];
    expect(aggregateMonthlyTotals(txns)).toEqual([
      { monthKey: '2026-04', income: 0, expense: 100, net: -100 },
      { monthKey: '2026-05', income: 3000, expense: 200, net: 2800 },
    ]);
  });
});

describe('aggregateCategoryTotals', () => {
  const txns: Transaction[] = [
    makeTx({ id: '1', type: 'expense', amount: 50, category: 'Food', date: '2026-05-01' }),
    makeTx({ id: '2', type: 'expense', amount: 30, category: 'Food', date: '2026-05-02' }),
    makeTx({ id: '3', type: 'expense', amount: 80, category: 'Shopping', date: '2026-04-02' }),
    makeTx({ id: '4', type: 'income', amount: 999, category: 'Income', date: '2026-05-02' }),
  ];
  it('sums expenses by category', () => {
    expect(aggregateCategoryTotals(txns)).toEqual({ Food: 80, Shopping: 80 });
  });
  it('scopes to a month when given', () => {
    expect(aggregateCategoryTotals(txns, '2026-05')).toEqual({ Food: 80 });
  });
});
