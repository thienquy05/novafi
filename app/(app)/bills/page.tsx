'use client';
import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Calendar, CheckCircle2, Circle, AlarmClock } from 'lucide-react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { formatCurrency, formatDate, generateId, today } from '@/lib/utils';
import type { Bill, Account } from '@/types';
import { EXPENSE_CATEGORIES } from '@/types';

const FREQUENCY_LABELS: Record<Bill['frequency'], string> = {
  weekly: 'Weekly',
  biweekly: 'Bi-weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
};

function nextDueAfter(currentDue: string, frequency: Bill['frequency']): string {
  const d = new Date(currentDue);
  switch (frequency) {
    case 'weekly': d.setDate(d.getDate() + 7); break;
    case 'biweekly': d.setDate(d.getDate() + 14); break;
    case 'monthly': d.setMonth(d.getMonth() + 1); break;
    case 'quarterly': d.setMonth(d.getMonth() + 3); break;
    case 'yearly': d.setFullYear(d.getFullYear() + 1); break;
  }
  return d.toISOString().split('T')[0];
}

const EMPTY_FORM = {
  name: '',
  amount: '',
  frequency: 'monthly' as Bill['frequency'],
  nextDue: today(),
  account: '',
  category: 'Bills',
  isActive: true,
};

export default function BillsPage() {
  const [bills, setBills] = useState<Bill[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [bRes, aRes] = await Promise.all([fetch('/api/bills'), fetch('/api/accounts')]);
    const [b, a] = await Promise.all([bRes.json(), aRes.json()]);
    setBills([...b].sort((x: Bill, y: Bill) => x.nextDue.localeCompare(y.nextDue)));
    setAccounts(a);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleSave() {
    if (!form.name || !form.amount) return;
    setSaving(true);
    const bill: Bill = {
      id: generateId(),
      name: form.name,
      amount: parseFloat(form.amount),
      frequency: form.frequency,
      nextDue: form.nextDue,
      account: form.account,
      category: form.category,
      isActive: true,
    };
    await fetch('/api/bills', {
      method: 'POST',
      body: JSON.stringify(bill),
      headers: { 'Content-Type': 'application/json' },
    });
    setOpen(false);
    setForm(EMPTY_FORM);
    await load();
    setSaving(false);
  }

  async function handleMarkPaid(bill: Bill) {
    const updated: Bill = {
      ...bill,
      nextDue: nextDueAfter(bill.nextDue, bill.frequency),
    };
    await fetch('/api/bills', {
      method: 'POST',
      body: JSON.stringify(updated),
      headers: { 'Content-Type': 'application/json' },
    });
    await load();
  }

  async function handleToggle(bill: Bill) {
    await fetch('/api/bills', {
      method: 'POST',
      body: JSON.stringify({ ...bill, isActive: !bill.isActive }),
      headers: { 'Content-Type': 'application/json' },
    });
    await load();
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this bill?')) return;
    await fetch('/api/bills', {
      method: 'DELETE',
      body: JSON.stringify({ id }),
      headers: { 'Content-Type': 'application/json' },
    });
    await load();
  }

  const now = new Date().getTime();
  const activeBills = bills.filter((b) => b.isActive);
  const inactiveBills = bills.filter((b) => !b.isActive);
  const monthlyTotal = activeBills.reduce((s, b) => {
    const multipliers: Record<Bill['frequency'], number> = {
      weekly: 52 / 12,
      biweekly: 26 / 12,
      monthly: 1,
      quarterly: 1 / 3,
      yearly: 1 / 12,
    };
    return s + b.amount * multipliers[b.frequency];
  }, 0);

  const upcomingCount = activeBills.filter((b) => {
    const diff = (new Date(b.nextDue).getTime() - now) / 86400000;
    return diff >= 0 && diff <= 14;
  }).length;

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6 sm:space-y-8 pb-24 md:pb-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-slate-900">Bills</h1>
          <p className="text-slate-500 text-base font-medium mt-1">Track and manage your recurring bills</p>
        </div>
        <Button onClick={() => setOpen(true)} className="w-full md:w-auto shadow-sm hover:shadow-md">
          <Plus className="w-5 h-5" />
          Add Bill
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Monthly Total</p>
          <p className="text-2xl md:text-3xl font-extrabold text-slate-900 mt-2 tracking-tight">{formatCurrency(monthlyTotal)}</p>
        </Card>
        <Card>
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Active Bills</p>
          <p className="text-2xl md:text-3xl font-extrabold text-indigo-600 mt-2 tracking-tight">{activeBills.length}</p>
        </Card>
        <Card className={upcomingCount > 0 ? "border-rose-100 hover:border-rose-200" : ""}>
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Due Soon</p>
          <p className={`text-2xl md:text-3xl font-extrabold mt-2 tracking-tight ${upcomingCount > 0 ? 'text-rose-600' : 'text-slate-400'}`}>
            {upcomingCount}
          </p>
        </Card>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-indigo-600 border-t-transparent" />
        </div>
      ) : bills.length === 0 ? (
        <Card className="text-center py-16 bg-slate-50 border-slate-100">
          <div className="w-16 h-16 rounded-full bg-white flex items-center justify-center mx-auto mb-4 shadow-sm border border-slate-100">
            <Calendar className="w-8 h-8 text-slate-400" />
          </div>
          <p className="text-slate-900 font-bold text-lg mb-1">No bills added yet.</p>
          <p className="text-slate-500 font-medium mb-6">Add your first recurring bill to start tracking.</p>
          <Button onClick={() => setOpen(true)} className="shadow-sm">Add Your First Bill</Button>
        </Card>
      ) : (
        <div className="space-y-8">
          {activeBills.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider px-1">Active Bills</h2>
              <div className="space-y-3">
                {activeBills.map((bill) => {
                  const dueDate = new Date(bill.nextDue);
                  const daysUntil = Math.ceil((dueDate.getTime() - now) / 86400000);
                  const isOverdue = daysUntil < 0;
                  const isDueSoon = daysUntil >= 0 && daysUntil <= 7;
                  const accountName = accounts.find((a) => a.id === bill.account)?.name ?? bill.account;

                  return (
                    <div
                      key={bill.id}
                      className={`flex flex-col sm:flex-row sm:items-center justify-between p-4 sm:p-5 rounded-3xl bg-white border hover:shadow-sm transition-all duration-300 gap-4 sm:gap-0 ${
                        isOverdue ? 'border-rose-200 bg-rose-50/50' : isDueSoon ? 'border-amber-200 bg-amber-50/50' : 'border-slate-100 hover:border-slate-200'
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        <div className={`flex items-center justify-center w-12 h-12 rounded-2xl shrink-0 border ${
                          isOverdue ? 'bg-rose-100 border-rose-200' : isDueSoon ? 'bg-amber-100 border-amber-200' : 'bg-slate-100 border-slate-200'
                        }`}>
                          <AlarmClock className={`w-6 h-6 ${
                            isOverdue ? 'text-rose-600' : isDueSoon ? 'text-amber-600' : 'text-slate-500'
                          }`} />
                        </div>
                        <div>
                          <p className="text-base font-bold text-slate-900">{bill.name}</p>
                          <p className="text-sm font-medium text-slate-500 mt-0.5">
                            {FREQUENCY_LABELS[bill.frequency]}
                            {accountName ? ` · ${accountName}` : ''}
                            {' · '}
                            {isOverdue
                              ? <span className="text-rose-600 font-bold">Overdue by {Math.abs(daysUntil)} day{Math.abs(daysUntil) !== 1 ? 's' : ''}</span>
                              : daysUntil === 0
                              ? <span className="text-amber-600 font-bold">Due today</span>
                              : <span>{`Due in ${daysUntil} day${daysUntil !== 1 ? 's' : ''}`} ({formatDate(bill.nextDue)})</span>
                            }
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center justify-between sm:justify-end w-full sm:w-auto pl-16 sm:pl-0 gap-4 sm:gap-6">
                        <span className={`text-lg font-extrabold ${isOverdue ? 'text-rose-600' : 'text-slate-900'}`}>
                          {formatCurrency(bill.amount)}
                        </span>
                        <div className="flex gap-2">
                          <button
                            title="Mark as paid"
                            onClick={() => handleMarkPaid(bill)}
                            className="p-2 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-colors"
                          >
                            <CheckCircle2 className="w-5 h-5" />
                          </button>
                          <button
                            title="Pause bill"
                            onClick={() => handleToggle(bill)}
                            className="p-2 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-xl transition-colors"
                          >
                            <Circle className="w-5 h-5" />
                          </button>
                          <button
                            title="Delete"
                            onClick={() => handleDelete(bill.id)}
                            className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors"
                          >
                            <Trash2 className="w-5 h-5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {inactiveBills.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider px-1">Paused</h2>
              <div className="space-y-3 opacity-60">
                {inactiveBills.map((bill) => (
                  <div
                    key={bill.id}
                    className="flex items-center justify-between p-4 sm:p-5 rounded-3xl bg-slate-50 border border-slate-200"
                  >
                    <div>
                      <p className="text-base font-bold text-slate-700">{bill.name}</p>
                      <p className="text-sm font-medium text-slate-500 mt-0.5">{FREQUENCY_LABELS[bill.frequency]} · {formatCurrency(bill.amount)}</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        title="Resume bill"
                        onClick={() => handleToggle(bill)}
                        className="p-2 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-colors"
                      >
                        <CheckCircle2 className="w-5 h-5" />
                      </button>
                      <button
                        title="Delete"
                        onClick={() => handleDelete(bill.id)}
                        className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Add Bill Modal */}
      <Modal open={open} onClose={() => { setOpen(false); setForm(EMPTY_FORM); }} title="Add Recurring Bill">
        <div className="space-y-5">
          <Input
            label="Bill Name"
            placeholder="e.g. Netflix, Rent, Car Insurance"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Amount ($)"
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
            />
            <Select
              label="Frequency"
              value={form.frequency}
              options={Object.entries(FREQUENCY_LABELS).map(([value, label]) => ({ value, label }))}
              onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value as Bill['frequency'] }))}
            />
          </div>
          <Input
            label="Next Due Date"
            type="date"
            value={form.nextDue}
            onChange={(e) => setForm((f) => ({ ...f, nextDue: e.target.value }))}
          />
          <Select
            label="Category"
            value={form.category}
            options={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: c }))}
            onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
          />
          {accounts.length > 0 && (
            <Select
              label="Pay from Account (optional)"
              value={form.account}
              options={[
                { value: '', label: '— None —' },
                ...accounts.map((a) => ({ value: a.id, label: a.name })),
              ]}
              onChange={(e) => setForm((f) => ({ ...f, account: e.target.value }))}
            />
          )}
          <div className="flex gap-3 pt-4">
            <Button variant="secondary" className="flex-1" onClick={() => { setOpen(false); setForm(EMPTY_FORM); }}>
              Cancel
            </Button>
            <Button className="flex-1 shadow-sm" onClick={handleSave} disabled={saving || !form.name || !form.amount}>
              {saving ? 'Saving…' : 'Add Bill'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
