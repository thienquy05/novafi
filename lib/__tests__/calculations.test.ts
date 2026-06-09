import { describe, it, expect } from 'vitest';
import {
  calcTraditionalNetWorth, calcLiquidNetWorth, calcTotalAssets, calcTotalDebt, calcLiquidSavings,
  calcMonthIncome, calcMonthExpense, calcSavingsRate, calcSafeToSpend, calcSafeToSpendDaily, calcMonthCashSpending, pctChange,
  normalizeMonthlyBudget,
  calcRolloverDeficit, calcEffectiveSpent,
  calcProjectedSpend, calcSpendingPace,
  calcAvgMonthlyExpense, calcEmergencyFundMonths,
  calcSavingsRateScore, calcEmergencyScore, calcBudgetScore, calcHealthGrade,
  calcDebtToIncomeScore, calcDebtToIncomeRatio,
  calcNetWorthTrendScore, calcAvgMomPct,
  calcSpendingVolatilityScore, calcCoefficientOfVariation,
  applyExpenseBalance, applyIncomeBalance, applyTransferFromBalance, applyTransferToBalance,
  reverseExpenseBalance, reverseIncomeBalance, reverseTransferFromBalance, reverseTransferToBalance,
  billToTransactionDefaults, calcSplitShares, calcLoanRemaining, myBillShare,
  calcOverdueBills, calcOverBudget,
  calcNetWorthProjection, calcPaycheckTaxToSave,
  calcPaycheckDeposited,
  creditUtilization, creditUtilStatus, isOverCreditTarget, availableCredit,
  calcPaydownToTarget, buildCreditReport, calcCreditAlerts, allocateSmartPayment,
  assessCardPaymentHistory, buildLimitIncreaseAdvisories, LIMIT_ADVISOR_TARGET,
  buildStatementArbitrage,
  calcCreditUtilizationScore, composeHealthScore, daysUntilStatement, HEALTH_WEIGHTS,
  CREDIT_UTIL_TARGET,
} from '@/lib/calculations';
import type { Account, Transaction, Bill, Budget } from '@/types';

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

  it('goes negative when spending exceeds income', () => {
    expect(calcSafeToSpend(5000, 5500, 0)).toBe(-500);
  });

  it('bills push result negative → surfaces the shortfall', () => {
    expect(calcSafeToSpend(1000, 800, 300)).toBe(-100);
  });

  it('no bills', () => {
    expect(calcSafeToSpend(3000, 1000, 0)).toBe(2000);
  });

  it('rounds float drift to cents', () => {
    expect(calcSafeToSpend(1000.1, 0.2, 0)).toBe(999.9);
  });
});

describe('calcSafeToSpendDaily', () => {
  it('spreads the leftover across the days remaining', () => {
    expect(calcSafeToSpendDaily(462, 11)).toBe(42);
  });

  it('rounds the per-day figure to cents', () => {
    expect(calcSafeToSpendDaily(100, 3)).toBe(33.33);
  });

  it('returns the shortfall unchanged when already overspent', () => {
    expect(calcSafeToSpendDaily(-150, 11)).toBe(-150);
  });

  it('returns the full leftover when no days remain', () => {
    expect(calcSafeToSpendDaily(200, 0)).toBe(200);
  });
});

describe('calcMonthCashSpending', () => {
  // chk/sav = deposit accounts, crd/lon = debt accounts (from MIXED_ACCOUNTS)
  it('counts expenses paid from a deposit account', () => {
    const txs = [
      makeTx({ type: 'expense', account: 'chk', amount: 200, date: '2026-05-03' }),
      makeTx({ type: 'expense', account: 'sav', amount: 50, date: '2026-05-09' }),
    ];
    expect(calcMonthCashSpending(txs, MIXED_ACCOUNTS, '2026-05')).toBe(250);
  });

  it('ignores purchases charged to a credit/loan account (no cash out yet)', () => {
    const txs = [makeTx({ type: 'expense', account: 'crd', amount: 900, date: '2026-05-04' })];
    expect(calcMonthCashSpending(txs, MIXED_ACCOUNTS, '2026-05')).toBe(0);
  });

  it('counts payments INTO a debt account (transfer = real cash leaving)', () => {
    const txs = [
      makeTx({ type: 'transfer', account: 'chk', toAccount: 'crd', amount: 900, date: '2026-05-15' }),
    ];
    expect(calcMonthCashSpending(txs, MIXED_ACCOUNTS, '2026-05')).toBe(900);
  });

  it('does not double-count a card purchase and its later payoff', () => {
    const txs = [
      makeTx({ type: 'expense', account: 'crd', amount: 900, date: '2026-05-04' }),     // charge: 0
      makeTx({ type: 'transfer', account: 'chk', toAccount: 'crd', amount: 900, date: '2026-05-20' }), // payoff: 900
    ];
    expect(calcMonthCashSpending(txs, MIXED_ACCOUNTS, '2026-05')).toBe(900);
  });

  it('ignores transfers between deposit accounts (checking → savings)', () => {
    const txs = [
      makeTx({ type: 'transfer', account: 'chk', toAccount: 'sav', amount: 300, date: '2026-05-02' }),
    ];
    expect(calcMonthCashSpending(txs, MIXED_ACCOUNTS, '2026-05')).toBe(0);
  });

  it('ignores income and other months', () => {
    const txs = [
      makeTx({ type: 'income', account: 'chk', amount: 1000, date: '2026-05-01' }),
      makeTx({ type: 'expense', account: 'chk', amount: 100, date: '2026-04-30' }),
    ];
    expect(calcMonthCashSpending(txs, MIXED_ACCOUNTS, '2026-05')).toBe(0);
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
  it('asset account: balance increases', () => {
    expect(applyIncomeBalance(1000, 500)).toBe(1500);
  });
  it('zero income: no change', () => {
    expect(applyIncomeBalance(1000, 0)).toBe(1000);
  });
  it('debt account: balance decreases (refund reduces what is owed)', () => {
    expect(applyIncomeBalance(500, 50, true)).toBe(450);
  });
});

describe('applyTransferFromBalance', () => {
  it('asset account: balance decreases', () => {
    expect(applyTransferFromBalance(1000, 500, false)).toBe(500);
  });
  it('asset account: can go below zero (overdraft)', () => {
    expect(applyTransferFromBalance(100, 500, false)).toBe(-400);
  });
  it('debt account: owed increases (cash advance / lending on a credit card)', () => {
    // Lending money charged to a credit card is a new charge, so the owed
    // balance grows — it must NOT look like a payoff.
    expect(applyTransferFromBalance(200, 100, true)).toBe(300);
  });
});

describe('applyTransferToBalance', () => {
  it('asset account: balance increases', () => {
    expect(applyTransferToBalance(1000, 500, false)).toBe(1500);
  });
  it('debt account: balance decreases (payoff)', () => {
    expect(applyTransferToBalance(1000, 500, true)).toBe(500);
  });
  it('debt overpayment: goes negative (credit balance, not clamped)', () => {
    // Overpaying leaves a credit balance the bank owes you. We do NOT clamp at
    // zero — clamping discarded money and broke reconciliation (apply/reverse
    // were no longer inverses).
    expect(applyTransferToBalance(50, 100, true)).toBe(-50);
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
  it('asset account: balance reduced (income reversed)', () => {
    expect(reverseIncomeBalance(1500, 500)).toBe(1000);
  });
  it('goes to zero if exactly reversed', () => {
    expect(reverseIncomeBalance(500, 500)).toBe(0);
  });
  it('debt account: balance restored (refund undone)', () => {
    expect(reverseIncomeBalance(450, 50, true)).toBe(500);
  });
});

describe('reverseTransferFromBalance', () => {
  it('asset account: gets money back', () => {
    expect(reverseTransferFromBalance(500, 500, false)).toBe(1000);
  });
  it('asset account: partial amount', () => {
    expect(reverseTransferFromBalance(200, 100, false)).toBe(300);
  });
  it('debt account: undoes the charge (owed goes back down)', () => {
    expect(reverseTransferFromBalance(300, 100, true)).toBe(200);
  });
  it('debt account: apply then reverse is an exact inverse', () => {
    const applied = applyTransferFromBalance(200, 100, true); // 300 owed
    expect(reverseTransferFromBalance(applied, 100, true)).toBe(200);
  });
});

describe('reverseTransferToBalance', () => {
  it('asset account: balance reduced (money was received, now reversed)', () => {
    expect(reverseTransferToBalance(1500, 500, false)).toBe(1000);
  });
  it('debt account (normal): balance increases (payoff reversed)', () => {
    expect(reverseTransferToBalance(500, 100, true)).toBe(600);
  });
  it('debt overpayment: apply/reverse are exact inverses (no clamp)', () => {
    // balance=50, paid 100 → apply gives -50 (credit balance). Reversing that
    // payment restores the original 50. Now that the clamp is gone, apply and
    // reverse round-trip cleanly, which is what reconciliation depends on.
    const applied = applyTransferToBalance(50, 100, true); // -50
    expect(reverseTransferToBalance(applied, 100, true)).toBe(50);
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

// ── calcSplitShares ───────────────────────────────────────────────────────────

describe('calcSplitShares', () => {
  it('splits a total into your share and their share', () => {
    expect(calcSplitShares(100, 40)).toEqual({ mine: 60, theirs: 40 });
  });

  it('handles an even 50/50 split', () => {
    expect(calcSplitShares(50, 25)).toEqual({ mine: 25, theirs: 25 });
  });

  it('rounds to cents', () => {
    expect(calcSplitShares(100, 33.333)).toEqual({ mine: 66.67, theirs: 33.33 });
  });

  it('clamps a negative their-share to 0 (you owe the whole thing)', () => {
    expect(calcSplitShares(100, -20)).toEqual({ mine: 100, theirs: 0 });
  });

  it('clamps their share to the total (you owe nothing)', () => {
    expect(calcSplitShares(100, 150)).toEqual({ mine: 0, theirs: 100 });
  });

  it('treats missing/zero inputs safely', () => {
    expect(calcSplitShares(0, 0)).toEqual({ mine: 0, theirs: 0 });
    expect(calcSplitShares(80, 0)).toEqual({ mine: 80, theirs: 0 });
  });
});

// ── myBillShare ───────────────────────────────────────────────────────────────

describe('myBillShare', () => {
  const base: Bill = {
    id: 'b1', name: 'Rent', amount: 100, frequency: 'monthly',
    nextDue: '2026-06-01', account: 'a1', category: 'Bills', isActive: true,
  };

  it('returns the full amount for a non-shared bill', () => {
    expect(myBillShare(base)).toBe(100);
  });

  it('returns only your share when the bill is split', () => {
    expect(myBillShare({ ...base, splitContactId: 'c1', splitAmount: 40 })).toBe(60);
  });

  it('returns the full amount when split is configured but their share is 0', () => {
    expect(myBillShare({ ...base, splitContactId: 'c1', splitAmount: 0 })).toBe(100);
  });

  it('falls back to full amount when no contact is set even if a split amount exists', () => {
    expect(myBillShare({ ...base, splitAmount: 40 })).toBe(100);
  });
});

// ── calcLoanRemaining ─────────────────────────────────────────────────────────

describe('calcLoanRemaining', () => {
  it('returns principal when nothing repaid', () => {
    expect(calcLoanRemaining(100, 0)).toBe(100);
  });

  it('subtracts partial repayments', () => {
    expect(calcLoanRemaining(100, 30)).toBe(70);
  });

  it('is 0 when fully repaid', () => {
    expect(calcLoanRemaining(100, 100)).toBe(0);
  });

  it('floors at 0 on over-repayment', () => {
    expect(calcLoanRemaining(100, 120)).toBe(0);
  });

  it('rounds to cents', () => {
    expect(calcLoanRemaining(100, 33.333)).toBe(66.67);
  });

  it('treats missing inputs as 0', () => {
    expect(calcLoanRemaining(0, 0)).toBe(0);
  });
});

// ── calcOverdueBills ──────────────────────────────────────────────────────────

function makeBillFull(overrides: Partial<Bill> = {}): Bill {
  return {
    id: 'b1', name: 'Test Bill', amount: 50,
    frequency: 'monthly', nextDue: '2026-05-01',
    account: 'acc_1', category: 'Bills', isActive: true,
    ...overrides,
  };
}

const NOW = new Date('2026-05-14T12:00:00Z');

describe('calcOverdueBills', () => {
  it('empty list → 0', () => {
    expect(calcOverdueBills([], NOW)).toBe(0);
  });

  it('no bills are overdue → 0', () => {
    const bills = [
      makeBillFull({ nextDue: '2026-05-20' }),
      makeBillFull({ nextDue: '2026-06-01' }),
    ];
    expect(calcOverdueBills(bills, NOW)).toBe(0);
  });

  it('counts bills whose nextDue is before now', () => {
    const bills = [
      makeBillFull({ nextDue: '2026-05-01' }),  // overdue
      makeBillFull({ nextDue: '2026-05-10' }),  // overdue
      makeBillFull({ nextDue: '2026-05-20' }),  // future
    ];
    expect(calcOverdueBills(bills, NOW)).toBe(2);
  });

  it('inactive bills are excluded even if overdue', () => {
    const bills = [
      makeBillFull({ nextDue: '2026-05-01', isActive: false }),
      makeBillFull({ nextDue: '2026-05-01', isActive: true }),
    ];
    expect(calcOverdueBills(bills, NOW)).toBe(1);
  });

  it('all inactive → 0', () => {
    const bills = [
      makeBillFull({ nextDue: '2026-04-01', isActive: false }),
      makeBillFull({ nextDue: '2026-04-15', isActive: false }),
    ];
    expect(calcOverdueBills(bills, NOW)).toBe(0);
  });

  it('due exactly at now is NOT overdue (strict <)', () => {
    const bills = [makeBillFull({ nextDue: '2026-05-14T12:00:00Z' })];
    expect(calcOverdueBills(bills, NOW)).toBe(0);
  });

  it('all bills overdue', () => {
    const bills = [
      makeBillFull({ nextDue: '2026-01-01' }),
      makeBillFull({ nextDue: '2026-03-15' }),
      makeBillFull({ nextDue: '2026-05-13' }),
    ];
    expect(calcOverdueBills(bills, NOW)).toBe(3);
  });
});

// ── calcOverBudget ────────────────────────────────────────────────────────────

function makeBudget(overrides: Partial<Budget> = {}): Budget {
  return {
    id: 'bgt_1', category: 'Food', amount: 500, period: 'monthly',
    ...overrides,
  };
}

const MONTH = '2026-05';

describe('calcOverBudget', () => {
  it('empty budgets → 0', () => {
    expect(calcOverBudget([], [], MONTH)).toBe(0);
  });

  it('no transactions → 0 (all budgets under)', () => {
    const budgets = [makeBudget(), makeBudget({ id: 'b2', category: 'Transport', amount: 200 })];
    expect(calcOverBudget(budgets, [], MONTH)).toBe(0);
  });

  it('spending exactly at budget limit → NOT over', () => {
    const budgets = [makeBudget({ amount: 300 })];
    const txs = [makeTx({ type: 'expense', date: '2026-05-10', amount: 300, category: 'Food' })];
    expect(calcOverBudget(budgets, txs, MONTH)).toBe(0);
  });

  it('spending one cent over → over', () => {
    const budgets = [makeBudget({ amount: 300 })];
    const txs = [makeTx({ type: 'expense', date: '2026-05-10', amount: 300.01, category: 'Food' })];
    expect(calcOverBudget(budgets, txs, MONTH)).toBe(1);
  });

  it('counts multiple over-budget categories', () => {
    const budgets = [
      makeBudget({ id: 'b1', category: 'Food', amount: 300 }),
      makeBudget({ id: 'b2', category: 'Entertainment', amount: 100 }),
      makeBudget({ id: 'b3', category: 'Transport', amount: 200 }),
    ];
    const txs = [
      makeTx({ type: 'expense', date: '2026-05-05', amount: 350, category: 'Food' }),        // over
      makeTx({ type: 'expense', date: '2026-05-06', amount: 150, category: 'Entertainment' }), // over
      makeTx({ type: 'expense', date: '2026-05-07', amount: 180, category: 'Transport' }),    // under
    ];
    expect(calcOverBudget(budgets, txs, MONTH)).toBe(2);
  });

  it('only sums transactions from the given month', () => {
    const budgets = [makeBudget({ amount: 300 })];
    const txs = [
      makeTx({ type: 'expense', date: '2026-04-20', amount: 200, category: 'Food' }), // wrong month
      makeTx({ type: 'expense', date: '2026-05-10', amount: 200, category: 'Food' }), // correct
    ];
    expect(calcOverBudget(budgets, txs, MONTH)).toBe(0); // only 200 counted, under 300
  });

  it('income transactions are not counted toward budget', () => {
    const budgets = [makeBudget({ amount: 300 })];
    const txs = [
      makeTx({ type: 'income',  date: '2026-05-01', amount: 1000, category: 'Food' }),
      makeTx({ type: 'expense', date: '2026-05-10', amount: 200,  category: 'Food' }),
    ];
    expect(calcOverBudget(budgets, txs, MONTH)).toBe(0);
  });

  it('weekly budget normalized to monthly (× 4.33)', () => {
    // weekly $100 → monthly $433; spend $434 → over
    const budgets = [makeBudget({ amount: 100, period: 'weekly' })];
    const txs = [makeTx({ type: 'expense', date: '2026-05-15', amount: 434, category: 'Food' })];
    expect(calcOverBudget(budgets, txs, MONTH)).toBe(1);
  });

  it('weekly budget: spending at $433 is NOT over (≤ 100×4.33)', () => {
    const budgets = [makeBudget({ amount: 100, period: 'weekly' })];
    const txs = [makeTx({ type: 'expense', date: '2026-05-15', amount: 433, category: 'Food' })];
    expect(calcOverBudget(budgets, txs, MONTH)).toBe(0);
  });

  it('yearly budget normalized to monthly (÷ 12)', () => {
    // yearly $1200 → monthly $100; spend $101 → over
    const budgets = [makeBudget({ amount: 1200, period: 'yearly' })];
    const txs = [makeTx({ type: 'expense', date: '2026-05-01', amount: 101, category: 'Food' })];
    expect(calcOverBudget(budgets, txs, MONTH)).toBe(1);
  });

  it('transactions from multiple days accumulate', () => {
    const budgets = [makeBudget({ amount: 500 })];
    const txs = [
      makeTx({ id: 'tx_a', type: 'expense', date: '2026-05-01', amount: 200, category: 'Food' }),
      makeTx({ id: 'tx_b', type: 'expense', date: '2026-05-15', amount: 200, category: 'Food' }),
      makeTx({ id: 'tx_c', type: 'expense', date: '2026-05-28', amount: 150, category: 'Food' }),
    ];
    expect(calcOverBudget(budgets, txs, MONTH)).toBe(1); // 550 > 500
  });

  it('category mismatch → not counted', () => {
    const budgets = [makeBudget({ category: 'Food', amount: 300 })];
    const txs = [makeTx({ type: 'expense', date: '2026-05-10', amount: 500, category: 'Entertainment' })];
    expect(calcOverBudget(budgets, txs, MONTH)).toBe(0);
  });
});

// ── Budget Rollover ───────────────────────────────────────────────────────────

describe('calcRolloverDeficit', () => {
  it('underspend (surplus) carries nothing over', () => {
    // $500 budget, $300 spent → surplus does NOT roll over
    expect(calcRolloverDeficit(500, 300)).toBe(0);
  });

  it('overspend carries the overage forward', () => {
    // $500 budget, $600 spent → +$100 deficit rolls into this month's usage
    expect(calcRolloverDeficit(500, 600)).toBe(100);
  });

  it('exact spend carries nothing over', () => {
    expect(calcRolloverDeficit(500, 500)).toBe(0);
  });

  it('no prior spending (new budget) → nothing carried over', () => {
    expect(calcRolloverDeficit(400, 0)).toBe(0);
  });
});

describe('calcEffectiveSpent', () => {
  it('a fixed budget with no rollover shows actual spend', () => {
    expect(calcEffectiveSpent(0, 0)).toBe(0);
    expect(calcEffectiveSpent(40, 0)).toBe(40);
  });

  it('rolled-over deficit adds to this month usage', () => {
    // $20 overspent last month + $0 spent so far → $20 used
    expect(calcEffectiveSpent(0, 20)).toBe(20);
  });

  it('composed: overspend last month rolls into usage, cap unchanged', () => {
    const base = 100;
    const prevSpend = 120;
    const rolledOver = calcRolloverDeficit(base, prevSpend); // 20
    expect(calcEffectiveSpent(0, rolledOver)).toBe(20);
  });

  it('composed: underspend last month leaves usage at actual spend', () => {
    const base = 100;
    const prevSpend = 70;
    const rolledOver = calcRolloverDeficit(base, prevSpend); // 0 (surplus does not roll)
    expect(calcEffectiveSpent(0, rolledOver)).toBe(0);
  });
});

// ── Spending Pace ─────────────────────────────────────────────────────────────

function makeBudgetItem(overrides: Partial<Budget> & { category: string; amount: number }): Budget {
  return { id: 'b_1', period: 'monthly' as const, position: 0, ...overrides };
}

describe('calcProjectedSpend', () => {
  it('projects correctly mid-month', () => {
    // spent $150 in 15 days of 30-day month → project $300
    expect(calcProjectedSpend(150, 15, 30)).toBeCloseTo(300, 4);
  });

  it('day 1: extrapolates a full month from one day', () => {
    expect(calcProjectedSpend(10, 1, 31)).toBeCloseTo(310, 4);
  });

  it('daysElapsed = 0 → returns 0 (no division by zero)', () => {
    expect(calcProjectedSpend(100, 0, 30)).toBe(0);
  });

  it('spent = 0 → projected = 0 regardless of days', () => {
    expect(calcProjectedSpend(0, 15, 30)).toBe(0);
  });
});

describe('calcSpendingPace', () => {
  const budgets = [
    makeBudgetItem({ id: 'b1', category: 'Food', amount: 500 }),
    makeBudgetItem({ id: 'b2', category: 'Entertainment', amount: 200 }),
    makeBudgetItem({ id: 'b3', category: 'Grocery', amount: 300 }),
  ];

  it('already-over category gets status "over"', () => {
    const spend = { Food: 550, Entertainment: 50, Grocery: 100 };
    const result = calcSpendingPace(budgets, spend, 15, 30);
    expect(result.find((r) => r.category === 'Food')?.status).toBe('over');
  });

  it('pace-to-overshoot category gets status "atRisk"', () => {
    // Entertainment: spent $120 in 15 of 30 days → projected $240 > $200
    const spend = { Food: 100, Entertainment: 120, Grocery: 50 };
    const result = calcSpendingPace(budgets, spend, 15, 30);
    expect(result.find((r) => r.category === 'Entertainment')?.status).toBe('atRisk');
  });

  it('on-track category gets status "onTrack"', () => {
    // Grocery: spent $100 in 15 days → projected $200 < $300
    const spend = { Food: 100, Entertainment: 50, Grocery: 100 };
    const result = calcSpendingPace(budgets, spend, 15, 30);
    expect(result.find((r) => r.category === 'Grocery')?.status).toBe('onTrack');
  });

  it('overshootAmt = 0 for onTrack and over categories', () => {
    const spend = { Food: 600, Entertainment: 120, Grocery: 100 };
    const result = calcSpendingPace(budgets, spend, 15, 30);
    expect(result.find((r) => r.category === 'Food')?.overshootAmt).toBe(0);
    expect(result.find((r) => r.category === 'Grocery')?.overshootAmt).toBe(0);
  });

  it('overshootAmt is correct for atRisk category', () => {
    // Entertainment: spent $120/15 days → projected $240, budget $200 → overshoot = $40
    const spend = { Food: 100, Entertainment: 120, Grocery: 50 };
    const result = calcSpendingPace(budgets, spend, 15, 30);
    const ent = result.find((r) => r.category === 'Entertainment')!;
    expect(ent.overshootAmt).toBeCloseTo(40, 4);
  });

  it('category with no spending is onTrack', () => {
    const spend = { Food: 100 };
    const result = calcSpendingPace(budgets, spend, 15, 30);
    expect(result.find((r) => r.category === 'Entertainment')?.status).toBe('onTrack');
  });

  it('weekly budget is normalized to monthly before comparison', () => {
    // weekly $50 → monthly $216.50; spent $200 in 15 days → projected $400 → atRisk
    const weeklyBudgets = [makeBudgetItem({ id: 'bw', category: 'Food', amount: 50, period: 'weekly' })];
    const spend = { Food: 200 };
    const result = calcSpendingPace(weeklyBudgets, spend, 15, 30);
    expect(result[0].status).toBe('atRisk');
  });
});

// ── Net Worth Projection ──────────────────────────────────────────────────────

describe('calcNetWorthProjection', () => {
  it('returns empty array when fewer than 2 data points', () => {
    expect(calcNetWorthProjection([], 6)).toEqual([]);
    expect(calcNetWorthProjection([{ netWorth: 10000 }], 6)).toEqual([]);
  });

  it('projects correct number of months', () => {
    const history = [{ netWorth: 10000 }, { netWorth: 11000 }];
    expect(calcNetWorthProjection(history, 6)).toHaveLength(6);
    expect(calcNetWorthProjection(history, 3)).toHaveLength(3);
  });

  it('flat history (0% MoM) → constant projection', () => {
    const history = [{ netWorth: 10000 }, { netWorth: 10000 }, { netWorth: 10000 }];
    const proj = calcNetWorthProjection(history, 3);
    expect(proj[0]).toBeCloseTo(10000, 0);
    expect(proj[2]).toBeCloseTo(10000, 0);
  });

  it('positive growth → increasing projection', () => {
    const history = [{ netWorth: 10000 }, { netWorth: 11000 }]; // +10% MoM
    const proj = calcNetWorthProjection(history, 3);
    expect(proj[0]).toBeGreaterThan(11000); // 11000 * 1.10
    expect(proj[1]).toBeGreaterThan(proj[0]);
  });
});

// ── Paycheck Tax To Set Aside ─────────────────────────────────────────────────

describe('calcPaycheckTaxToSave', () => {
  it('sums the explicit tax pieces (income + FICA) for a full-deposit entry', () => {
    // full-deposit model: net = gross, no 401k/HSA, taxes stored explicitly
    const p = {
      grossAmount: 5000, netAmount: 5000, k401: 0, hsa: 0,
      federalWithheld: 700, stateWithheld: 250, localWithheld: 150, ficaWithheld: 382.5,
    };
    expect(calcPaycheckTaxToSave(p)).toBeCloseTo(1482.5, 2);
  });

  it('back-derives full tax for a legacy entry without stored FICA', () => {
    // legacy: net < gross, FICA not stored → recover via gross − net − deductions
    const p = {
      grossAmount: 819.93, netAmount: 708.60, k401: 0, hsa: 0,
      federalWithheld: 0, stateWithheld: 0, localWithheld: 0, ficaWithheld: 0,
    };
    expect(calcPaycheckTaxToSave(p)).toBeCloseTo(111.33, 2);
  });

  it('never returns negative', () => {
    const p = {
      grossAmount: 100, netAmount: 200, k401: 0, hsa: 0,
      federalWithheld: 0, stateWithheld: 0, localWithheld: 0, ficaWithheld: 0,
    };
    expect(calcPaycheckTaxToSave(p)).toBe(0);
  });
});

// ── Paycheck Deposited (real money) ───────────────────────────────────────────

describe('calcPaycheckDeposited', () => {
  it('is the full amount = gross wages + tips', () => {
    expect(calcPaycheckDeposited({ grossAmount: 3500, gratuityAmount: 150 })).toBeCloseTo(3650, 2);
  });

  it('ignores missing tips (treats as 0)', () => {
    expect(calcPaycheckDeposited({ grossAmount: 3500 })).toBeCloseTo(3500, 2);
  });

  it('returns the full gross regardless of withheld tax (no withholding)', () => {
    // Even a legacy-shaped entry deposits the full gross + tips, never an after-tax figure.
    expect(calcPaycheckDeposited({ grossAmount: 819.93, gratuityAmount: 0 })).toBeCloseTo(819.93, 2);
  });
});

// ── Spending Pace ─────────────────────────────────────────────────────────────

describe('calcSpendingPace', () => {
  const budget: Budget = { id: 'b1', category: 'Food', amount: 300, period: 'monthly' };

  it('flags a category as over when actual spend already exceeds the budget', () => {
    const [item] = calcSpendingPace([budget], { Food: 320 }, 15, 30);
    expect(item.status).toBe('over');
    expect(item.spent).toBeCloseTo(320, 2);
  });

  it('reports onTrack without rollover even if last month overspent (deficit ignored)', () => {
    // Half a budget used halfway through the month projects exactly to budget.
    const [item] = calcSpendingPace([budget], { Food: 150 }, 15, 30);
    expect(item.status).toBe('onTrack');
  });

  it('folds a rolled-over deficit into used so an already-over budget reads over', () => {
    // Only $50 spent this month, but $400 carried from last month's overspend.
    const [item] = calcSpendingPace([budget], { Food: 50 }, 10, 30, { Food: 400 });
    expect(item.spent).toBeCloseTo(450, 2);   // 50 actual + 400 carried
    expect(item.status).toBe('over');         // 450 > 300
  });

  it('treats the carryover as flat, not part of the daily pace', () => {
    // Daily pace must come from this month's $30, not the $30 + $270 carryover.
    const [item] = calcSpendingPace([budget], { Food: 30 }, 10, 30, { Food: 270 });
    expect(item.pace).toBeCloseTo(3, 2);                 // 30 / 10 days
    expect(item.projected).toBeCloseTo(30 / 10 * 30 + 270, 2); // rate-projected spend + flat carry
  });
});

// ── Credit Utilization (Smart Credit Report) ──────────────────────────────────

describe('creditUtilization', () => {
  it('computes balance ÷ limit as a percent', () => {
    expect(creditUtilization(300, 1000)).toBe(30);
    expect(creditUtilization(100, 400)).toBe(25);
  });
  it('returns null when the limit is unknown/zero', () => {
    expect(creditUtilization(500, 0)).toBeNull();
    expect(creditUtilization(500, -1)).toBeNull();
  });
  it('treats a credit (negative) balance as 0% used', () => {
    expect(creditUtilization(-50, 1000)).toBe(0);
  });
  it('can exceed 100% when over the limit', () => {
    expect(creditUtilization(1200, 1000)).toBe(120);
  });
});

describe('creditUtilStatus', () => {
  it('bands utilization into the score-relevant tiers', () => {
    expect(creditUtilStatus(5)).toBe('excellent');   // ≤10
    expect(creditUtilStatus(10)).toBe('excellent');
    expect(creditUtilStatus(20)).toBe('good');        // ≤30
    expect(creditUtilStatus(30)).toBe('good');
    expect(creditUtilStatus(45)).toBe('fair');        // ≤50
    expect(creditUtilStatus(70)).toBe('high');        // <90
    expect(creditUtilStatus(95)).toBe('maxed');       // <100
    expect(creditUtilStatus(100)).toBe('maxed');
    expect(creditUtilStatus(101)).toBe('over');       // >100
  });
});

describe('isOverCreditTarget', () => {
  it('flags utilization above the 30% cap only', () => {
    expect(isOverCreditTarget(CREDIT_UTIL_TARGET)).toBe(false); // exactly 30 is OK
    expect(isOverCreditTarget(30.01)).toBe(true);
    expect(isOverCreditTarget(10)).toBe(false);
  });
});

describe('availableCredit', () => {
  it('is limit minus owed, with credit balances counted as 0 owed', () => {
    expect(availableCredit(300, 1000)).toBe(700);
    expect(availableCredit(-50, 1000)).toBe(1000);
  });
});

describe('calcPaydownToTarget', () => {
  it('returns the amount needed to reach the target utilization', () => {
    expect(calcPaydownToTarget(500, 1000, 30)).toBe(200);  // 500 → 300
    expect(calcPaydownToTarget(500, 1000, 10)).toBe(400);  // 500 → 100
  });
  it('is 0 when already at or under target, or no limit', () => {
    expect(calcPaydownToTarget(200, 1000, 30)).toBe(0);
    expect(calcPaydownToTarget(500, 0, 30)).toBe(0);
  });
});

describe('buildCreditReport', () => {
  const cardA = makeAccount({ id: 'a', type: 'credit', balance: 300, creditLimit: 1000 });   // 30%
  const cardB = makeAccount({ id: 'b', type: 'credit', balance: 800, creditLimit: 1000 });   // 80% (over target)
  const noLimit = makeAccount({ id: 'c', type: 'credit', balance: 500 });                     // unknown
  const checking = makeAccount({ id: 'd', type: 'checking', balance: 5000 });

  it('only considers credit accounts and excludes non-credit', () => {
    const r = buildCreditReport([cardA, checking]);
    expect(r.cards).toHaveLength(1);
    expect(r.cards[0].account.id).toBe('a');
  });

  it('aggregates only cards with a known limit', () => {
    const r = buildCreditReport([cardA, cardB, noLimit]);
    expect(r.cards).toHaveLength(3);          // all three credit cards listed
    expect(r.totalBalance).toBe(1100);        // 300 + 800 (noLimit excluded)
    expect(r.totalLimit).toBe(2000);
    expect(r.totalAvailable).toBe(900);
    expect(r.overallUtil).toBe(55);           // 1100 / 2000
    expect(r.overallStatus).toBe('high');
    expect(r.cardsOverTarget).toBe(1);        // only cardB
    expect(r.hasLimits).toBe(true);
  });

  it('marks per-card util null when no limit and surfaces paydown amounts', () => {
    const r = buildCreditReport([cardB, noLimit]);
    const b = r.cards.find((c) => c.account.id === 'b')!;
    const c = r.cards.find((c) => c.account.id === 'c')!;
    expect(c.util).toBeNull();
    expect(b.util).toBe(80);
    expect(b.paydownToTarget).toBe(500);      // 800 → 300
    expect(b.paydownToIdeal).toBe(700);       // 800 → 100
  });

  it('reports no limits / null overall when nothing has a limit', () => {
    const r = buildCreditReport([noLimit]);
    expect(r.hasLimits).toBe(false);
    expect(r.overallUtil).toBeNull();
    expect(r.overallStatus).toBeNull();
  });
});

describe('allocateSmartPayment', () => {
  // Two cards over the 30% cap with different paydown costs, plus one healthy card.
  const spikeSmall = makeAccount({ id: 's', type: 'credit', balance: 400, creditLimit: 1000 }); // 40% → needs 100 to hit 30%
  const spikeBig = makeAccount({ id: 'b', type: 'credit', balance: 900, creditLimit: 1000 });    // 90% → needs 600 to hit 30%
  const healthy = makeAccount({ id: 'h', type: 'credit', balance: 50, creditLimit: 1000 });      // 5% already ideal
  const checking = makeAccount({ id: 'c', type: 'checking', balance: 9999 });

  it('ignores non-credit and zero-balance/no-limit cards', () => {
    const noLimit = makeAccount({ id: 'n', type: 'credit', balance: 500 });
    const zero = makeAccount({ id: 'z', type: 'credit', balance: 0, creditLimit: 1000 });
    const plan = allocateSmartPayment([checking, noLimit, zero, spikeSmall], 50);
    expect(plan.allCards.map((c) => c.account.id)).toEqual(['s']);
  });

  it('eliminates the cheapest spike first to maximize spikes cleared', () => {
    // $100 only covers the small spike (needs 100); big spike needs 600.
    const plan = allocateSmartPayment([spikeSmall, spikeBig], 100);
    const s = plan.allCards.find((c) => c.account.id === 's')!;
    const b = plan.allCards.find((c) => c.account.id === 'b')!;
    expect(s.payment).toBe(100);   // small spike fully cleared to 30%
    expect(b.payment).toBe(0);     // nothing left for the big one
    expect(s.utilAfter).toBe(30);
    expect(plan.spikesBefore).toBe(2);
    expect(plan.spikesAfter).toBe(1);
    expect(plan.totalPaid).toBe(100);
    expect(plan.leftover).toBe(0);
  });

  it('clears all spikes then pushes toward the 10% ideal', () => {
    // 100 (small→30) + 600 (big→30) = 700 clears both spikes; 100 more pushes
    // the cheapest toward 10%. Small at 30% (300 owed) needs 200 to reach 10%.
    const plan = allocateSmartPayment([spikeSmall, spikeBig], 800);
    expect(plan.spikesAfter).toBe(0);
    const s = plan.allCards.find((c) => c.account.id === 's')!;
    // 100 to clear spike + 100 of the remaining toward ideal.
    expect(s.payment).toBe(200);
    expect(plan.totalPaid).toBe(800);
  });

  it('never overpays a card and reports leftover when budget exceeds total owed', () => {
    const plan = allocateSmartPayment([spikeSmall, healthy], 5000);
    const s = plan.allCards.find((c) => c.account.id === 's')!;
    const h = plan.allCards.find((c) => c.account.id === 'h')!;
    expect(s.payment).toBe(400);   // full balance, not more
    expect(h.payment).toBe(50);
    expect(s.utilAfter).toBe(0);
    expect(plan.totalPaid).toBe(450);
    expect(plan.leftover).toBe(4550);
  });

  it('computes overall utilization before/after across all limited cards', () => {
    const plan = allocateSmartPayment([spikeSmall, spikeBig, healthy], 100);
    // before: (400+900+50)/3000 = 45%
    expect(plan.overallUtilBefore).toBe(45);
    // after paying 100: (1350-100)/3000 = 41.67%
    expect(plan.overallUtilAfter).toBeCloseTo(41.67, 1);
  });

  it('handles a zero budget as a no-op plan', () => {
    const plan = allocateSmartPayment([spikeSmall, spikeBig], 0);
    expect(plan.totalPaid).toBe(0);
    expect(plan.allocations).toHaveLength(0);
    expect(plan.spikesAfter).toBe(plan.spikesBefore);
  });
});

describe('assessCardPaymentHistory', () => {
  const card = makeAccount({ id: 'cc', type: 'credit', balance: 800, creditLimit: 1000, createdAt: '2025-01-01' });
  const today = new Date('2026-06-08');

  it('counts only transfers INTO the card as payments', () => {
    const txs = [
      makeTx({ id: '1', type: 'transfer', toAccount: 'cc', amount: 100, date: '2026-05-10' }), // payment
      makeTx({ id: '2', type: 'expense', account: 'cc', amount: 50, date: '2026-05-11' }),       // charge, not a payment
      makeTx({ id: '3', type: 'transfer', account: 'cc', amount: 30, date: '2026-05-12' }),      // cash advance OUT, not a payment
    ];
    const h = assessCardPaymentHistory(card, txs, today);
    expect(h.payments).toBe(1);
  });

  it('is solid with 3+ payments across 3+ distinct months', () => {
    const txs = [
      makeTx({ id: '1', type: 'transfer', toAccount: 'cc', amount: 100, date: '2026-03-10' }),
      makeTx({ id: '2', type: 'transfer', toAccount: 'cc', amount: 100, date: '2026-04-10' }),
      makeTx({ id: '3', type: 'transfer', toAccount: 'cc', amount: 100, date: '2026-05-10' }),
    ];
    const h = assessCardPaymentHistory(card, txs, today);
    expect(h.monthsWithPayment).toBe(3);
    expect(h.solid).toBe(true);
  });

  it('is not solid when payments cluster in too few months', () => {
    const txs = [
      makeTx({ id: '1', type: 'transfer', toAccount: 'cc', amount: 50, date: '2026-05-01' }),
      makeTx({ id: '2', type: 'transfer', toAccount: 'cc', amount: 50, date: '2026-05-10' }),
      makeTx({ id: '3', type: 'transfer', toAccount: 'cc', amount: 50, date: '2026-05-20' }),
    ];
    expect(assessCardPaymentHistory(card, txs, today).solid).toBe(false);
  });

  it('ignores payments older than the lookback window', () => {
    const txs = [
      makeTx({ id: '1', type: 'transfer', toAccount: 'cc', amount: 100, date: '2024-01-10' }),
      makeTx({ id: '2', type: 'transfer', toAccount: 'cc', amount: 100, date: '2024-02-10' }),
      makeTx({ id: '3', type: 'transfer', toAccount: 'cc', amount: 100, date: '2024-03-10' }),
    ];
    expect(assessCardPaymentHistory(card, txs, today).payments).toBe(0);
  });
});

describe('buildLimitIncreaseAdvisories', () => {
  const today = new Date('2026-06-08');
  const solidHistory = (id: string) => [
    makeTx({ id: id + 'a', type: 'transfer', toAccount: id, amount: 100, date: '2026-03-10' }),
    makeTx({ id: id + 'b', type: 'transfer', toAccount: id, amount: 100, date: '2026-04-10' }),
    makeTx({ id: id + 'c', type: 'transfer', toAccount: id, amount: 100, date: '2026-05-10' }),
  ];

  it('recommends the limit that dilutes a high-util card to <=15%, rounded up to $100', () => {
    const card = makeAccount({ id: 'cc', type: 'credit', balance: 800, creditLimit: 1000 }); // 80%
    const advice = buildLimitIncreaseAdvisories([card], solidHistory('cc'), today);
    expect(advice).toHaveLength(1);
    // 800 / 0.15 = 5333.3 → round up to 5400.
    expect(advice[0].recommendedLimit).toBe(5400);
    expect(advice[0].increase).toBe(4400);
    expect(advice[0].resultingUtil).toBeLessThanOrEqual(LIMIT_ADVISOR_TARGET);
  });

  it('skips cards at or under the 30% cap', () => {
    const card = makeAccount({ id: 'cc', type: 'credit', balance: 200, creditLimit: 1000 }); // 20%
    expect(buildLimitIncreaseAdvisories([card], solidHistory('cc'), today)).toHaveLength(0);
  });

  it('skips high-util cards without a solid payment history', () => {
    const card = makeAccount({ id: 'cc', type: 'credit', balance: 800, creditLimit: 1000 });
    expect(buildLimitIncreaseAdvisories([card], [], today)).toHaveLength(0);
  });

  it('skips cards with no limit set', () => {
    const card = makeAccount({ id: 'cc', type: 'credit', balance: 800 });
    expect(buildLimitIncreaseAdvisories([card], solidHistory('cc'), today)).toHaveLength(0);
  });
});

describe('buildStatementArbitrage', () => {
  // today = 2026-06-08; statementDay 11 → closes in 3 days.
  const today = new Date('2026-06-08');

  it('flags a card closing soon that is over the 30% cap, with paydown to 30%', () => {
    const card = makeAccount({ id: 'cc', type: 'credit', balance: 800, creditLimit: 1000, statementDay: 11 }); // 80%
    const items = buildStatementArbitrage([card], today);
    expect(items).toHaveLength(1);
    expect(items[0].daysUntil).toBe(3);
    expect(items[0].targetPct).toBe(30);
    expect(items[0].recommendedPayment).toBe(500); // 800 → 300
  });

  it('targets the 10% ideal when already under the cap', () => {
    const card = makeAccount({ id: 'cc', type: 'credit', balance: 250, creditLimit: 1000, statementDay: 11 }); // 25%
    const items = buildStatementArbitrage([card], today);
    expect(items[0].targetPct).toBe(10);
    expect(items[0].recommendedPayment).toBe(150); // 250 → 100
  });

  it('ignores cards closing beyond the window or with no statement day', () => {
    const far = makeAccount({ id: 'a', type: 'credit', balance: 800, creditLimit: 1000, statementDay: 1 }); // closes ~23 days out
    const noStmt = makeAccount({ id: 'b', type: 'credit', balance: 800, creditLimit: 1000 });
    expect(buildStatementArbitrage([far, noStmt], today)).toHaveLength(0);
  });

  it('skips cards already at/under the relevant target', () => {
    const ideal = makeAccount({ id: 'cc', type: 'credit', balance: 50, creditLimit: 1000, statementDay: 11 }); // 5%
    expect(buildStatementArbitrage([ideal], today)).toHaveLength(0);
  });

  it('sorts by soonest closing first', () => {
    const soon = makeAccount({ id: 'soon', type: 'credit', balance: 800, creditLimit: 1000, statementDay: 9 });  // 1 day
    const later = makeAccount({ id: 'later', type: 'credit', balance: 800, creditLimit: 1000, statementDay: 12 }); // 4 days
    const items = buildStatementArbitrage([later, soon], today);
    expect(items.map((i) => i.account.id)).toEqual(['soon', 'later']);
  });
});

describe('calcCreditAlerts', () => {
  it('counts cards over the recommended target', () => {
    const cards = [
      makeAccount({ id: 'a', type: 'credit', balance: 300, creditLimit: 1000 }), // 30% ok
      makeAccount({ id: 'b', type: 'credit', balance: 800, creditLimit: 1000 }), // 80% over
      makeAccount({ id: 'c', type: 'credit', balance: 1200, creditLimit: 1000 }),// 120% over
    ];
    expect(calcCreditAlerts(cards)).toBe(2);
  });
  it('is 0 when no cards or none over target', () => {
    expect(calcCreditAlerts([])).toBe(0);
    expect(calcCreditAlerts([makeAccount({ id: 'a', type: 'credit', balance: 100, creditLimit: 1000 })])).toBe(0);
  });
});

// ── Credit utilization health factor + statement dates ────────────────────────

describe('calcCreditUtilizationScore', () => {
  it('rewards low utilization, penalizes high', () => {
    expect(calcCreditUtilizationScore(5)).toBe(15);
    expect(calcCreditUtilizationScore(10)).toBe(15);
    expect(calcCreditUtilizationScore(20)).toBe(13);
    expect(calcCreditUtilizationScore(30)).toBe(11);
    expect(calcCreditUtilizationScore(50)).toBe(7);
    expect(calcCreditUtilizationScore(85)).toBe(2);
    expect(calcCreditUtilizationScore(95)).toBe(1);
    expect(calcCreditUtilizationScore(100)).toBe(1);
    expect(calcCreditUtilizationScore(150)).toBe(0);
  });
  it('returns a neutral-good 12 when no card has a limit (null)', () => {
    expect(calcCreditUtilizationScore(null)).toBe(12);
  });
});

describe('composeHealthScore', () => {
  it('caps at 100 with all sub-scores maxed and ideal utilization', () => {
    const { score, breakdown } = composeHealthScore({
      savingsScore: 25, emergencyScore: 20, budgetScore: 15, dtiScore: 20,
      trendScore: 10, volatilityScore: 10, creditUtil: 5,
    });
    expect(score).toBe(100);
    // breakdown integers sum exactly to the score
    const sum = breakdown.savings + breakdown.emergency + breakdown.credit + breakdown.dti + breakdown.budget + breakdown.trend + breakdown.volatility;
    expect(sum).toBe(score);
    expect(breakdown.credit).toBe(15);
  });
  it('weights each factor to HEALTH_WEIGHTS at full sub-score', () => {
    const { breakdown } = composeHealthScore({
      savingsScore: 25, emergencyScore: 20, budgetScore: 15, dtiScore: 20,
      trendScore: 10, volatilityScore: 10, creditUtil: 5,
    });
    expect(breakdown.savings).toBe(HEALTH_WEIGHTS.savings);
    expect(breakdown.dti).toBe(HEALTH_WEIGHTS.dti);
    expect(breakdown.budget).toBe(HEALTH_WEIGHTS.budget);
  });
  it('uses the neutral credit score when utilization is unknown', () => {
    const { breakdown } = composeHealthScore({
      savingsScore: 0, emergencyScore: 0, budgetScore: 0, dtiScore: 0,
      trendScore: 0, volatilityScore: 0, creditUtil: null,
    });
    expect(breakdown.credit).toBe(12);
  });
  it('weights sum to 100', () => {
    const total = Object.values(HEALTH_WEIGHTS).reduce((s, v) => s + v, 0);
    expect(total).toBe(100);
  });
});

describe('daysUntilStatement', () => {
  it('returns null when unset or out of range', () => {
    expect(daysUntilStatement(undefined, new Date(2026, 5, 8))).toBeNull();
    expect(daysUntilStatement(0, new Date(2026, 5, 8))).toBeNull();
    expect(daysUntilStatement(32, new Date(2026, 5, 8))).toBeNull();
  });
  it('counts days to a later day this month', () => {
    expect(daysUntilStatement(15, new Date(2026, 5, 8))).toBe(7); // Jun 8 → Jun 15
  });
  it('is 0 on the statement day itself', () => {
    expect(daysUntilStatement(8, new Date(2026, 5, 8))).toBe(0);
  });
  it('rolls to next month once the day has passed', () => {
    expect(daysUntilStatement(5, new Date(2026, 5, 8))).toBe(27); // Jun 8 → Jul 5
  });
  it('clamps a 31 to the last day of a short month', () => {
    // Feb 2026 has 28 days → statement "31" clamps to Feb 28.
    expect(daysUntilStatement(31, new Date(2026, 1, 10))).toBe(18); // Feb 10 → Feb 28
  });
});
