import { describe, it, expect } from 'vitest';
import {
  calcTraditionalNetWorth, calcLiquidNetWorth, calcTotalAssets, calcTotalDebt, calcLiquidSavings,
  calcMonthIncome, calcMonthExpense, calcSavingsRate, calcSafeToSpend, pctChange,
  normalizeMonthlyBudget,
  calcAvgMonthlyExpense, calcEmergencyFundMonths,
  calcSavingsRateScore, calcEmergencyScore, calcBudgetScore, calcDebtScore, calcHealthGrade,
  calcDebtToIncomeScore, calcDebtToIncomeRatio,
  calcNetWorthTrendScore, calcAvgMomPct,
  calcSpendingVolatilityScore, calcCoefficientOfVariation,
  calcGoalProgress,
  applyExpenseBalance, applyIncomeBalance, applyTransferFromBalance, applyTransferToBalance,
  reverseExpenseBalance, reverseIncomeBalance, reverseTransferFromBalance, reverseTransferToBalance,
  billToTransactionDefaults,
} from '@/lib/calculations';
import type { Account, Transaction, Bill } from '@/types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeAccount(overrides: Partial<Account> & { type: Account['type'] }): Account {
  return {
    id: 'acc_1', name: 'Test', institution: '', balance: 0, last4: '', color: '#000', createdAt: '2026-01-01',
    ...overrides,
  };
}

function makeTx(overrides: Partial<Transaction> & { type: Transaction['type'] }): Transaction {
  return {
    id: 'tx_1', date: '2026-05-01', description: '', amount: 100,
    category: 'Food', account: 'acc_1',
    ...overrides,
  };
}

const MIXED_ACCOUNTS: Account[] = [
  makeAccount({ id: 'chk', type: 'checking', balance: 5000 }),
  makeAccount({ id: 'sav', type: 'savings',  balance: 10000 }),
  makeAccount({ id: 'crd', type: 'credit',   balance: 2000 }),
  makeAccount({ id: 'lon', type: 'loan',     balance: 20000 }),
];

// ── Net Worth ─────────────────────────────────────────────────────────────────

describe('calcTraditionalNetWorth', () => {
  it('mixed accounts: assets - all liabilities', () => {
    expect(calcTraditionalNetWorth(MIXED_ACCOUNTS)).toBe(5000 + 10000 - 2000 - 20000); // -7000
  });

  it('empty accounts → 0', () => {
    expect(calcTraditionalNetWorth([])).toBe(0);
  });

  it('only assets → positive sum', () => {
    const accounts = [
      makeAccount({ type: 'checking', balance: 3000 }),
      makeAccount({ type: 'investment', balance: 7000 }),
    ];
    expect(calcTraditionalNetWorth(accounts)).toBe(10000);
  });

  it('credit card with zero balance → no effect on net worth', () => {
    const accounts = [
      makeAccount({ type: 'checking', balance: 5000 }),
      makeAccount({ type: 'credit', balance: 0 }),
    ];
    expect(calcTraditionalNetWorth(accounts)).toBe(5000);
  });
});

describe('calcLiquidNetWorth', () => {
  it('mixed: assets - credit only (loans excluded)', () => {
    expect(calcLiquidNetWorth(MIXED_ACCOUNTS)).toBe(5000 + 10000 - 2000); // 13000
  });

  it('with only loans: loans contribute 0', () => {
    const accounts = [
      makeAccount({ type: 'checking', balance: 5000 }),
      makeAccount({ type: 'loan', balance: 30000 }),
    ];
    expect(calcLiquidNetWorth(accounts)).toBe(5000);
  });

  it('empty → 0', () => {
    expect(calcLiquidNetWorth([])).toBe(0);
  });
});

describe('calcTotalAssets', () => {
  it('sums non-debt accounts', () => {
    expect(calcTotalAssets(MIXED_ACCOUNTS)).toBe(5000 + 10000); // 15000
  });

  it('ignores credit and loan', () => {
    const accounts = [
      makeAccount({ type: 'credit', balance: 5000 }),
      makeAccount({ type: 'loan', balance: 20000 }),
    ];
    expect(calcTotalAssets(accounts)).toBe(0);
  });

  it('investment accounts are assets', () => {
    const accounts = [makeAccount({ type: 'investment', balance: 50000 })];
    expect(calcTotalAssets(accounts)).toBe(50000);
  });
});

describe('calcTotalDebt', () => {
  it('sums credit + loan balances above 0', () => {
    expect(calcTotalDebt(MIXED_ACCOUNTS)).toBe(2000 + 20000); // 22000
  });

  it('zero-balance credit card excluded', () => {
    const accounts = [
      makeAccount({ type: 'credit', balance: 0 }),
      makeAccount({ type: 'loan', balance: 5000 }),
    ];
    expect(calcTotalDebt(accounts)).toBe(5000);
  });

  it('no debt → 0', () => {
    expect(calcTotalDebt([makeAccount({ type: 'checking', balance: 5000 })])).toBe(0);
  });
});

describe('calcLiquidSavings', () => {
  it('sums checking + savings only', () => {
    expect(calcLiquidSavings(MIXED_ACCOUNTS)).toBe(5000 + 10000); // 15000
  });

  it('investment accounts not counted', () => {
    const accounts = [
      makeAccount({ type: 'investment', balance: 20000 }),
      makeAccount({ type: 'checking', balance: 1000 }),
    ];
    expect(calcLiquidSavings(accounts)).toBe(1000);
  });
});

// ── Cash Flow ─────────────────────────────────────────────────────────────────

const TRANSACTIONS: Transaction[] = [
  makeTx({ id: 't1', type: 'income',  date: '2026-05-01', amount: 5000 }),
  makeTx({ id: 't2', type: 'expense', date: '2026-05-10', amount: 1200 }),
  makeTx({ id: 't3', type: 'expense', date: '2026-05-20', amount: 800 }),
  makeTx({ id: 't4', type: 'income',  date: '2026-04-15', amount: 4800 }),
  makeTx({ id: 't5', type: 'expense', date: '2026-04-20', amount: 1000 }),
];

describe('calcMonthIncome', () => {
  it('sums income for the given month key', () => {
    expect(calcMonthIncome(TRANSACTIONS, '2026-05')).toBe(5000);
  });

  it('excludes other months', () => {
    expect(calcMonthIncome(TRANSACTIONS, '2026-04')).toBe(4800);
  });

  it('no income in month → 0', () => {
    expect(calcMonthIncome(TRANSACTIONS, '2026-03')).toBe(0);
  });

  it('excludes expense transactions', () => {
    const txs = [makeTx({ type: 'expense', date: '2026-05-01', amount: 999 })];
    expect(calcMonthIncome(txs, '2026-05')).toBe(0);
  });
});

describe('calcMonthExpense', () => {
  it('sums expenses for the given month', () => {
    expect(calcMonthExpense(TRANSACTIONS, '2026-05')).toBe(2000);
  });

  it('excludes income transactions', () => {
    expect(calcMonthExpense(TRANSACTIONS, '2026-04')).toBe(1000);
  });

  it('empty month → 0', () => {
    expect(calcMonthExpense(TRANSACTIONS, '2026-01')).toBe(0);
  });
});

describe('calcSavingsRate', () => {
  it('40% when spending is 3000 of 5000 income', () => {
    expect(calcSavingsRate(5000, 3000)).toBeCloseTo(40, 4);
  });

  it('100% when spending is 0', () => {
    expect(calcSavingsRate(5000, 0)).toBeCloseTo(100, 4);
  });

  it('0% when spending equals income', () => {
    expect(calcSavingsRate(5000, 5000)).toBe(0);
  });

  it('floors at 0 — does not go negative', () => {
    expect(calcSavingsRate(5000, 6000)).toBe(0);
  });

  it('0 when income is 0 (no division by zero)', () => {
    expect(calcSavingsRate(0, 0)).toBe(0);
    expect(calcSavingsRate(0, 500)).toBe(0);
  });
});

describe('calcSafeToSpend', () => {
  it('income - spending - bills', () => {
    expect(calcSafeToSpend(5000, 2000, 500)).toBe(2500);
  });

  it('floors at 0 when spending exceeds income', () => {
    expect(calcSafeToSpend(5000, 5500, 0)).toBe(0);
  });

  it('bills push result negative → clamped to 0', () => {
    expect(calcSafeToSpend(1000, 800, 300)).toBe(0);
  });

  it('no bills', () => {
    expect(calcSafeToSpend(3000, 1000, 0)).toBe(2000);
  });
});

describe('pctChange', () => {
  it('positive change', () => {
    expect(pctChange(110, 100)).toBeCloseTo(10, 4);
  });

  it('negative change', () => {
    expect(pctChange(90, 100)).toBeCloseTo(-10, 4);
  });

  it('no change → 0', () => {
    expect(pctChange(100, 100)).toBe(0);
  });

  it('returns null when prev is 0', () => {
    expect(pctChange(100, 0)).toBeNull();
  });

  it('current = 0, prev > 0 → -100%', () => {
    expect(pctChange(0, 100)).toBeCloseTo(-100, 4);
  });
});

// ── Budget ────────────────────────────────────────────────────────────────────

describe('normalizeMonthlyBudget', () => {
  it('monthly period → same amount', () => {
    expect(normalizeMonthlyBudget(200, 'monthly')).toBe(200);
  });

  it('weekly period → amount × 4.33', () => {
    expect(normalizeMonthlyBudget(100, 'weekly')).toBeCloseTo(433, 4);
  });

  it('yearly period → amount / 12', () => {
    expect(normalizeMonthlyBudget(2400, 'yearly')).toBeCloseTo(200, 4);
  });

  it('weekly $50 → $216.50', () => {
    expect(normalizeMonthlyBudget(50, 'weekly')).toBeCloseTo(216.5, 2);
  });
});

// ── Emergency Fund ────────────────────────────────────────────────────────────

describe('calcAvgMonthlyExpense', () => {
  it('average of 3 months', () => {
    expect(calcAvgMonthlyExpense([1200, 1500, 900])).toBeCloseTo(1200, 4);
  });

  it('all same values', () => {
    expect(calcAvgMonthlyExpense([1000, 1000, 1000])).toBe(1000);
  });

  it('empty array → 0', () => {
    expect(calcAvgMonthlyExpense([])).toBe(0);
  });

  it('single value', () => {
    expect(calcAvgMonthlyExpense([800])).toBe(800);
  });
});

describe('calcEmergencyFundMonths', () => {
  it('6000 liquid / 2000 avg = 3 months', () => {
    expect(calcEmergencyFundMonths(6000, 2000)).toBeCloseTo(3, 4);
  });

  it('0 avg expense → returns 0 (no division by zero)', () => {
    expect(calcEmergencyFundMonths(6000, 0)).toBe(0);
  });

  it('0 liquid savings → 0', () => {
    expect(calcEmergencyFundMonths(0, 2000)).toBe(0);
  });

  it('fractional months', () => {
    expect(calcEmergencyFundMonths(1000, 3000)).toBeCloseTo(0.333, 2);
  });
});

// ── Health Score Components ───────────────────────────────────────────────────

describe('calcSavingsRateScore', () => {
  it('≥25% → 25 (max)', () => { expect(calcSavingsRateScore(25)).toBe(25); });
  it('30% → 25', () => { expect(calcSavingsRateScore(30)).toBe(25); });
  it('20% → 22', () => { expect(calcSavingsRateScore(20)).toBe(22); });
  it('15% → 18', () => { expect(calcSavingsRateScore(15)).toBe(18); });
  it('10% → 14', () => { expect(calcSavingsRateScore(10)).toBe(14); });
  it('5% → 9', () => { expect(calcSavingsRateScore(5)).toBe(9); });
  it('0.1% → 4', () => { expect(calcSavingsRateScore(0.1)).toBe(4); });
  it('0% → 0', () => { expect(calcSavingsRateScore(0)).toBe(0); });
});

describe('calcEmergencyScore', () => {
  it('≥6 months → 20 (max)', () => { expect(calcEmergencyScore(6)).toBe(20); });
  it('10 months → 20', () => { expect(calcEmergencyScore(10)).toBe(20); });
  it('4 months → 16', () => { expect(calcEmergencyScore(4)).toBe(16); });
  it('3 months → 13', () => { expect(calcEmergencyScore(3)).toBe(13); });
  it('2 months → 9', () => { expect(calcEmergencyScore(2)).toBe(9); });
  it('1 month → 6', () => { expect(calcEmergencyScore(1)).toBe(6); });
  it('0.5 months → 3', () => { expect(calcEmergencyScore(0.5)).toBe(3); });
  it('0.4 months → 0', () => { expect(calcEmergencyScore(0.4)).toBe(0); });
  it('0 months → 0', () => { expect(calcEmergencyScore(0)).toBe(0); });
});

describe('calcBudgetScore', () => {
  it('no budgets → 7 (neutral)', () => { expect(calcBudgetScore(0, 0)).toBe(7); });
  it('3 budgets, 0 over → 15 (max)', () => { expect(calcBudgetScore(3, 0)).toBe(15); });
  it('5 budgets, 1 over (80% adherence) → 12', () => { expect(calcBudgetScore(5, 1)).toBe(12); });
  it('5 budgets, 2 over (60% adherence) → 9', () => { expect(calcBudgetScore(5, 2)).toBe(9); });
  it('5 budgets, 3 over (40% adherence) → 6', () => { expect(calcBudgetScore(5, 3)).toBe(6); });
  it('5 budgets, 4 over (20% adherence) → 3', () => { expect(calcBudgetScore(5, 4)).toBe(3); });
  it('5 budgets, 5 over (0% adherence) → 0', () => { expect(calcBudgetScore(5, 5)).toBe(0); });
});

// Legacy debt-to-asset score retained for back-compat — kept for old callers.
describe('calcDebtScore (legacy debt-to-asset)', () => {
  it('ratio 0 → 25', () => { expect(calcDebtScore(0)).toBe(25); });
  it('ratio 0.1 → 25', () => { expect(calcDebtScore(0.1)).toBe(25); });
  it('ratio 0.3 → 20', () => { expect(calcDebtScore(0.3)).toBe(20); });
  it('ratio 0.5 → 15', () => { expect(calcDebtScore(0.5)).toBe(15); });
  it('ratio 0.75 → 10', () => { expect(calcDebtScore(0.75)).toBe(10); });
  it('ratio 1.0 → 5', () => { expect(calcDebtScore(1.0)).toBe(5); });
});

describe('calcDebtToIncomeRatio', () => {
  it('no debt → 0', () => { expect(calcDebtToIncomeRatio(0, 5000)).toBe(0); });
  it('$60k debt vs $5k/mo income → 1.0', () => {
    expect(calcDebtToIncomeRatio(60000, 5000)).toBeCloseTo(1.0, 4);
  });
  it('$18k debt vs $5k/mo income → 0.3', () => {
    expect(calcDebtToIncomeRatio(18000, 5000)).toBeCloseTo(0.3, 4);
  });
  it('debt with no income → Infinity', () => {
    expect(calcDebtToIncomeRatio(10000, 0)).toBe(Infinity);
  });
  it('no debt and no income → 0', () => {
    expect(calcDebtToIncomeRatio(0, 0)).toBe(0);
  });
});

describe('calcDebtToIncomeScore', () => {
  it('0 dti → 20 (max)', () => { expect(calcDebtToIncomeScore(0)).toBe(20); });
  it('0.36 dti → 18 (healthy)', () => { expect(calcDebtToIncomeScore(0.36)).toBe(18); });
  it('0.6 dti → 15', () => { expect(calcDebtToIncomeScore(0.6)).toBe(15); });
  it('1.0 dti → 12', () => { expect(calcDebtToIncomeScore(1.0)).toBe(12); });
  it('1.5 dti → 9', () => { expect(calcDebtToIncomeScore(1.5)).toBe(9); });
  it('2.0 dti → 6', () => { expect(calcDebtToIncomeScore(2.0)).toBe(6); });
  it('3.0 dti → 3', () => { expect(calcDebtToIncomeScore(3.0)).toBe(3); });
  it('5.0 dti → 0 (critical)', () => { expect(calcDebtToIncomeScore(5.0)).toBe(0); });
  it('Infinity dti → 0', () => { expect(calcDebtToIncomeScore(Infinity)).toBe(0); });
});

describe('calcAvgMomPct', () => {
  it('returns null when < 2 snapshots', () => {
    expect(calcAvgMomPct([1000])).toBeNull();
    expect(calcAvgMomPct([])).toBeNull();
  });
  it('+10% between two snapshots', () => {
    expect(calcAvgMomPct([1000, 1100])).toBeCloseTo(10, 4);
  });
  it('averages multiple MoM changes', () => {
    // 1000→1100 (+10%), 1100→1210 (+10%) → avg 10%
    expect(calcAvgMomPct([1000, 1100, 1210])).toBeCloseTo(10, 4);
  });
  it('negative growth', () => {
    expect(calcAvgMomPct([1000, 900])).toBeCloseTo(-10, 4);
  });
  it('skips zero-base points (undefined growth)', () => {
    expect(calcAvgMomPct([0, 100, 110])).toBeCloseTo(10, 4);
  });
  it('all-zero series → null', () => {
    expect(calcAvgMomPct([0, 0])).toBeNull();
  });
});

describe('calcNetWorthTrendScore', () => {
  it('null history → 5 (neutral)', () => { expect(calcNetWorthTrendScore(null)).toBe(5); });
  it('+3%/mo → 10', () => { expect(calcNetWorthTrendScore(3)).toBe(10); });
  it('+1.5%/mo → 8', () => { expect(calcNetWorthTrendScore(1.5)).toBe(8); });
  it('+0.5%/mo → 6', () => { expect(calcNetWorthTrendScore(0.5)).toBe(6); });
  it('flat 0%/mo → 5', () => { expect(calcNetWorthTrendScore(0)).toBe(5); });
  it('-0.5%/mo → 3', () => { expect(calcNetWorthTrendScore(-0.5)).toBe(3); });
  it('-2%/mo → 1', () => { expect(calcNetWorthTrendScore(-2)).toBe(1); });
  it('-5%/mo → 0', () => { expect(calcNetWorthTrendScore(-5)).toBe(0); });
});

describe('calcCoefficientOfVariation', () => {
  it('< 2 values → null', () => {
    expect(calcCoefficientOfVariation([])).toBeNull();
    expect(calcCoefficientOfVariation([1000])).toBeNull();
  });
  it('mean ≤ 0 → null', () => {
    expect(calcCoefficientOfVariation([0, 0])).toBeNull();
  });
  it('identical values → 0 CV', () => {
    expect(calcCoefficientOfVariation([1000, 1000, 1000])).toBeCloseTo(0, 4);
  });
  it('moderate variation', () => {
    // values: 800, 1000, 1200 → mean 1000, popStd ≈ 163.3 → CV ≈ 0.163
    const cv = calcCoefficientOfVariation([800, 1000, 1200])!;
    expect(cv).toBeCloseTo(0.163, 2);
  });
});

describe('calcSpendingVolatilityScore', () => {
  it('null cv → 5 (neutral)', () => { expect(calcSpendingVolatilityScore(null)).toBe(5); });
  it('cv 0 → 10', () => { expect(calcSpendingVolatilityScore(0)).toBe(10); });
  it('cv 0.1 → 10', () => { expect(calcSpendingVolatilityScore(0.1)).toBe(10); });
  it('cv 0.2 → 8', () => { expect(calcSpendingVolatilityScore(0.2)).toBe(8); });
  it('cv 0.3 → 6', () => { expect(calcSpendingVolatilityScore(0.3)).toBe(6); });
  it('cv 0.5 → 4', () => { expect(calcSpendingVolatilityScore(0.5)).toBe(4); });
  it('cv 0.75 → 2', () => { expect(calcSpendingVolatilityScore(0.75)).toBe(2); });
  it('cv 1.0 → 0', () => { expect(calcSpendingVolatilityScore(1.0)).toBe(0); });
});

describe('calcHealthGrade', () => {
  it('100 → A', () => { expect(calcHealthGrade(100)).toBe('A'); });
  it('85 → A', () => { expect(calcHealthGrade(85)).toBe('A'); });
  it('84 → B', () => { expect(calcHealthGrade(84)).toBe('B'); });
  it('70 → B', () => { expect(calcHealthGrade(70)).toBe('B'); });
  it('69 → C', () => { expect(calcHealthGrade(69)).toBe('C'); });
  it('55 → C', () => { expect(calcHealthGrade(55)).toBe('C'); });
  it('54 → D', () => { expect(calcHealthGrade(54)).toBe('D'); });
  it('40 → D', () => { expect(calcHealthGrade(40)).toBe('D'); });
  it('39 → F', () => { expect(calcHealthGrade(39)).toBe('F'); });
  it('0 → F', () => { expect(calcHealthGrade(0)).toBe('F'); });
});

// ── Goal Progress ─────────────────────────────────────────────────────────────

describe('calcGoalProgress', () => {
  it('50% when halfway', () => { expect(calcGoalProgress(5000, 10000)).toBeCloseTo(50, 4); });
  it('100% when exactly at target', () => { expect(calcGoalProgress(10000, 10000)).toBe(100); });
  it('capped at 100% when over target', () => { expect(calcGoalProgress(15000, 10000)).toBe(100); });
  it('0% when nothing saved', () => { expect(calcGoalProgress(0, 10000)).toBe(0); });
  it('0% when target is 0 (no division by zero)', () => { expect(calcGoalProgress(1000, 0)).toBe(0); });
  it('25% progress', () => { expect(calcGoalProgress(250, 1000)).toBeCloseTo(25, 4); });
});

// ── Transaction Balance Effects ───────────────────────────────────────────────

describe('applyExpenseBalance', () => {
  it('asset account: balance decreases', () => {
    expect(applyExpenseBalance(1000, 500, false)).toBe(500);
  });
  it('debt account: balance increases (more owed)', () => {
    expect(applyExpenseBalance(1000, 500, true)).toBe(1500);
  });
  it('zero amount: no change', () => {
    expect(applyExpenseBalance(1000, 0, false)).toBe(1000);
  });
});

describe('applyIncomeBalance', () => {
  it('balance increases', () => {
    expect(applyIncomeBalance(1000, 500)).toBe(1500);
  });
  it('zero income: no change', () => {
    expect(applyIncomeBalance(1000, 0)).toBe(1000);
  });
});

describe('applyTransferFromBalance', () => {
  it('from account decreases', () => {
    expect(applyTransferFromBalance(1000, 500)).toBe(500);
  });
  it('can go below zero (overdraft)', () => {
    expect(applyTransferFromBalance(100, 500)).toBe(-400);
  });
});

describe('applyTransferToBalance', () => {
  it('asset account: balance increases', () => {
    expect(applyTransferToBalance(1000, 500, false)).toBe(1500);
  });
  it('debt account: balance decreases (payoff)', () => {
    expect(applyTransferToBalance(1000, 500, true)).toBe(500);
  });
  it('debt overpayment: clamped to 0', () => {
    expect(applyTransferToBalance(50, 100, true)).toBe(0);
  });
  it('debt exact payoff: results in 0', () => {
    expect(applyTransferToBalance(500, 500, true)).toBe(0);
  });
});

describe('reverseExpenseBalance', () => {
  it('asset account: balance restored (add back)', () => {
    expect(reverseExpenseBalance(500, 200, false)).toBe(700);
  });
  it('debt account: balance reduced (remove charge)', () => {
    expect(reverseExpenseBalance(1200, 200, true)).toBe(1000);
  });
});

describe('reverseIncomeBalance', () => {
  it('balance reduced (income reversed)', () => {
    expect(reverseIncomeBalance(1500, 500)).toBe(1000);
  });
  it('goes to zero if exactly reversed', () => {
    expect(reverseIncomeBalance(500, 500)).toBe(0);
  });
});

describe('reverseTransferFromBalance', () => {
  it('from account gets money back', () => {
    expect(reverseTransferFromBalance(500, 500)).toBe(1000);
  });
  it('partial amount', () => {
    expect(reverseTransferFromBalance(200, 100)).toBe(300);
  });
});

describe('reverseTransferToBalance', () => {
  it('asset account: balance reduced (money was received, now reversed)', () => {
    expect(reverseTransferToBalance(1500, 500, false)).toBe(1000);
  });
  it('debt account (normal): balance increases (payoff reversed)', () => {
    expect(reverseTransferToBalance(500, 100, true)).toBe(600);
  });
  it('debt overpayment clamped case — KNOWN LIMITATION', () => {
    // Original: balance=50, paid 100, clamped to 0. Reversal adds 100 → 100 (≠ original 50).
    // This is a known limitation when the original payment was clamped by Math.max(0,...).
    const result = reverseTransferToBalance(0, 100, true);
    expect(result).toBe(100); // documents actual behavior (not ideal, but expected)
  });
});

// ── billToTransactionDefaults ─────────────────────────────────────────────────

function makeBill(overrides: Partial<Bill> = {}): Bill {
  return {
    id: 'bill_1', name: 'Netflix', amount: 15.99,
    frequency: 'monthly', nextDue: '2026-06-01',
    account: 'acc_1', category: 'Bills', isActive: true,
    ...overrides,
  };
}

describe('billToTransactionDefaults', () => {
  it('maps bill fields to transaction defaults correctly', () => {
    const result = billToTransactionDefaults(makeBill(), '2026-05-08');
    expect(result).toEqual({
      date: '2026-05-08',
      description: 'Netflix',
      amount: 15.99,
      type: 'expense',
      category: 'Bills',
      account: 'acc_1',
    });
  });

  it('type is always expense regardless of bill category', () => {
    const result = billToTransactionDefaults(makeBill({ category: 'Transportation' }), '2026-05-08');
    expect(result.type).toBe('expense');
  });

  it('uses the provided date, not the bill nextDue', () => {
    const result = billToTransactionDefaults(makeBill({ nextDue: '2026-06-15' }), '2026-05-08');
    expect(result.date).toBe('2026-05-08');
  });

  it('missing account falls back to empty string', () => {
    const result = billToTransactionDefaults(makeBill({ account: '' }), '2026-05-08');
    expect(result.account).toBe('');
  });

  it('undefined account falls back to empty string', () => {
    const bill = makeBill();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (bill as any).account = undefined;
    const result = billToTransactionDefaults(bill, '2026-05-08');
    expect(result.account).toBe('');
  });

  it('preserves bill name as description', () => {
    const result = billToTransactionDefaults(makeBill({ name: 'Rent Payment' }), '2026-05-08');
    expect(result.description).toBe('Rent Payment');
  });

  it('preserves bill amount exactly', () => {
    const result = billToTransactionDefaults(makeBill({ amount: 1234.56 }), '2026-05-08');
    expect(result.amount).toBe(1234.56);
  });

  it('works for all bill frequencies (amount is frequency-agnostic)', () => {
    const frequencies: Bill['frequency'][] = ['weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'];
    for (const frequency of frequencies) {
      const result = billToTransactionDefaults(makeBill({ frequency, amount: 50 }), '2026-05-08');
      expect(result.amount).toBe(50);
      expect(result.type).toBe('expense');
    }
  });
});
