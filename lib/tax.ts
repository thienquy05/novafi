import type { TaxSettings, TaxResult } from '@/types';

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
  } = settings;

  const k401 = (grossPaycheck * k401Pct) / 100;
  const hsa = hsaAnnual / payPeriodsPerYear;
  const ira = iraAnnual / payPeriodsPerYear;

  const federalTax = (grossPaycheck * federalRate) / 100;
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
  };
}
