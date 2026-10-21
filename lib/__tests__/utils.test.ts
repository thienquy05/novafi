import { describe, it, expect } from 'vitest';
import { formatAxisCurrency, matchesRange, parseTagInput } from '@/lib/utils';

describe('formatAxisCurrency', () => {
  it('shows real values for small amounts instead of collapsing to $0k', () => {
    expect(formatAxisCurrency(0)).toBe('$0');
    expect(formatAxisCurrency(250)).toBe('$250');
    expect(formatAxisCurrency(999)).toBe('$999');
  });

  it('never shows cents (axis labels stay short)', () => {
    expect(formatAxisCurrency(250.75)).toBe('$251');
    expect(formatAxisCurrency(12.4)).toBe('$12');
  });

  it('scales to thousands and trims a trailing .0', () => {
    expect(formatAxisCurrency(1_000)).toBe('$1k');
    expect(formatAxisCurrency(1_500)).toBe('$1.5k');
    expect(formatAxisCurrency(12_000)).toBe('$12k');
  });

  it('scales to millions', () => {
    expect(formatAxisCurrency(1_000_000)).toBe('$1M');
    expect(formatAxisCurrency(1_200_000)).toBe('$1.2M');
  });

  it('handles negatives for charts that cross zero (e.g. net worth)', () => {
    expect(formatAxisCurrency(-250)).toBe('-$250');
    expect(formatAxisCurrency(-5_000)).toBe('-$5k');
    expect(formatAxisCurrency(-2_000_000)).toBe('-$2M');
  });
});

describe('matchesRange (transactions date/amount filter)', () => {
  const tx = { date: '2026-03-15', amount: 42.5 };
  const none = { from: '', to: '', min: '', max: '' };
  it('passes everything when unbounded', () => {
    expect(matchesRange(tx, none)).toBe(true);
  });
  it('date bounds are inclusive', () => {
    expect(matchesRange(tx, { ...none, from: '2026-03-15', to: '2026-03-15' })).toBe(true);
    expect(matchesRange(tx, { ...none, from: '2026-03-16' })).toBe(false);
    expect(matchesRange(tx, { ...none, to: '2026-03-14' })).toBe(false);
  });
  it('amount bounds are inclusive and ignore blanks/junk', () => {
    expect(matchesRange(tx, { ...none, min: '42.5', max: '42.5' })).toBe(true);
    expect(matchesRange(tx, { ...none, min: '50' })).toBe(false);
    expect(matchesRange(tx, { ...none, max: '10' })).toBe(false);
    expect(matchesRange(tx, { ...none, min: 'abc' })).toBe(true);
  });
});

describe('parseTagInput', () => {
  it('splits on commas, trims, drops blanks and case-insensitive duplicates', () => {
    expect(parseTagInput(' Japan trip, work,, Work ,')).toEqual(['Japan trip', 'work']);
  });
  it('strips the storage separator', () => {
    expect(parseTagInput('a|b')).toEqual(['ab']);
  });
});
