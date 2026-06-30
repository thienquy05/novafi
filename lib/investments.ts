import type { Holding } from '@/types';
import { roundCents } from './calculations';

/**
 * Pure investment / portfolio math, independent of the UI and the Sheets layer
 * (mirrors lib/calculations.ts so it can be unit-tested in isolation).
 *
 * A holding's current market value is `quantity × currentPrice`; its cost basis
 * is `quantity × avgCost`; unrealized gain is the difference. When a price hasn't
 * been set yet (currentPrice ≤ 0) we fall back to cost basis as the value so a
 * brand-new, un-priced position never reads as a 100% loss.
 */

export type AssetType = Holding['assetType'];

/** Whether a price has actually been provided for this holding. */
export function hasPrice(h: Holding): boolean {
  return Number.isFinite(h.currentPrice) && h.currentPrice > 0;
}

/**
 * Convert between a per-unit price and a total dollar amount so the entry form
 * can "chase" whichever figure the user actually knows: type the price of one
 * share/coin and read off the total (forwards), or type the total you hold and
 * back-solve the price of a single unit (backwards).
 *
 * Both directions are quantity-safe — with no quantity there's nothing to
 * multiply or divide, so they return 0 instead of NaN/Infinity. Per-unit is kept
 * to 6 decimals so fractional-crypto totals round-trip cleanly (e.g. $100 over
 * 3 shares → $33.333333 → back to $100.00), while totals round to cents.
 */
export function totalFromPerUnit(perUnit: number, quantity: number): number {
  if (!Number.isFinite(perUnit) || !Number.isFinite(quantity)) return 0;
  return roundCents(perUnit * quantity);
}

export function perUnitFromTotal(total: number, quantity: number): number {
  if (!Number.isFinite(total) || !Number.isFinite(quantity) || quantity <= 0) return 0;
  return Math.round((total / quantity) * 1e6) / 1e6;
}

/** Current market value of one holding. Falls back to cost basis when un-priced. */
export function holdingValue(h: Holding): number {
  const price = hasPrice(h) ? h.currentPrice : h.avgCost;
  return roundCents(h.quantity * price);
}

/** Cost basis (total invested) for one holding. */
export function holdingCost(h: Holding): number {
  return roundCents(h.quantity * h.avgCost);
}

/** Unrealized gain/loss in dollars for one holding. */
export function holdingGain(h: Holding): number {
  return roundCents(holdingValue(h) - holdingCost(h));
}

/** Unrealized return as a percent of cost basis. Null when there's no basis. */
export function holdingGainPct(h: Holding): number | null {
  const cost = holdingCost(h);
  if (cost <= 0) return null;
  return (holdingGain(h) / cost) * 100;
}

export interface PortfolioStats {
  value: number;     // total market value
  cost: number;      // total cost basis
  gain: number;      // total unrealized gain ($)
  gainPct: number | null; // total return (%) — null when cost basis is 0
  count: number;     // number of holdings
}

/** Aggregate value / cost / gain across a set of holdings. */
export function portfolioStats(holdings: Holding[]): PortfolioStats {
  let value = 0;
  let cost = 0;
  for (const h of holdings) {
    value += holdingValue(h);
    cost += holdingCost(h);
  }
  value = roundCents(value);
  cost = roundCents(cost);
  const gain = roundCents(value - cost);
  return {
    value,
    cost,
    gain,
    gainPct: cost > 0 ? (gain / cost) * 100 : null,
    count: holdings.length,
  };
}

/** Total market value of the holdings belonging to one account. */
export function accountInvestmentValue(holdings: Holding[], accountId: string): number {
  return roundCents(
    holdings
      .filter((h) => h.accountId === accountId)
      .reduce((s, h) => s + holdingValue(h), 0),
  );
}

export interface AllocationSlice {
  key: string;        // asset type or symbol
  label: string;      // display label
  value: number;      // market value of the slice
  pct: number;        // share of the whole portfolio (0–100)
}

const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  stock: 'Stocks',
  etf: 'ETFs',
  crypto: 'Crypto',
};

/** Breakdown by asset class (stocks / ETFs / crypto), largest first. */
export function allocationByType(holdings: Holding[]): AllocationSlice[] {
  const totals = new Map<AssetType, number>();
  for (const h of holdings) {
    totals.set(h.assetType, roundCents((totals.get(h.assetType) ?? 0) + holdingValue(h)));
  }
  const total = [...totals.values()].reduce((s, v) => s + v, 0);
  return [...totals.entries()]
    .map(([key, value]) => ({
      key,
      label: ASSET_TYPE_LABELS[key],
      value,
      pct: total > 0 ? (value / total) * 100 : 0,
    }))
    .sort((a, b) => b.value - a.value);
}

/** Breakdown by individual holding (symbol), largest first. */
export function allocationByHolding(holdings: Holding[]): AllocationSlice[] {
  const total = holdings.reduce((s, h) => s + holdingValue(h), 0);
  return holdings
    .map((h) => {
      const value = holdingValue(h);
      return {
        key: h.id,
        label: h.symbol || h.name,
        value,
        pct: total > 0 ? (value / total) * 100 : 0,
      };
    })
    .sort((a, b) => b.value - a.value);
}
