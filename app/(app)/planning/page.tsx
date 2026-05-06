'use client';
import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Target, PiggyBank, Pencil } from 'lucide-react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { formatCurrency, formatDate, generateId } from '@/lib/utils';
import { EXPENSE_CATEGORIES } from '@/types';
import type { Budget, Goal, Transaction, Account } from '@/types';

// ─── Budget helpers ────────────────────────────────────────────────────────────
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
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);

  const [budgetModalOpen, setBudgetModalOpen] = useState(false);
  const [goalModalOpen, setGoalModalOpen] = useState(false);
  const [editGoal, setEditGoal] = useState<Goal | null>(null);

  const [budgetForm, setBudgetForm] = useState(EMPTY_BUDGET_FORM);
  const [goalForm, setGoalForm] = useState(EMPTY_GOAL_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [bRes, gRes, tRes, aRes] = await Promise.all([
      fetch('/api/budgets'),
      fetch('/api/goals'),
      fetch('/api/transactions'),
      fetch('/api/accounts'),
    ]);
    const [b, g, t, a] = await Promise.all([bRes.json(), gRes.json(), tRes.json(), aRes.json()]);
    setBudgets(b);
    setGoals(g);
    setTransactions(t);
    setAccounts(a);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // ─── This month spending ──────────────────────────────────────────────────
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const monthExpenses = transactions.filter((t) => t.date.startsWith(thisMonth) && t.type === 'expense');

  function spentForCategory(cat: string): number {
    return monthExpenses.filter((t) => t.category === cat).reduce((s, t) => s + t.amount, 0);
  }

  // ─── Budget CRUD ──────────────────────────────────────────────────────────
  async function saveBudget() {
    if (!budgetForm.amount) return;
    setSaving(true);
    const existing = budgets.find((b) => b.category === budgetForm.category);
    const budget: Budget = {
      id: existing?.id ?? generateId(),
      category: budgetForm.category,
      amount: parseFloat(budgetForm.amount),
      period: budgetForm.period,
    };
    await fetch('/api/budgets', {
      method: 'POST',
      body: JSON.stringify(budget),
      headers: { 'Content-Type': 'application/json' },
    });
    setBudgetModalOpen(false);
    setBudgetForm(EMPTY_BUDGET_FORM);
    await load();
    setSaving(false);
  }

  async function deleteBudget(id: string) {
    if (!confirm('Delete this budget?')) return;
    await fetch('/api/budgets', {
      method: 'DELETE',
      body: JSON.stringify({ id }),
      headers: { 'Content-Type': 'application/json' },
    });
    await load();
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
    await fetch('/api/goals', {
      method: 'POST',
      body: JSON.stringify(goal),
      headers: { 'Content-Type': 'application/json' },
    });
    setGoalModalOpen(false);
    setGoalForm(EMPTY_GOAL_FORM);
    setEditGoal(null);
    await load();
    setSaving(false);
  }

  async function deleteGoal(id: string) {
    if (!confirm('Delete this goal?')) return;
    await fetch('/api/goals', {
      method: 'DELETE',
      body: JSON.stringify({ id }),
      headers: { 'Content-Type': 'application/json' },
    });
    await load();
  }

  // ─── Derived stats for summary ────────────────────────────────────────────
  const totalBudgeted = budgets.reduce((s, b) => s + monthlyAmount(b), 0);
  const totalSpent = budgets.reduce((s, b) => s + spentForCategory(b.category), 0);
  const overBudgetCount = budgets.filter((b) => spentForCategory(b.category) > monthlyAmount(b)).length;

  const totalGoalTarget = goals.reduce((s, g) => s + g.targetAmount, 0);
  const totalGoalSaved = goals.reduce((s, g) => {
    const linked = g.linkedAccountId ? accounts.find((a) => a.id === g.linkedAccountId) : null;
    return s + (linked ? linked.balance : g.currentAmount);
  }, 0);

  const savingsAccounts = accounts.filter((a) => a.type === 'savings');
  const unbudgetedWithSpending = EXPENSE_CATEGORIES.filter(
    (c) => !budgets.some((b) => b.category === c) && monthExpenses.some((t) => t.category === c)
  );

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6 sm:space-y-8 pb-24 md:pb-8">
      {/* Header */}
      <div className="mb-6 md:mb-8">
        <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-slate-900">Planning</h1>
        <p className="text-slate-500 text-base font-medium mt-1">Budgets & savings goals in one place</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Budgeted/mo</p>
          <p className="text-2xl font-extrabold text-slate-900 mt-2 tracking-tight">{formatCurrency(totalBudgeted)}</p>
        </Card>
        <Card>
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Spent This Month</p>
          <p className={`text-2xl font-extrabold mt-2 tracking-tight ${totalSpent > totalBudgeted ? 'text-rose-600' : 'text-slate-400'}`}>
            {formatCurrency(totalSpent)}
          </p>
        </Card>
        <Card className="border-emerald-100 hover:border-emerald-200">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Goals Progress</p>
          <p className="text-2xl font-extrabold text-emerald-600 mt-2 tracking-tight">{formatCurrency(totalGoalSaved)}</p>
          <p className="text-xs font-bold text-slate-400 mt-0.5">of {formatCurrency(totalGoalTarget)}</p>
        </Card>
        <Card className={overBudgetCount > 0 ? "border-rose-100 hover:border-rose-200" : ""}>
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Over Budget</p>
          <p className={`text-2xl font-extrabold mt-2 tracking-tight ${overBudgetCount > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
            {overBudgetCount} <span className="text-sm font-bold opacity-80">{overBudgetCount === 1 ? 'category' : 'categories'}</span>
          </p>
        </Card>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-indigo-600 border-t-transparent" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* ── BUDGETS SECTION ──────────────────────────────────────────── */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <span className="text-2xl">📊</span> Budgets
              </h2>
              <Button size="sm" onClick={() => setBudgetModalOpen(true)} className="shadow-sm">
                <Plus className="w-4 h-4" /> Set Budget
              </Button>
            </div>

            {budgets.length === 0 ? (
              <Card className="text-center py-12 bg-slate-50 border-slate-100">
                <div className="w-16 h-16 rounded-full bg-white flex items-center justify-center mx-auto mb-4 shadow-sm border border-slate-100">
                  <Target className="w-8 h-8 text-slate-400" />
                </div>
                <p className="text-slate-900 font-bold text-lg mb-1">No budgets set yet.</p>
                <p className="text-slate-500 font-medium text-sm mb-6">Set spending limits by category to stay on track.</p>
                <Button onClick={() => setBudgetModalOpen(true)} className="shadow-sm">Set Your First Budget</Button>
              </Card>
            ) : (
              <div className="space-y-4">
                {budgets.map((budget) => {
                  const monthly = monthlyAmount(budget);
                  const spent = spentForCategory(budget.category);
                  const pct = monthly > 0 ? Math.min(100, (spent / monthly) * 100) : 0;
                  const over = spent > monthly;
                  const remaining = monthly - spent;

                  return (
                    <Card key={budget.id} className="hover:shadow-md transition-all">
                      <div className="flex items-start justify-between mb-4">
                        <div>
                          <p className="text-base font-bold text-slate-900">{budget.category}</p>
                          <p className="text-sm font-medium text-slate-500 mt-0.5">
                            {formatCurrency(budget.amount)}/{budget.period}
                            {budget.period !== 'monthly' ? ` · ${formatCurrency(monthly)}/mo` : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <p className={`text-base font-extrabold ${over ? 'text-rose-600' : 'text-slate-900'}`}>
                              {formatCurrency(spent)}
                              <span className="text-slate-400 font-bold text-xs ml-1">/ {formatCurrency(monthly)}</span>
                            </p>
                            <p className={`text-xs font-bold mt-0.5 ${over ? 'text-rose-500' : 'text-slate-400'}`}>
                              {over ? `${formatCurrency(Math.abs(remaining))} over` : `${formatCurrency(remaining)} left`}
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-slate-400 hover:text-rose-600 hover:bg-rose-50 h-10 w-10 rounded-xl"
                            onClick={() => deleteBudget(budget.id)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-2.5">
                        <div
                          className={`h-2.5 rounded-full transition-all duration-500 ${
                            over ? 'bg-rose-500' : pct > 80 ? 'bg-amber-500' : 'bg-indigo-500'
                          }`}
                          style={{ width: `${Math.min(100, pct)}%` }}
                        />
                      </div>
                      <p className="text-xs font-bold text-slate-400 mt-2 text-right">{pct.toFixed(0)}% used</p>
                    </Card>
                  );
                })}
              </div>
            )}

            {/* Unbudgeted categories with spending */}
            {unbudgetedWithSpending.length > 0 && (
              <div className="mt-2">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 px-1">Unbudgeted — spending detected</p>
                <div className="space-y-3">
                  {unbudgetedWithSpending.map((c) => {
                    const spent = spentForCategory(c);
                    return (
                      <div
                        key={c}
                        className="flex items-center justify-between px-5 py-4 rounded-2xl bg-slate-50 border border-dashed border-slate-200"
                      >
                        <p className="text-sm font-bold text-slate-700">{c}</p>
                        <div className="flex items-center gap-4">
                          <p className="text-sm font-extrabold text-slate-900">{formatCurrency(spent)} <span className="text-slate-500 font-medium text-xs">this month</span></p>
                          <button
                            onClick={() => { setBudgetForm((f) => ({ ...f, category: c })); setBudgetModalOpen(true); }}
                            className="text-xs font-bold text-indigo-600 hover:text-indigo-500 transition-colors bg-indigo-50 px-3 py-1.5 rounded-lg"
                          >
                            + Set limit
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* ── GOALS SECTION ────────────────────────────────────────────── */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <span className="text-2xl">🎯</span> Goals
              </h2>
              <Button size="sm" onClick={openAddGoal} className="shadow-sm">
                <Plus className="w-4 h-4" /> Add Goal
              </Button>
            </div>

            {goals.length === 0 ? (
              <Card className="text-center py-12 bg-slate-50 border-slate-100">
                <div className="w-16 h-16 rounded-full bg-white flex items-center justify-center mx-auto mb-4 shadow-sm border border-slate-100">
                  <PiggyBank className="w-8 h-8 text-slate-400" />
                </div>
                <p className="text-slate-900 font-bold text-lg mb-1">No savings goals yet.</p>
                <p className="text-slate-500 font-medium text-sm mb-6">
                  Set a target — emergency fund, vacation, down payment — and track your progress.
                </p>
                <Button onClick={openAddGoal} className="shadow-sm">Add Your First Goal</Button>
              </Card>
            ) : (
              <div className="space-y-4">
                {goals.map((goal) => {
                  const linked = goal.linkedAccountId
                    ? accounts.find((a) => a.id === goal.linkedAccountId)
                    : null;
                  const current = linked ? linked.balance : goal.currentAmount;
                  const pct = goal.targetAmount > 0 ? Math.min(100, (current / goal.targetAmount) * 100) : 0;
                  const remaining = goal.targetAmount - current;
                  const achieved = current >= goal.targetAmount;

                  const daysLeft = goal.deadline
                    ? Math.ceil((new Date(goal.deadline).getTime() - new Date().getTime()) / 86400000)
                    : null;

                  const monthlyNeeded =
                    daysLeft && daysLeft > 0 && remaining > 0
                      ? remaining / (daysLeft / 30.44)
                      : null;

                  return (
                    <Card key={goal.id} className={`hover:shadow-md transition-all ${achieved ? 'border-emerald-200 bg-emerald-50/30' : ''}`}>
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 rounded-2xl bg-white flex items-center justify-center text-2xl shrink-0 shadow-sm border border-slate-100">
                            {goal.icon}
                          </div>
                          <div>
                            <p className="text-base font-bold text-slate-900 flex items-center gap-2">
                              {goal.name}
                              {achieved && <span className="text-xs text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-md font-bold">✓ Achieved!</span>}
                            </p>
                            {linked && (
                              <p className="text-xs font-medium text-slate-500 mt-0.5">Linked: {linked.name}</p>
                            )}
                            {goal.deadline && (
                              <p className="text-xs font-medium text-slate-500 mt-0.5">
                                {daysLeft && daysLeft > 0
                                  ? `${daysLeft} days left · Due ${formatDate(goal.deadline)}`
                                  : `Due ${formatDate(goal.deadline)}`}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 h-10 w-10 rounded-xl"
                            onClick={() => openEditGoal(goal)}
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-slate-400 hover:text-rose-600 hover:bg-rose-50 h-10 w-10 rounded-xl"
                            onClick={() => deleteGoal(goal.id)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>

                      <div className="w-full bg-slate-100 rounded-full h-2.5 mb-3">
                        <div
                          className={`h-2.5 rounded-full transition-all duration-500 ${achieved ? 'bg-emerald-500' : 'bg-indigo-500'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="flex items-baseline gap-2">
                          <span className={`text-lg font-extrabold ${achieved ? 'text-emerald-600' : 'text-slate-900'}`}>
                            {formatCurrency(current)}
                          </span>
                          <span className="text-xs font-bold text-slate-400">/ {formatCurrency(goal.targetAmount)}</span>
                        </div>
                        <div className="text-right">
                          <span className="text-sm font-extrabold text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-lg">{pct.toFixed(0)}%</span>
                        </div>
                      </div>

                      {(!achieved && remaining > 0) && (
                        <div className="flex justify-between items-center mt-3 pt-3 border-t border-slate-100">
                          <p className="text-xs font-bold text-slate-500">{formatCurrency(remaining)} to go</p>
                          {monthlyNeeded && (
                            <p className="text-xs font-bold text-slate-400">{formatCurrency(monthlyNeeded)}/mo needed</p>
                          )}
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── BUDGET MODAL ──────────────────────────────────────────────────────── */}
      <Modal open={budgetModalOpen} onClose={() => { setBudgetModalOpen(false); setBudgetForm(EMPTY_BUDGET_FORM); }} title="Set Budget">
        <div className="space-y-5">
          <Select
            label="Category"
            value={budgetForm.category}
            options={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: c }))}
            onChange={(e) => setBudgetForm((f) => ({ ...f, category: e.target.value }))}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select
              label="Period"
              value={budgetForm.period}
              options={PERIOD_OPTIONS}
              onChange={(e) => setBudgetForm((f) => ({ ...f, period: e.target.value as Budget['period'] }))}
            />
            <Input
              label={`Limit per ${budgetForm.period}`}
              type="number"
              min="0"
              step="10"
              placeholder="0.00"
              value={budgetForm.amount}
              onChange={(e) => setBudgetForm((f) => ({ ...f, amount: e.target.value }))}
            />
          </div>
          {budgets.find((b) => b.category === budgetForm.category) && (
            <p className="text-xs font-bold text-amber-600 bg-amber-50 p-3 rounded-xl border border-amber-100">This replaces the existing budget for {budgetForm.category}.</p>
          )}
          <div className="flex gap-3 pt-4">
            <Button variant="secondary" className="flex-1" onClick={() => { setBudgetModalOpen(false); setBudgetForm(EMPTY_BUDGET_FORM); }}>Cancel</Button>
            <Button className="flex-1 shadow-sm" onClick={saveBudget} disabled={saving || !budgetForm.amount}>
              {saving ? 'Saving…' : 'Save Budget'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── GOAL MODAL ────────────────────────────────────────────────────────── */}
      <Modal open={goalModalOpen} onClose={() => { setGoalModalOpen(false); setGoalForm(EMPTY_GOAL_FORM); setEditGoal(null); }} title={editGoal ? 'Edit Goal' : 'Add Goal'}>
        <div className="space-y-5">
          {/* Icon picker */}
          <div>
            <p className="text-sm font-bold text-slate-700 ml-1 mb-2">Icon</p>
            <div className="flex gap-2 flex-wrap">
              {GOAL_ICONS.map((ic) => (
                <button
                  key={ic}
                  onClick={() => setGoalForm((f) => ({ ...f, icon: ic }))}
                  className={`text-2xl w-12 h-12 rounded-2xl border-2 transition-all flex items-center justify-center shadow-sm hover:scale-110 ${
                    goalForm.icon === ic ? 'border-indigo-500 bg-indigo-50' : 'border-transparent bg-white hover:border-slate-200'
                  }`}
                >
                  {ic}
                </button>
              ))}
            </div>
          </div>

          <Input
            label="Goal Name"
            placeholder="e.g. Emergency Fund, Down Payment, Vacation"
            value={goalForm.name}
            onChange={(e) => setGoalForm((f) => ({ ...f, name: e.target.value }))}
          />
          <Input
            label="Target Amount ($)"
            type="number"
            min="0"
            step="100"
            placeholder="e.g. 10000"
            value={goalForm.targetAmount}
            onChange={(e) => setGoalForm((f) => ({ ...f, targetAmount: e.target.value }))}
          />

          {savingsAccounts.length > 0 ? (
            <Select
              label="Link to Savings Account (optional)"
              value={goalForm.linkedAccountId}
              options={[
                { value: '', label: '— Track manually —' },
                ...savingsAccounts.map((a) => ({ value: a.id, label: `${a.name} (${formatCurrency(a.balance)})` })),
              ]}
              onChange={(e) => setGoalForm((f) => ({ ...f, linkedAccountId: e.target.value }))}
            />
          ) : null}

          {!goalForm.linkedAccountId && (
            <Input
              label="Current Amount ($)"
              type="number"
              min="0"
              step="100"
              placeholder="How much have you saved so far?"
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
            label="Target Date (optional)"
            type="date"
            value={goalForm.deadline}
            onChange={(e) => setGoalForm((f) => ({ ...f, deadline: e.target.value }))}
          />

          <div className="flex gap-3 pt-4">
            <Button variant="secondary" className="flex-1" onClick={() => { setGoalModalOpen(false); setGoalForm(EMPTY_GOAL_FORM); setEditGoal(null); }}>Cancel</Button>
            <Button className="flex-1 shadow-sm" onClick={saveGoal} disabled={saving || !goalForm.name || !goalForm.targetAmount}>
              {saving ? 'Saving…' : editGoal ? 'Update Goal' : 'Add Goal'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
