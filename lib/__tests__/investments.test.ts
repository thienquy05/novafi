import { describe, it, expect } from 'vitest';
import {
  hasPrice, holdingValue, holdingCost, holdingGain, holdingGainPct,
  portfolioStats, accountInvestmentValue, allocationByType, allocationByHolding,
} from '@/lib/investments';
import type { Holding } from '@/types';

function makeHolding(over: Partial<Holding> = {}): Holding {
  return {
    id: 'h1',
    accountId: 'acc1',
    symbol: 'VOO',
    name: 'Vanguard S&P 500 ETF',
    assetType: 'etf',
    quantity: 10,
    avgCost: 400,
    currentPrice: 500,
    priceUpdatedAt: '2026-06-01',
    notes: '',
    createdAt: '2026-01-01',
    ...over,
  };
}

describe('holding math', () => {
  it('computes value, cost, gain and percent', () => {
    const h = makeHolding();
    expect(holdingValue(h)).toBe(5000);
    expect(holdingCost(h)).toBe(4000);
    expect(holdingGain(h)).toBe(1000);
    expect(holdingGainPct(h)).toBeCloseTo(25, 5);
  });

  it('falls back to cost basis when the price is missing', () => {
    const h = makeHolding({ currentPrice: 0 });
    expect(hasPrice(h)).toBe(false);
    expect(holdingValue(h)).toBe(4000); // = cost, so no phantom 100% loss
    expect(holdingGain(h)).toBe(0);
  });

  it('returns null percent when there is no cost basis', () => {
    const h = makeHolding({ avgCost: 0 });
    expect(holdingGainPct(h)).toBeNull();
  });

  it('handles a loss', () => {
    const h = makeHolding({ avgCost: 500, currentPrice: 400 });
    expect(holdingGain(h)).toBe(-1000);
    expect(holdingGainPct(h)).toBeCloseTo(-20, 5);
  });

  it('rounds fractional crypto positions to cents', () => {
    const h = makeHolding({ assetType: 'crypto', symbol: 'BTC', quantity: 0.13, avgCost: 30000, currentPrice: 60000 });
    expect(holdingValue(h)).toBe(7800);
    expect(holdingCost(h)).toBe(3900);
    expect(holdingGain(h)).toBe(3900);
  });
});

describe('portfolioStats', () => {
  it('aggregates across holdings', () => {
    const holdings = [
      makeHolding({ id: 'a', quantity: 10, avgCost: 400, currentPrice: 500 }), // val 5000 cost 4000
      makeHolding({ id: 'b', symbol: 'BTC', assetType: 'crypto', quantity: 1, avgCost: 30000, currentPrice: 40000 }), // val 40000 cost 30000
    ];
    const s = portfolioStats(holdings);
    expect(s.value).toBe(45000);
    expect(s.cost).toBe(34000);
    expect(s.gain).toBe(11000);
    expect(s.gainPct).toBeCloseTo((11000 / 34000) * 100, 5);
    expect(s.count).toBe(2);
  });

  it('is empty-safe', () => {
    const s = portfolioStats([]);
    expect(s).toEqual({ value: 0, cost: 0, gain: 0, gainPct: null, count: 0 });
  });
});

describe('accountInvestmentValue', () => {
  it('sums only the holdings for the given account', () => {
    const holdings = [
      makeHolding({ id: 'a', accountId: 'rh', quantity: 10, avgCost: 400, currentPrice: 500 }), // 5000
      makeHolding({ id: 'b', accountId: 'rh', quantity: 1, currentPrice: 1000, avgCost: 1000 }), // 1000
      makeHolding({ id: 'c', accountId: 'other', quantity: 5, currentPrice: 100, avgCost: 100 }), // excluded
    ];
    expect(accountInvestmentValue(holdings, 'rh')).toBe(6000);
    expect(accountInvestmentValue(holdings, 'missing')).toBe(0);
  });
});

describe('allocation', () => {
  it('breaks down by asset type, largest first', () => {
    const holdings = [
      makeHolding({ id: 'a', assetType: 'etf', quantity: 10, avgCost: 100, currentPrice: 100 }), // 1000
      makeHolding({ id: 'b', assetType: 'crypto', quantity: 1, avgCost: 3000, currentPrice: 3000 }), // 3000
      makeHolding({ id: 'c', assetType: 'stock', quantity: 1, avgCost: 1000, currentPrice: 1000 }), // 1000
    ];
    const slices = allocationByType(holdings);
    expect(slices.map((s) => s.key)).toEqual(['crypto', 'etf', 'stock']);
    expect(slices[0].pct).toBeCloseTo((3000 / 5000) * 100, 5);
  });

  it('breaks down by holding', () => {
    const holdings = [
      makeHolding({ id: 'a', symbol: 'VOO', quantity: 10, avgCost: 100, currentPrice: 100 }), // 1000
      makeHolding({ id: 'b', symbol: 'BTC', quantity: 1, avgCost: 3000, currentPrice: 3000 }), // 3000
    ];
    const slices = allocationByHolding(holdings);
    expect(slices[0].label).toBe('BTC');
    expect(slices[0].pct).toBeCloseTo(75, 5);
  });
});
