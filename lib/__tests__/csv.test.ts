import { describe, it, expect } from 'vitest';
import { transactionsToCsv } from '@/lib/csv';
import type { Transaction } from '@/types';

function makeTx(overrides: Partial<Transaction> & { type: Transaction['type'] }): Transaction {
  return { id: 'tx', date: '2026-05-01', description: '', amount: 100, category: 'Food', account: 'chk', ...overrides };
}

describe('transactionsToCsv', () => {
  it('emits a header row plus one row per transaction', () => {
    const csv = transactionsToCsv([makeTx({ type: 'expense', description: 'Coffee', amount: 4.5 })]);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('"Date","Description","Amount","Type","Category","Account","To Account"');
    expect(lines[1]).toBe('"2026-05-01","Coffee","4.50","expense","Food","chk",""');
  });

  it('maps account ids to names and includes transfer destinations', () => {
    const names: Record<string, string> = { chk: 'Checking', sav: 'Savings' };
    const csv = transactionsToCsv(
      [makeTx({ type: 'transfer', description: 'Move', amount: 200, account: 'chk', toAccount: 'sav' })],
      (id) => names[id] ?? id,
    );
    expect(csv.split('\n')[1]).toBe('"2026-05-01","Move","200.00","transfer","Food","Checking","Savings"');
  });

  it('escapes embedded quotes per RFC 4180', () => {
    const csv = transactionsToCsv([makeTx({ type: 'expense', description: 'Say "hi"', amount: 1 })]);
    expect(csv.split('\n')[1]).toContain('"Say ""hi"""');
  });

  it('formats amounts to two decimals', () => {
    const csv = transactionsToCsv([makeTx({ type: 'expense', amount: 1000 })]);
    expect(csv.split('\n')[1]).toContain('"1000.00"');
  });
});
