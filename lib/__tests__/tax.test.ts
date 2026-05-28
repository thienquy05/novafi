import { describe, it, expect } from 'vitest';
import { calcPaycheckTax, BRACKETS_2026, STANDARD_DEDUCTION_2026 } from '@/lib/tax';
import type { TaxSettings } from '@/types';

// Re-export the internal calcBracketTax by testing it through calcPaycheckTax
// (calcBracketTax is not exported, so we test its effect via the progressive path)

const BASE_SETTINGS: TaxSettings = {
  filingStatus: 'single',
  payPeriodsPerYear: 26,
  k401Pct: 0,
  hsaAnnual: 0,
  iraAnnual: 0,
  federalRate: 0,
  stateRate: 0,
  cityRate: 0,
  ficaSsRate: 6.2,
  ficaSsWageBase: 176100,
  ficaMedicareRate: 1.45,
  useFederalBrackets: false,
  excludeLoansFromNetWorth: false,
  budgetRollover: false,
  customExpenseCategories: [],
  customIncomeCategories: [],
  hiddenExpenseCategories: [],
  hiddenIncomeCategories: [],
  language: 'en',
};

describe('BRACKETS_2026 and STANDARD_DEDUCTION_2026', () => {
  it('standard deduction single = $15,450', () => {
    expect(STANDARD_DEDUCTION_2026.single).toBe(15450);
  });

  it('standard deduction mfj = $30,900', () => {
    expect(STANDARD_DEDUCTION_2026.mfj).toBe(30900);
  });

  it('single first bracket top = $12,250 at 10%', () => {
    expect(BRACKETS_2026.single[0]).toEqual({ max: 12250, rate: 0.10 });
  });
});

describe('calcPaycheckTax — flat rate mode', () => {
  it('zero gross produces all zeros', () => {
    const result = calcPaycheckTax(0, { ...BASE_SETTINGS, ficaSsRate: 6.2, ficaMedicareRate: 1.45 });
    expect(result.grossPaycheck).toBe(0);
    expect(result.totalTax).toBe(0);
    expect(result.netPaycheck).toBe(0);
    expect(result.effectiveRate).toBe(0);
  });

  it('flat rate: federal + state taxes computed correctly', () => {
    const settings: TaxSettings = {
      ...BASE_SETTINGS,
      federalRate: 22,
      stateRate: 5,
      ficaSsRate: 6.2,
      ficaMedicareRate: 1.45,
    };
    const result = calcPaycheckTax(5000, settings);
    expect(result.federalTax).toBeCloseTo(1100, 2);
    expect(result.stateTax).toBeCloseTo(250, 2);
    expect(result.ficaSs).toBeCloseTo(310, 2);
    expect(result.ficaMedicare).toBeCloseTo(72.5, 2);
    expect(result.totalTax).toBeCloseTo(1732.5, 2);
    expect(result.netPaycheck).toBeCloseTo(3267.5, 2);
  });

  it('k401 deduction reduces net pay (not taxes)', () => {
    const settings: TaxSettings = { ...BASE_SETTINGS, k401Pct: 6 };
    const result = calcPaycheckTax(5000, settings);
    expect(result.k401).toBeCloseTo(300, 2);
    // k401 is a pre-tax deduction reducing net, not counted in totalTax
    expect(result.netPaycheck).toBeCloseTo(5000 - 300 - result.totalTax, 2);
  });

  it('HSA and IRA deductions reduce net pay', () => {
    const settings: TaxSettings = {
      ...BASE_SETTINGS,
      hsaAnnual: 3250,
      iraAnnual: 7000,
      payPeriodsPerYear: 26,
    };
    const result = calcPaycheckTax(5000, settings);
    const hsa = 3250 / 26;    // 125
    const ira = 7000 / 26;    // ~269.23
    expect(result.hsa).toBeCloseTo(hsa, 2);
    // netPaycheck = gross - k401 - hsa - ira - totalTax (ira is deducted but not on TaxResult)
    expect(result.netPaycheck).toBeCloseTo(5000 - hsa - ira - result.totalTax, 2);
  });

  it('city tax applied correctly', () => {
    const settings: TaxSettings = { ...BASE_SETTINGS, cityRate: 1.5 };
    const result = calcPaycheckTax(4000, settings);
    expect(result.cityTax).toBeCloseTo(60, 2);
  });
});

describe('calcPaycheckTax — FICA Social Security wage base cap', () => {
  it('full SS tax when YTD is zero', () => {
    const result = calcPaycheckTax(5000, BASE_SETTINGS, 0);
    expect(result.ficaSs).toBeCloseTo(5000 * 0.062, 4);
  });

  it('partial SS when YTD is near wage base', () => {
    // ytd=174000, gross=5000, wageBase=176100 → ssable = 2100
    const result = calcPaycheckTax(5000, BASE_SETTINGS, 174000);
    expect(result.ficaSs).toBeCloseTo(2100 * 0.062, 4); // 130.2
  });

  it('SS is zero when YTD already exceeds wage base', () => {
    const result = calcPaycheckTax(5000, BASE_SETTINGS, 177000);
    expect(result.ficaSs).toBe(0);
  });

  it('SS caps exactly at wage base', () => {
    // ytd=175100, gross=5000, wageBase=176100 → ssable=1000
    const result = calcPaycheckTax(5000, BASE_SETTINGS, 175100);
    expect(result.ficaSs).toBeCloseTo(1000 * 0.062, 4);
  });

  it('Medicare has no wage base cap', () => {
    const result = calcPaycheckTax(5000, BASE_SETTINGS, 300000);
    expect(result.ficaSs).toBe(0);
    expect(result.ficaMedicare).toBeCloseTo(5000 * 0.0145, 4);
  });
});

describe('calcPaycheckTax — progressive bracket mode (single)', () => {
  it('returns marginalRate and taxableIncome when useFederalBrackets=true', () => {
    const settings: TaxSettings = { ...BASE_SETTINGS, useFederalBrackets: true };
    const result = calcPaycheckTax(4000, settings);
    expect(result.marginalRate).toBeDefined();
    expect(result.taxableIncome).toBeDefined();
  });

  it('income fully below standard deduction → zero federal tax', () => {
    // annualGross = 500*26 = 13000, k401=0, hsa=0, ira=0
    // agi=13000, taxable = max(0, 13000-15450) = 0
    const settings: TaxSettings = { ...BASE_SETTINGS, useFederalBrackets: true };
    const result = calcPaycheckTax(500, settings);
    expect(result.federalTax).toBe(0);
    expect(result.taxableIncome).toBe(0);
  });

  it('progressive tax for a single filer at $4000/paycheck (26 periods)', () => {
    // annualGross = 4000*26 = 104000
    // k401=0, hsa=0, ira=0 → agi=104000
    // taxableIncome = 104000 - 15450 = 88550
    // bracket calc: 10% on 12250=1225, 12% on 37575=4509, 22% on 38725=8519.5 → total=14253.5
    // federal per paycheck = 14253.5/26 ≈ 548.21
    const settings: TaxSettings = { ...BASE_SETTINGS, useFederalBrackets: true };
    const result = calcPaycheckTax(4000, settings);
    expect(result.federalTax).toBeCloseTo(14253.5 / 26, 2);
    expect(result.taxableIncome).toBeCloseTo(88550, 2);
    expect(result.marginalRate).toBeCloseTo(22, 1);
  });

  it('pre-tax k401 reduces taxable income in bracket mode', () => {
    // annualGross=104000, k401Pct=10 → annualK401=10400, agi=93600
    // taxableIncome = 93600 - 15450 = 78150
    const settings: TaxSettings = { ...BASE_SETTINGS, useFederalBrackets: true, k401Pct: 10 };
    const result = calcPaycheckTax(4000, settings);
    expect(result.taxableIncome).toBeCloseTo(78150, 2);
  });

  it('MFJ filer has higher first bracket', () => {
    // annualGross = 4000*26 = 104000, agi=104000, std deduct=30900
    // taxableIncome = 73100 → all in 10% and 12% brackets
    const settings: TaxSettings = { ...BASE_SETTINGS, useFederalBrackets: true, filingStatus: 'mfj' };
    const result = calcPaycheckTax(4000, settings);
    // MFJ taxableIncome = 104000 - 30900 = 73100
    expect(result.taxableIncome).toBeCloseTo(73100, 2);
    // 10% on 24500=2450, 12% on 48600=5832 → total=8282
    expect(result.federalTax).toBeCloseTo(8282 / 26, 2);
    expect(result.marginalRate).toBeCloseTo(12, 1);
  });

  it('high earner hits 35% bracket (single)', () => {
    // annualGross = 30000*26 = 780000, taxableIncome = 780000-15450 = 764550
    // which is above 643650 (35% ceiling for single) → hits 37% bracket
    const settings: TaxSettings = { ...BASE_SETTINGS, useFederalBrackets: true };
    const result = calcPaycheckTax(30000, settings);
    expect(result.marginalRate).toBeCloseTo(37, 1);
  });

  it('effectiveRate = totalTax / grossPaycheck', () => {
    const settings: TaxSettings = { ...BASE_SETTINGS, federalRate: 22, stateRate: 5 };
    const result = calcPaycheckTax(5000, settings);
    expect(result.effectiveRate).toBeCloseTo((result.totalTax / 5000) * 100, 4);
  });
});
