'use client';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Plus, Trash2, Target, PiggyBank, Pencil, TrendingUp, TrendingDown, Zap, RefreshCw, AlertCircle, GripVertical } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { HelpHint } from '@/components/ui/HelpHint';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { SwipeToDelete } from '@/components/ui/SwipeToDelete';
import { PlanningSkeleton } from '@/components/ui/Skeleton';
import { formatCurrency, formatDate, generateId } from '@/lib/utils';
import { calcRolloverDeficit, calcEffectiveSpent } from '@/lib/calculations';
import type { Budget, Goal, Transaction, Account } from '@/types';
import { useCategories } from '@/hooks/useCategories';
import { Reorder, useDragControls } from 'framer-motion';
import { useToast } from '@/lib/toast';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { useTranslation } from '@/lib/i18n/context';

const PERIOD_OPTIONS = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'yearly', label: 'Yearly' },
];

function monthlyAmount(b: Budget): number {
  if (b.period === 'monthly') return b.amount;
  if (b.period === 'weekly') return b.amount * 4.33;
  return b.amount / 12;
}

const GOAL_ICONS = ['🎯', '🏠', '🚗', '✈️', '💍', '📱', '🎓', '💻', '🏋️', '🌴', '🐾', '💰', '🆘', '🏦'];

const EMPTY_BUDGET_FORM = {
  category: 'Food',
  amount: '',
  period: 'monthly' as Budget['period'],
};

const EMPTY_GOAL_FORM = {
  name: '',
  targetAmount: '',
  currentAmount: '',
  deadline: '',
  icon: '🎯',
  linkedAccountId: '',
};

export default function PlanningPage() {
  const { t } = useTranslation();
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [rolloverEnabled, setRolloverEnabled] = useState(false);

  const [budgetModalOpen, setBudgetModalOpen] = useState(false);
  const [editBudget, setEditBudget] = useState<Budget | null>(null);
  const [goalModalOpen, setGoalModalOpen] = useState(false);
  const [editGoal, setEditGoal] = useState<Goal | null>(null);

  const [budgetForm, setBudgetForm] = useState(EMPTY_BUDGET_FORM);
  const [goalForm, setGoalForm] = useState(EMPTY_GOAL_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const toast = useToast();
  const { expenseCategories } = useCategories();

  const load = useCallback(async () => {
    setError(false);
    try {
      const [bRes, gRes, tRes, aRes, sRes] = await Promise.all([
        fetch('/api/budgets'), fetch('/api/goals'), fetch('/api/transactions'), fetch('/api/accounts'), fetch('/api/settings'),
      ]);
      if (!bRes.ok || !gRes.ok) throw new Error();
      const [b, g, tx, a, s] = await Promise.all([bRes.json(), gRes.json(), tRes.json(), aRes.json(), sRes.json()]);
      setBudgets(b); setGoals(g); setTransactions(tx); setAccounts(a);
      setRolloverEnabled(s?.budgetRollover === true);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  const { pullY, refreshing } = usePullToRefresh(load);

  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysElapsed = now.getDate();
  const daysLeft = daysInMonth - daysElapsed;

  const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthKey = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, '0')}`;

  const monthExpenses = useMemo(
    () => transactions.filter((tx) => tx.date.startsWith(thisMonth) && tx.type === 'expense'),
    [transactions, thisMonth]
  );
  const prevMonthExpenses = useMemo(
    () => transactions.filter((tx) => tx.date.startsWith(prevMonthKey) && tx.type === 'expense'),
    [transactions, prevMonthKey]
  );

  const categorySpendMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const tx of monthExpenses) map[tx.category] = (map[tx.category] ?? 0) + tx.amount;
    return map;
  }, [monthExpenses]);

  const prevCategorySpendMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const tx of prevMonthExpenses) map[tx.category] = (map[tx.category] ?? 0) + tx.amount;
    return map;
  }, [prevMonthExpenses]);

  // 3-month rolling average: average spend per category across the 3 months prior to current
  const rolling3MonthAvgMap = useMemo(() => {
    const keys = [0, 1, 2].map((offset) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 1 - offset, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    });
    const monthMaps: Record<string, number>[] = keys.map((key) => {
      const map: Record<string, number> = {};
      for (const tx of transactions) {
        if (tx.type === 'expense' && tx.date.startsWith(key)) {
          map[tx.category] = (map[tx.category] ?? 0) + tx.amount;
        }
      }
      return map;
    });
    const allCats = new Set(monthMaps.flatMap((m) => Object.keys(m)));
    const avg: Record<string, number> = {};
    for (const cat of allCats) {
      const values = monthMaps.map((m) => m[cat] ?? 0);
      avg[cat] = values.reduce((s, v) => s + v, 0) / 3;
    }
    return avg;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions]);

  // Total spend this month for category %
  const totalMonthSpend = useMemo(
    () => monthExpenses.reduce((s, tx) => s + tx.amount, 0),
    [monthExpenses]
  );

  function spentForCategory(cat: string): number { return categorySpendMap[cat] ?? 0; }
  function prevSpentForCategory(cat: string): number { return prevCategorySpendMap[cat] ?? 0; }
  function rolling3AvgForCategory(cat: string): number { return rolling3MonthAvgMap[cat] ?? 0; }

  // ─── Budget CRUD ──────────────────────────────────────────────────────────
  function openAddBudget() {
    setEditBudget(null);
    setBudgetForm(EMPTY_BUDGET_FORM);
    setBudgetModalOpen(true);
  }

  function openEditBudgetFn(budget: Budget) {
    setEditBudget(budget);
    setBudgetForm({ category: budget.category, amount: String(budget.amount), period: budget.period });
    setBudgetModalOpen(true);
  }

  async function saveBudget() {
    if (!budgetForm.amount) return;
    setSaving(true);
    const sameCategory = budgets.find((b) => b.category === budgetForm.category && b.id !== editBudget?.id);
    const budget: Budget = {
      id: editBudget?.id ?? sameCategory?.id ?? generateId(),
      category: budgetForm.category,
      amount: parseFloat(budgetForm.amount),
      period: budgetForm.period,
    };
    // Optimistic
    const isExisting = budgets.some((b) => b.id === budget.id);
    setBudgets((prev) => isExisting ? prev.map((b) => b.id === budget.id ? budget : b) : [...prev, budget]);
    setBudgetModalOpen(false);
    setBudgetForm(EMPTY_BUDGET_FORM);
    setEditBudget(null);
    setSaving(false);
    try {
      const res = await fetch('/api/budgets', { method: 'POST', body: JSON.stringify(budget), headers: { 'Content-Type': 'application/json' } });
      if (!res.ok) throw new Error();
      toast(editBudget ? t('planning.toastBudgetUpdated') : t('planning.toastBudgetSaved'), 'success');
    } catch {
      toast(t('planning.toastBudgetFailed'), 'error');
      await load();
    }
  }

  async function deleteBudget(id: string) {
    if (!confirm(t('planning.confirmDeleteBudget'))) return;
    const prev = budgets;
    setBudgets((b) => b.filter((x) => x.id !== id));
    try {
      await fetch('/api/budgets', { method: 'DELETE', body: JSON.stringify({ id }), headers: { 'Content-Type': 'application/json' } });
      toast(t('planning.toastBudgetRemoved'), 'success');
    } catch {
      setBudgets(prev);
      toast(t('planning.toastBudgetDeleteFailed'), 'error');
    }
  }

  // ─── Goal CRUD ────────────────────────────────────────────────────────────
  function openAddGoal() {
    setEditGoal(null);
    setGoalForm(EMPTY_GOAL_FORM);
    setGoalModalOpen(true);
  }

  function openEditGoal(goal: Goal) {
    setEditGoal(goal);
    setGoalForm({
      name: goal.name,
      targetAmount: String(goal.targetAmount),
      currentAmount: String(goal.currentAmount),
      deadline: goal.deadline,
      icon: goal.icon,
      linkedAccountId: goal.linkedAccountId ?? '',
    });
    setGoalModalOpen(true);
  }

  async function saveGoal() {
    if (!goalForm.name || !goalForm.targetAmount) return;
    setSaving(true);
    const goal: Goal = {
      id: editGoal?.id ?? generateId(),
      name: goalForm.name,
      targetAmount: parseFloat(goalForm.targetAmount),
      currentAmount: parseFloat(goalForm.currentAmount) || 0,
      deadline: goalForm.deadline,
      icon: goalForm.icon,
      linkedAccountId: goalForm.linkedAccountId || undefined,
    };
    // Optimistic
    setGoals((prev) => editGoal ? prev.map((g) => g.id === goal.id ? goal : g) : [...prev, goal]);
    setGoalModalOpen(false);
    setGoalForm(EMPTY_GOAL_FORM);
    setEditGoal(null);
    setSaving(false);
    try {
      const res = await fetch('/api/goals', { method: 'POST', body: JSON.stringify(goal), headers: { 'Content-Type': 'application/json' } });
      if (!res.ok) throw new Error();
      toast(editGoal ? t('planning.toastGoalUpdated') : t('planning.toastGoalAdded'), 'success');
    } catch {
      toast(t('planning.toastGoalFailed'), 'error');
      await load();
    }
  }

  async function deleteGoal(id: string) {
    if (!confirm(t('planning.confirmDeleteGoal'))) return;
    const prev = goals;
    setGoals((g) => g.filter((x) => x.id !== id));
    try {
      await fetch('/api/goals', { method: 'DELETE', body: JSON.stringify({ id }), headers: { 'Content-Type': 'application/json' } });
      toast(t('planning.toastGoalRemoved'), 'success');
    } catch {
      setGoals(prev);
      toast(t('planning.toastGoalDeleteFailed'), 'error');
    }
  }

  // ─── Reorder ──────────────────────────────────────────────────────────────
  const budgetReorderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const goalReorderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleBudgetReorder(newOrder: Budget[]) {
    setBudgets(newOrder);
    if (budgetReorderTimer.current) clearTimeout(budgetReorderTimer.current);
    budgetReorderTimer.current = setTimeout(() => {
      fetch('/api/budgets', {
        method: 'PATCH',
        body: JSON.stringify(newOrder.map((b, i) => ({ id: b.id, position: i }))),
        headers: { 'Content-Type': 'application/json' },
      }).catch(() => toast(t('planning.toastOrderFailed'), 'error'));
    }, 600);
  }

  function handleGoalReorder(newOrder: Goal[]) {
    setGoals(newOrder);
    if (goalReorderTimer.current) clearTimeout(goalReorderTimer.current);
    goalReorderTimer.current = setTimeout(() => {
      fetch('/api/goals', {
        method: 'PATCH',
        body: JSON.stringify(newOrder.map((g, i) => ({ id: g.id, position: i }))),
        headers: { 'Content-Type': 'application/json' },
      }).catch(() => toast(t('planning.toastOrderFailed'), 'error'));
    }, 600);
  }

  // ─── Rollover helpers ────────────────────────────────────────────────────
  // The budget cap stays fixed; only last month's overspend rolls into this
  // month's usage. Returns ≥ 0 (a carried-over deficit), 0 when none/disabled.
  function rolledOverDeficit(budget: Budget): number {
    if (!rolloverEnabled) return 0;
    return calcRolloverDeficit(monthlyAmount(budget), prevSpentForCategory(budget.category));
  }

  // ─── Derived stats ───────────────────────────────────────────────────────
  const totalBudgeted = budgets.reduce((s, b) => s + monthlyAmount(b), 0);
  const totalSpent = budgets.reduce((s, b) => s + spentForCategory(b.category), 0);
  const overBudgetCount = budgets.filter(
    (b) => calcEffectiveSpent(spentForCategory(b.category), rolledOverDeficit(b)) > monthlyAmount(b)
  ).length;

  const totalGoalTarget = goals.reduce((s, g) => s + g.targetAmount, 0);
  const totalGoalSaved = goals.reduce((s, g) => {
    const linked = g.linkedAccountId ? accounts.find((a) => a.id === g.linkedAccountId) : null;
    return s + (linked ? linked.balance : g.currentAmount);
  }, 0);

  const savingsAccounts = accounts.filter((a) => a.type === 'savings');
  const budgetedCategories = useMemo(() => new Set(budgets.map((b) => b.category)), [budgets]);
  const unbudgetedWithSpending = useMemo(
    () => expenseCategories.filter((c) => !budgetedCategories.has(c) && (categorySpendMap[c] ?? 0) > 0),
    [expenseCategories, budgetedCategories, categorySpendMap]
  );

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-5 sm:space-y-7 pb-28 md:pb-8">
      {(pullY > 0 || refreshing) && (
        <div className="fixed top-0 left-0 right-0 z-50 flex justify-center pt-safe">
          <div className="flex items-center gap-2 bg-indigo-600 text-white text-xs font-bold px-4 py-2 rounded-full shadow-lg mt-2">
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} style={!refreshing ? { transform: `rotate(${pullY * 180}deg)` } : undefined} />
            {refreshing ? 'Refreshing…' : pullY >= 1 ? 'Release to refresh' : 'Pull to refresh'}
          </div>
        </div>
      )}
      {/* Header */}
      <div className="mb-4 md:mb-6">
        <h1 className="text-2xl md:text-4xl font-extrabold tracking-tight text-slate-900">{t('planning.title')}</h1>
        <p className="text-slate-500 text-sm font-medium mt-1">{t('planning.subtitle', { daysLeft })}</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4 sm:p-5">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">{t('planning.budgetedPerMonth')}</p>
          <p className="text-xl font-extrabold text-slate-900 mt-1.5 tracking-tight">{formatCurrency(totalBudgeted)}</p>
        </Card>
        <Card className="p-4 sm:p-5">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">{t('planning.spent')}</p>
          <p className={`text-xl font-extrabold mt-1.5 tracking-tight ${totalSpent > totalBudgeted ? 'text-rose-600' : 'text-slate-900'}`}>
            {formatCurrency(totalSpent)}
          </p>
        </Card>
        <Card className="p-4 sm:p-5 border-emerald-100">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">{t('planning.goalsSaved')}</p>
          <p className="text-xl font-extrabold text-emerald-600 mt-1.5 tracking-tight">{formatCurrency(totalGoalSaved)}</p>
          <p className="text-xs font-bold text-slate-400 mt-0.5">of {formatCurrency(totalGoalTarget)}</p>
        </Card>
        <Card className={`p-4 sm:p-5 ${overBudgetCount > 0 ? 'border-rose-100' : ''}`}>
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">{t('planning.overBudget')}</p>
          <p className={`text-xl font-extrabold mt-1.5 tracking-tight ${overBudgetCount > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
            {overBudgetCount} <span className="text-sm font-bold opacity-80">{overBudgetCount === 1 ? t('planning.cat') : t('planning.cats')}</span>
          </p>
        </Card>
      </div>

      {loading ? (
        <PlanningSkeleton />
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-14 h-14 rounded-full bg-rose-50 flex items-center justify-center mb-4"><AlertCircle className="w-7 h-7 text-rose-400" /></div>
          <p className="text-slate-700 font-bold text-base mb-1">Couldn&apos;t load planning data</p>
          <p className="text-slate-500 text-sm mb-6">Check your connection and try again.</p>
          <Button variant="secondary" onClick={load}>Try Again</Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-7">
          {/* ── BUDGETS ──────────────────────────────────────────────────── */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900">{t('planning.budgets')}</h2>
                <HelpHint label="What do these badges mean?" align="left">
                  <p className="font-bold mb-2">{t('planning.helpTitle')}</p>
                  <ul className="space-y-1.5 list-none">
                    <li>
                      <span className="font-bold text-amber-300">~$X overshoot</span> — at your current daily pace,
                      you&apos;re projected to spend $X over the budget by month-end.
                    </li>
                    <li>
                      <span className="font-bold text-emerald-300">On pace</span> — pace stays inside the cap if today&apos;s rate holds.
                    </li>
                    <li>
                      <span className="font-bold text-rose-300">$X over</span> — you&apos;ve already exceeded the budget this month.
                    </li>
                    <li>
                      <span className="font-bold text-slate-300">+$X vs last mo</span> — month-over-month change in spending.
                    </li>
                  </ul>
                  <p className="mt-2 text-slate-300">Projection = (spent ÷ days elapsed) × days in month.</p>
                </HelpHint>
              </div>
              <Button size="sm" onClick={openAddBudget} className="shadow-sm">
                <Plus className="w-4 h-4" /> {t('planning.setBudget')}
              </Button>
            </div>

            {budgets.length === 0 ? (
              <Card className="text-center py-12 bg-slate-50 border-slate-100">
                <div className="w-14 h-14 rounded-full bg-white flex items-center justify-center mx-auto mb-4 shadow-sm border border-slate-100">
                  <Target className="w-7 h-7 text-slate-400" />
                </div>
                <p className="text-slate-900 font-bold text-base mb-1">{t('planning.noBudgetsYet')}</p>
                <p className="text-slate-500 font-medium text-sm mb-5">{t('planning.noBudgetsBody')}</p>
                <Button onClick={openAddBudget} className="shadow-sm">{t('planning.setBudget')}</Button>
              </Card>
            ) : (
              <Reorder.Group axis="y" values={budgets} onReorder={handleBudgetReorder} className="space-y-3 list-none">
                {budgets.map((budget) => {
                  const monthly = monthlyAmount(budget);            // fixed cap (no rollover added)
                  const rolledOver = rolledOverDeficit(budget);     // ≥ 0, carried from last month's overspend
                  const spent = spentForCategory(budget.category);  // actual spend this month
                  const usage = calcEffectiveSpent(spent, rolledOver); // bar usage incl. rolled-over deficit
                  const prevSpent = prevSpentForCategory(budget.category);
                  const rollingAvg = rolling3AvgForCategory(budget.category);
                  const categoryPct = totalMonthSpend > 0 && spent > 0 ? (spent / totalMonthSpend) * 100 : 0;
                  const momDiff = spent - prevSpent;
                  const pct = monthly > 0 ? Math.min(100, (usage / monthly) * 100) : 0;
                  const over = usage > monthly;
                  const remaining = monthly - usage;
                  const projected = daysElapsed > 0 ? (spent / daysElapsed) * daysInMonth + rolledOver : null;
                  const willOvershoot = projected !== null && projected > monthly && !over;
                  const overshootAmt = projected ? projected - monthly : 0;

                  return (
                    <BudgetItem
                      key={budget.id}
                      budget={budget}
                      monthly={monthly}
                      rolledOver={rolledOver}
                      spent={spent}
                      usage={usage}
                      prevSpent={prevSpent}
                      rollingAvg={rollingAvg}
                      categoryPct={categoryPct}
                      momDiff={momDiff}
                      pct={pct}
                      over={over}
                      remaining={remaining}
                      willOvershoot={willOvershoot}
                      overshootAmt={overshootAmt}
                      daysLeft={daysLeft}
                      onEdit={openEditBudgetFn}
                      onDelete={deleteBudget}
                    />
                  );
                })}
              </Reorder.Group>
            )}

            {/* Unbudgeted categories with spending */}
            {unbudgetedWithSpending.length > 0 && (
              <div className="mt-2">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 px-1">{t('planning.unbudgetedSpending')}</p>
                <div className="space-y-2">
                  {unbudgetedWithSpending.map((c) => {
                    const spent = spentForCategory(c);
                    return (
                      <div key={c} className="flex items-center justify-between px-4 py-3 rounded-2xl bg-slate-50 border border-dashed border-slate-200">
                        <p className="text-sm font-bold text-slate-700">{c}</p>
                        <div className="flex items-center gap-3">
                          <p className="text-sm font-extrabold text-slate-900">{formatCurrency(spent)}</p>
                          <button
                            onClick={() => { setBudgetForm((f) => ({ ...f, category: c })); setBudgetModalOpen(true); }}
                            className="text-xs font-bold text-indigo-600 hover:text-indigo-500 transition-colors bg-indigo-50 px-3 py-1.5 rounded-lg"
                          >
                            {t('planning.setLimit')}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* ── GOALS ────────────────────────────────────────────────────── */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900">{t('planning.goals')}</h2>
              <Button size="sm" onClick={openAddGoal} className="shadow-sm">
                <Plus className="w-4 h-4" /> {t('planning.addGoal')}
              </Button>
            </div>

            {goals.length === 0 ? (
              <Card className="text-center py-12 bg-slate-50 border-slate-100">
                <div className="w-14 h-14 rounded-full bg-white flex items-center justify-center mx-auto mb-4 shadow-sm border border-slate-100">
                  <PiggyBank className="w-7 h-7 text-slate-400" />
                </div>
                <p className="text-slate-900 font-bold text-base mb-1">{t('planning.noGoalsYet')}</p>
                <p className="text-slate-500 font-medium text-sm mb-5">
                  {t('planning.noGoalsBody')}
                </p>
                <Button onClick={openAddGoal} className="shadow-sm">{t('planning.addFirstGoal')}</Button>
              </Card>
            ) : (
              <Reorder.Group axis="y" values={goals} onReorder={handleGoalReorder} className="space-y-3 list-none">
                {goals.map((goal) => {
                  const linked = goal.linkedAccountId
                    ? accounts.find((a) => a.id === goal.linkedAccountId)
                    : null;
                  const current = linked ? linked.balance : goal.currentAmount;
                  // Raw % can go negative when a linked account is overdrawn — keep the sign for display.
                  const rawPct = goal.targetAmount > 0 ? (current / goal.targetAmount) * 100 : 0;
                  const pct = Math.max(-100, Math.min(100, rawPct));
                  const remaining = goal.targetAmount - current;
                  const achieved = current >= goal.targetAmount;
                  const daysToDeadline = goal.deadline
                    ? Math.ceil((new Date(goal.deadline).getTime() - now.getTime()) / 86400000)
                    : null;
                  const monthsLeft = daysToDeadline && daysToDeadline > 0 ? daysToDeadline / 30.44 : null;
                  const monthlyNeeded = monthsLeft && remaining > 0 ? remaining / monthsLeft : null;
                  const onTrack =
                    achieved ? 'done'
                    : !goal.deadline ? 'nodl'
                    : daysToDeadline && daysToDeadline <= 0 ? 'overdue'
                    : pct >= ((daysInMonth - daysLeft) / daysInMonth) * 100 ? 'ontarget'
                    : 'behind';

                  return (
                    <GoalItem
                      key={goal.id}
                      goal={goal}
                      linked={linked ?? null}
                      current={current}
                      pct={pct}
                      remaining={remaining}
                      achieved={achieved}
                      daysToDeadline={daysToDeadline}
                      monthlyNeeded={monthlyNeeded ?? null}
                      onTrack={onTrack}
                      onEdit={openEditGoal}
                      onDelete={deleteGoal}
                    />
                  );
                })}
              </Reorder.Group>
            )}
          </div>
        </div>
      )}

      {/* ── BUDGET MODAL ──────────────────────────────────────────────────────── */}
      <Modal
        open={budgetModalOpen}
        onClose={() => { setBudgetModalOpen(false); setBudgetForm(EMPTY_BUDGET_FORM); setEditBudget(null); }}
        title={editBudget ? t('planning.editBudget') : t('planning.setBudget')}
      >
        <div className="space-y-5 pb-4">
          <Select
            label={t('common.category')}
            value={budgetForm.category}
            options={expenseCategories.map((c) => ({ value: c, label: c }))}
            onChange={(e) => setBudgetForm((f) => ({ ...f, category: e.target.value }))}
            disabled={!!editBudget}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select
              label={t('common.period')}
              value={budgetForm.period}
              options={PERIOD_OPTIONS}
              onChange={(e) => setBudgetForm((f) => ({ ...f, period: e.target.value as Budget['period'] }))}
            />
            <Input
              label={t('planning.limitPerPeriod', { period: budgetForm.period })}
              type="number"
              min="0"
              step="10"
              placeholder="0.00"
              value={budgetForm.amount}
              onChange={(e) => setBudgetForm((f) => ({ ...f, amount: e.target.value }))}
            />
          </div>
          {!editBudget && budgets.find((b) => b.category === budgetForm.category) && (
            <p className="text-xs font-bold text-amber-600 bg-amber-50 p-3 rounded-xl border border-amber-100">
              {t('planning.replaceBudget', { category: budgetForm.category })}
            </p>
          )}
        </div>
        <div className="sticky bottom-0 bg-white border-t border-slate-100 -mx-6 sm:-mx-8 px-6 sm:px-8 py-4">
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => { setBudgetModalOpen(false); setBudgetForm(EMPTY_BUDGET_FORM); setEditBudget(null); }}>{t('common.cancel')}</Button>
            <Button className="flex-1 shadow-sm" onClick={saveBudget} disabled={saving || !budgetForm.amount}>
              {saving ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── GOAL MODAL ────────────────────────────────────────────────────────── */}
      <Modal
        open={goalModalOpen}
        onClose={() => { setGoalModalOpen(false); setGoalForm(EMPTY_GOAL_FORM); setEditGoal(null); }}
        title={editGoal ? t('planning.editGoal') : t('planning.addGoal')}
      >
        <div className="space-y-5 pb-4">
          <div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">{t('common.icon')}</p>
            <div className="flex gap-2 flex-wrap">
              {GOAL_ICONS.map((ic) => (
                <button
                  key={ic}
                  onClick={() => setGoalForm((f) => ({ ...f, icon: ic }))}
                  className={`text-xl w-11 h-11 rounded-2xl border-2 transition-all flex items-center justify-center hover:scale-110 ${
                    goalForm.icon === ic ? 'border-indigo-500 bg-indigo-50' : 'border-transparent bg-white hover:border-slate-200'
                  }`}
                >
                  {ic}
                </button>
              ))}
            </div>
          </div>
          <Input
            label={t('planning.goalName')}
            placeholder="e.g. Emergency Fund, Down Payment, Vacation"
            value={goalForm.name}
            onChange={(e) => setGoalForm((f) => ({ ...f, name: e.target.value }))}
          />
          <Input
            label={t('planning.targetAmount')}
            type="number"
            min="0"
            step="100"
            placeholder="e.g. 10000"
            value={goalForm.targetAmount}
            onChange={(e) => setGoalForm((f) => ({ ...f, targetAmount: e.target.value }))}
          />
          {savingsAccounts.length > 0 ? (
            <Select
              label={t('planning.linkToSavings')}
              value={goalForm.linkedAccountId}
              options={[
                { value: '', label: t('planning.trackManually') },
                ...savingsAccounts.map((a) => ({ value: a.id, label: `${a.name} (${formatCurrency(a.balance)})` })),
              ]}
              onChange={(e) => setGoalForm((f) => ({ ...f, linkedAccountId: e.target.value }))}
            />
          ) : null}
          {!goalForm.linkedAccountId && (
            <Input
              label={t('planning.currentAmount')}
              type="number"
              min="0"
              step="100"
              placeholder={t('planning.howMuchSaved')}
              value={goalForm.currentAmount}
              onChange={(e) => setGoalForm((f) => ({ ...f, currentAmount: e.target.value }))}
            />
          )}
          {goalForm.linkedAccountId && (
            <p className="text-xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3">
              Progress will automatically use the linked account&apos;s balance.
            </p>
          )}
          <Input
            label={t('planning.targetDate')}
            type="date"
            value={goalForm.deadline}
            onChange={(e) => setGoalForm((f) => ({ ...f, deadline: e.target.value }))}
          />
        </div>
        <div className="sticky bottom-0 bg-white border-t border-slate-100 -mx-6 sm:-mx-8 px-6 sm:px-8 py-4">
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => { setGoalModalOpen(false); setGoalForm(EMPTY_GOAL_FORM); setEditGoal(null); }}>{t('common.cancel')}</Button>
            <Button className="flex-1 shadow-sm" onClick={saveGoal} disabled={saving || !goalForm.name || !goalForm.targetAmount}>
              {saving ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ── Draggable Budget Card ──────────────────────────────────────────────────────
function BudgetItem({ budget, monthly, rolledOver, spent, usage, prevSpent, rollingAvg, categoryPct, momDiff, pct, over, remaining, willOvershoot, overshootAmt, daysLeft, onEdit, onDelete }: {
  budget: Budget;
  monthly: number; rolledOver: number; spent: number; usage: number; prevSpent: number; rollingAvg: number; categoryPct: number; momDiff: number;
  pct: number; over: boolean; remaining: number; willOvershoot: boolean; overshootAmt: number; daysLeft: number;
  onEdit: (b: Budget) => void; onDelete: (id: string) => void;
}) {
  const { t } = useTranslation();
  const controls = useDragControls();
  return (
    <Reorder.Item value={budget} dragListener={false} dragControls={controls} className="list-none">
      <SwipeToDelete onDelete={() => onDelete(budget.id)}>
      <Card className={`transition-all p-4 sm:p-5 ${over ? 'border-rose-100' : willOvershoot ? 'border-amber-100' : ''}`}>
        {/* Header: grip · category · spent/limit · edit */}
        <div className="flex items-center gap-2 mb-2">
          <button
            className="touch-none cursor-grab active:cursor-grabbing text-slate-300 shrink-0 p-1 -ml-1"
            onPointerDown={(e) => { e.stopPropagation(); controls.start(e); }}
            aria-label="Reorder budget"
          >
            <GripVertical className="w-4 h-4" />
          </button>
          <p className="text-sm font-bold text-slate-900 truncate flex-1 min-w-0">{budget.category}</p>
          <p className="text-sm font-extrabold shrink-0 text-right tabular-nums whitespace-nowrap">
            <span className={over ? 'text-rose-600' : 'text-slate-900'}>{formatCurrency(usage)}</span>
            <span className="text-slate-400 font-bold text-xs"> / {formatCurrency(monthly)}</span>
          </p>
          <Button variant="ghost" size="icon" className="text-slate-400 h-8 w-8 rounded-xl shrink-0" onClick={(e) => { e.stopPropagation(); onEdit(budget); }}>
            <Pencil className="w-4 h-4" />
          </Button>
        </div>

        {/* Meta: budget amount per period + rolled-over deficit note, aligned under the name */}
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 mb-3 pl-6 text-xs font-medium text-slate-500">
          <span className="tabular-nums">{formatCurrency(budget.amount)}/{budget.period}</span>
          {budget.period !== 'monthly' && (
            <>
              <span className="text-slate-300">·</span>
              <span className="tabular-nums">{formatCurrency(monthly)}/mo</span>
            </>
          )}
          {rolledOver > 0 && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-bold tabular-nums bg-rose-50 text-rose-600">
              +{formatCurrency(rolledOver)} {t('planning.rolledOver')}
            </span>
          )}
        </div>

        <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${over ? 'bg-rose-500' : pct > 80 ? 'bg-amber-500' : 'bg-indigo-500'}`}
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>

        <div className="flex items-center justify-between mt-2">
          <p className="text-xs font-bold">
            {over
              ? <span className="text-rose-600">{formatCurrency(Math.abs(remaining))} over</span>
              : <span className="text-slate-500">{formatCurrency(remaining)} left · {daysLeft}{t('planning.daysLeft')}</span>
            }
          </p>
          <div className="flex items-center gap-1.5">
            {prevSpent > 0 && Math.abs(momDiff) >= 0.5 && (
              <span className={`text-xs font-bold flex items-center gap-0.5 ${momDiff > 0 ? 'text-rose-500' : 'text-emerald-600'}`}>
                {momDiff > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                {momDiff > 0 ? '+' : ''}{formatCurrency(momDiff)} vs last mo
              </span>
            )}
            {willOvershoot && (
              <span className="text-xs font-bold text-amber-600 flex items-center gap-0.5">
                <TrendingUp className="w-3 h-3" />~{formatCurrency(overshootAmt)} overshoot
              </span>
            )}
            {!over && !willOvershoot && pct > 0 && !prevSpent && (
              <span className="text-xs font-bold text-emerald-600 flex items-center gap-0.5">
                <Zap className="w-3 h-3" />{t('planning.onTrack')}
              </span>
            )}
            <span className="text-xs font-bold text-slate-400">{pct.toFixed(0)}%</span>
          </div>
        </div>

        {/* Category % of total + 3-month rolling avg */}
        {(categoryPct > 0 || rollingAvg > 0) && (
          <div className="flex items-center gap-3 mt-2 pt-2 border-t border-slate-50">
            {categoryPct > 0 && (
              <span className="text-xs font-medium text-slate-400">
                {categoryPct.toFixed(0)}% of spend
              </span>
            )}
            {rollingAvg > 0 && (
              <span className="text-xs font-medium text-slate-400">
                3mo avg: <span className={`font-bold ${spent > rollingAvg * 1.1 ? 'text-rose-500' : spent < rollingAvg * 0.9 ? 'text-emerald-600' : 'text-slate-500'}`}>{formatCurrency(rollingAvg)}</span>
              </span>
            )}
          </div>
        )}
      </Card>
      </SwipeToDelete>
    </Reorder.Item>
  );
}

// ── Draggable Goal Card ────────────────────────────────────────────────────────
function GoalItem({ goal, linked, current, pct, remaining, achieved, daysToDeadline, monthlyNeeded, onTrack, onEdit, onDelete }: {
  goal: Goal; linked: { name: string } | null; current: number; pct: number; remaining: number;
  achieved: boolean; daysToDeadline: number | null; monthlyNeeded: number | null;
  onTrack: string; onEdit: (g: Goal) => void; onDelete: (id: string) => void;
}) {
  const { t } = useTranslation();
  const controls = useDragControls();
  return (
    <Reorder.Item value={goal} dragListener={false} dragControls={controls} className="list-none">
      <Card className={`transition-all p-4 sm:p-5 ${achieved ? 'border-emerald-200 bg-emerald-50/30' : ''}`}>
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <button
              className="touch-none cursor-grab active:cursor-grabbing text-slate-300 shrink-0 p-1 -ml-1"
              onPointerDown={(e) => controls.start(e)}
            >
              <GripVertical className="w-4 h-4" />
            </button>
            <div className="w-11 h-11 rounded-2xl bg-white flex items-center justify-center text-xl shrink-0 shadow-sm border border-slate-100">
              {goal.icon}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-900 flex items-center gap-1.5 flex-wrap">
                {goal.name}
                {achieved && <span className="text-xs text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded-md font-bold">{t('planning.done')}</span>}
                {onTrack === 'behind' && (
                  <span className="text-xs text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded-md font-bold flex items-center gap-0.5">
                    <TrendingDown className="w-2.5 h-2.5" /> {t('planning.behind')}
                  </span>
                )}
                {onTrack === 'ontarget' && !achieved && (
                  <span className="text-xs text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-md font-bold flex items-center gap-0.5">
                    <TrendingUp className="w-2.5 h-2.5" /> {t('planning.onTrack')}
                  </span>
                )}
              </p>
              {linked && <p className="text-xs font-medium text-slate-500 mt-0.5">{t('planning.linked')} {linked.name}</p>}
              {goal.deadline && daysToDeadline !== null && (
                <p className="text-xs font-medium text-slate-500">
                  {daysToDeadline > 0 ? `${daysToDeadline}${t('planning.daysLeft')} · ` : `${t('planning.deadlinePassed')} · `}
                  {formatDate(goal.deadline)}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0 ml-2">
            <Button variant="ghost" size="icon" className="text-slate-400 h-9 w-9 rounded-xl" onClick={() => onEdit(goal)}>
              <Pencil className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="icon" className="text-slate-400 h-9 w-9 rounded-xl" onClick={() => onDelete(goal.id)}>
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div className="w-full bg-slate-100 rounded-full h-2.5 mb-2 overflow-hidden relative">
          {current < 0 ? (
            // Inverted red bar: anchored to the right, width proportional to how far below zero.
            <div
              className="absolute right-0 top-0 h-full rounded-full transition-all duration-700 bg-rose-500"
              style={{ width: `${Math.min(100, Math.abs(pct))}%` }}
              aria-label="Deficit"
            />
          ) : (
            <div
              className={`h-full rounded-full transition-all duration-700 ${achieved ? 'bg-emerald-500' : 'bg-indigo-500'}`}
              style={{ width: `${Math.max(0, pct)}%` }}
            />
          )}
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-baseline gap-1.5">
            <span className={`text-base font-extrabold ${achieved ? 'text-emerald-600' : current < 0 ? 'text-rose-600' : 'text-slate-900'}`}>
              {formatCurrency(current)}
            </span>
            <span className="text-xs font-bold text-slate-400">/ {formatCurrency(goal.targetAmount)}</span>
          </div>
          <span className={`text-xs font-extrabold px-2.5 py-1 rounded-lg ${achieved ? 'bg-emerald-100 text-emerald-700' : current < 0 ? 'bg-rose-50 text-rose-700' : 'bg-indigo-50 text-indigo-700'}`}>
            {pct.toFixed(0)}%
          </span>
        </div>

        {!achieved && remaining > 0 && (
          <div className="flex justify-between items-center mt-2.5 pt-2.5 border-t border-slate-100">
            <p className="text-xs font-bold text-slate-500">{formatCurrency(remaining)} {t('planning.toGo')}</p>
            {monthlyNeeded && (
              <p className="text-xs font-bold text-slate-400">{formatCurrency(monthlyNeeded)}{t('planning.moNeeded')}</p>
            )}
          </div>
        )}
      </Card>
    </Reorder.Item>
  );
}
