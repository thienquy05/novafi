import type { TaxSettings, TaxResult, FilingStatus } from '@/types';

// 2026 IRS standard deductions (Rev. Proc. 2025-28, ~2.8% inflation adjustment from 2025)
const STANDARD_DEDUCTION_2026: Record<FilingStatus, number> = {
  single: 15450,
  mfj: 30900,
  mfs: 15450,
  hoh: 23200,
};

// 2026 IRS marginal tax brackets — each entry is the ceiling for that rate
// (last bracket has Infinity ceiling)
const BRACKETS_2026: Record<FilingStatus, { max: number; rate: number }[]> = {
  single: [
    { max: 12250,  rate: 0.10 },
    { max: 49825,  rate: 0.12 },
    { max: 106250, rate: 0.22 },
    { max: 202950, rate: 0.24 },
    { max: 257650, rate: 0.32 },
    { max: 643650, rate: 0.35 },
    { max: Infinity, rate: 0.37 },
  ],
  mfj: [
    { max: 24500,  rate: 0.10 },
    { max: 99650,  rate: 0.12 },
    { max: 212500, rate: 0.22 },
    { max: 405900, rate: 0.24 },
    { max: 515300, rate: 0.32 },
    { max: 771650, rate: 0.35 },
    { max: Infinity, rate: 0.37 },
  ],
  mfs: [
    { max: 12250,  rate: 0.10 },
    { max: 49825,  rate: 0.12 },
    { max: 106250, rate: 0.22 },
    { max: 202950, rate: 0.24 },
    { max: 257650, rate: 0.32 },
    { max: 385825, rate: 0.35 },
    { max: Infinity, rate: 0.37 },
  ],
  hoh: [
    { max: 17450,  rate: 0.10 },
    { max: 66750,  rate: 0.12 },
    { max: 106250, rate: 0.22 },
    { max: 202950, rate: 0.24 },
    { max: 257650, rate: 0.32 },
    { max: 643650, rate: 0.35 },
    { max: Infinity, rate: 0.37 },
  ],
};

function calcBracketTax(taxableIncome: number, status: FilingStatus): { tax: number; marginalRate: number } {
  if (taxableIncome <= 0) return { tax: 0, marginalRate: 0 };
  const brackets = BRACKETS_2026[status];
  let tax = 0;
  let prev = 0;
  let marginalRate = brackets[0].rate;
  for (const { max, rate } of brackets) {
    if (taxableIncome <= prev) break;
    tax += (Math.min(taxableIncome, max) - prev) * rate;
    marginalRate = rate;
    prev = max;
  }
  return { tax, marginalRate };
}

// Exported for Settings page bracket display
export { BRACKETS_2026, STANDARD_DEDUCTION_2026 };

export function calcPaycheckTax(
  grossPaycheck: number,
  settings: TaxSettings,
  ytdGrossBeforeThisCheck = 0
): TaxResult {
  const {
    payPeriodsPerYear,
    k401Pct,
    hsaAnnual,
    iraAnnual,
    federalRate,
    stateRate,
    cityRate,
    ficaSsRate,
    ficaSsWageBase,
    ficaMedicareRate,
    filingStatus,
    useFederalBrackets,
  } = settings;

  const k401 = (grossPaycheck * k401Pct) / 100;
  const hsa = hsaAnnual / payPeriodsPerYear;
  const ira = iraAnnual / payPeriodsPerYear;

  let federalTax: number;
  let marginalRate: number | undefined;
  let taxableIncome: number | undefined;

  if (useFederalBrackets) {
    // Annualize gross, subtract pre-tax deductions, then apply progressive brackets
    const annualGross = grossPaycheck * payPeriodsPerYear;
    const annualK401 = (annualGross * k401Pct) / 100;
    const agi = annualGross - annualK401 - hsaAnnual - iraAnnual;
    const stdDeduction = STANDARD_DEDUCTION_2026[filingStatus] ?? 15450;
    taxableIncome = Math.max(0, agi - stdDeduction);
    const result = calcBracketTax(taxableIncome, filingStatus);
    federalTax = result.tax / payPeriodsPerYear;
    marginalRate = result.marginalRate * 100;
  } else {
    federalTax = (grossPaycheck * federalRate) / 100;
  }

  const stateTax = (grossPaycheck * stateRate) / 100;
  const cityTax = (grossPaycheck * cityRate) / 100;

  // FICA — SS has a wage base cap
  const ssableThisCheck = Math.max(
    0,
    Math.min(grossPaycheck, ficaSsWageBase - Math.max(0, ytdGrossBeforeThisCheck))
  );
  const ficaSs = (ssableThisCheck * ficaSsRate) / 100;
  const ficaMedicare = (grossPaycheck * ficaMedicareRate) / 100;

  const totalTax = federalTax + stateTax + cityTax + ficaSs + ficaMedicare;
  const netPaycheck = grossPaycheck - k401 - hsa - ira - totalTax;
  const effectiveRate = grossPaycheck > 0 ? (totalTax / grossPaycheck) * 100 : 0;

  return {
    grossPaycheck,
    k401,
    hsa,
    federalTax,
    stateTax,
    cityTax,
    ficaSs,
    ficaMedicare,
    totalTax,
    netPaycheck,
    effectiveRate,
    ...(useFederalBrackets && { marginalRate, taxableIncome }),
  };
}
