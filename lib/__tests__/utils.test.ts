import { describe, it, expect } from 'vitest';
import { formatAxisCurrency } from '@/lib/utils';

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
