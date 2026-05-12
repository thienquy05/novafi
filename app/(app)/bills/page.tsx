'use client';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Plus, Trash2, Calendar, CheckCircle2, Circle, AlarmClock, Pencil, RefreshCw, AlertCircle, Banknote, Repeat } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { BillsSkeleton } from '@/components/ui/Skeleton';
import { FitText } from '@/components/ui/FitText';
import { formatCurrency, formatDate, generateId, today } from '@/lib/utils';
import { billToTransactionDefaults } from '@/lib/calculations';
import type { Bill, Account, PaycheckEntry, Transaction } from '@/types';
import { useCategories } from '@/hooks/useCategories';
import { useToast } from '@/lib/toast';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { useTranslation } from '@/lib/i18n/context';

// ── Subscription detection ─────────────────────────────────────────────────────

type DetectedSub = {
  name: string;
  avgAmount: number;
  monthlyCount: number;
  lastDate: string;
  category: string;
};

function detectSubscriptions(transactions: Transaction[]): DetectedSub[] {
  const expenses = transactions.filter((t) => t.type === 'expense' && t.description);
  const grouped: Record<string, Transaction[]> = {};
  for (const tx of expenses) {
    const key = tx.description.toLowerCase().trim();
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(tx);
  }

  const subs: DetectedSub[] = [];
  for (const [, txs] of Object.entries(grouped)) {
    if (txs.length < 2) continue;
    const months = new Set(txs.map((t) => t.date.slice(0, 7)));
    if (months.size < 2) continue;

    // Check if amounts are similar (within 20% or $5)
    const amounts = txs.map((t) => t.amount);
    const avg = amounts.reduce((s, a) => s + a, 0) / amounts.length;
    const allSimilar = amounts.every((a) => Math.abs(a - avg) <= Math.max(avg * 0.2, 5));
    if (!allSimilar) continue;

    const sorted = [...txs].sort((a, b) => b.date.localeCompare(a.date));
    subs.push({
      name: sorted[0].description,
      avgAmount: avg,
      monthlyCount: months.size,
      lastDate: sorted[0].date,
      category: sorted[0].category,
    });
  }

  return subs.sort((a, b) => b.avgAmount - a.avgAmount);
}

// ── Subscription Tracker component ────────────────────────────────────────────

function SubscriptionTracker({ transactions }: { transactions: Transaction[] }) {
  const { t } = useTranslation();
  const subs = detectSubscriptions(transactions);
  const monthlyTotal = subs.reduce((s, sub) => s + sub.avgAmount, 0);

  if (subs.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
          <Repeat className="w-3.5 h-3.5" /> {t('bills.detectedSubscriptions')}
        </h2>
        <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-lg">
          {formatCurrency(monthlyTotal)}/mo
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {subs.map((sub) => (
          <div key={sub.name} className="flex items-center justify-between p-3.5 rounded-2xl bg-white border border-indigo-100 hover:border-indigo-200 transition-colors">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center shrink-0">
                <Repeat className="w-4 h-4 text-indigo-500" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-900 capitalize">{sub.name}</p>
                <p className="text-xs font-medium text-slate-500 mt-0.5">{sub.category} · {t('bills.moDetected', { n: sub.monthlyCount })}</p>
              </div>
            </div>
            <span className="text-sm font-extrabold text-indigo-600 ml-2 shrink-0">{formatCurrency(sub.avgAmount)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

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
  name: '', amount: '', frequency: 'monthly' as Bill['frequency'],
  nextDue: today(), account: '', category: 'Bills', isActive: true,
};

// ── Recurring template helpers (mirrors transactions page localStorage format) ─
type BillTemplate = { id: string; description: string; amount: number; type: Transaction['type']; category: string; account: string };
const TEMPLATES_KEY = 'nf_tx_templates_v1';
function loadTemplates(): BillTemplate[] {
  try { return JSON.parse(localStorage.getItem(TEMPLATES_KEY) ?? '[]'); } catch { return []; }
}
function saveTemplates(templates: BillTemplate[]) {
  try { localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates)); } catch { /* ignore */ }
}
function upsertTemplate(tpl: BillTemplate) {
  const existing = loadTemplates();
  const updated = [...existing.filter((t) => t.description !== tpl.description || t.category !== tpl.category), tpl];
  saveTemplates(updated);
}

// ── Cashflow Calendar ──────────────────────────────────────────────────────────
function CashflowCalendar({ bills, paychecks, nowMs }: { bills: Bill[]; paychecks: PaycheckEntry[]; nowMs: number }) {
  const { t } = useTranslation();
  const now = new Date(nowMs);
  const year = now.getFullYear();
  const month = now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayDay = now.getDate();
  const firstDayOfMonth = new Date(year, month, 1).getDay();

  // Map day → bills and paychecks
  const dayBills: Record<number, Bill[]> = {};
  const dayPaychecks: Record<number, PaycheckEntry[]> = {};
  let totalBillsAmt = 0;
  let totalPaychecksAmt = 0;

  bills.forEach((bill) => {
    if (!bill.isActive) return;
    const due = new Date(bill.nextDue);
    if (due.getFullYear() === year && due.getMonth() === month) {
      const d = due.getDate();
      if (!dayBills[d]) dayBills[d] = [];
      dayBills[d].push(bill);
      if (d >= todayDay) totalBillsAmt += bill.amount;
    }
  });

  paychecks.forEach((p) => {
    const d = new Date(p.date);
    if (d.getFullYear() === year && d.getMonth() === month) {
      const day = d.getDate();
      if (!dayPaychecks[day]) dayPaychecks[day] = [];
      dayPaychecks[day].push(p);
      totalPaychecksAmt += p.netAmount;
    }
  });

  const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-bold text-slate-900">
            {now.toLocaleString('default', { month: 'long' })} {year} — {t('bills.cashflow')}
          </h2>
          <div className="flex items-center gap-3 mt-1">
            {totalPaychecksAmt > 0 && <span className="text-xs font-bold text-emerald-600">+{formatCurrency(totalPaychecksAmt)} in</span>}
            {totalBillsAmt > 0 && <span className="text-xs font-bold text-rose-600">-{formatCurrency(totalBillsAmt)} out</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />{t('bills.pay')}</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-400 inline-block" />{t('bills.bill')}</span>
        </div>
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-0.5">
        {DAY_LABELS.map((d) => (
          <div key={d} className="text-center text-[10px] font-bold text-slate-400 pb-1.5">{d}</div>
        ))}
        {/* Empty cells for month start */}
        {Array.from({ length: firstDayOfMonth }, (_, i) => (
          <div key={`empty-${i}`} />
        ))}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const hasBill = (dayBills[day] ?? []).length > 0;
          const hasPaycheck = (dayPaychecks[day] ?? []).length > 0;
          const isToday = day === todayDay;
          const isPast = day < todayDay;

          const billNames = (dayBills[day] ?? []).map((b) => `${b.name} ${formatCurrency(b.amount)}`).join(', ');
          const paycheckNames = (dayPaychecks[day] ?? []).map((p) => `+${formatCurrency(p.netAmount)}`).join(', ');
          const title = [billNames, paycheckNames].filter(Boolean).join(' | ');

          return (
            <div key={day} title={title || undefined} className={`relative flex flex-col items-center justify-start pt-1 pb-1.5 rounded-xl min-h-[2.75rem] transition-colors ${isToday ? 'bg-indigo-600' : hasBill || hasPaycheck ? 'bg-slate-50' : ''}`}>
              <span className={`text-xs font-bold leading-none ${isToday ? 'text-white' : isPast ? 'text-slate-300' : 'text-slate-700'}`}>{day}</span>
              <div className="flex gap-0.5 mt-0.5">
                {hasPaycheck && <span className={`w-1.5 h-1.5 rounded-full ${isPast ? 'bg-emerald-200' : 'bg-emerald-400'}`} />}
                {hasBill && <span className={`w-1.5 h-1.5 rounded-full ${isPast ? 'bg-rose-200' : 'bg-rose-400'}`} />}
              </div>
            </div>
          );
        })}
      </div>

      {/* Quick summary legend */}
      {(Object.keys(dayBills).length > 0 || Object.keys(dayPaychecks).length > 0) && (
        <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap gap-2">
          {(() => {
            const sortedNum = ([a]: [string, unknown], [b]: [string, unknown]) => Number(a) - Number(b);
            const monthShort = now.toLocaleString('default', { month: 'short' });
            return (
              <>
                {Object.entries(dayPaychecks).sort(sortedNum).map(([day, pays]) => (
                  <span key={`pay-${day}`} className="text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-lg px-2 py-1 flex items-center gap-1">
                    <Banknote className="w-3 h-3" />
                    {monthShort} {day} · +{formatCurrency(pays.reduce((s, p) => s + p.netAmount, 0))}
                  </span>
                ))}
                {Object.entries(dayBills).sort(sortedNum).map(([day, bs]) => (
                  <span key={`bill-${day}`} className="text-xs font-medium bg-rose-50 text-rose-700 border border-rose-100 rounded-lg px-2 py-1">
                    {monthShort} {day} · {bs.map((b) => b.name).join(', ')}
                  </span>
                ))}
              </>
            );
          })()}
        </div>
      )}
    </Card>
  );
}

// ── Bills Timeline (horizontal scroll strip) ──────────────────────────────────
function BillsTimeline({ bills, nowMs }: { bills: Bill[]; nowMs: number }) {
  const { t } = useTranslation();
  const now = new Date(nowMs);
  const year = now.getFullYear();
  const month = now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayDay = now.getDate();
  const scrollRef = useRef<HTMLDivElement>(null);

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
  const totalThisMonth = Object.values(dayToBills).flat().reduce((s, b) => s + b.amount, 0);

  useEffect(() => {
    if (scrollRef.current) {
      const todayEl = scrollRef.current.querySelector('[data-today="true"]') as HTMLElement | null;
      if (todayEl) todayEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, []);

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-bold text-slate-900">{t('bills.timeline', { month: now.toLocaleString('default', { month: 'long' }) })}</h2>
          {totalThisMonth > 0 && <p className="text-xs font-medium text-slate-500 mt-0.5">{formatCurrency(totalThisMonth)} {t('bills.dueThisMonth')}</p>}
        </div>
        {Object.keys(dayToBills).length > 0 && (
          <span className="text-xs font-bold text-rose-600 bg-rose-50 px-2.5 py-1 rounded-lg">{Object.keys(dayToBills).length} bill{Object.keys(dayToBills).length !== 1 ? 's' : ''}</span>
        )}
      </div>
      <div ref={scrollRef} className="overflow-x-auto hide-scrollbar -mx-1 px-1">
        <div className="flex gap-1.5 pb-1" style={{ minWidth: 'max-content' }}>
          {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
            const billsOnDay = dayToBills[day] ?? [];
            const isToday = day === todayDay;
            const isPast = day < todayDay;
            const hasBills = billsOnDay.length > 0;
            const dayOfWeek = new Date(year, month, day).getDay();
            return (
              <div key={day} data-today={isToday ? 'true' : undefined} className="flex flex-col items-center gap-1 w-9">
                <span className="text-[10px] font-bold text-slate-400">{DAY_LABELS[dayOfWeek]}</span>
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-xs font-extrabold transition-all ${isToday ? 'bg-indigo-600 text-white ring-2 ring-indigo-200' : hasBills ? isPast ? 'bg-slate-100 text-slate-400 ring-1 ring-slate-200' : 'bg-rose-50 text-rose-700 ring-1 ring-rose-200' : isPast ? 'bg-transparent text-slate-300' : 'bg-slate-50 text-slate-500'}`}
                  title={hasBills ? billsOnDay.map((b) => `${b.name} ${formatCurrency(b.amount)}`).join(', ') : undefined}>
                  {day}
                </div>
                <div className="flex gap-0.5 h-2 items-center justify-center">
                  {billsOnDay.slice(0, 3).map((_, idx) => <div key={idx} className={`w-1 h-1 rounded-full ${isPast ? 'bg-slate-300' : 'bg-rose-400'}`} />)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function BillsPage() {
  const { t } = useTranslation();
  const [bills, setBills] = useState<Bill[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [paychecks, setPaychecks] = useState<PaycheckEntry[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [payBill, setPayBill] = useState<Bill | null>(null);
  const [payForm, setPayForm] = useState({ description: '', date: today(), amount: '', account: '', category: '' });
  const [paying, setPaying] = useState(false);
  const toast = useToast();
  const { expenseCategories } = useCategories();

  const FREQUENCY_LABELS: Record<Bill['frequency'], string> = {
    weekly: t('common.weekly'),
    biweekly: t('common.biweekly'),
    monthly: t('common.monthly'),
    quarterly: t('common.quarterly'),
    yearly: t('common.yearly'),
  };

  const load = useCallback(async () => {
    setError(false);
    try {
      const [bRes, aRes, pRes, txRes] = await Promise.all([fetch('/api/bills'), fetch('/api/accounts'), fetch('/api/paychecks'), fetch('/api/transactions')]);
      if (!bRes.ok) throw new Error();
      const [b, a, p, tx] = await Promise.all([bRes.json(), aRes.json(), pRes.ok ? pRes.json() : Promise.resolve([]), txRes.ok ? txRes.json() : Promise.resolve([])]);
      setBills([...b].sort((x: Bill, y: Bill) => x.nextDue.localeCompare(y.nextDue)));
      setAccounts(a);
      setPaychecks(p);
      setTransactions(tx);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  const { pullY, refreshing } = usePullToRefresh(load);

  function openAdd() { setEditingId(null); setForm(EMPTY_FORM); setOpen(true); }
  function openEdit(bill: Bill) {
    setEditingId(bill.id);
    setForm({ name: bill.name, amount: String(bill.amount), frequency: bill.frequency, nextDue: bill.nextDue, account: bill.account ?? '', category: bill.category, isActive: bill.isActive });
    setOpen(true);
  }
  function closeModal() { setOpen(false); setEditingId(null); setForm(EMPTY_FORM); }

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
    // Optimistic update
    if (editingId) {
      setBills((prev) => prev.map((b) => b.id === bill.id ? bill : b).sort((x, y) => x.nextDue.localeCompare(y.nextDue)));
    } else {
      setBills((prev) => [...prev, bill].sort((x, y) => x.nextDue.localeCompare(y.nextDue)));
    }
    closeModal();
    try {
      const res = await fetch('/api/bills', { method: 'POST', body: JSON.stringify(bill), headers: { 'Content-Type': 'application/json' } });
      if (!res.ok) throw new Error();
      toast(editingId ? t('bills.toastUpdated') : t('bills.toastAdded'), 'success');
    } catch {
      toast(t('bills.toastFailedSave'), 'error');
      await load();
    } finally {
      setSaving(false);
    }
  }

  function openPayModal(bill: Bill) {
    const defaults = billToTransactionDefaults(bill, today());
    setPayBill(bill);
    setPayForm({ description: defaults.description, date: defaults.date, amount: String(defaults.amount), account: defaults.account, category: defaults.category });
  }

  function closePayModal() { setPayBill(null); }

  async function advanceBillDue(bill: Bill) {
    const updated: Bill = { ...bill, nextDue: nextDueAfter(bill.nextDue, bill.frequency) };
    setBills((prev) => prev.map((b) => b.id === bill.id ? updated : b).sort((x, y) => x.nextDue.localeCompare(y.nextDue)));
    await fetch('/api/bills', { method: 'POST', body: JSON.stringify(updated), headers: { 'Content-Type': 'application/json' } });
  }

  async function handleRecordPayment() {
    if (!payBill) return;
    setPaying(true);
    const tx: Transaction = {
      id: generateId(),
      date: payForm.date,
      description: payForm.description,
      amount: parseFloat(payForm.amount) || 0,
      type: 'expense',
      category: payForm.category,
      account: payForm.account,
    };
    try {
      const [txRes] = await Promise.all([
        fetch('/api/transactions', { method: 'POST', body: JSON.stringify(tx), headers: { 'Content-Type': 'application/json' } }),
        advanceBillDue(payBill),
      ]);
      if (!txRes.ok) throw new Error();
      upsertTemplate({ id: generateId(), description: tx.description, amount: tx.amount, type: 'expense', category: tx.category, account: tx.account });
      toast(`${payBill.name} paid & transaction recorded`, 'success');
      closePayModal();
    } catch {
      toast(t('bills.toastFailedPayment'), 'error');
    } finally {
      setPaying(false);
    }
  }

  async function handleSkipPayment() {
    if (!payBill) return;
    try {
      await advanceBillDue(payBill);
      toast(`${payBill.name} marked paid`, 'success');
    } catch {
      toast(t('bills.toastFailedMarkPaid'), 'error');
      await load();
    }
    closePayModal();
  }

  async function handleToggle(bill: Bill) {
    const updated = { ...bill, isActive: !bill.isActive };
    setBills((prev) => prev.map((b) => b.id === bill.id ? updated : b));
    try {
      await fetch('/api/bills', { method: 'POST', body: JSON.stringify(updated), headers: { 'Content-Type': 'application/json' } });
      toast(updated.isActive ? t('bills.toastResumed') : t('bills.toastPaused'), 'info');
    } catch {
      toast(t('bills.toastFailedUpdate'), 'error');
      await load();
    }
  }

  async function handleDelete(id: string) {
    if (!confirm(t('bills.confirmDelete'))) return;
    const prev = bills;
    setBills((b) => b.filter((bill) => bill.id !== id));
    try {
      const res = await fetch('/api/bills', { method: 'DELETE', body: JSON.stringify({ id }), headers: { 'Content-Type': 'application/json' } });
      if (!res.ok) throw new Error();
      toast('Bill deleted', 'success');
    } catch {
      setBills(prev);
      toast(t('bills.toastFailedDelete'), 'error');
    }
  }

  const nowMs = useMemo(() => Date.now(), [bills]);
  const activeBills = bills.filter((b) => b.isActive);
  const inactiveBills = bills.filter((b) => !b.isActive);
  const monthlyTotal = activeBills.reduce((s, b) => {
    const m: Record<Bill['frequency'], number> = { weekly: 52 / 12, biweekly: 26 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 };
    return s + b.amount * m[b.frequency];
  }, 0);
  const overdueBills = activeBills.filter((b) => new Date(b.nextDue) < new Date(nowMs));
  const upcomingCount = activeBills.filter((b) => { const diff = (new Date(b.nextDue).getTime() - nowMs) / 86400000; return diff >= 0 && diff <= 14; }).length;

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-5 sm:space-y-7 pb-28 md:pb-8">
      {(pullY > 0 || refreshing) && (
        <div className="fixed top-0 left-0 right-0 z-50 flex justify-center pt-safe">
          <div className="flex items-center gap-2 bg-indigo-600 text-white text-xs font-bold px-4 py-2 rounded-full shadow-lg mt-2">
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} style={!refreshing ? { transform: `rotate(${pullY * 180}deg)` } : undefined} />
            {refreshing ? t('accounts.refreshing') : pullY >= 1 ? t('accounts.releaseToRefresh') : t('accounts.pullToRefresh')}
          </div>
        </div>
      )}

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-4xl font-extrabold tracking-tight text-slate-900">{t('bills.title')}</h1>
          <p className="text-slate-500 text-sm font-medium mt-1">{t('bills.subtitle')}</p>
        </div>
        <Button onClick={openAdd} className="w-full md:w-auto shadow-sm"><Plus className="w-5 h-5" />{t('bills.addBill')}</Button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card className="p-4 sm:p-5 min-w-0">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">{t('common.monthly')}</p>
          <FitText maxSize={24} minSize={13} className="font-extrabold text-slate-900 mt-1.5">{formatCurrency(monthlyTotal)}</FitText>
        </Card>
        <Card className="p-4 sm:p-5 min-w-0">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">{t('bills.active')}</p>
          <FitText maxSize={24} minSize={13} className="font-extrabold text-indigo-600 mt-1.5">{String(activeBills.length)}</FitText>
        </Card>
        <Card className={`p-4 sm:p-5 min-w-0 ${overdueBills.length > 0 ? 'border-rose-200' : upcomingCount > 0 ? 'border-amber-200' : ''}`}>
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">{overdueBills.length > 0 ? t('bills.overdue') : t('bills.dueSoon')}</p>
          <FitText maxSize={24} minSize={13} className={`font-extrabold mt-1.5 ${overdueBills.length > 0 ? 'text-rose-600' : upcomingCount > 0 ? 'text-amber-600' : 'text-slate-400'}`}>{String(overdueBills.length > 0 ? overdueBills.length : upcomingCount)}</FitText>
        </Card>
      </div>

      {overdueBills.length > 0 && (
        <div className="flex items-start gap-4 px-5 py-4 rounded-3xl bg-rose-50 border border-rose-200">
          <div className="p-2 bg-white rounded-xl shrink-0 shadow-sm"><AlarmClock className="w-5 h-5 text-rose-500" /></div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-extrabold text-rose-700">{overdueBills.length} overdue bill{overdueBills.length !== 1 ? 's' : ''}</p>
            <p className="text-xs text-rose-600 mt-0.5 font-medium truncate">{overdueBills.map((b) => b.name).join(' · ')}</p>
          </div>
          <button onClick={openAdd} className="text-xs font-bold text-rose-600 bg-white px-3 py-1.5 rounded-lg border border-rose-200 shrink-0">Mark Paid</button>
        </div>
      )}

      {loading ? (
        <BillsSkeleton />
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-14 h-14 rounded-full bg-rose-50 flex items-center justify-center mb-4"><AlertCircle className="w-7 h-7 text-rose-400" /></div>
          <p className="text-slate-700 font-bold text-base mb-1">Couldn&apos;t load bills</p>
          <p className="text-slate-500 text-sm mb-6">Check your connection and try again.</p>
          <Button variant="secondary" onClick={load}>Try Again</Button>
        </div>
      ) : bills.length === 0 ? (
        <Card className="text-center py-16 bg-slate-50 border-slate-100">
          <div className="w-16 h-16 rounded-full bg-white flex items-center justify-center mx-auto mb-4 shadow-sm border border-slate-100"><Calendar className="w-8 h-8 text-slate-400" /></div>
          <p className="text-slate-900 font-bold text-lg mb-1">No bills added yet</p>
          <p className="text-slate-500 font-medium text-sm mb-6">Add your first recurring bill to start tracking.</p>
          <Button onClick={openAdd} className="shadow-sm">Add Your First Bill</Button>
        </Card>
      ) : (
        <div className="space-y-5">
          {/* Cashflow Calendar */}
          <CashflowCalendar bills={activeBills} paychecks={paychecks} nowMs={nowMs} />

          {/* Subscription Tracker */}
          {transactions.length > 0 && <SubscriptionTracker transactions={transactions} />}

          {/* Horizontal Timeline */}
          <BillsTimeline bills={activeBills} nowMs={nowMs} />

          {activeBills.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider px-1">{t('bills.active')} Bills</h2>
              <div className="space-y-2.5">
                {activeBills.map((bill) => {
                  const dueDate = new Date(bill.nextDue);
                  const daysUntil = Math.ceil((dueDate.getTime() - nowMs) / 86400000);
                  const isOverdue = daysUntil < 0;
                  const isDueSoon = daysUntil >= 0 && daysUntil <= 7;
                  const accountName = accounts.find((a) => a.id === bill.account)?.name ?? bill.account;
                  return (
                    <div key={bill.id} className={`flex flex-col sm:flex-row sm:items-center justify-between p-4 sm:p-5 rounded-3xl bg-white border transition-all duration-200 gap-3 sm:gap-0 ${isOverdue ? 'border-rose-200 bg-rose-50/30' : isDueSoon ? 'border-amber-200 bg-amber-50/30' : 'border-slate-100 hover:border-slate-200 hover:shadow-sm'}`}>
                      <div className="flex items-center gap-4">
                        <div className={`flex items-center justify-center w-12 h-12 rounded-2xl shrink-0 border ${isOverdue ? 'bg-rose-100 border-rose-200' : isDueSoon ? 'bg-amber-100 border-amber-200' : 'bg-slate-100 border-slate-200'}`}>
                          <AlarmClock className={`w-5 h-5 ${isOverdue ? 'text-rose-600' : isDueSoon ? 'text-amber-600' : 'text-slate-500'}`} />
                        </div>
                        <div>
                          <p className="text-base font-bold text-slate-900">{bill.name}</p>
                          <p className="text-xs font-medium text-slate-500 mt-0.5">
                            {FREQUENCY_LABELS[bill.frequency]}{accountName ? ` · ${accountName}` : ''}{' · '}
                            {isOverdue ? <span className="text-rose-600 font-bold">{t('common.overdue')} {Math.abs(daysUntil)}d</span> : daysUntil === 0 ? <span className="text-amber-600 font-bold">Due today</span> : <span>{daysUntil}d ({formatDate(bill.nextDue)})</span>}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center justify-between sm:justify-end w-full sm:w-auto pl-16 sm:pl-0 gap-3 sm:gap-5">
                        <span className={`text-base font-extrabold ${isOverdue ? 'text-rose-600' : 'text-slate-900'}`}>{formatCurrency(bill.amount)}</span>
                        <div className="flex gap-1.5">
                          <button title="Edit" onClick={() => openEdit(bill)} className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-colors"><Pencil className="w-4 h-4" /></button>
                          <button title="Mark paid" onClick={() => openPayModal(bill)} className="p-2 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-colors"><CheckCircle2 className="w-4 h-4" /></button>
                          <button title="Pause" onClick={() => handleToggle(bill)} className="p-2 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-xl transition-colors"><Circle className="w-4 h-4" /></button>
                          <button title="Delete" onClick={() => handleDelete(bill.id)} className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors"><Trash2 className="w-4 h-4" /></button>
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
                      <button title="Edit" onClick={() => openEdit(bill)} className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-colors"><Pencil className="w-4 h-4" /></button>
                      <button title="Resume" onClick={() => handleToggle(bill)} className="p-2 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-colors"><CheckCircle2 className="w-4 h-4" /></button>
                      <button title="Delete" onClick={() => handleDelete(bill.id)} className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Record Payment modal ── */}
      <Modal open={!!payBill} onClose={closePayModal} title={t('bills.recordPayment')}>
        <div className="space-y-5 pb-4">
          <Input label={t('common.description')} value={payForm.description} onChange={(e) => setPayForm((f) => ({ ...f, description: e.target.value }))} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label={t('common.amountUsd')} type="number" min="0" step="0.01" value={payForm.amount} onChange={(e) => setPayForm((f) => ({ ...f, amount: e.target.value }))} />
            <Input label={t('common.date')} type="date" value={payForm.date} onChange={(e) => setPayForm((f) => ({ ...f, date: e.target.value }))} />
          </div>
          {accounts.length > 0 && (
            <Select label={t('bills.payFromAccount')} value={payForm.account} options={[{ value: '', label: t('common.selectPlaceholder') }, ...accounts.map((a) => ({ value: a.id, label: a.name }))]} onChange={(e) => setPayForm((f) => ({ ...f, account: e.target.value }))} />
          )}
          <p className="text-xs text-slate-500 font-medium">This will record an expense transaction and save a recurring template for quick re-use.</p>
        </div>
        <div className="sticky bottom-0 bg-white border-t border-slate-100 -mx-6 sm:-mx-8 px-6 sm:px-8 py-4">
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={handleSkipPayment} disabled={paying}>{t('common.skip')}</Button>
            <Button className="flex-1 shadow-sm" onClick={handleRecordPayment} disabled={paying || !payForm.amount}>
              {paying ? t('bills.recording') : t('bills.recordPayment')}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={open} onClose={closeModal} title={editingId ? t('bills.editBill') : t('bills.addBill')}>
        <div className="space-y-5 pb-4">
          <Input label={t('bills.billName')} placeholder="e.g. Netflix, Rent, Car Insurance" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label={t('common.amountUsd')} type="number" min="0" step="0.01" placeholder="0.00" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
            <Select label={t('common.frequency')} value={form.frequency} options={Object.entries(FREQUENCY_LABELS).map(([value, label]) => ({ value, label }))} onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value as Bill['frequency'] }))} />
          </div>
          <Input label={t('bills.nextDueDate')} type="date" value={form.nextDue} onChange={(e) => setForm((f) => ({ ...f, nextDue: e.target.value }))} />
          <Select label={t('common.category')} value={form.category} options={expenseCategories.map((c) => ({ value: c, label: c }))} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} />
          {accounts.length > 0 && (
            <Select label={t('bills.payFromOptional')} value={form.account} options={[{ value: '', label: t('common.selectPlaceholder') }, ...accounts.map((a) => ({ value: a.id, label: a.name }))]} onChange={(e) => setForm((f) => ({ ...f, account: e.target.value }))} />
          )}
        </div>
        <div className="sticky bottom-0 bg-white border-t border-slate-100 -mx-6 sm:-mx-8 px-6 sm:px-8 py-4">
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={closeModal}>{t('common.cancel')}</Button>
            <Button className="flex-1 shadow-sm" onClick={handleSave} disabled={saving || !form.name || !form.amount}>{saving ? t('common.saving') : editingId ? t('bills.saveChanges') : t('bills.addBillBtn')}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
