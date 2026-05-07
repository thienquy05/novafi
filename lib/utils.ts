import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number, showSign = false): string {
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(Math.abs(amount));
  if (showSign && amount < 0) return `-${formatted}`;
  if (showSign && amount > 0) return `+${formatted}`;
  return amount < 0 ? `-${formatted}` : formatted;
}

export function formatPercent(value: number, decimals = 2): string {
  return `${value.toFixed(decimals)}%`;
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function today(): string {
  return new Date().toISOString().split('T')[0];
}

export function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export const DEFAULT_TAX_SETTINGS = {
  filingStatus: 'single' as const,
  payPeriodsPerYear: 26,
  k401Pct: 5,
  hsaAnnual: 1600,
  iraAnnual: 0,
  federalRate: 22,
  stateRate: 3.125,
  cityRate: 1.5,
  ficaSsRate: 6.2,
  ficaSsWageBase: 176100,
  ficaMedicareRate: 1.45,
  useFederalBrackets: false,
  customExpenseCategories: [] as string[],
  customIncomeCategories: [] as string[],
  hiddenExpenseCategories: [] as string[],
  hiddenIncomeCategories: [] as string[],
};
