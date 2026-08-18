import { describe, it, expect } from 'vitest';
import {
  calcTraditionalNetWorth, calcLiquidNetWorth, calcTotalAssets, calcTotalDebt, calcLiquidSavings,
  calcMonthIncome, calcMonthExpense, calcSavingsRate, calcSafeToSpend, calcSafeToSpendDaily, calcSpendableCash, calcMonthCashSpending, pctChange,
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
  billToTransactionDefaults, calcSplitShares, calcLoanRemaining, myBillShare, billOthersShare, defaultBillPaymentAmount,
  calcOverdueBills, calcOverBudget,
  calcNetWorthProjection, calcPaycheckTaxToSave, calcLongestUntouchedSavings,
  calcLoanPayoff, calcLoanExtraPaymentImpact, calcLoanPaymentSplit,
  calcActivityMonths, calcPredictionReadiness,
  calcPaycheckDeposited,
  creditUtilization, creditUtilStatus, isOverCreditTarget, availableCredit,
  calcPaydownToTarget, buildCreditReport, calcCreditAlerts, allocateSmartPayment,
  assessCardPaymentHistory, buildLimitIncreaseAdvisories, LIMIT_ADVISOR_TARGET,
  buildStatementArbitrage, buildBalanceTransferAdvice,
  detectSubscriptions, suggestBudgetReallocations, denormalizeMonthlyBudget,
  calcCreditUtilizationScore, composeHealthScore, daysUntilStatement, HEALTH_WEIGHTS,
  CREDIT_UTIL_TARGET,
  predictMonthlyIncome, suggestCardPaymentBudget,
  parseCategoryBuckets, serializeCategoryBuckets, normalizeBucketTargets, bucketForCategory,
  calcTakeHomeIncome, calcBucketSpend, calcDeliberateSavings, allocateProportional,
  buildBucketSnapshot, buildBucketBudgetPlan, DEBT_PAYOFF_IS_SAVINGS, roundCents,
  accountUpcomingBills, assessAccountOverdraft, detectOverdraftRisks, evaluatePaymentSafety,
  isSpendableAccount, OVERDRAFT_HORIZON_DAYS,
  calcSavingsInterest,
} from '@/lib/calculations';
import type { Account, Transaction, Bill, Budget, Loan, Split, PaycheckEntry, CategoryBucketMap } from '@/types';

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
  it('spendable cash minus bills still due', () => {
    expect(calcSafeToSpend(2500, 500)).toBe(2000);
  });

  it('goes negative when bills exceed cash on hand', () => {
    expect(calcSafeToSpend(800, 1100)).toBe(-300);
  });

  it('no bills due → full cash on hand', () => {
    expect(calcSafeToSpend(3000, 0)).toBe(3000);
  });

  it('rounds float drift to cents', () => {
    expect(calcSafeToSpend(1000.1, 0.2)).toBe(999.9);
  });
});

describe('calcLongestUntouchedSavings', () => {
  const today = new Date('2026-06-09T00:00:00');

  it('returns null when there are no savings accounts', () => {
    const accts = [makeAccount({ id: 'chk', type: 'checking', balance: 100 })];
    expect(calcLongestUntouchedSavings(accts, [], today)).toBeNull();
  });

  it('picks the savings account with the oldest last deposit', () => {
    const accts = [
      makeAccount({ id: 's1', type: 'savings', balance: 1000, createdAt: '2026-01-01' }),
      makeAccount({ id: 's2', type: 'savings', balance: 2000, createdAt: '2026-01-01' }),
    ];
    const txs = [
      makeTx({ type: 'transfer', account: 'chk', toAccount: 's1', amount: 100, date: '2026-06-01' }),
      makeTx({ type: 'transfer', account: 'chk', toAccount: 's2', amount: 100, date: '2026-03-01' }),
    ];
    const r = calcLongestUntouchedSavings(accts, txs, today);
    expect(r?.account.id).toBe('s2');
    expect(r?.lastDeposit).toBe('2026-03-01');
    expect(r?.daysSince).toBe(100);
  });

  it('counts income deposits and falls back to creation date when never funded', () => {
    const accts = [makeAccount({ id: 's1', type: 'savings', balance: 0, createdAt: '2026-05-10' })];
    const r = calcLongestUntouchedSavings(accts, [], today);
    expect(r?.lastDeposit).toBeNull();
    expect(r?.daysSince).toBe(30);
  });
});

describe('calcLoanPayoff', () => {
  const today = new Date('2026-06-09T00:00:00');

  it('paid-off loan → 0 months, no interest', () => {
    const r = calcLoanPayoff(0, 6, 300, today);
    expect(r.months).toBe(0);
    expect(r.amortizes).toBe(true);
  });

  it('0% APR → simple division', () => {
    const r = calcLoanPayoff(1200, 0, 100, today);
    expect(r.months).toBe(12);
    expect(r.totalInterest).toBe(0);
    expect(r.payoffMonth).toBe('2027-06');
  });

  it('amortizes a typical loan and charges interest', () => {
    // $10,000 at 6% APR, $200/mo → ~58 months, a few hundred in interest.
    const r = calcLoanPayoff(10000, 6, 200, today);
    expect(r.amortizes).toBe(true);
    expect(r.months).toBe(58);
    expect(r.monthlyInterest).toBe(50); // 10000 * 0.005
    expect(r.totalInterest).toBeGreaterThan(1000);
    expect(r.totalInterest).toBeLessThan(2000);
  });

  it('payment below first-month interest never amortizes', () => {
    const r = calcLoanPayoff(10000, 24, 100, today); // monthly interest = 200 > 100
    expect(r.amortizes).toBe(false);
    expect(r.months).toBeNull();
    expect(r.monthlyInterest).toBe(200);
  });
});

describe('calcLoanExtraPaymentImpact', () => {
  const today = new Date('2026-06-09T00:00:00');
  it('paying extra shortens the term and saves interest', () => {
    const r = calcLoanExtraPaymentImpact(10000, 6, 200, 100, today);
    expect(r).not.toBeNull();
    expect(r!.monthsSaved).toBeGreaterThan(0);
    expect(r!.interestSaved).toBeGreaterThan(0);
    expect(r!.newMonths).toBeLessThan(58);
  });
  it('returns null with no balance or no extra', () => {
    expect(calcLoanExtraPaymentImpact(0, 6, 200, 100, today)).toBeNull();
    expect(calcLoanExtraPaymentImpact(10000, 6, 200, 0, today)).toBeNull();
  });
});

describe('calcPredictionReadiness', () => {
  it('counts distinct income/expense months, ignoring transfers', () => {
    const txs = [
      makeTx({ type: 'income', date: '2026-01-05', amount: 100 }),
      makeTx({ type: 'expense', date: '2026-01-20', amount: 50 }),
      makeTx({ type: 'expense', date: '2026-02-10', amount: 30 }),
      makeTx({ type: 'transfer', date: '2026-03-01', amount: 200 }), // ignored
    ];
    const r = calcPredictionReadiness(txs);
    expect(r.months).toBe(2);
    expect(r.ready).toBe(false);
    expect(r.monthsNeeded).toBe(1);
    expect(r.required).toBe(3);
  });

  it('is ready at 3+ distinct active months', () => {
    const txs = [
      makeTx({ type: 'expense', date: '2026-01-10', amount: 10 }),
      makeTx({ type: 'expense', date: '2026-02-10', amount: 10 }),
      makeTx({ type: 'income', date: '2026-03-10', amount: 10 }),
    ];
    const r = calcPredictionReadiness(txs);
    expect(r.months).toBe(3);
    expect(r.ready).toBe(true);
    expect(r.monthsNeeded).toBe(0);
  });

  it('respects a custom threshold', () => {
    expect(calcPredictionReadiness([], 2)).toEqual({ months: 0, ready: false, monthsNeeded: 2, required: 2 });
  });

  it('calcActivityMonths dedupes within a month', () => {
    const txs = [
      makeTx({ type: 'expense', date: '2026-01-03', amount: 5 }),
      makeTx({ type: 'expense', date: '2026-01-28', amount: 5 }),
    ];
    expect(calcActivityMonths(txs)).toBe(1);
  });
});

describe('calcLoanPaymentSplit', () => {
  it('splits interest vs principal at the current balance', () => {
    // 10000 @ 6% → monthly interest 50; a 200 payment is 50 interest + 150 principal.
    expect(calcLoanPaymentSplit(10000, 6, 200)).toEqual({ interest: 50, principal: 150 });
  });

  it('0% APR → all principal', () => {
    expect(calcLoanPaymentSplit(5000, 0, 300)).toEqual({ interest: 0, principal: 300 });
  });

  it('payment below interest → all interest, no principal', () => {
    expect(calcLoanPaymentSplit(10000, 24, 100)).toEqual({ interest: 100, principal: 0 });
  });

  it('caps principal at the remaining balance (final payment)', () => {
    const s = calcLoanPaymentSplit(100, 6, 200);
    expect(s.interest).toBe(0.5);
    expect(s.principal).toBe(100);
  });

  it('nothing owed → no interest, no principal', () => {
    expect(calcLoanPaymentSplit(0, 6, 200)).toEqual({ interest: 0, principal: 0 });
  });
});

describe('calcSpendableCash', () => {
  it('sums only checking balances (savings/credit/loan/investment excluded)', () => {
    const accts = [
      makeAccount({ id: 'c1', type: 'checking', balance: 1200 }),
      makeAccount({ id: 'c2', type: 'checking', balance: 300 }),
      makeAccount({ id: 's1', type: 'savings', balance: 5000 }),
      makeAccount({ id: 'cr', type: 'credit', balance: 400 }),
      makeAccount({ id: 'l1', type: 'loan', balance: 9000 }),
      makeAccount({ id: 'i1', type: 'investment', balance: 7000 }),
    ];
    expect(calcSpendableCash(accts)).toBe(1500);
  });

  it('returns 0 with no checking accounts', () => {
    expect(calcSpendableCash([makeAccount({ type: 'savings', balance: 500 })])).toBe(0);
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

// ── defaultBillPaymentAmount ──────────────────────────────────────────────────
// Regression guard for the loan-split underpayment bug: a loan-linked split bill
// must record the FULL bill amount (not just your share), or the loan is paid
// down by far too little and the account isn't drained for the fronted shares.

describe('defaultBillPaymentAmount', () => {
  const base: Bill = {
    id: 'b1', name: 'Car Payment', amount: 510.76, frequency: 'monthly',
    nextDue: '2026-06-27', account: 'chk', category: 'Car', isActive: true,
  };

  it('unsplit bill → full amount', () => {
    expect(defaultBillPaymentAmount(base)).toBe(510.76);
  });

  it('plain split bill → only your share (others are fronted separately)', () => {
    const split: Bill = { ...base, splitParticipants: [{ contactId: 'mom', amount: 300 }] };
    expect(defaultBillPaymentAmount(split)).toBe(210.76);
  });

  it('LOAN-linked split bill → the FULL amount, not your share (the bug)', () => {
    const loanSplit: Bill = {
      ...base,
      loanAccountId: 'ford',
      splitParticipants: [{ contactId: 'mom', amount: 300 }],
    };
    // Must be the whole bill: the entire payment flows into the loan
    // (interest + principal); the $300 is tracked as a receivable, not subtracted.
    expect(defaultBillPaymentAmount(loanSplit)).toBe(510.76);
  });

  it('LOAN-linked unsplit bill → full amount', () => {
    expect(defaultBillPaymentAmount({ ...base, loanAccountId: 'ford' })).toBe(510.76);
  });

  it('full loan payment = your share + everyone else’s shares (money conserved)', () => {
    const loanSplit: Bill = {
      ...base,
      loanAccountId: 'ford',
      splitParticipants: [{ contactId: 'mom', amount: 300 }, { contactId: 'dad', amount: 50 }],
    };
    expect(defaultBillPaymentAmount(loanSplit)).toBe(
      roundCentsForTest(myBillShare(loanSplit) + billOthersShare(loanSplit)),
    );
  });
});

function roundCentsForTest(n: number): number {
  return Math.round(n * 100) / 100;
}

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

  it('rollover off: last month overspend does NOT push a category over', () => {
    const budgets = [makeBudget({ category: 'Food', amount: 500 })];
    const txs = [
      makeTx({ id: 'p', type: 'expense', date: '2026-04-15', amount: 700, category: 'Food' }), // prev month overspend
      makeTx({ id: 'c', type: 'expense', date: '2026-05-10', amount: 300, category: 'Food' }), // this month under cap
    ];
    expect(calcOverBudget(budgets, txs, MONTH, false)).toBe(0);
  });

  it('rollover on: last month overspend carries forward to push a category over', () => {
    const budgets = [makeBudget({ category: 'Food', amount: 500 })];
    const txs = [
      makeTx({ id: 'p', type: 'expense', date: '2026-04-15', amount: 700, category: 'Food' }), // $200 deficit carried
      makeTx({ id: 'c', type: 'expense', date: '2026-05-10', amount: 400, category: 'Food' }), // 400 + 200 = 600 > 500
    ];
    expect(calcOverBudget(budgets, txs, MONTH, true)).toBe(1);
  });

  it('rollover on: last month underspend carries nothing', () => {
    const budgets = [makeBudget({ category: 'Food', amount: 500 })];
    const txs = [
      makeTx({ id: 'p', type: 'expense', date: '2026-04-15', amount: 100, category: 'Food' }), // surplus, no carry
      makeTx({ id: 'c', type: 'expense', date: '2026-05-10', amount: 400, category: 'Food' }), // 400 < 500
    ];
    expect(calcOverBudget(budgets, txs, MONTH, true)).toBe(0);
  });

  it('rollover on: matches the Planning view (2 cats) where raw count would be 1', () => {
    const budgets = [
      makeBudget({ id: 'b1', category: 'Food', amount: 500 }),
      makeBudget({ id: 'b2', category: 'Transport', amount: 150 }),
    ];
    const txs = [
      // Food: this month already over the cap on raw spend alone.
      makeTx({ id: 'f', type: 'expense', date: '2026-05-10', amount: 520, category: 'Food' }),
      // Transport: under the cap this month, but last month's overspend carries it over.
      makeTx({ id: 'tp', type: 'expense', date: '2026-04-12', amount: 220, category: 'Transport' }), // $70 deficit
      makeTx({ id: 'tc', type: 'expense', date: '2026-05-12', amount: 120, category: 'Transport' }), // 120 + 70 = 190 > 150
    ];
    expect(calcOverBudget(budgets, txs, MONTH, false)).toBe(1); // raw badge under-counted
    expect(calcOverBudget(budgets, txs, MONTH, true)).toBe(2);  // now consistent with Planning
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

describe('buildBalanceTransferAdvice', () => {
  it('reports interest cost and savings into a real 0% destination', () => {
    const high = makeAccount({ id: 'h', type: 'credit', balance: 1000, creditLimit: 2000, apr: 24 });
    const zero = makeAccount({ id: 'z', type: 'credit', balance: 0, creditLimit: 5000, apr: 0 });
    const advice = buildBalanceTransferAdvice([high, zero]);
    expect(advice).toHaveLength(1);
    const a = advice[0];
    expect(a.account.id).toBe('h');
    expect(a.annualInterest).toBe(240);           // 1000 * 24%
    expect(a.monthlyInterest).toBe(20);           // 240 / 12
    expect(a.transferable).toBe(1000);            // fits the 5000 of room
    expect(a.destinationName).toBe('Test');       // the 0% card's name
    expect(a.savings).toBe(240);                  // full balance moved, 12-month window
  });

  it('caps the transfer at the destination available room', () => {
    const high = makeAccount({ id: 'h', type: 'credit', balance: 1000, creditLimit: 2000, apr: 24 });
    const zero = makeAccount({ id: 'z', type: 'credit', balance: 700, creditLimit: 1000, apr: 0 }); // 300 room
    const advice = buildBalanceTransferAdvice([high, zero]);
    expect(advice[0].transferable).toBe(300);
    expect(advice[0].savings).toBe(72);           // 300 * 24% over a year
  });

  it('still advises (hypothetical 0% card) when no low-APR destination exists', () => {
    const high = makeAccount({ id: 'h', type: 'credit', balance: 1000, creditLimit: 2000, apr: 24 });
    const advice = buildBalanceTransferAdvice([high]);
    expect(advice).toHaveLength(1);
    expect(advice[0].transferable).toBe(0);
    expect(advice[0].destinationName).toBeNull();
    expect(advice[0].savings).toBe(240);          // potential on the full balance
  });

  it('ignores low-APR cards as sources and cards without an APR set', () => {
    const lowApr = makeAccount({ id: 'l', type: 'credit', balance: 1000, creditLimit: 2000, apr: 8 });
    const noApr = makeAccount({ id: 'n', type: 'credit', balance: 1000, creditLimit: 2000 });
    expect(buildBalanceTransferAdvice([lowApr, noApr])).toHaveLength(0);
  });

  it('allocates limited destination room worst-APR-first', () => {
    const worst = makeAccount({ id: 'w', type: 'credit', balance: 500, creditLimit: 1000, apr: 27 });
    const bad = makeAccount({ id: 'b', type: 'credit', balance: 500, creditLimit: 1000, apr: 20 });
    const zero = makeAccount({ id: 'z', type: 'credit', balance: 600, creditLimit: 1000, apr: 0 }); // 400 room
    const advice = buildBalanceTransferAdvice([bad, worst, zero]);
    // 400 of room → all to the 27% card first, none left for the 20% card.
    expect(advice[0].account.id).toBe('w');
    expect(advice[0].transferable).toBe(400);
    expect(advice[1].account.id).toBe('b');
    expect(advice[1].transferable).toBe(0);
  });
});

describe('detectSubscriptions', () => {
  const today = new Date('2026-06-08');

  it('detects a recurring charge across months and flags price creep', () => {
    const txs = [
      makeTx({ id: '1', type: 'expense', description: 'Netflix', amount: 15.99, category: 'Entertainment', date: '2026-03-05' }),
      makeTx({ id: '2', type: 'expense', description: 'Netflix', amount: 15.99, category: 'Entertainment', date: '2026-04-05' }),
      makeTx({ id: '3', type: 'expense', description: 'Netflix', amount: 17.99, category: 'Entertainment', date: '2026-05-05' }),
    ];
    const subs = detectSubscriptions(txs, today);
    expect(subs).toHaveLength(1);
    expect(subs[0].merchant).toBe('Netflix');
    expect(subs[0].monthlyAmount).toBe(17.99);
    expect(subs[0].firstAmount).toBe(15.99);
    expect(subs[0].priceIncrease).toBe(2);
    expect(subs[0].hasPriceCreep).toBe(true);
    expect(subs[0].isActive).toBe(true);
  });

  it('groups merchant-name noise (card digits / punctuation) together', () => {
    const txs = [
      makeTx({ id: '1', type: 'expense', description: 'NETFLIX 1234', amount: 15.99, date: '2026-03-05' }),
      makeTx({ id: '2', type: 'expense', description: 'Netflix.com', amount: 15.99, date: '2026-04-05' }),
      makeTx({ id: '3', type: 'expense', description: 'netflix', amount: 15.99, date: '2026-05-05' }),
    ];
    expect(detectSubscriptions(txs, today)).toHaveLength(1);
  });

  it('ignores merchants with wildly varying amounts (e.g. groceries)', () => {
    const txs = [
      makeTx({ id: '1', type: 'expense', description: 'Kroger', amount: 20, date: '2026-03-05' }),
      makeTx({ id: '2', type: 'expense', description: 'Kroger', amount: 180, date: '2026-04-05' }),
      makeTx({ id: '3', type: 'expense', description: 'Kroger', amount: 95, date: '2026-05-05' }),
    ];
    expect(detectSubscriptions(txs, today)).toHaveLength(0);
  });

  it('ignores merchants seen in too few months', () => {
    const txs = [
      makeTx({ id: '1', type: 'expense', description: 'Spotify', amount: 9.99, date: '2026-05-01' }),
      makeTx({ id: '2', type: 'expense', description: 'Spotify', amount: 9.99, date: '2026-05-15' }),
      makeTx({ id: '3', type: 'expense', description: 'Spotify', amount: 9.99, date: '2026-05-28' }),
    ];
    expect(detectSubscriptions(txs, today)).toHaveLength(0); // 3 charges but only 1 month
  });

  it('marks a stale subscription inactive', () => {
    const txs = [
      makeTx({ id: '1', type: 'expense', description: 'OldGym', amount: 30, date: '2025-09-05' }),
      makeTx({ id: '2', type: 'expense', description: 'OldGym', amount: 30, date: '2025-10-05' }),
      makeTx({ id: '3', type: 'expense', description: 'OldGym', amount: 30, date: '2025-11-05' }),
    ];
    expect(detectSubscriptions(txs, today)[0].isActive).toBe(false);
  });
});

describe('suggestBudgetReallocations', () => {
  const today = new Date('2026-06-08'); // window = 2026-05, 2026-04, 2026-03
  const monthly = (cat: string, amount: number): Budget => ({ id: cat, category: cat, amount, period: 'monthly' });
  const spend = (cat: string, month: string, amount: number, i: number) =>
    makeTx({ id: `${cat}-${month}-${i}`, type: 'expense', category: cat, amount, date: `${month}-10` });

  it('suggests increasing a chronically overspent budget', () => {
    const budgets = [monthly('Food', 300)];
    const txs = [
      spend('Food', '2026-03', 400, 1),
      spend('Food', '2026-04', 420, 2),
      spend('Food', '2026-05', 410, 3),
    ];
    const r = suggestBudgetReallocations(budgets, txs, today);
    expect(r).toHaveLength(1);
    expect(r[0].direction).toBe('increase');
    expect(r[0].avgSpend).toBe(410);
    expect(r[0].suggestedMonthly).toBe(410);
    expect(r[0].delta).toBe(110);
    expect(r[0].monthsOver).toBe(3);
  });

  it('suggests decreasing a chronically underspent budget', () => {
    const budgets = [monthly('Entertainment', 200)];
    const txs = [
      spend('Entertainment', '2026-03', 120, 1),
      spend('Entertainment', '2026-04', 130, 2),
      spend('Entertainment', '2026-05', 125, 3),
    ];
    const r = suggestBudgetReallocations(budgets, txs, today);
    expect(r[0].direction).toBe('decrease');
    expect(r[0].suggestedMonthly).toBe(125);
    expect(r[0].delta).toBe(-75);
  });

  it('leaves budgets that roughly match spend alone', () => {
    const budgets = [monthly('Food', 300)];
    const txs = [
      spend('Food', '2026-03', 300, 1),
      spend('Food', '2026-04', 310, 2),
      spend('Food', '2026-05', 295, 3),
    ];
    expect(suggestBudgetReallocations(budgets, txs, today)).toHaveLength(0);
  });

  it('excludes the current (partial) month from the window', () => {
    const budgets = [monthly('Food', 300)];
    const txs = [
      spend('Food', '2026-03', 300, 1),
      spend('Food', '2026-04', 300, 2),
      spend('Food', '2026-05', 300, 3),
      spend('Food', '2026-06', 999, 4), // current month — should be ignored
    ];
    expect(suggestBudgetReallocations(budgets, txs, today)).toHaveLength(0);
  });

  it('ignores sub-threshold deltas', () => {
    const budgets = [monthly('Food', 300)];
    const txs = [
      spend('Food', '2026-03', 303, 1),
      spend('Food', '2026-04', 304, 2),
      spend('Food', '2026-05', 302, 3),
    ];
    expect(suggestBudgetReallocations(budgets, txs, today)).toHaveLength(0);
  });
});

describe('denormalizeMonthlyBudget', () => {
  it('inverts normalizeMonthlyBudget for each period', () => {
    expect(denormalizeMonthlyBudget(300, 'monthly')).toBe(300);
    expect(denormalizeMonthlyBudget(120, 'yearly')).toBe(1440);
    // weekly: normalize multiplies by 4.33, so denormalize divides by it.
    expect(denormalizeMonthlyBudget(433, 'weekly')).toBe(100);
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

// ── predictMonthlyIncome ──────────────────────────────────────────────────────

describe('predictMonthlyIncome', () => {
  const today = new Date(2026, 5, 15); // Jun 15 2026

  it('projects recurring biweekly paychecks to a monthly figure', () => {
    // Same payer, steady amount, ~14 days apart, latest within the active window.
    const txs: Transaction[] = [
      '2026-04-03', '2026-04-17', '2026-05-01', '2026-05-15', '2026-05-29', '2026-06-12',
    ].map((date, i) => makeTx({ id: `p${i}`, type: 'income', description: 'ACME Payroll', amount: 2000, date }));
    const r = predictMonthlyIncome(txs, today);
    expect(r.method).toBe('recurring');
    expect(r.sources).toHaveLength(1);
    expect(r.sources[0].cadenceDays).toBe(14);
    // 2000 × (30.44 / 14) ≈ 4348.57 — biweekly normalizes to ~2.17 paychecks/month.
    expect(r.amount).toBeCloseTo(4348.57, 1);
  });

  it('ignores a paycheck that stopped (latest deposit too old)', () => {
    const txs: Transaction[] = ['2026-01-03', '2026-01-17', '2026-01-31'].map((date, i) =>
      makeTx({ id: `o${i}`, type: 'income', description: 'Old Job', amount: 2000, date }),
    );
    // No active recurring source and no income in the trailing 3 months → none.
    expect(predictMonthlyIncome(txs, today).method).toBe('none');
  });

  it('falls back to the average of the last 3 complete months when nothing recurs', () => {
    // Distinct descriptions → never grouped as a recurring paycheck.
    const txs: Transaction[] = [
      makeTx({ id: 'a', type: 'income', description: 'May gig', amount: 3000, date: '2026-05-10' }),
      makeTx({ id: 'b', type: 'income', description: 'Apr gig', amount: 1000, date: '2026-04-10' }),
      makeTx({ id: 'c', type: 'income', description: 'Mar gig', amount: 2000, date: '2026-03-10' }),
    ];
    const r = predictMonthlyIncome(txs, today);
    expect(r.method).toBe('average');
    expect(r.amount).toBe(2000); // (3000 + 1000 + 2000) / 3
    expect(r.sources).toHaveLength(0);
  });

  it('returns zero / none with no income at all', () => {
    const r = predictMonthlyIncome([makeTx({ type: 'expense', amount: 50 })], today);
    expect(r.amount).toBe(0);
    expect(r.method).toBe('none');
  });
});

// ── suggestCardPaymentBudget ──────────────────────────────────────────────────

function makeLoan(overrides: Partial<Loan> & { direction: Loan['direction'] }): Loan {
  return {
    id: 'loan_1', contactId: 'c1', contactName: 'Sam', account: 'acc_1', category: '',
    principal: 0, repaidAmount: 0, date: '2026-05-01', note: '', settled: false, settledDate: '',
    principalTxId: '', repaymentTxIds: [],
    ...overrides,
  };
}

function makeSplit(overrides: Partial<Split> = {}): Split {
  return {
    id: 'split_1', billId: 'b1', billName: 'Dinner', contactId: 'c1', contactName: 'Sam',
    amount: 0, category: 'Food', account: 'acc_1', date: '2026-05-01', settled: false, settledDate: '',
    repaidAmount: 0, repaymentTxIds: [],
    ...overrides,
  };
}

describe('suggestCardPaymentBudget', () => {
  const today = new Date(2026, 5, 15); // Jun 15 2026
  const card = makeAccount({ id: 'cc', type: 'credit', balance: 1000, creditLimit: 5000 });
  const checking = makeAccount({ id: 'chk', type: 'checking', balance: 8000 });

  // Distinct descriptions keep income on the clean 'average' path: avg = 3000.
  const income: Transaction[] = [
    makeTx({ id: 'i1', type: 'income', description: 'May pay', amount: 3000, date: '2026-05-10' }),
    makeTx({ id: 'i2', type: 'income', description: 'Apr pay', amount: 3000, date: '2026-04-10' }),
    makeTx({ id: 'i3', type: 'income', description: 'Mar pay', amount: 3000, date: '2026-03-10' }),
  ];

  it('derives free cash from income minus obligations plus what is owed to you', () => {
    const r = suggestCardPaymentBudget({
      accounts: [card, checking],
      transactions: income,
      bills: [makeBill({ amount: 500, nextDue: '2026-06-20', account: 'chk' })],
      budgets: [{ id: 'bg', category: 'Food', amount: 800, period: 'monthly' }],
      loans: [
        makeLoan({ direction: 'borrowed', principal: 1000, repaidAmount: 200, account: 'chk' }), // owe 800
        makeLoan({ id: 'l2', direction: 'lent', principal: 300 }),                               // owed 300
      ],
      splits: [makeSplit({ amount: 100, account: 'cc' })],                                        // owed 100, on the card
      today,
    });
    expect(r.predictedIncome).toBe(3000);
    expect(r.incomeMethod).toBe('average');
    expect(r.bills).toBe(500);
    expect(r.budgets).toBe(800);
    expect(r.loanRepayments).toBe(800);
    expect(r.incomingOwed).toBe(400); // 300 lent + 100 split
    // 3000 − 500 − 800 − 800 + 400 = 1300 free cash, capped at the 1000 owed.
    expect(r.freeCash).toBe(1300);
    expect(r.cardBalance).toBe(1000);
    expect(r.suggested).toBe(1000);
    // The split was fronted from the card, so it's flagged as card-linked.
    expect(r.cardLinked.splits).toBe(100);
    expect(r.cardLinked.bills).toBe(0);
  });

  it('floors free cash at zero when obligations swallow income', () => {
    const r = suggestCardPaymentBudget({
      accounts: [card],
      transactions: income,
      bills: [makeBill({ amount: 2500, nextDue: '2026-06-05', account: 'chk' })],
      budgets: [{ id: 'bg', category: 'Rent', amount: 1500, period: 'monthly' }],
      loans: [],
      splits: [],
      today,
    });
    expect(r.freeCash).toBe(0); // 3000 − 2500 − 1500 < 0 → floored
    expect(r.suggested).toBe(0);
  });

  it('only counts bills due in the current month', () => {
    const r = suggestCardPaymentBudget({
      accounts: [card],
      transactions: income,
      bills: [
        makeBill({ id: 'now', amount: 200, nextDue: '2026-06-28', account: 'chk' }),
        makeBill({ id: 'later', amount: 999, nextDue: '2026-07-01', account: 'chk' }),
      ],
      budgets: [],
      loans: [],
      splits: [],
      today,
    });
    expect(r.bills).toBe(200); // July bill excluded
  });
});

// ── Overdraft / Low-Balance Safeguard ─────────────────────────────────────────

describe('overdraft safeguard', () => {
  const today = new Date('2026-06-11T12:00:00');

  describe('isSpendableAccount', () => {
    it('guards checking, savings and cash; not credit/loan/investment', () => {
      expect(isSpendableAccount(makeAccount({ type: 'checking' }))).toBe(true);
      expect(isSpendableAccount(makeAccount({ type: 'savings' }))).toBe(true);
      expect(isSpendableAccount(makeAccount({ type: 'cash' }))).toBe(true);
      expect(isSpendableAccount(makeAccount({ type: 'credit' }))).toBe(false);
      expect(isSpendableAccount(makeAccount({ type: 'loan' }))).toBe(false);
      expect(isSpendableAccount(makeAccount({ type: 'investment' }))).toBe(false);
    });
  });

  describe('accountUpcomingBills', () => {
    const bills = [
      makeBill({ id: 'b1', account: 'chk', amount: 60, nextDue: '2026-06-15' }),
      makeBill({ id: 'b2', account: 'chk', amount: 40, nextDue: '2026-06-20' }),
      makeBill({ id: 'b3', account: 'sav', amount: 99, nextDue: '2026-06-18' }), // other account
      makeBill({ id: 'b4', account: 'chk', amount: 30, nextDue: '2026-08-01' }), // beyond horizon
      makeBill({ id: 'b5', account: 'chk', amount: 25, nextDue: '2026-06-25', isActive: false }), // inactive
    ];

    it('returns only active bills from this account within the horizon, soonest first', () => {
      const out = accountUpcomingBills('chk', bills, today);
      expect(out.map((u) => u.bill.id)).toEqual(['b1', 'b2']);
      expect(out[0].share).toBe(60);
    });

    it('counts overdue (already-past) bills — they still need the cash', () => {
      const overdue = [makeBill({ id: 'od', account: 'chk', amount: 50, nextDue: '2026-06-01' })];
      expect(accountUpcomingBills('chk', overdue, today)).toHaveLength(1);
    });

    it('uses YOUR share of a split bill, and skips bills others fully cover', () => {
      const split = [
        makeBill({ id: 's1', account: 'chk', amount: 100, nextDue: '2026-06-15', splitContactId: 'c1', splitAmount: 30 }),
        makeBill({ id: 's2', account: 'chk', amount: 80, nextDue: '2026-06-16', splitContactId: 'c1', splitAmount: 80 }),
      ];
      const out = accountUpcomingBills('chk', split, today);
      expect(out).toHaveLength(1);
      expect(out[0].bill.id).toBe('s1');
      expect(out[0].share).toBe(70); // 100 − 30
    });

    it('respects a custom horizon', () => {
      const out = accountUpcomingBills('chk', bills, today, 5); // only through 06-16
      expect(out.map((u) => u.bill.id)).toEqual(['b1']);
    });
  });

  describe('assessAccountOverdraft', () => {
    it('projects balance after upcoming bills and flags a real overdraft (buffer 0)', () => {
      const acc = makeAccount({ id: 'chk', type: 'checking', balance: 100 });
      const bills = [makeBill({ account: 'chk', amount: 120, nextDue: '2026-06-15' })];
      const r = assessAccountOverdraft(acc, bills, today);
      expect(r.upcomingTotal).toBe(120);
      expect(r.projectedBalance).toBe(-20);
      expect(r.willOverdraft).toBe(true);
      expect(r.belowThreshold).toBe(true);
      expect(r.shortfall).toBe(20);
    });

    it('flags dipping below the buffer even when still positive', () => {
      // $100 on hand, $60 of bills → $40 projected, but a $60 buffer is set.
      const acc = makeAccount({ id: 'chk', type: 'checking', balance: 100, minBalance: 60 });
      const bills = [makeBill({ account: 'chk', amount: 60, nextDue: '2026-06-15' })];
      const r = assessAccountOverdraft(acc, bills, today);
      expect(r.projectedBalance).toBe(40);
      expect(r.willOverdraft).toBe(false);
      expect(r.belowThreshold).toBe(true);
      expect(r.shortfall).toBe(20); // 60 buffer − 40 projected
    });

    it('is clear when the balance comfortably covers bills + buffer', () => {
      const acc = makeAccount({ id: 'chk', type: 'checking', balance: 500, minBalance: 100 });
      const bills = [makeBill({ account: 'chk', amount: 60, nextDue: '2026-06-15' })];
      const r = assessAccountOverdraft(acc, bills, today);
      expect(r.belowThreshold).toBe(false);
      expect(r.shortfall).toBe(0);
    });

    it('credit card: flags when upcoming bills push the balance past the limit', () => {
      // $900 owed on a $1,000 limit ($100 available), $300 of bills charged to it.
      const card = makeAccount({ id: 'crd', type: 'credit', balance: 900, creditLimit: 1000 });
      const bills = [makeBill({ account: 'crd', amount: 300, nextDue: '2026-06-15' })];
      const r = assessAccountOverdraft(card, bills, today);
      expect(r.kind).toBe('credit');
      expect(r.availableCredit).toBe(100);
      expect(r.projectedBalance).toBe(1200); // projected debt
      expect(r.belowThreshold).toBe(true);
      expect(r.willOverdraft).toBe(true);
      expect(r.shortfall).toBe(200); // 1200 − 1000 limit
    });

    it('credit card: clear when the charges fit under the limit', () => {
      const card = makeAccount({ id: 'crd', type: 'credit', balance: 200, creditLimit: 1000 });
      const bills = [makeBill({ account: 'crd', amount: 300, nextDue: '2026-06-15' })];
      const r = assessAccountOverdraft(card, bills, today);
      expect(r.kind).toBe('credit');
      expect(r.belowThreshold).toBe(false);
      expect(r.shortfall).toBe(0);
    });

    it('credit card: never warns when there are no upcoming charges', () => {
      // Already over the limit, but with nothing due there is nothing to pay —
      // the upcoming-bills alert stays quiet (utilization is a separate nudge).
      const card = makeAccount({ id: 'crd', type: 'credit', balance: 1200, creditLimit: 1000 });
      const r = assessAccountOverdraft(card, [], today);
      expect(r.upcomingTotal).toBe(0);
      expect(r.belowThreshold).toBe(false);
      expect(r.willOverdraft).toBe(false);
    });
  });

  describe('detectOverdraftRisks', () => {
    it('returns only spendable accounts at risk, worst shortfall first', () => {
      const accounts = [
        makeAccount({ id: 'chk', type: 'checking', balance: 100 }),       // short by 50
        makeAccount({ id: 'sav', type: 'savings', balance: 200, minBalance: 300 }), // short by 100
        makeAccount({ id: 'safe', type: 'checking', balance: 9999 }),     // fine
        makeAccount({ id: 'card', type: 'credit', balance: 0 }),          // not guarded
      ];
      const bills = [
        makeBill({ id: 'b1', account: 'chk', amount: 150, nextDue: '2026-06-15' }),
        makeBill({ id: 'b2', account: 'card', amount: 500, nextDue: '2026-06-15' }),
      ];
      const risks = detectOverdraftRisks(accounts, bills, today);
      expect(risks.map((r) => r.account.id)).toEqual(['sav', 'chk']);
    });

    it('includes credit cards with a limit, sorted in by shortfall', () => {
      const accounts = [
        makeAccount({ id: 'chk', type: 'checking', balance: 100 }),                    // short by 50
        makeAccount({ id: 'card', type: 'credit', balance: 900, creditLimit: 1000 }),  // over by 200
        makeAccount({ id: 'nolimit', type: 'credit', balance: 5000 }),                 // no limit → skipped
      ];
      const bills = [
        makeBill({ id: 'b1', account: 'chk', amount: 150, nextDue: '2026-06-15' }),
        makeBill({ id: 'b2', account: 'card', amount: 300, nextDue: '2026-06-15' }),
        makeBill({ id: 'b3', account: 'nolimit', amount: 9999, nextDue: '2026-06-15' }),
      ];
      const risks = detectOverdraftRisks(accounts, bills, today);
      expect(risks.map((r) => r.account.id)).toEqual(['card', 'chk']); // 200 over, then 50 short
    });

    it('returns an empty array when everything is covered', () => {
      const accounts = [makeAccount({ id: 'chk', type: 'checking', balance: 1000 })];
      expect(detectOverdraftRisks(accounts, [], today)).toEqual([]);
    });
  });

  describe('evaluatePaymentSafety', () => {
    const acc = makeAccount({ id: 'chk', type: 'checking', balance: 100, minBalance: 60 });
    const bills = [makeBill({ account: 'chk', amount: 60, nextDue: '2026-06-15' })];

    it('flags overdraft when the payment plus bills exceed the balance', () => {
      const r = evaluatePaymentSafety({ account: acc, amount: 50, bills, today });
      // 100 − 50 payment − 60 bills = −10
      expect(r.projectedBalance).toBe(-10);
      expect(r.status).toBe('overdraft');
    });

    it('flags below-buffer when still positive but under the cushion', () => {
      const noBills = makeAccount({ id: 'chk', type: 'checking', balance: 100, minBalance: 60 });
      const r = evaluatePaymentSafety({ account: noBills, amount: 50, bills: [], today });
      // 100 − 50 = 50 projected, under the 60 buffer
      expect(r.projectedBalance).toBe(50);
      expect(r.status).toBe('belowBuffer');
      expect(r.shortfall).toBe(10);
    });

    it('is ok when the payment leaves enough for bills and buffer', () => {
      const rich = makeAccount({ id: 'chk', type: 'checking', balance: 500, minBalance: 60 });
      const r = evaluatePaymentSafety({ account: rich, amount: 50, bills, today });
      expect(r.status).toBe('ok');
      expect(r.kind).toBe('deposit');
    });

    it('flags over-limit when a charge plus upcoming charges pass a card limit', () => {
      const card = makeAccount({ id: 'cc', type: 'credit', balance: 800, creditLimit: 1000 });
      const cardBills = [makeBill({ account: 'cc', amount: 150, nextDue: '2026-06-15' })];
      const r = evaluatePaymentSafety({ account: card, amount: 100, bills: cardBills, today });
      // 800 owed + 100 charge + 150 upcoming = 1050 projected debt, over the 1000 limit
      expect(r.kind).toBe('credit');
      expect(r.projectedBalance).toBe(1050);
      expect(r.status).toBe('overLimit');
      expect(r.shortfall).toBe(50);
      expect(r.availableCredit).toBe(200);
    });

    it('is ok on a card when the charge stays within the limit', () => {
      const card = makeAccount({ id: 'cc', type: 'credit', balance: 200, creditLimit: 1000 });
      const r = evaluatePaymentSafety({ account: card, amount: 100, bills: [], today });
      expect(r.kind).toBe('credit');
      expect(r.projectedBalance).toBe(300);
      expect(r.status).toBe('ok');
    });

    it('never warns on a card with no limit set (no ceiling to draw)', () => {
      const card = makeAccount({ id: 'cc', type: 'credit', balance: 9000 });
      const r = evaluatePaymentSafety({ account: card, amount: 5000, bills: [], today });
      expect(r.kind).toBe('credit');
      expect(r.status).toBe('ok');
    });
  });

  it('exposes a sane default horizon', () => {
    expect(OVERDRAFT_HORIZON_DAYS).toBeGreaterThan(0);
  });
});

describe('calcSavingsInterest', () => {
  it('compounds the APY down to a monthly rate (not naïve APY/12)', () => {
    // $10,000 at 3.00% APY, credited monthly: (1.03)^(1/12) - 1 ≈ 0.0024663 → $24.66
    expect(calcSavingsInterest(10000, 3)).toBeCloseTo(24.66, 2);
  });

  it('is below the naïve simple-interest figure (compounding effect)', () => {
    const naive = 10000 * (3 / 100) / 12; // 25.00
    expect(calcSavingsInterest(10000, 3)).toBeLessThan(naive);
  });

  it('one year of monthly interest compounds up to ~the stated APY', () => {
    let bal = 10000;
    for (let i = 0; i < 12; i++) bal += calcSavingsInterest(bal, 3);
    // 3.00% APY on 10k ≈ +$300 over the year (± rounding of monthly credits)
    expect(bal).toBeGreaterThan(10298);
    expect(bal).toBeLessThan(10302);
  });

  it('supports other crediting frequencies via periodsPerYear', () => {
    // Annual crediting = the full APY on the balance.
    expect(calcSavingsInterest(10000, 3, 1)).toBeCloseTo(300, 2);
  });

  it('returns 0 for a non-positive balance, rate, or period', () => {
    expect(calcSavingsInterest(0, 3)).toBe(0);
    expect(calcSavingsInterest(-500, 3)).toBe(0);
    expect(calcSavingsInterest(10000, 0)).toBe(0);
    expect(calcSavingsInterest(10000, 3, 0)).toBe(0);
  });

  it('rounds to whole cents', () => {
    const v = calcSavingsInterest(12345.67, 3.25);
    expect(v).toBe(Math.round(v * 100) / 100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 50/30/20 buckets
// ─────────────────────────────────────────────────────────────────────────────

function makePaycheck(o: Partial<PaycheckEntry> & { id: string }): PaycheckEntry {
  return {
    date: '2026-05-01', grossAmount: 0,
    federalWithheld: 0, stateWithheld: 0, localWithheld: 0, ficaWithheld: 0,
    k401: 0, hsa: 0, netAmount: 0, notes: '', gratuityAmount: 0,
    ...o,
  };
}

const BUCKET_ACCOUNTS: Account[] = [
  makeAccount({ id: 'chk', type: 'checking' }),
  makeAccount({ id: 'sav', type: 'savings' }),
  makeAccount({ id: 'inv', type: 'investment' }),
  makeAccount({ id: 'lon', type: 'loan' }),
  makeAccount({ id: 'pool', type: 'savings' }), // a Funding pool held in savings
];

const BUCKET_SETTINGS = {
  categoryBuckets: {} as CategoryBucketMap,
  bucketTargetNeeds: 50, bucketTargetWants: 30, bucketTargetSavings: 20,
};

describe('serializeCategoryBuckets / parseCategoryBuckets', () => {
  it('round-trips a normal map', () => {
    const map: CategoryBucketMap = { Food: 'wants', Grocery: 'needs', Other: 'excluded' };
    expect(parseCategoryBuckets(serializeCategoryBuckets(map))).toEqual(map);
  });

  it('empty string parses to an empty map', () => {
    expect(parseCategoryBuckets('')).toEqual({});
  });

  it('skips an unknown bucket token but keeps the rest', () => {
    expect(parseCategoryBuckets('Food:banana|Grocery:needs')).toEqual({ Grocery: 'needs' });
  });

  it('skips a chunk with no separator', () => {
    expect(parseCategoryBuckets('Food|Grocery:needs')).toEqual({ Grocery: 'needs' });
  });

  it('survives a category containing both separators', () => {
    const map: CategoryBucketMap = { 'Rent|Utils: shared': 'needs' };
    expect(parseCategoryBuckets(serializeCategoryBuckets(map))).toEqual(map);
  });

  it('does not throw on an invalid percent-escape', () => {
    expect(() => parseCategoryBuckets('%E0%A4%A:needs')).not.toThrow();
  });

  it('writes keys in a stable sorted order', () => {
    expect(serializeCategoryBuckets({ Zoo: 'wants', Apple: 'needs' }))
      .toBe('Apple:needs|Zoo:wants');
  });
});

describe('normalizeBucketTargets', () => {
  it('leaves a valid split alone', () => {
    expect(normalizeBucketTargets({ needs: 50, wants: 30, savings: 20 }))
      .toEqual({ needs: 50, wants: 30, savings: 20 });
    expect(normalizeBucketTargets({ needs: 60, wants: 20, savings: 20 }))
      .toEqual({ needs: 60, wants: 20, savings: 20 });
  });

  it('falls back to 50/30/20 when nothing usable is given', () => {
    expect(normalizeBucketTargets({ needs: 0, wants: 0, savings: 0 }))
      .toEqual({ needs: 50, wants: 30, savings: 20 });
    expect(normalizeBucketTargets({ needs: NaN, wants: -5, savings: 0 }))
      .toEqual({ needs: 50, wants: 30, savings: 20 });
  });

  it('rescales any ratio to total exactly 100', () => {
    for (const t of [
      { needs: 1, wants: 1, savings: 1 },
      { needs: 33, wants: 33, savings: 33 },
      { needs: 500, wants: 300, savings: 200 },
      { needs: 7, wants: 2, savings: 1 },
    ]) {
      const r = normalizeBucketTargets(t);
      expect(r.needs + r.wants + r.savings).toBe(100);
    }
  });
});

describe('bucketForCategory', () => {
  it('uses the built-in defaults', () => {
    expect(bucketForCategory('Grocery', {})).toBe('needs');
    expect(bucketForCategory('Food', {})).toBe('wants');
    expect(bucketForCategory('Transfer', {})).toBe('excluded');
  });

  it('returns null for a category nobody has assigned', () => {
    expect(bucketForCategory('Other', {})).toBeNull();
    expect(bucketForCategory('Pet Grooming', {})).toBeNull();
  });

  it('lets a user override beat the built-in default', () => {
    expect(bucketForCategory('Food', { Food: 'needs' })).toBe('needs');
  });
});

describe('calcTakeHomeIncome', () => {
  const income = [makeTx({ id: 'pc1', type: 'income', date: '2026-05-01', amount: 4000 })];

  it('subtracts the set-aside of an id-matched paycheck', () => {
    const p = [makePaycheck({
      id: 'pc1', date: '2026-05-01', grossAmount: 4000, netAmount: 4000,
      federalWithheld: 300, stateWithheld: 100, localWithheld: 50, ficaWithheld: 250,
    })];
    const r = calcTakeHomeIncome(income, p, '2026-05');
    expect(r.income).toBe(4000);
    expect(r.taxSetAside).toBe(700);
    expect(r.takeHome).toBe(3300);
    expect(r.paycheckCount).toBe(1);
  });

  it('take-home equals income when there are no paychecks at all', () => {
    const r = calcTakeHomeIncome(income, [], '2026-05');
    expect(r.takeHome).toBe(4000);
    expect(r.paycheckCount).toBe(0);
  });

  it('returns a clean zero for a month with no income', () => {
    const r = calcTakeHomeIncome([], [], '2026-05');
    expect(r).toMatchObject({ income: 0, taxSetAside: 0, takeHome: 0, hasIncome: false });
    expect(Number.isNaN(r.takeHome)).toBe(false);
  });

  it('never goes negative when the set-aside exceeds recorded income', () => {
    const p = [makePaycheck({ id: 'pc1', date: '2026-05-01', federalWithheld: 9000 })];
    expect(calcTakeHomeIncome(income, p, '2026-05').takeHome).toBe(0);
  });

  it('falls back to date matching when no paycheck matches an income row by id', () => {
    const p = [makePaycheck({ id: 'legacy', date: '2026-05-03', federalWithheld: 500 })];
    expect(calcTakeHomeIncome(income, p, '2026-05').takeHome).toBe(3500);
  });

  it('recovers a legacy paycheck with no explicit withholdings', () => {
    const p = [makePaycheck({ id: 'pc1', date: '2026-05-01', grossAmount: 4000, netAmount: 3200 })];
    expect(calcTakeHomeIncome(income, p, '2026-05').taxSetAside).toBe(800);
  });

  it('ignores paychecks from other months', () => {
    const p = [makePaycheck({ id: 'old', date: '2026-04-01', federalWithheld: 500 })];
    expect(calcTakeHomeIncome(income, p, '2026-05').takeHome).toBe(4000);
  });
});

describe('calcBucketSpend', () => {
  const txs = [
    makeTx({ type: 'expense', date: '2026-05-02', category: 'Grocery', amount: 300 }),
    makeTx({ type: 'expense', date: '2026-05-03', category: 'Bills', amount: 700 }),
    makeTx({ type: 'expense', date: '2026-05-04', category: 'Food', amount: 200 }),
    makeTx({ type: 'expense', date: '2026-05-05', category: 'Shopping', amount: 150 }),
    makeTx({ type: 'expense', date: '2026-05-06', category: 'Other', amount: 80 }),
    makeTx({ type: 'expense', date: '2026-05-07', category: 'Transfer', amount: 500 }),
    makeTx({ type: 'income',  date: '2026-05-08', category: 'Paycheck', amount: 4000 }),
    makeTx({ type: 'expense', date: '2026-04-09', category: 'Grocery', amount: 999 }),
  ];

  it('splits spending into needs, wants and excluded', () => {
    const r = calcBucketSpend(txs, '2026-05', {});
    expect(r.needs).toBe(1000);
    expect(r.wants).toBe(350);
    expect(r.excluded).toBe(500);
  });

  it('surfaces unassigned spend by name instead of guessing a bucket', () => {
    const r = calcBucketSpend(txs, '2026-05', {});
    expect(r.unassigned).toBe(80);
    expect(r.unassignedCategories).toEqual(['Other']);
  });

  it('returns clean zeros for an empty ledger', () => {
    const r = calcBucketSpend([], '2026-05', {});
    expect(r).toMatchObject({ needs: 0, wants: 0, unassigned: 0 });
    expect(r.unassignedCategories).toEqual([]);
  });
});

describe('calcDeliberateSavings', () => {
  const t = (o: Partial<Transaction>) =>
    makeTx({ type: 'transfer', date: '2026-05-10', account: 'chk', category: '', amount: 100, ...o });

  it('counts transfers from a spending account into savings and investment', () => {
    const r = calcDeliberateSavings(
      [t({ toAccount: 'sav', amount: 300 }), t({ toAccount: 'inv', amount: 200 })],
      BUCKET_ACCOUNTS, [], '2026-05',
    );
    expect(r.transfersToSavings).toBe(500);
    expect(r.total).toBe(500);
  });

  it('ignores a savings→savings shuffle (that money was already saved)', () => {
    const r = calcDeliberateSavings(
      [t({ account: 'sav', toAccount: 'inv', amount: 400 })], BUCKET_ACCOUNTS, [], '2026-05',
    );
    expect(r.transfersToSavings).toBe(0);
  });

  it('does NOT count a Funding pool contribution held in a savings account', () => {
    const r = calcDeliberateSavings(
      [t({ toAccount: 'pool', category: 'Funding', amount: 250 })], BUCKET_ACCOUNTS, [], '2026-05',
    );
    expect(r.total).toBe(0);
  });

  it('ignores Loan and Split transfers — that money is not yours or not saving', () => {
    const r = calcDeliberateSavings([
      t({ toAccount: 'sav', category: 'Loan', amount: 100 }),
      t({ toAccount: 'sav', category: 'Split', amount: 100 }),
      t({ toAccount: 'sav', category: 'FundingRepay', amount: 100 }),
    ], BUCKET_ACCOUNTS, [], '2026-05');
    expect(r.total).toBe(0);
  });

  it('ignores an external transfer with no source account', () => {
    const r = calcDeliberateSavings(
      [t({ account: '', toAccount: 'sav', amount: 500 })], BUCKET_ACCOUNTS, [], '2026-05',
    );
    expect(r.transfersToSavings).toBe(0);
  });

  it('reports goal-linked transfers as a subset without inflating the total', () => {
    const goals = [{ id: 'g1', name: 'Trip', targetAmount: 1000, currentAmount: 0,
      deadline: '', icon: '✈️', linkedAccountId: 'sav' }];
    const r = calcDeliberateSavings([t({ toAccount: 'sav', amount: 300 })], BUCKET_ACCOUNTS, goals, '2026-05');
    expect(r.goalLinked).toBe(300);
    expect(r.total).toBe(300); // NOT 600 — the goal is the same money
  });

  it('excludes debt principal while DEBT_PAYOFF_IS_SAVINGS is off', () => {
    const r = calcDeliberateSavings([t({ toAccount: 'lon', amount: 400 })], BUCKET_ACCOUNTS, [], '2026-05');
    expect(DEBT_PAYOFF_IS_SAVINGS).toBe(false);
    expect(r.debtPrincipal).toBe(0);
    expect(r.total).toBe(0);
  });

  it('folds in categories the user mapped to savings', () => {
    const r = calcDeliberateSavings([], BUCKET_ACCOUNTS, [], '2026-05', 250);
    expect(r.total).toBe(250);
  });
});

describe('allocateProportional', () => {
  it('sums to exactly the total despite awkward thirds', () => {
    const r = allocateProportional(1000, [1, 1, 1]);
    expect(r.reduce((s, v) => s + v, 0)).toBe(1000);
  });

  it('splits by weight', () => {
    const r = allocateProportional(100, [1, 2, 3]);
    expect(r.reduce((s, v) => s + v, 0)).toBe(100);
    expect(r[2]).toBe(50);
  });

  it('falls back to an even split when every weight is zero', () => {
    const r = allocateProportional(90, [0, 0, 0]);
    expect(r).toEqual([30, 30, 30]);
  });

  it('gives a single category the whole target', () => {
    expect(allocateProportional(750, [42])).toEqual([750]);
  });

  it('handles degenerate totals', () => {
    expect(allocateProportional(0, [1, 2])).toEqual([0, 0]);
    expect(allocateProportional(-50, [1, 2])).toEqual([0, 0]);
    expect(allocateProportional(100, [])).toEqual([]);
  });

  it('always sums to the total (randomized)', () => {
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < 200; i++) {
      const total = Math.round(rnd() * 900000) / 100;
      const weights = Array.from({ length: 1 + Math.floor(rnd() * 7) }, () => Math.round(rnd() * 10000) / 100);
      const parts = allocateProportional(total, weights);
      const sum = Math.round(parts.reduce((s, v) => s + v, 0) * 100) / 100;
      expect(sum).toBe(roundCents(total));
      expect(parts.every((v) => v >= 0)).toBe(true);
    }
  });
});

describe('buildBucketSnapshot', () => {
  const base = (txs: Transaction[], settings = BUCKET_SETTINGS) => buildBucketSnapshot({
    transactions: txs, accounts: BUCKET_ACCOUNTS, goals: [], paychecks: [],
    monthKey: '2026-05', settings,
  });

  const income3000 = makeTx({ id: 'i1', type: 'income', date: '2026-05-01', amount: 3000 });

  it('splits savings into money moved and money merely unspent', () => {
    const s = base([
      income3000,
      makeTx({ type: 'expense', date: '2026-05-02', category: 'Bills', amount: 1200 }),
      makeTx({ type: 'expense', date: '2026-05-03', category: 'Food', amount: 900 }),
      makeTx({ type: 'transfer', date: '2026-05-04', account: 'chk', toAccount: 'sav', category: '', amount: 500 }),
    ]);
    expect(s.leftover).toBe(900);
    expect(s.savingsMoved).toBe(500);
    expect(s.savingsUnspent).toBe(400);
    expect(s.bars[2].actualAmount).toBe(900); // 500 + 400, not 1400
  });

  it('takes max(moved, leftover) — never their sum', () => {
    const s = base([
      income3000,
      makeTx({ type: 'expense', date: '2026-05-02', category: 'Bills', amount: 1900 }),
      makeTx({ type: 'expense', date: '2026-05-03', category: 'Food', amount: 900 }),
      makeTx({ type: 'transfer', date: '2026-05-04', account: 'chk', toAccount: 'sav', category: '', amount: 500 }),
    ]);
    expect(s.leftover).toBe(200);
    expect(s.savingsUnspent).toBe(0);
    expect(s.bars[2].actualAmount).toBe(500);
  });

  it('handles an over-spent month without NaN', () => {
    const s = base([
      income3000,
      makeTx({ type: 'expense', date: '2026-05-02', category: 'Bills', amount: 2600 }),
      makeTx({ type: 'expense', date: '2026-05-03', category: 'Food', amount: 900 }),
      makeTx({ type: 'transfer', date: '2026-05-04', account: 'chk', toAccount: 'sav', category: '', amount: 100 }),
    ]);
    expect(s.leftover).toBe(-500);
    expect(s.savingsUnspent).toBe(0);
    expect(s.bars[2].actualAmount).toBe(100);
    expect(s.bars.every((b) => Number.isFinite(b.actualPct))).toBe(true);
  });

  it('reports zeroed percentages but real dollars when there is no income', () => {
    const s = base([makeTx({ type: 'expense', date: '2026-05-02', category: 'Bills', amount: 400 })]);
    expect(s.hasIncome).toBe(false);
    expect(s.bars[0].actualAmount).toBe(400);
    expect(s.bars.every((b) => b.actualPct === 0)).toBe(true);
  });

  it('keeps unassigned spend out of the needs and wants bars', () => {
    const s = base([
      income3000,
      makeTx({ type: 'expense', date: '2026-05-02', category: 'Other', amount: 400 }),
    ]);
    expect(s.bars[0].actualAmount).toBe(0);
    expect(s.bars[1].actualAmount).toBe(0);
    expect(s.spend.unassigned).toBe(400);
  });

  it('honours a custom ratio', () => {
    const s = base([income3000], { ...BUCKET_SETTINGS,
      bucketTargetNeeds: 70, bucketTargetWants: 20, bucketTargetSavings: 10 });
    expect(s.bars.map((b) => b.targetAmount)).toEqual([2100, 600, 300]);
  });
});

describe('buildBucketBudgetPlan', () => {
  const today = new Date(2026, 4, 20); // May 2026
  const income = makeTx({ id: 'i1', type: 'income', date: '2026-05-01', amount: 3000 });

  const plan = (o: Partial<Parameters<typeof buildBucketBudgetPlan>[0]> = {}) => buildBucketBudgetPlan({
    budgets: [], transactions: [income], accounts: BUCKET_ACCOUNTS, goals: [], paychecks: [],
    settings: BUCKET_SETTINGS, categories: ['Grocery', 'Bills', 'Food'],
    monthKey: '2026-05', today, ...o,
  });

  it('splits a bucket evenly when there is no history', () => {
    const { allocations } = plan();
    const needs = allocations.filter((a) => a.bucket === 'needs');
    expect(needs.every((a) => a.evenSplit)).toBe(true);
    expect(needs.reduce((s, a) => s + a.suggestedMonthly, 0)).toBe(1500); // 50% of 3000
  });

  it('weights a bucket by the last three months of real spending', () => {
    const history = [
      makeTx({ type: 'expense', date: '2026-04-05', category: 'Grocery', amount: 900 }),
      makeTx({ type: 'expense', date: '2026-04-06', category: 'Bills', amount: 300 }),
    ];
    const { allocations } = plan({ transactions: [income, ...history] });
    const grocery = allocations.find((a) => a.category === 'Grocery')!;
    const bills = allocations.find((a) => a.category === 'Bills')!;
    expect(grocery.suggestedMonthly).toBe(1125); // 75% of the 1500 needs target
    expect(bills.suggestedMonthly).toBe(375);
  });

  it('every bucket sums to exactly its target', () => {
    const { snapshot, allocations } = plan();
    for (const bar of snapshot.bars) {
      const rows = allocations.filter((a) => a.bucket === bar.bucket);
      if (rows.length === 0) continue;
      expect(roundCents(rows.reduce((s, a) => s + a.suggestedMonthly, 0))).toBe(bar.targetAmount);
    }
  });

  it('keeps an existing budget’s period and converts the amount into it', () => {
    const budgets = [{ id: 'b1', category: 'Food', amount: 100, period: 'weekly' as const }];
    const { allocations } = plan({ budgets });
    const food = allocations.find((a) => a.category === 'Food')!;
    expect(food.budgetId).toBe('b1');
    expect(food.period).toBe('weekly');
    expect(food.suggestedAmount).toBe(denormalizeMonthlyBudget(food.suggestedMonthly, 'weekly'));
  });

  it('marks a category with no existing budget as new', () => {
    const grocery = plan().allocations.find((a) => a.category === 'Grocery')!;
    expect(grocery.budgetId).toBeNull();
    expect(grocery.currentMonthly).toBeNull();
  });

  it('does not redistribute an empty bucket into the others', () => {
    // No category is mapped to savings, so its 20% simply goes unallocated.
    const { allocations } = plan();
    expect(allocations.some((a) => a.bucket === 'savings')).toBe(false);
    expect(roundCents(allocations.reduce((s, a) => s + a.suggestedMonthly, 0))).toBe(2400); // 80% of 3000
  });

  it('proposes nothing but zeros when there is no take-home income', () => {
    const { allocations } = plan({ transactions: [] });
    expect(allocations.every((a) => a.suggestedMonthly === 0)).toBe(true);
  });

  it('never proposes a category that was filtered out upstream', () => {
    const { allocations } = plan({ categories: ['Grocery'] });
    expect(allocations.map((a) => a.category)).toEqual(['Grocery']);
  });
});
