'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Trash2, Calendar, CheckCircle2, Circle, AlarmClock, Pencil, ChevronRight } from 'lucide-react';
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

// ── Bills Timeline ─────────────────────────────────────────────────────────────
function BillsTimeline({ bills, nowMs }: { bills: Bill[]; nowMs: number }) {
  const now = new Date(nowMs);
  const year = now.getFullYear();
  const month = now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = now.getDate();

  const scrollRef = useRef<HTMLDivElement>(null);

  // Map day → bills due on that day this month
  const dayToBills: Record<number, Bill[]> = {};
  bills.forEach((bill) => {
    if (!bill.isActive) return;
    const due = new Date(bill.nextDue);
    if (due.getMonth() === month && due.getFullYear() === year) {
      const d = due.getDate();
      if (!dayToBills[d]) dayToBills[d] = [];
      dayToBills[d].push(bill);
    }
  });

  const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  // Scroll to today on mount
  useEffect(() => {
    if (scrollRef.current) {
      const todayEl = scrollRef.current.querySelector('[data-today="true"]') as HTMLElement | null;
      if (todayEl) {
        todayEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    }
  }, []);

  const totalThisMonth = Object.values(dayToBills)
    .flat()
    .reduce((s, b) => s + b.amount, 0);

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-bold text-slate-900">
            {now.toLocaleString('default', { month: 'long' })} {year}
          </h2>
          {totalThisMonth > 0 && (
            <p className="text-xs font-medium text-slate-500 mt-0.5">
              {formatCurrency(totalThisMonth)} due this month
            </p>
          )}
        </div>
        {Object.keys(dayToBills).length > 0 && (
          <span className="text-xs font-bold text-rose-600 bg-rose-50 px-2.5 py-1 rounded-lg">
            {Object.keys(dayToBills).length} bill{Object.keys(dayToBills).length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      <div ref={scrollRef} className="overflow-x-auto hide-scrollbar -mx-1 px-1">
        <div className="flex gap-1.5 pb-1" style={{ minWidth: 'max-content' }}>
          {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
            const billsOnDay = dayToBills[day] ?? [];
            const isToday = day === today;
            const isPast = day < today;
            const hasBills = billsOnDay.length > 0;
            const dayOfWeek = new Date(year, month, day).getDay();

            return (
              <div
                key={day}
                data-today={isToday ? 'true' : undefined}
                className="flex flex-col items-center gap-1 w-9"
              >
                <span className="text-[10px] font-bold text-slate-400">{DAY_LABELS[dayOfWeek]}</span>
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center text-xs font-extrabold transition-all ${
                    isToday
                      ? 'bg-indigo-600 text-white ring-2 ring-indigo-200'
                      : hasBills
                      ? isPast
                        ? 'bg-slate-100 text-slate-400 ring-1 ring-slate-200'
                        : 'bg-rose-50 text-rose-700 ring-1 ring-rose-200'
                      : isPast
                      ? 'bg-transparent text-slate-300'
                      : 'bg-slate-50 text-slate-500'
                  }`}
                  title={hasBills ? billsOnDay.map(b => `${b.name} ${formatCurrency(b.amount)}`).join(', ') : undefined}
                >
                  {day}
                </div>
                {/* Bill dots */}
                <div className="flex gap-0.5 h-2 items-center justify-center">
                  {billsOnDay.slice(0, 3).map((_, idx) => (
                    <div
                      key={idx}
                      className={`w-1 h-1 rounded-full ${isPast ? 'bg-slate-300' : 'bg-rose-400'}`}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend: bills due this month */}
      {Object.keys(dayToBills).length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap gap-2">
          {Object.entries(dayToBills).sort(([a], [b]) => Number(a) - Number(b)).map(([day, dayBills]) => (
            <div key={day} className="flex items-center gap-1.5 text-xs font-medium text-slate-600 bg-slate-50 rounded-lg px-2.5 py-1.5 border border-slate-100">
              <span className="font-bold text-slate-800">{now.toLocaleString('default', { month: 'short' })} {day}</span>
              <span>·</span>
              {dayBills.map(b => <span key={b.id}>{b.name}</span>)}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export default function BillsPage() {
  const [bills, setBills] = useState<Bill[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
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

  function openAdd() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setOpen(true);
  }

  function openEdit(bill: Bill) {
    setEditingId(bill.id);
    setForm({
      name: bill.name,
      amount: String(bill.amount),
      frequency: bill.frequency,
      nextDue: bill.nextDue,
      account: bill.account ?? '',
      category: bill.category,
      isActive: bill.isActive,
    });
    setOpen(true);
  }

  function closeModal() {
    setOpen(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  async function handleSave() {
    if (!form.name || !form.amount) return;
    setSaving(true);
    const bill: Bill = {
      id: editingId ?? generateId(),
      name: form.name,
      amount: parseFloat(form.amount),
      frequency: form.frequency,
      nextDue: form.nextDue,
      account: form.account,
      category: form.category,
      isActive: editingId ? form.isActive : true,
    };
    await fetch('/api/bills', {
      method: 'POST',
      body: JSON.stringify(bill),
      headers: { 'Content-Type': 'application/json' },
    });
    closeModal();
    await load();
    setSaving(false);
  }

  async function handleMarkPaid(bill: Bill) {
    const updated: Bill = { ...bill, nextDue: nextDueAfter(bill.nextDue, bill.frequency) };
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

  const nowMs = Date.now();
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

  const overdueBills = activeBills.filter((b) => new Date(b.nextDue) < new Date(nowMs));
  const upcomingCount = activeBills.filter((b) => {
    const diff = (new Date(b.nextDue).getTime() - nowMs) / 86400000;
    return diff >= 0 && diff <= 14;
  }).length;

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-5 sm:space-y-7 pb-28 md:pb-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-4xl font-extrabold tracking-tight text-slate-900">Bills</h1>
          <p className="text-slate-500 text-sm font-medium mt-1">Recurring payments &amp; schedule</p>
        </div>
        <Button onClick={openAdd} className="w-full md:w-auto shadow-sm">
          <Plus className="w-5 h-5" />
          Add Bill
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="p-4 sm:p-5">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Monthly</p>
          <p className="text-xl md:text-2xl font-extrabold text-slate-900 mt-1.5 tracking-tight">{formatCurrency(monthlyTotal)}</p>
        </Card>
        <Card className="p-4 sm:p-5">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Active</p>
          <p className="text-xl md:text-2xl font-extrabold text-indigo-600 mt-1.5 tracking-tight">{activeBills.length}</p>
        </Card>
        <Card className={`p-4 sm:p-5 ${overdueBills.length > 0 ? 'border-rose-200' : upcomingCount > 0 ? 'border-amber-200' : ''}`}>
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">
            {overdueBills.length > 0 ? 'Overdue' : 'Due Soon'}
          </p>
          <p className={`text-xl md:text-2xl font-extrabold mt-1.5 tracking-tight ${
            overdueBills.length > 0 ? 'text-rose-600' : upcomingCount > 0 ? 'text-amber-600' : 'text-slate-400'
          }`}>
            {overdueBills.length > 0 ? overdueBills.length : upcomingCount}
          </p>
        </Card>
      </div>

      {/* Overdue banner */}
      {overdueBills.length > 0 && (
        <div className="flex items-start gap-4 px-5 py-4 rounded-3xl bg-rose-50 border border-rose-200">
          <div className="p-2 bg-white rounded-xl shrink-0 shadow-sm">
            <AlarmClock className="w-5 h-5 text-rose-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-extrabold text-rose-700">
              {overdueBills.length} overdue bill{overdueBills.length !== 1 ? 's' : ''}
            </p>
            <p className="text-xs text-rose-600 mt-0.5 font-medium truncate">
              {overdueBills.map(b => b.name).join(' · ')}
            </p>
          </div>
          <button onClick={openAdd} className="text-xs font-bold text-rose-600 bg-white px-3 py-1.5 rounded-lg border border-rose-200 shrink-0">
            Mark Paid
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-indigo-600 border-t-transparent" />
        </div>
      ) : bills.length === 0 ? (
        <Card className="text-center py-16 bg-slate-50 border-slate-100">
          <div className="w-16 h-16 rounded-full bg-white flex items-center justify-center mx-auto mb-4 shadow-sm border border-slate-100">
            <Calendar className="w-8 h-8 text-slate-400" />
          </div>
          <p className="text-slate-900 font-bold text-lg mb-1">No bills added yet</p>
          <p className="text-slate-500 font-medium text-sm mb-6">Add your first recurring bill to start tracking.</p>
          <Button onClick={openAdd} className="shadow-sm">Add Your First Bill</Button>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Timeline */}
          <BillsTimeline bills={activeBills} nowMs={nowMs} />

          {activeBills.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider px-1">Active Bills</h2>
              <div className="space-y-2.5">
                {activeBills.map((bill) => {
                  const dueDate = new Date(bill.nextDue);
                  const daysUntil = Math.ceil((dueDate.getTime() - nowMs) / 86400000);
                  const isOverdue = daysUntil < 0;
                  const isDueSoon = daysUntil >= 0 && daysUntil <= 7;
                  const accountName = accounts.find((a) => a.id === bill.account)?.name ?? bill.account;

                  return (
                    <div
                      key={bill.id}
                      className={`flex flex-col sm:flex-row sm:items-center justify-between p-4 sm:p-5 rounded-3xl bg-white border transition-all duration-200 gap-3 sm:gap-0 ${
                        isOverdue ? 'border-rose-200 bg-rose-50/30' : isDueSoon ? 'border-amber-200 bg-amber-50/30' : 'border-slate-100 hover:border-slate-200 hover:shadow-sm'
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        <div className={`flex items-center justify-center w-12 h-12 rounded-2xl shrink-0 border ${
                          isOverdue ? 'bg-rose-100 border-rose-200' : isDueSoon ? 'bg-amber-100 border-amber-200' : 'bg-slate-100 border-slate-200'
                        }`}>
                          <AlarmClock className={`w-5 h-5 ${isOverdue ? 'text-rose-600' : isDueSoon ? 'text-amber-600' : 'text-slate-500'}`} />
                        </div>
                        <div>
                          <p className="text-base font-bold text-slate-900">{bill.name}</p>
                          <p className="text-xs font-medium text-slate-500 mt-0.5">
                            {FREQUENCY_LABELS[bill.frequency]}
                            {accountName ? ` · ${accountName}` : ''}
                            {' · '}
                            {isOverdue
                              ? <span className="text-rose-600 font-bold">Overdue {Math.abs(daysUntil)}d</span>
                              : daysUntil === 0
                              ? <span className="text-amber-600 font-bold">Due today</span>
                              : <span>{`${daysUntil}d`} ({formatDate(bill.nextDue)})</span>
                            }
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center justify-between sm:justify-end w-full sm:w-auto pl-16 sm:pl-0 gap-3 sm:gap-5">
                        <span className={`text-base font-extrabold ${isOverdue ? 'text-rose-600' : 'text-slate-900'}`}>
                          {formatCurrency(bill.amount)}
                        </span>
                        <div className="flex gap-1.5">
                          <button title="Edit" onClick={() => openEdit(bill)} className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-colors">
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button title="Mark paid" onClick={() => handleMarkPaid(bill)} className="p-2 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-colors">
                            <CheckCircle2 className="w-4 h-4" />
                          </button>
                          <button title="Pause" onClick={() => handleToggle(bill)} className="p-2 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-xl transition-colors">
                            <Circle className="w-4 h-4" />
                          </button>
                          <button title="Delete" onClick={() => handleDelete(bill.id)} className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors">
                            <Trash2 className="w-4 h-4" />
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
            <div className="space-y-3">
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider px-1">Paused</h2>
              <div className="space-y-2 opacity-60">
                {inactiveBills.map((bill) => (
                  <div key={bill.id} className="flex items-center justify-between p-4 sm:p-5 rounded-3xl bg-slate-50 border border-slate-200">
                    <div>
                      <p className="text-sm font-bold text-slate-700">{bill.name}</p>
                      <p className="text-xs font-medium text-slate-500 mt-0.5">{FREQUENCY_LABELS[bill.frequency]} · {formatCurrency(bill.amount)}</p>
                    </div>
                    <div className="flex gap-1.5">
                      <button title="Edit" onClick={() => openEdit(bill)} className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-colors">
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button title="Resume" onClick={() => handleToggle(bill)} className="p-2 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-colors">
                        <CheckCircle2 className="w-4 h-4" />
                      </button>
                      <button title="Delete" onClick={() => handleDelete(bill.id)} className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Add / Edit Bill Modal */}
      <Modal open={open} onClose={closeModal} title={editingId ? 'Edit Bill' : 'Add Recurring Bill'}>
        <div className="space-y-5">
          <Input
            label="Bill Name"
            placeholder="e.g. Netflix, Rent, Car Insurance"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <div className="grid grid-cols-2 gap-4">
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
            <Button variant="secondary" className="flex-1" onClick={closeModal}>Cancel</Button>
            <Button className="flex-1 shadow-sm" onClick={handleSave} disabled={saving || !form.name || !form.amount}>
              {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Add Bill'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
