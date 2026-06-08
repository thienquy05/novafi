import { describe, it, expect } from 'vitest';
import {
  splitLineAmount,
  splitLinesTotal,
  isCompleteLine,
  validateSplit,
  buildSplitTransactions,
  groupLedgerItems,
  type SplitLine,
} from '../tx-split';
import type { Transaction } from '@/types';

const line = (id: string, category: string, amount: string): SplitLine => ({ id, category, amount });

describe('splitLineAmount', () => {
  it('parses positive numbers, rejects junk/negatives', () => {
    expect(splitLineAmount({ amount: '12.50' })).toBe(12.5);
    expect(splitLineAmount({ amount: '' })).toBe(0);
    expect(splitLineAmount({ amount: 'abc' })).toBe(0);
    expect(splitLineAmount({ amount: '-5' })).toBe(0);
  });
});

describe('splitLinesTotal', () => {
  it('sums and rounds to cents', () => {
    expect(splitLinesTotal([{ amount: '10.10' }, { amount: '20.20' }, { amount: '' }])).toBe(30.3);
    expect(splitLinesTotal([{ amount: '0.1' }, { amount: '0.2' }])).toBe(0.3);
  });
});

describe('isCompleteLine', () => {
  it('requires a category and a positive amount', () => {
    expect(isCompleteLine(line('1', 'Food', '5'))).toBe(true);
    expect(isCompleteLine(line('1', '', '5'))).toBe(false);
    expect(isCompleteLine(line('1', 'Food', ''))).toBe(false);
    expect(isCompleteLine(line('1', 'Food', '0'))).toBe(false);
  });
});

describe('validateSplit', () => {
  it('requires at least two complete lines', () => {
    const r = validateSplit([line('1', 'Food', '10')]);
    expect(r.ok).toBe(false);
    expect(r.completeCount).toBe(1);
  });

  it('accepts two complete lines for a new split (no locked total)', () => {
    const r = validateSplit([line('1', 'Food', '10'), line('2', 'Household', '15')]);
    expect(r.ok).toBe(true);
    expect(r.total).toBe(25);
    expect(r.remaining).toBe(0);
  });

  it('rejects a half-entered line (category without amount)', () => {
    const r = validateSplit([line('1', 'Food', '10'), line('2', 'Household', '5'), line('3', 'Clothing', '')]);
    expect(r.ok).toBe(false);
  });

  it('treats a fully-blank line as ignorable', () => {
    const r = validateSplit([line('1', 'Food', '10'), line('2', 'Household', '5'), line('3', '', '')]);
    expect(r.ok).toBe(true);
    expect(r.total).toBe(15);
  });

  it('enforces a locked total within a cent', () => {
    const lines = [line('1', 'Food', '60'), line('2', 'Household', '40')];
    expect(validateSplit(lines, 100).ok).toBe(true);
    expect(validateSplit(lines, 120).ok).toBe(false);
    expect(validateSplit(lines, 120).remaining).toBe(20);
    expect(validateSplit([line('1', 'Food', '60.004'), line('2', 'Household', '40')], 100).ok).toBe(true);
  });
});

describe('buildSplitTransactions', () => {
  it('builds one expense row per complete line sharing the group id and base fields', () => {
    let n = 0;
    const txs = buildSplitTransactions(
      { date: '2026-06-08', description: 'Target', account: 'acc1', createdAt: 'TS' },
      [line('1', 'Groceries', '60'), line('2', 'Household', '40'), line('3', '', '')],
      'GROUP1',
      () => `id${++n}`,
    );
    expect(txs).toHaveLength(2);
    expect(txs.every((t) => t.type === 'expense' && t.splitGroupId === 'GROUP1')).toBe(true);
    expect(txs.every((t) => t.account === 'acc1' && t.date === '2026-06-08' && t.createdAt === 'TS')).toBe(true);
    expect(txs.map((t) => t.amount)).toEqual([60, 40]);
    expect(txs.map((t) => t.category)).toEqual(['Groceries', 'Household']);
    expect(new Set(txs.map((t) => t.id)).size).toBe(2);
  });
});

describe('groupLedgerItems', () => {
  const tx = (id: string, gid?: string, amount = 10): Transaction => ({
    id, date: '2026-06-08', description: 'x', amount, type: 'expense', category: 'Food', account: 'a',
    ...(gid ? { splitGroupId: gid } : {}),
  });

  it('folds split rows into one group at first appearance, keeps singles', () => {
    const items = groupLedgerItems([tx('a'), tx('s1', 'G', 60), tx('s2', 'G', 40), tx('b')]);
    expect(items.map((i) => i.kind)).toEqual(['single', 'group', 'single']);
    const grp = items[1];
    if (grp.kind !== 'group') throw new Error('expected group');
    expect(grp.group.transactions).toHaveLength(2);
    expect(grp.group.total).toBe(100);
    expect(grp.group.splitGroupId).toBe('G');
  });

  it('renders a group with only one surviving member as a single row', () => {
    const items = groupLedgerItems([tx('s1', 'G')]);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('single');
  });

  it('does not duplicate a group when its rows are non-adjacent', () => {
    const items = groupLedgerItems([tx('s1', 'G'), tx('x'), tx('s2', 'G')]);
    expect(items.filter((i) => i.kind === 'group')).toHaveLength(1);
  });
});
