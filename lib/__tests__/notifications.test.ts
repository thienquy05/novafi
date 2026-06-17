import { describe, it, expect } from 'vitest';
import { buildNotifications, type NotificationContext } from '@/lib/notifications';
import type { Account, Bill, Budget, Transaction } from '@/types';

const NOW = new Date('2026-06-11T12:00:00');

// Simple identity-style translator so assertions can target stable substrings
// without depending on the locale files.
const ctx: NotificationContext = {
  now: NOW,
  monthKey: '2026-06',
  tr: (key, params) => (params ? `${key}|${JSON.stringify(params)}` : key),
  fmt: (n) => `$${n.toFixed(2)}`,
};

function acc(o: Partial<Account> & { id: string }): Account {
  return {
    name: o.id, type: 'checking', institution: '', balance: 0,
    last4: '', color: '#000', createdAt: '2026-01-01', ...o,
  };
}
function bill(o: Partial<Bill> & { id: string }): Bill {
  return {
    name: o.id, amount: 100, frequency: 'monthly', nextDue: '2026-06-20',
    account: 'a1', category: 'Bills', isActive: true, ...o,
  };
}

describe('buildNotifications', () => {
  it('returns nothing when everything is healthy', () => {
    const accounts = [acc({ id: 'a1', balance: 5000 })];
    expect(buildNotifications({ accounts, bills: [], budgets: [], transactions: [] }, ctx)).toEqual([]);
  });

  it('flags an account that WILL overdraft once upcoming bills are drawn', () => {
    const accounts = [acc({ id: 'a1', name: 'Checking', balance: 50 })];
    const bills = [bill({ id: 'b1', account: 'a1', amount: 200, nextDue: '2026-06-15' })];
    const out = buildNotifications({ accounts, bills, budgets: [], transactions: [] }, ctx);
    const od = out.find((n) => n.type === 'overdraft');
    expect(od).toBeDefined();
    expect(od!.id).toBe('overdraft:a1');
    expect(od!.severity).toBe('critical'); // positive now, but bills push it negative
    expect(od!.title).toContain('overdraftWillTitle'); // not the "already overdrawn" wording
    expect(od!.href).toBe('/accounts');
  });

  it('describes an ALREADY-overdrawn account in plain terms (no phantom bills)', () => {
    // The screenshot case: balance is already −$178 with $0 of bills. The old
    // wording read "−$178 on hand − $0 in bills = −$178 projected", which was
    // confusing. Now it's framed as already overdrawn.
    const accounts = [acc({ id: 'a1', name: 'Me', balance: -178 })];
    const out = buildNotifications({ accounts, bills: [], budgets: [], transactions: [] }, ctx);
    const od = out.find((n) => n.type === 'overdraft');
    expect(od).toBeDefined();
    expect(od!.severity).toBe('critical');
    expect(od!.title).toContain('overdrawnTitle');
    // No bills → the simple "add {short} to get back to $0" body, short = $178.
    expect(od!.body).toContain('overdrawnBody');
    expect(od!.body).toContain('$178.00');
    expect(od!.body).not.toContain('overdrawnBodyBills');
  });

  it('flags overdue bills one item each, skipping future/inactive ones', () => {
    const accounts = [acc({ id: 'a1', balance: 9000 })];
    const bills = [
      bill({ id: 'b1', nextDue: '2026-06-01' }),               // overdue
      bill({ id: 'b2', nextDue: '2026-06-30' }),               // future
      bill({ id: 'b3', nextDue: '2026-06-01', isActive: false }), // inactive
    ];
    const out = buildNotifications({ accounts, bills, budgets: [], transactions: [] }, ctx);
    const billNotes = out.filter((n) => n.type === 'bill');
    expect(billNotes).toHaveLength(1);
    expect(billNotes[0].id).toBe('bill:b1');
  });

  it('flags an over-budget category', () => {
    const budgets: Budget[] = [{ id: 'bud1', category: 'Food', amount: 100, period: 'monthly' }];
    const transactions: Transaction[] = [
      { id: 't1', date: '2026-06-05', description: '', amount: 80, type: 'expense', category: 'Food', account: 'a1' },
      { id: 't2', date: '2026-06-06', description: '', amount: 40, type: 'expense', category: 'Food', account: 'a1' },
    ];
    const out = buildNotifications({ accounts: [], bills: [], budgets, transactions }, ctx);
    const b = out.find((n) => n.type === 'budget');
    expect(b).toBeDefined();
    expect(b!.id).toBe('budget:bud1');
  });

  it('flags a credit card whose upcoming bills would run it past its limit', () => {
    // $900 owed on a $1,000 limit, with $300 of bills charged to the card.
    const accounts = [acc({ id: 'c1', name: 'Visa', type: 'credit', balance: 900, creditLimit: 1000 })];
    const bills = [bill({ id: 'b1', account: 'c1', amount: 300, nextDue: '2026-06-15' })];
    const out = buildNotifications({ accounts, bills, budgets: [], transactions: [] }, ctx);
    const od = out.find((n) => n.type === 'overdraft');
    expect(od).toBeDefined();
    expect(od!.id).toBe('overdraft:c1');
    expect(od!.severity).toBe('critical');
    expect(od!.title).toContain('creditLimitTitle');
    expect(od!.href).toBe('/credit');
  });

  it('does not raise a credit-limit alert when the card has no upcoming bills', () => {
    const accounts = [acc({ id: 'c1', name: 'Visa', type: 'credit', balance: 800, creditLimit: 1000 })];
    const out = buildNotifications({ accounts, bills: [], budgets: [], transactions: [] }, ctx);
    expect(out.find((n) => n.type === 'overdraft')).toBeUndefined();
  });

  it('flags a credit card over 30% utilization', () => {
    const accounts = [acc({ id: 'c1', name: 'Visa', type: 'credit', balance: 800, creditLimit: 1000 })];
    const out = buildNotifications({ accounts, bills: [], budgets: [], transactions: [] }, ctx);
    const c = out.find((n) => n.type === 'credit');
    expect(c).toBeDefined();
    expect(c!.id).toBe('credit:c1');
    expect(c!.href).toBe('/credit');
  });

  it('flags stale savings only past the 45-day threshold', () => {
    const accounts = [acc({ id: 's1', name: 'Emergency', type: 'savings', balance: 1000, createdAt: '2026-01-01' })];
    const out = buildNotifications({ accounts, bills: [], budgets: [], transactions: [] }, ctx);
    const s = out.find((n) => n.type === 'savings');
    expect(s).toBeDefined();
    expect(s!.id).toBe('savings:s1');
    expect(s!.severity).toBe('info');
  });

  it('produces stable ids so read/dismiss state can persist', () => {
    const accounts = [acc({ id: 'a1', name: 'Checking', balance: 50 })];
    const bills = [bill({ id: 'b1', account: 'a1', amount: 200, nextDue: '2026-06-15' })];
    const first = buildNotifications({ accounts, bills, budgets: [], transactions: [] }, ctx);
    const second = buildNotifications({ accounts, bills, budgets: [], transactions: [] }, ctx);
    expect(first.map((n) => n.id)).toEqual(second.map((n) => n.id));
  });
});
