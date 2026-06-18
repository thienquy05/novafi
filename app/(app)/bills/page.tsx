'use client';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Plus, Calendar, CheckCircle2, Circle, AlarmClock, Pencil, RefreshCw, AlertCircle, Banknote, Repeat, Users, UserPlus, HandCoins, Check, Trash2, ChevronDown, Gauge, TrendingUp } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { SwipeToDelete } from '@/components/ui/SwipeToDelete';
import { BillsSkeleton } from '@/components/ui/Skeleton';
import { FitText } from '@/components/ui/FitText';
import { Collapsible } from '@/components/ui/Collapsible';
import { ExpandableCard } from '@/components/ui/ExpandableCard';
import { formatCurrency, formatDate, generateId, today } from '@/lib/utils';
import { billToTransactionDefaults, calcPaycheckDeposited, myBillShare, billParticipants, billOthersShare, detectSubscriptions } from '@/lib/calculations';
import { buildLoanPaymentTxs } from '@/lib/loanPayments';
import { buildSplitTx, groupSplits, isOneOffSplit, resolveSplit, splitRemaining } from '@/lib/splits';
import type { Bill, Account, PaycheckEntry, Transaction, Contact, Split, BillSplitParticipant } from '@/types';
import { useCategories } from '@/hooks/useCategories';
import { useToast } from '@/lib/toast';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { peekCache, ensureResources } from '@/lib/client/store';
import { useTranslation } from '@/lib/i18n/context';

// Subscription detection (incl. price-creep + ghost flags) lives in the tested
// calc layer — see detectSubscriptions in lib/calculations.

// ── Subscription Tracker component ────────────────────────────────────────────

// Deterministic tinted avatar per merchant — a stable color picked from the
// merchant name so each subscription reads as a distinct "brand" tile instead
// of a row of identical repeat glyphs.
const SUB_AVATAR_COLORS = [
  'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
  'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300',
  'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/40 dark:text-fuchsia-300',
];
function subAvatar(merchant: string): { initial: string; color: string } {
  let hash = 0;
  for (let i = 0; i < merchant.length; i++) hash = (hash * 31 + merchant.charCodeAt(i)) | 0;
  const initial = merchant.trim().charAt(0).toUpperCase() || '?';
  return { initial, color: SUB_AVATAR_COLORS[Math.abs(hash) % SUB_AVATAR_COLORS.length] };
}

function SubscriptionTracker({ transactions }: { transactions: Transaction[] }) {
  const { t } = useTranslation();
  const subs = useMemo(() => detectSubscriptions(transactions, new Date()), [transactions]);
  // Active first (then ghosts); each group keeps its by-spend ordering.
  const ordered = useMemo(() => [...subs].sort((a, b) => Number(b.isActive) - Number(a.isActive)), [subs]);
  // Active subscriptions drive the "what you're burning monthly" headline.
  const activeSubs = subs.filter((s) => s.isActive);
  const monthlyTotal = activeSubs.reduce((s, sub) => s + sub.monthlyAmount, 0);

  if (subs.length === 0) return null;

  return (
    <ExpandableCard
      icon={<Repeat className="w-5 h-5" />}
      iconWrapClass="bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400"
      title={t('bills.detectedSubscriptions')}
      subtitle={t('bills.subSummary', { count: activeSubs.length, amount: formatCurrency(monthlyTotal * 12) })}
      badge={(
        <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 px-2.5 py-1 rounded-lg">
          {formatCurrency(monthlyTotal)}/mo
        </span>
      )}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {ordered.map((sub) => {
          const { initial, color } = subAvatar(sub.merchant);
          return (
            <div key={sub.merchant} className={`group relative flex items-center justify-between gap-2 p-3.5 rounded-2xl bg-white dark:bg-slate-800 border transition-all ${sub.isActive ? 'border-slate-100 dark:border-slate-700/60 hover:border-indigo-200 dark:hover:border-indigo-700/60 hover:shadow-sm' : 'border-slate-200 dark:border-slate-700 opacity-75 hover:opacity-100'}`}>
              <div className="flex items-center gap-3 min-w-0">
                <div className={`relative w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-sm font-extrabold ${sub.isActive ? color : 'bg-slate-100 dark:bg-slate-700/60 text-slate-400 dark:text-slate-500'}`}>
                  {initial}
                  {sub.isActive && (
                    <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-white dark:bg-slate-800 flex items-center justify-center">
                      <Repeat className="w-2.5 h-2.5 text-indigo-500 dark:text-indigo-400" />
                    </span>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-900 dark:text-slate-100 capitalize truncate">{sub.merchant}</p>
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5 truncate">{sub.category} · {t('bills.moDetected', { n: sub.months })}</p>
                  <div className="flex flex-wrap items-center gap-1.5 mt-1">
                    {sub.hasPriceCreep && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold px-1.5 py-0.5 rounded-md bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
                        <TrendingUp className="w-3 h-3" />
                        {t('bills.subPriceCreep', { amount: formatCurrency(sub.priceIncrease), pct: sub.priceIncreasePct ?? 0 })}
                      </span>
                    )}
                    {!sub.isActive && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400">
                        {t('bills.subGhost')}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className={`text-sm font-extrabold ${sub.isActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400 dark:text-slate-500'}`}>{formatCurrency(sub.monthlyAmount)}</p>
                <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500 mt-0.5">{t('bills.subPerYear', { amount: formatCurrency(sub.monthlyAmount * 12) })}</p>
              </div>
            </div>
          );
        })}
      </div>
    </ExpandableCard>
  );
}

function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function nextDueAfter(currentDue: string, frequency: Bill['frequency']): string {
  const d = parseLocalDate(currentDue);
  switch (frequency) {
    case 'weekly': d.setDate(d.getDate() + 7); break;
    case 'biweekly': d.setDate(d.getDate() + 14); break;
    case 'monthly': d.setMonth(d.getMonth() + 1); break;
    case 'quarterly': d.setMonth(d.getMonth() + 3); break;
    case 'yearly': d.setFullYear(d.getFullYear() + 1); break;
    case 'once': break; // one-time charge: no next occurrence (the bill is deactivated on pay)
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const EMPTY_FORM = {
  name: '', amount: '', frequency: 'monthly' as Bill['frequency'],
  nextDue: today(), account: '', category: 'Bills', isActive: true,
  splitEnabled: false, variable: false, loanAccountId: '',
};

// Sentinel option value that opens the inline "add new contact" input.
const NEW_CONTACT = '__new__';

// One editable split row in the bill form. Mirrors the Transactions page split
// model: a contact + their share (blank = auto-divide the remainder). "Me" is
// never a row — your share is whatever's left.
type SplitParticipant = { key: string; contactId: string; amount: string; newName: string };
function emptyParticipant(): SplitParticipant {
  return { key: generateId(), contactId: '', amount: '', newName: '' };
}
function roundCents(n: number): number {
  return Math.round(n * 100) / 100;
}

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
    const due = parseLocalDate(bill.nextDue);
    if (due.getFullYear() === year && due.getMonth() === month) {
      const d = due.getDate();
      if (!dayBills[d]) dayBills[d] = [];
      dayBills[d].push(bill);
      if (d >= todayDay) totalBillsAmt += myBillShare(bill);
    }
  });

  paychecks.forEach((p) => {
    const d = parseLocalDate(p.date);
    if (d.getFullYear() === year && d.getMonth() === month) {
      const day = d.getDate();
      if (!dayPaychecks[day]) dayPaychecks[day] = [];
      dayPaychecks[day].push(p);
      // Deposited income = gross wages + tips (the full amount; tax is set aside, not withheld)
      totalPaychecksAmt += calcPaycheckDeposited(p);
    }
  });

  const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
            {now.toLocaleString('default', { month: 'long' })} {year} — {t('bills.cashflow')}
          </h2>
          <div className="flex items-center gap-3 mt-1">
            {totalPaychecksAmt > 0 && <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">+{formatCurrency(totalPaychecksAmt)} in</span>}
            {totalBillsAmt > 0 && <span className="text-xs font-bold text-rose-600 dark:text-rose-400">-{formatCurrency(totalBillsAmt)} out</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />{t('bills.pay')}</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-400 inline-block" />{t('bills.bill')}</span>
        </div>
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-0.5">
        {DAY_LABELS.map((d) => (
          <div key={d} className="text-center text-[10px] font-bold text-slate-400 dark:text-slate-500 pb-1.5">{d}</div>
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

          const billNames = (dayBills[day] ?? []).map((b) => `${b.name} ${formatCurrency(myBillShare(b))}`).join(', ');
          const paycheckNames = (dayPaychecks[day] ?? []).map((p) => `+${formatCurrency(calcPaycheckDeposited(p))}`).join(', ');
          const title = [billNames, paycheckNames].filter(Boolean).join(' | ');

          return (
            <div key={day} title={title || undefined} className={`relative flex flex-col items-center justify-start pt-1 pb-1.5 rounded-xl min-h-[2.75rem] transition-colors ${isToday ? 'bg-indigo-600' : hasBill || hasPaycheck ? 'bg-slate-50 dark:bg-slate-700/50' : ''}`}>
              <span className={`text-xs font-bold leading-none ${isToday ? 'text-white' : isPast ? 'text-slate-300 dark:text-slate-600' : 'text-slate-700 dark:text-slate-300'}`}>{day}</span>
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
        <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700/60 flex flex-wrap gap-2">
          {(() => {
            const sortedNum = ([a]: [string, unknown], [b]: [string, unknown]) => Number(a) - Number(b);
            const monthShort = now.toLocaleString('default', { month: 'short' });
            return (
              <>
                {Object.entries(dayPaychecks).sort(sortedNum).map(([day, pays]) => (
                  <span key={`pay-${day}`} className="text-xs font-medium bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border border-emerald-100 dark:border-emerald-800/50 rounded-lg px-2 py-1 flex items-center gap-1">
                    <Banknote className="w-3 h-3" />
                    {monthShort} {day} · +{formatCurrency(pays.reduce((s, p) => s + calcPaycheckDeposited(p), 0))}
                  </span>
                ))}
                {Object.entries(dayBills).sort(sortedNum).map(([day, bs]) => (
                  <span key={`bill-${day}`} className="text-xs font-medium bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 border border-rose-100 dark:border-rose-800/50 rounded-lg px-2 py-1">
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
    const due = parseLocalDate(bill.nextDue);
    if (due.getMonth() === month && due.getFullYear() === year) {
      const d = due.getDate();
      if (!dayToBills[d]) dayToBills[d] = [];
      dayToBills[d].push(bill);
    }
  });

  const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  const totalThisMonth = Object.values(dayToBills).flat().reduce((s, b) => s + myBillShare(b), 0);

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
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">{t('bills.timeline', { month: now.toLocaleString('default', { month: 'long' }) })}</h2>
          {totalThisMonth > 0 && <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5">{formatCurrency(totalThisMonth)} {t('bills.dueThisMonth')}</p>}
        </div>
        {Object.keys(dayToBills).length > 0 && (
          <span className="text-xs font-bold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/30 px-2.5 py-1 rounded-lg">{Object.keys(dayToBills).length} bill{Object.keys(dayToBills).length !== 1 ? 's' : ''}</span>
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
                <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500">{DAY_LABELS[dayOfWeek]}</span>
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-xs font-extrabold transition-all ${isToday ? 'bg-indigo-600 text-white ring-2 ring-indigo-200' : hasBills ? isPast ? 'bg-slate-100 dark:bg-slate-700 text-slate-400 dark:text-slate-500 ring-1 ring-slate-200 dark:ring-slate-700' : 'bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 ring-1 ring-rose-200' : isPast ? 'bg-transparent text-slate-300 dark:text-slate-600' : 'bg-slate-50 dark:bg-slate-700/50 text-slate-500 dark:text-slate-400'}`}
                  title={hasBills ? billsOnDay.map((b) => `${b.name} ${formatCurrency(myBillShare(b))}`).join(', ') : undefined}>
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
  const [bills, setBills] = useState<Bill[]>(() => {
    const b = peekCache(['bills'])?.bills;
    return b ? [...b].sort((x, y) => x.nextDue.localeCompare(y.nextDue)) : [];
  });
  const [accounts, setAccounts] = useState<Account[]>(() => peekCache(['accounts'])?.accounts ?? []);
  const [paychecks, setPaychecks] = useState<PaycheckEntry[]>(() => peekCache(['paychecks'])?.paychecks ?? []);
  const [transactions, setTransactions] = useState<Transaction[]>(() => peekCache(['transactions'])?.transactions ?? []);
  const [contacts, setContacts] = useState<Contact[]>(() => peekCache(['contacts'])?.contacts ?? []);
  const [splits, setSplits] = useState<Split[]>(() => peekCache(['splits'])?.splits ?? []);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  // Split participants for the bill being added/edited (separate state so
  // EMPTY_FORM stays a shared immutable constant — no aliased array).
  const [billParticipantRows, setBillParticipantRows] = useState<SplitParticipant[]>([emptyParticipant()]);
  // Your own typed share, used only when the bill total is left blank (so the
  // total is inferred by summing everyone's parts — see resolveSplit).
  const [billMyShare, setBillMyShare] = useState('');
  const [addingContact, setAddingContact] = useState(false);
  const [loading, setLoading] = useState(() => peekCache(['bills', 'accounts', 'paychecks', 'transactions', 'contacts', 'splits']) === null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [payBill, setPayBill] = useState<Bill | null>(null);
  const [payForm, setPayForm] = useState({ description: '', date: today(), amount: '', account: '', category: '' });
  const [paying, setPaying] = useState(false);
  // Loan-style "record payment" for an "owed to you" split — paybackFor is the
  // split id whose inline form is open; paybackForm holds the entered amount and
  // the account the cash returns into.
  const [paybackFor, setPaybackFor] = useState<string | null>(null);
  const [paybackForm, setPaybackForm] = useState({ amount: '', account: '' });
  const [recordingPayback, setRecordingPayback] = useState(false);
  const [sharingOpen, setSharingOpen] = useState(false);
  const [showSharingHistory, setShowSharingHistory] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const toast = useToast();
  const { expenseCategories } = useCategories();

  const FREQUENCY_LABELS: Record<Bill['frequency'], string> = {
    weekly: t('common.weekly'),
    biweekly: t('common.biweekly'),
    monthly: t('common.monthly'),
    quarterly: t('common.quarterly'),
    yearly: t('common.yearly'),
    once: t('common.oneTime'),
  };

  const load = useCallback(async (force = false) => {
    setError(false);
    try {
      // One round trip instead of six; served from the client cache when fresh.
      const data = await ensureResources(['bills', 'accounts', 'paychecks', 'transactions', 'contacts', 'splits'], { force });
      setBills([...data.bills].sort((x, y) => x.nextDue.localeCompare(y.nextDue)));
      setAccounts(data.accounts);
      setPaychecks(data.paychecks);
      setTransactions(data.transactions);
      setContacts(data.contacts);
      setSplits(data.splits);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  const { pullY, refreshing } = usePullToRefresh(() => load(true));

  function resetSplitMode() { setBillMyShare(''); }
  function openAdd() { setEditingId(null); setForm(EMPTY_FORM); setBillParticipantRows([emptyParticipant()]); resetSplitMode(); setShowAdvanced(false); setOpen(true); }
  function openEdit(bill: Bill) {
    setEditingId(bill.id);
    const parts = billParticipants(bill); // normalizes legacy single-split → rows
    const hasAdvanced = parts.length > 0 || bill.variable === true || !!bill.loanAccountId;
    setForm({
      name: bill.name, amount: String(bill.amount), frequency: bill.frequency,
      nextDue: bill.nextDue, account: bill.account ?? '', category: bill.category, isActive: bill.isActive,
      splitEnabled: parts.length > 0, variable: bill.variable === true,
      loanAccountId: bill.loanAccountId ?? '',
    });
    setBillParticipantRows(parts.length > 0
      ? parts.map((p) => ({ key: generateId(), contactId: p.contactId, amount: String(p.amount), newName: '' }))
      : [emptyParticipant()]);
    resetSplitMode(); // participants carry explicit amounts; the stored total drives the split
    setShowAdvanced(hasAdvanced);
    setOpen(true);
  }
  function closeModal() { setOpen(false); setEditingId(null); setForm(EMPTY_FORM); setBillParticipantRows([emptyParticipant()]); resetSplitMode(); setShowAdvanced(false); }

  // ── Bill split participants ──
  function updateBillParticipant(key: string, patch: Partial<SplitParticipant>) {
    setBillParticipantRows((prev) => prev.map((p) => p.key === key ? { ...p, ...patch } : p));
  }
  function addBillParticipantRow() { setBillParticipantRows((prev) => [...prev, emptyParticipant()]); }
  function removeBillParticipantRow(key: string) {
    setBillParticipantRows((prev) => prev.length > 1 ? prev.filter((p) => p.key !== key) : prev);
  }
  function billSplitEqually() { setBillParticipantRows((prev) => prev.map((p) => ({ ...p, amount: '' }))); }

  // Creates a reusable contact inline for one split row and selects it there.
  async function handleAddParticipantContact(row: SplitParticipant) {
    const name = row.newName.trim();
    if (!name) return;
    setAddingContact(true);
    const contact: Contact = { id: generateId(), name, createdAt: new Date().toISOString() };
    try {
      const res = await fetch('/api/contacts', { method: 'POST', body: JSON.stringify(contact), headers: { 'Content-Type': 'application/json' } });
      if (!res.ok) throw new Error();
      setContacts((prev) => [...prev, contact].sort((a, b) => a.name.localeCompare(b.name)));
      updateBillParticipant(row.key, { contactId: contact.id, newName: '' });
      toast(t('bills.toastContactAdded'), 'success');
    } catch {
      toast(t('bills.toastFailedContact'), 'error');
    } finally {
      setAddingContact(false);
    }
  }

  async function handleSave() {
    if (!form.name) return;
    // Resolve each named row's share. Rows without a real contact are dropped.
    const namedRows = form.splitEnabled
      ? billParticipantRows.filter((p) => !!contacts.find((c) => c.id === p.contactId))
      : [];
    const amounts = namedRows.map((p) => (p.amount.trim() === '' ? null : (parseFloat(p.amount) || 0)));
    const totalInput = form.amount.trim() === '' ? null : (parseFloat(form.amount) || 0);
    // Total filled → divide it across people; total blank → sum the parts (your
    // own typed share included). You always take part in a bill (includeMe true).
    const { shares, over, total } = resolveSplit(totalInput, amounts, true, parseFloat(billMyShare) || 0);
    if (over) { toast(t('bills.splitExpenseOverTotal'), 'error'); return; }
    const splitParticipants: BillSplitParticipant[] = namedRows
      .map((p, i) => ({ contactId: p.contactId, amount: roundCents(shares[i]) }))
      .filter((p) => p.amount > 0);
    if (total <= 0) return;
    setSaving(true);
    const bill: Bill = {
      id: editingId ?? generateId(),
      name: form.name,
      amount: total,
      frequency: form.frequency,
      nextDue: form.nextDue,
      account: form.account,
      category: form.category,
      isActive: editingId ? form.isActive : true,
      variable: form.variable,
      // New bills use the participants model exclusively; clear legacy fields.
      splitContactId: '',
      splitAmount: undefined,
      splitParticipants: splitParticipants.length > 0 ? splitParticipants : undefined,
      // When linked, recording the payment pays down this loan account.
      loanAccountId: form.loanAccountId || undefined,
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
    // For a shared bill, log only YOUR share as the expense — the other people
    // cover their parts separately (tracked under "Owed to You", no expense).
    const myAmount = billParticipants(bill).length > 0 ? myBillShare(bill) : defaults.amount;
    setPayBill(bill);
    setPayForm({ description: defaults.description, date: defaults.date, amount: String(myAmount), account: defaults.account, category: defaults.category });
  }

  function closePayModal() { setPayBill(null); }

  // Advances a bill after it's paid (or skipped). A one-time ('once') bill has no
  // next occurrence, so it's deactivated instead of rolled forward. For a variable
  // bill (energy/gas) the stored amount is just an estimate, so when an actual
  // paid amount is known we refresh the estimate to it — but only for unsplit
  // bills, where `paidAmount` is the whole charge (on split bills it's just your
  // share, which must not overwrite the total).
  async function advanceBillDue(bill: Bill, paidAmount?: number) {
    const isOnce = bill.frequency === 'once';
    const refreshEstimate =
      bill.variable && paidAmount != null && paidAmount > 0 && billParticipants(bill).length === 0;
    const updated: Bill = {
      ...bill,
      nextDue: isOnce ? bill.nextDue : nextDueAfter(bill.nextDue, bill.frequency),
      isActive: isOnce ? false : bill.isActive,
      amount: refreshEstimate ? roundCents(paidAmount!) : bill.amount,
    };
    setBills((prev) => prev.map((b) => b.id === bill.id ? updated : b).sort((x, y) => x.nextDue.localeCompare(y.nextDue)));
    await fetch('/api/bills', { method: 'POST', body: JSON.stringify(updated), headers: { 'Content-Type': 'application/json' } });
  }

  async function handleRecordPayment() {
    if (!payBill) return;

    // Loan-linked bill → pay down the loan instead of logging a plain expense.
    // The payment is split into interest (an expense) + principal (a transfer into
    // the loan that lowers its balance). See buildLoanPaymentTxs.
    if (payBill.loanAccountId) {
      const loan = accounts.find((a) => a.id === payBill.loanAccountId);
      const from = payForm.account || loan?.paymentAccountId || '';
      const amount = parseFloat(payForm.amount) || 0;
      if (!loan) { toast(t('bills.loanMissing'), 'error'); return; }
      if (!from) { toast(t('bills.loanNeedsAccount'), 'error'); return; }
      if (!(amount > 0)) return;
      setPaying(true);
      const txs = buildLoanPaymentTxs(from, loan.id, Math.max(0, loan.balance), loan.apr ?? 0, amount, payForm.description, payForm.category, payForm.date);
      // Build split receivables — the loan txs already drain the full amount from
      // the account, so no cashOut fronting transfer is needed; only owed-to-you records.
      const loanSplits: Split[] = billParticipants(payBill).flatMap((part) => {
        const contact = contacts.find((c) => c.id === part.contactId);
        if (!contact || part.amount <= 0) return [];
        return [{
          id: generateId(),
          billId: payBill.id,
          billName: payBill.name,
          contactId: contact.id,
          contactName: contact.name,
          amount: part.amount,
          category: payForm.category,
          account: payForm.account,
          date: payForm.date,
          settled: false,
          settledDate: '',
          repaidAmount: 0,
          repaymentTxIds: [],
          frontedTxId: '',
          settleTxId: '',
        }];
      });
      try {
        for (const tx of txs) {
          const res = await fetch('/api/transactions', { method: 'POST', body: JSON.stringify(tx), headers: { 'Content-Type': 'application/json' } });
          if (!res.ok) throw new Error();
        }
        await advanceBillDue(payBill, amount);
        for (const split of loanSplits) {
          const sRes = await fetch('/api/splits', { method: 'POST', body: JSON.stringify(split), headers: { 'Content-Type': 'application/json' } });
          if (!sRes.ok) throw new Error();
        }
        if (loanSplits.length > 0) {
          setSplits((prev) => [...loanSplits, ...prev]);
          const totalOwed = loanSplits.reduce((s, x) => s + x.amount, 0);
          toast(t('bills.toastSplitPaid', { name: loanSplits.length === 1 ? loanSplits[0].contactName : t('bills.peopleCount', { n: loanSplits.length }), amount: formatCurrency(totalOwed) }), 'success');
        } else {
          toast(t('bills.loanPaymentRecorded', { name: payBill.name }), 'success');
        }
        closePayModal();
      } catch {
        toast(t('bills.toastFailedPayment'), 'error');
      } finally {
        setPaying(false);
      }
      return;
    }

    setPaying(true);
    const tx: Transaction = {
      id: generateId(),
      date: payForm.date,
      description: payForm.description,
      amount: parseFloat(payForm.amount) || 0,
      type: 'expense',
      category: payForm.category,
      account: payForm.account,
      createdAt: new Date().toISOString(),
    };
    // The expense above counts only YOUR share. For a shared bill we also front
    // EACH other person's share out of the same account as a `transfer` (so the
    // balance reflects the full amount you really paid) and open an "owed to
    // you" receivable per person. When an account is selected the transfer is
    // bundled with the split so the balance moves atomically; with no account it
    // stays a note-only receivable. All splits share the payBill.id + date so
    // they collapse into one group (see groupSplits).
    const newSplits: { split: Split; tx: Transaction | null }[] = [];
    for (const part of billParticipants(payBill)) {
      const contact = contacts.find((c) => c.id === part.contactId);
      if (!contact || part.amount <= 0) continue;
      const frontedTx = payForm.account
        ? buildSplitTx('cashOut', part.amount, payForm.account, t('bills.txFronted', { name: contact.name, bill: payBill.name }), payForm.date)
        : null;
      newSplits.push({
        split: {
          id: generateId(),
          billId: payBill.id,
          billName: payBill.name,
          contactId: contact.id,
          contactName: contact.name,
          amount: part.amount,
          category: payForm.category,
          account: payForm.account,
          date: payForm.date,
          settled: false,
          settledDate: '',
          repaidAmount: 0,
          repaymentTxIds: [],
          frontedTxId: frontedTx?.id ?? '',
          settleTxId: '',
        },
        tx: frontedTx,
      });
    }
    try {
      // Confirm the expense wrote before creating the split records, otherwise a
      // failed transaction would leave orphaned "owed to you" entries.
      const txPromise = fetch('/api/transactions', { method: 'POST', body: JSON.stringify(tx), headers: { 'Content-Type': 'application/json' } });
      const advancePromise = advanceBillDue(payBill, tx.amount);
      const txRes = await txPromise;
      await advancePromise;
      if (!txRes.ok) throw new Error();
      // Sequential — each fronted transfer mutates the same account balance
      // server-side, so parallel writes would race.
      for (const { split, tx: frontedTx } of newSplits) {
        const sRes = await fetch('/api/splits', {
          method: 'POST',
          body: JSON.stringify(frontedTx ? { split, tx: frontedTx } : split),
          headers: { 'Content-Type': 'application/json' },
        });
        if (!sRes.ok) throw new Error();
      }
      upsertTemplate({ id: generateId(), description: tx.description, amount: tx.amount, type: 'expense', category: tx.category, account: tx.account });
      if (newSplits.length > 0) {
        setSplits((prev) => [...newSplits.map((s) => s.split), ...prev]);
        const totalOwedNow = newSplits.reduce((s, x) => s + x.split.amount, 0);
        toast(t('bills.toastSplitPaid', { name: newSplits.length === 1 ? newSplits[0].split.contactName : t('bills.peopleCount', { n: newSplits.length }), amount: formatCurrency(totalOwedNow) }), 'success');
      } else {
        toast(`${payBill.name} paid & transaction recorded`, 'success');
      }
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

  // Open / close the inline "record payment" form for one "owed to you" split,
  // mirroring the loan payback form. Opening pre-fills the amount with what's
  // still owed and the account with the one the share was fronted from.
  function openSplitPayback(split: Split) {
    if (paybackFor === split.id) { setPaybackFor(null); return; }
    setPaybackFor(split.id);
    setPaybackForm({ amount: String(splitRemaining(split)), account: split.account });
  }

  // Record a (possibly partial) payback for a shared-bill split — the same model
  // as a loan payback. The entered amount accumulates in `repaidAmount`; once it
  // covers the full share the split is marked settled. When an account is chosen
  // the share is returned INTO it as a cash-in `transfer` (bundled with the split
  // so the balance and the receivable move together). A note-only split (no
  // account) just advances repaidAmount. Your own expense is never touched here.
  async function handleRecordSplitPayback(split: Split) {
    const remaining = splitRemaining(split);
    const entered = parseFloat(paybackForm.amount) || 0;
    const applied = roundCents(Math.min(entered, remaining));
    if (applied <= 0) return;
    setRecordingPayback(true);
    const account = paybackForm.account;
    const tx: Transaction | null = account
      ? buildSplitTx('cashIn', applied, account, t('bills.txSettled', { name: split.contactName, bill: split.billName }), today())
      : null;
    const newRepaid = roundCents(split.repaidAmount + applied);
    const fullyPaid = newRepaid >= roundCents(split.amount) - 0.005;
    const updated: Split = {
      ...split,
      repaidAmount: newRepaid,
      settled: fullyPaid,
      settledDate: fullyPaid ? today() : '',
      repaymentTxIds: tx ? [...split.repaymentTxIds, tx.id] : split.repaymentTxIds,
    };
    const prev = splits;
    setSplits((list) => list.map((s) => s.id === split.id ? updated : s));
    try {
      const res = await fetch('/api/splits', { method: 'POST', body: JSON.stringify(tx ? { split: updated, tx } : updated), headers: { 'Content-Type': 'application/json' } });
      if (!res.ok) throw new Error();
      toast(fullyPaid ? t('bills.toastSplitSettled', { name: split.contactName }) : t('bills.toastSplitPartial', { name: split.contactName, amount: formatCurrency(splitRemaining(updated)) }), 'success');
      setPaybackFor(null);
      setPaybackForm({ amount: '', account: '' });
    } catch {
      setSplits(prev);
      toast(t('bills.toastFailedSplit'), 'error');
    } finally {
      setRecordingPayback(false);
    }
  }

  // One pending "owed to you" person: the loan-style card showing what's still
  // owed, a progress bar once partially paid, a "Record payment" button, and the
  // inline payback form it toggles open. `showBill` adds the bill name (used for
  // standalone single-person rows; group cards already show it in the header).
  function renderPendingSplitRow(split: Split, showBill: boolean) {
    const expanded = paybackFor === split.id;
    const remaining = splitRemaining(split);
    const partial = (split.repaidAmount || 0) > 0;
    const pct = split.amount > 0 ? Math.min(100, (split.repaidAmount / split.amount) * 100) : 0;
    return (
      <div key={split.id} className="px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
              {split.contactName}{showBill && <> <span className="text-slate-400 dark:text-slate-500 font-medium">·</span> {split.billName}</>}
            </p>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5">{t('bills.owedSince', { date: formatDate(split.date) })}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400">{formatCurrency(remaining)}</p>
            {partial && <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500">{t('bills.splitPaidOf', { paid: formatCurrency(split.repaidAmount), total: formatCurrency(split.amount) })}</p>}
          </div>
        </div>
        {partial && (
          <div className="mt-2.5 h-1.5 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
          </div>
        )}
        <div className="flex items-center gap-2 mt-3">
          <Button size="sm" variant="secondary" className="h-9" onClick={() => openSplitPayback(split)}>
            <HandCoins className="w-4 h-4" />{t('bills.recordSplitPayment')}
          </Button>
          <button title={t('common.delete')} onClick={() => handleDeleteSplit(split)} className="p-2 text-slate-300 dark:text-slate-600 hover:text-rose-500 dark:hover:text-rose-400 rounded-lg transition-colors ml-auto">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
        <Collapsible open={expanded}>
          <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700/60 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input label={t('loans.paybackAmount')} type="number" min="0" step="0.01" value={paybackForm.amount} onChange={(e) => setPaybackForm((f) => ({ ...f, amount: e.target.value }))} />
              <Select
                label={t('loans.intoAccount')}
                value={paybackForm.account}
                options={[{ value: '', label: t('loans.noAccount') }, ...accounts.filter((a) => a.type !== 'pool').map((a) => ({ value: a.id, label: `${a.name} (${formatCurrency(a.balance)})` }))]}
                onChange={(e) => setPaybackForm((f) => ({ ...f, account: e.target.value }))}
              />
            </div>
            <div className="flex gap-3">
              <Button variant="secondary" className="flex-1 h-10" onClick={() => setPaybackFor(null)}>{t('common.cancel')}</Button>
              <Button className="flex-1 h-10" onClick={() => handleRecordSplitPayback(split)} disabled={recordingPayback || !paybackForm.amount}>{recordingPayback ? t('common.saving') : t('loans.confirmPayback')}</Button>
            </div>
          </div>
        </Collapsible>
      </div>
    );
  }

  // Removes an "owed to you" record. The splits API reverses and deletes every
  // cash transfer the split created (the fronted share + each payback) so any
  // linked account returns to exactly where it was — mirrors loan deletion.
  async function handleDeleteSplit(split: Split) {
    if (!confirm(t('bills.confirmDeleteSplit'))) return;
    const prev = splits;
    setSplits((s) => s.filter((x) => x.id !== split.id));
    try {
      const res = await fetch('/api/splits', { method: 'DELETE', body: JSON.stringify({ id: split.id }), headers: { 'Content-Type': 'application/json' } });
      if (!res.ok) throw new Error();
    } catch {
      setSplits(prev);
      toast(t('bills.toastFailedSplit'), 'error');
    }
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
  const todayMidnight = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, [bills]);
  const activeBills = bills.filter((b) => b.isActive);
  const inactiveBills = bills.filter((b) => !b.isActive);
  const monthlyTotal = activeBills.reduce((s, b) => {
    const m: Record<Bill['frequency'], number> = { weekly: 52 / 12, biweekly: 26 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12, once: 0 };
    return s + myBillShare(b) * m[b.frequency];
  }, 0);
  const overdueBills = activeBills.filter((b) => parseLocalDate(b.nextDue) < todayMidnight);
  const upcomingCount = activeBills.filter((b) => { const diff = Math.ceil((parseLocalDate(b.nextDue).getTime() - todayMidnight.getTime()) / 86400000); return diff >= 0 && diff <= 14; }).length;

  const contactName = useCallback((id: string) => contacts.find((c) => c.id === id)?.name ?? '', [contacts]);

  // "Owed to you" derived views. Only recurring shared-bill splits live here;
  // one-time expense splits are tracked on the Transactions page (see lib/splits
  // isOneOffSplit), so they're filtered out.
  const billSplits = useMemo(() => splits.filter((s) => !isOneOffSplit(s)), [splits]);
  const pendingSplits = useMemo(() => billSplits.filter((s) => !s.settled).sort((a, b) => b.date.localeCompare(a.date)), [billSplits]);
  const settledSplits = useMemo(() => billSplits.filter((s) => s.settled).sort((a, b) => (b.settledDate || '').localeCompare(a.settledDate || '')), [billSplits]);
  const totalOwed = useMemo(() => pendingSplits.reduce((s, x) => s + splitRemaining(x), 0), [pendingSplits]);
  const owedByContact = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of pendingSplits) map.set(s.contactName, (map.get(s.contactName) ?? 0) + s.amount);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [pendingSplits]);
  // Grouped views for the tracker modal — one card per shared bill/expense.
  const pendingGroups = useMemo(() => groupSplits(pendingSplits), [pendingSplits]);
  const settledGroups = useMemo(() => groupSplits(settledSplits), [settledSplits]);

  // Live preview of the split breakdown inside the bill modal. Only rows with a
  // real contact count. When the bill total is filled it's divided across people
  // (blank rows auto-divide the remainder, you join that pool); when it's left
  // blank the total is inferred by summing each typed share plus your own.
  // `billShareByKey` feeds each row's placeholder.
  const billTotalInput = form.amount.trim() === '' ? null : (parseFloat(form.amount) || 0);
  const billHasTotal = (billTotalInput ?? 0) > 0;
  const billNamedRows = form.splitEnabled ? billParticipantRows.filter((p) => !!contacts.find((c) => c.id === p.contactId)) : [];
  const billAmounts = billNamedRows.map((p) => (p.amount.trim() === '' ? null : (parseFloat(p.amount) || 0)));
  const billComputed = resolveSplit(billTotalInput, billAmounts, true, parseFloat(billMyShare) || 0);
  const billShareByKey = new Map(billNamedRows.map((p, i) => [p.key, billComputed.shares[i]]));
  const billOthersTotal = roundCents(billComputed.shares.reduce((s, v) => s + v, 0));
  const billMyShareNum = billComputed.myShare;
  const billTotal = billComputed.total;
  const billIsGroup = billNamedRows.length > 1;
  const billOver = billComputed.over;

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

      <PageHeader
        icon={Calendar}
        tone="amber"
        title={t('bills.title')}
        subtitle={t('bills.subtitle')}
        action={
          <Button onClick={openAdd} className="w-full md:w-auto shadow-sm"><Plus className="w-5 h-5" />{t('bills.addBill')}</Button>
        }
      />

      <div className="grid grid-cols-3 gap-3">
        <Card className="p-4 sm:p-5 min-w-0">
          <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t('common.monthly')}</p>
          <FitText maxSize={24} minSize={13} className="font-extrabold text-slate-900 dark:text-slate-100 mt-1.5">{formatCurrency(monthlyTotal)}</FitText>
        </Card>
        <Card className="p-4 sm:p-5 min-w-0">
          <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t('bills.active')}</p>
          <FitText maxSize={24} minSize={13} className="font-extrabold text-indigo-600 dark:text-indigo-400 mt-1.5">{String(activeBills.length)}</FitText>
        </Card>
        <Card className={`p-4 sm:p-5 min-w-0 ${overdueBills.length > 0 ? 'border-rose-200 dark:border-rose-800/50' : upcomingCount > 0 ? 'border-amber-200 dark:border-amber-800/50' : ''}`}>
          <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{overdueBills.length > 0 ? t('bills.overdue') : t('bills.dueSoon')}</p>
          <FitText maxSize={24} minSize={13} className={`font-extrabold mt-1.5 ${overdueBills.length > 0 ? 'text-rose-600 dark:text-rose-400' : upcomingCount > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400 dark:text-slate-500'}`}>{String(overdueBills.length > 0 ? overdueBills.length : upcomingCount)}</FitText>
        </Card>
      </div>

      {overdueBills.length > 0 && (
        <div className="flex items-start gap-4 px-5 py-4 rounded-3xl bg-rose-50 dark:bg-rose-900/30 border border-rose-200 dark:border-rose-800/50">
          <div className="p-2 bg-white dark:bg-slate-800 rounded-xl shrink-0 shadow-sm"><AlarmClock className="w-5 h-5 text-rose-500 dark:text-rose-400" /></div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-extrabold text-rose-700 dark:text-rose-300">{overdueBills.length} overdue bill{overdueBills.length !== 1 ? 's' : ''}</p>
            <p className="text-xs text-rose-600 dark:text-rose-400 mt-0.5 font-medium truncate">{overdueBills.map((b) => b.name).join(' · ')}</p>
          </div>
          <button onClick={openAdd} className="text-xs font-bold text-rose-600 dark:text-rose-400 bg-white dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-rose-200 dark:border-rose-800/50 shrink-0">Mark Paid</button>
        </div>
      )}

      {/* Overdraft risks now live in the notification center (the bell). */}

      {loading ? (
        <BillsSkeleton />
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-14 h-14 rounded-full bg-rose-50 dark:bg-rose-900/30 flex items-center justify-center mb-4"><AlertCircle className="w-7 h-7 text-rose-400" /></div>
          <p className="text-slate-700 dark:text-slate-300 font-bold text-base mb-1">Couldn&apos;t load bills</p>
          <p className="text-slate-500 dark:text-slate-400 text-sm mb-6">Check your connection and try again.</p>
          <Button variant="secondary" onClick={() => load(true)}>Try Again</Button>
        </div>
      ) : bills.length === 0 ? (
        <Card className="text-center py-16 bg-slate-50 dark:bg-slate-700/50 border-slate-100 dark:border-slate-700/60">
          <div className="w-16 h-16 rounded-full bg-white dark:bg-slate-800 flex items-center justify-center mx-auto mb-4 shadow-sm border border-slate-100 dark:border-slate-700/60"><Calendar className="w-8 h-8 text-slate-400 dark:text-slate-500" /></div>
          <p className="text-slate-900 dark:text-slate-100 font-bold text-lg mb-1">No bills added yet</p>
          <p className="text-slate-500 dark:text-slate-400 font-medium text-sm mb-6">Add your first recurring bill to start tracking.</p>
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

          {/* Owed to You — tap to open the shared-payments tracker */}
          {billSplits.length > 0 && (
            <button onClick={() => setSharingOpen(true)} className="w-full flex items-center justify-between p-4 rounded-3xl bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700/60 hover:border-slate-200 dark:hover:border-slate-700 transition-colors text-left shadow-sm">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-2xl bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-100 dark:border-emerald-800/50 flex items-center justify-center shrink-0">
                  <HandCoins className="w-5 h-5 text-emerald-500 dark:text-emerald-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{t('bills.owedToYou')}</p>
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5">{t('bills.sharedOpenCount', { n: pendingSplits.length })}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {totalOwed > 0 && <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(totalOwed)}</span>}
                {pendingSplits.length > 0 && (
                  <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-indigo-600 text-white text-[11px] font-bold">{pendingSplits.length}</span>
                )}
              </div>
            </button>
          )}

          {activeBills.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider px-1">{t('bills.active')} Bills</h2>
              <div className="space-y-2.5">
                {activeBills.map((bill) => {
                  const daysUntil = Math.ceil((parseLocalDate(bill.nextDue).getTime() - todayMidnight.getTime()) / 86400000);
                  const isOverdue = daysUntil < 0;
                  // Red when overdue or due within 3 days; yellow when due in 4–7
                  // days; normal beyond that.
                  const isUrgent = daysUntil <= 3;
                  const isDueSoon = daysUntil > 3 && daysUntil <= 7;
                  const accountName = accounts.find((a) => a.id === bill.account)?.name ?? bill.account;
                  return (
                    <SwipeToDelete key={bill.id} onDelete={() => handleDelete(bill.id)}>
                      <div className={`flex flex-col sm:flex-row sm:items-center justify-between p-4 sm:p-5 rounded-3xl bg-white dark:bg-slate-800 border transition-all duration-200 gap-3 sm:gap-0 ${isUrgent ? 'border-rose-200 dark:border-rose-800/50 bg-rose-50/30' : isDueSoon ? 'border-amber-200 dark:border-amber-800/50 bg-amber-50/30' : 'border-slate-100 dark:border-slate-700/60 hover:border-slate-200 dark:hover:border-slate-700 hover:shadow-sm'}`}>
                        <div className="flex items-center gap-4">
                          <div className={`flex items-center justify-center w-12 h-12 rounded-2xl shrink-0 border ${isUrgent ? 'bg-rose-100 dark:bg-rose-900/40 border-rose-200 dark:border-rose-800/50 pulse-glow' : isDueSoon ? 'bg-amber-100 dark:bg-amber-900/40 border-amber-200 dark:border-amber-800/50' : 'bg-slate-100 dark:bg-slate-700 border-slate-200 dark:border-slate-700'}`}>
                            <AlarmClock className={`w-5 h-5 ${isUrgent ? 'text-rose-600 dark:text-rose-400' : isDueSoon ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400'}`} />
                          </div>
                          <div>
                            <p className="text-base font-bold text-slate-900 dark:text-slate-100">{bill.name}</p>
                            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5">
                              {FREQUENCY_LABELS[bill.frequency]}{accountName ? ` · ${accountName}` : ''}{' · '}
                              {isOverdue ? <span className="text-rose-600 dark:text-rose-400 font-bold">{t('common.overdue')} {Math.abs(daysUntil)}d</span> : daysUntil === 0 ? <span className="text-amber-600 dark:text-amber-400 font-bold">Due today</span> : <span>{daysUntil}d ({formatDate(bill.nextDue)})</span>}
                            </p>
                            {(() => {
                              const parts = billParticipants(bill);
                              if (parts.length === 0) return null;
                              const label = parts.length === 1
                                ? t('bills.splitBadge', { name: contactName(parts[0].contactId), your: formatCurrency(myBillShare(bill)), their: formatCurrency(parts[0].amount) })
                                : t('bills.splitBadgeGroup', { n: parts.length, your: formatCurrency(myBillShare(bill)), their: formatCurrency(billOthersShare(bill)) });
                              return (
                                <span className="inline-flex items-center gap-1 mt-1.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-100 dark:border-emerald-800/50 rounded-lg px-2 py-0.5">
                                  <Users className="w-3 h-3" />{label}
                                </span>
                              );
                            })()}
                          </div>
                        </div>
                        <div className="flex items-center justify-between sm:justify-end w-full sm:w-auto pl-16 sm:pl-0 gap-3 sm:gap-5">
                          <span title={bill.variable ? t('bills.variableAmountHint') : undefined} className={`text-base font-extrabold ${isUrgent ? 'text-rose-600 dark:text-rose-400' : isDueSoon ? 'text-amber-600 dark:text-amber-400' : 'text-slate-900 dark:text-slate-100'}`}>{bill.variable ? '~' : ''}{formatCurrency(bill.amount)}</span>
                          <div className="flex gap-1.5">
                            <button title="Edit" onClick={(e) => { e.stopPropagation(); openEdit(bill); }} className="p-2 text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded-xl transition-colors"><Pencil className="w-4 h-4" /></button>
                            <button title="Mark paid" onClick={(e) => { e.stopPropagation(); openPayModal(bill); }} className="p-2 text-slate-400 dark:text-slate-500 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 rounded-xl transition-colors"><CheckCircle2 className="w-4 h-4" /></button>
                            <button title="Pause" onClick={(e) => { e.stopPropagation(); handleToggle(bill); }} className="p-2 text-slate-400 dark:text-slate-500 hover:text-amber-600 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/30 rounded-xl transition-colors"><Circle className="w-4 h-4" /></button>
                          </div>
                        </div>
                      </div>
                    </SwipeToDelete>
                  );
                })}
              </div>
            </div>
          )}

          {inactiveBills.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider px-1">Paused</h2>
              <div className="space-y-2 opacity-60">
                {inactiveBills.map((bill) => (
                  <SwipeToDelete key={bill.id} onDelete={() => handleDelete(bill.id)}>
                    <div className="flex items-center justify-between p-4 sm:p-5 rounded-3xl bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-700">
                      <div>
                        <p className="text-sm font-bold text-slate-700 dark:text-slate-300">{bill.name}</p>
                        <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5">{FREQUENCY_LABELS[bill.frequency]} · {bill.variable ? '~' : ''}{formatCurrency(bill.amount)}</p>
                      </div>
                      <div className="flex gap-1.5">
                        <button title="Edit" onClick={(e) => { e.stopPropagation(); openEdit(bill); }} className="p-2 text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded-xl transition-colors"><Pencil className="w-4 h-4" /></button>
                        <button title="Resume" onClick={(e) => { e.stopPropagation(); handleToggle(bill); }} className="p-2 text-slate-400 dark:text-slate-500 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 rounded-xl transition-colors"><CheckCircle2 className="w-4 h-4" /></button>
                      </div>
                    </div>
                  </SwipeToDelete>
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
            <Select label={t('bills.payFromAccount')} value={payForm.account} options={[{ value: '', label: t('common.selectPlaceholder') }, ...accounts.filter((a) => a.type !== 'pool').map((a) => ({ value: a.id, label: a.name }))]} onChange={(e) => setPayForm((f) => ({ ...f, account: e.target.value }))} />
          )}
          {payBill && billParticipants(payBill).length > 0 ? (
            <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-2xl bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-100 dark:border-emerald-800/50">
              <HandCoins className="w-4 h-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
              <p className="text-xs text-emerald-700 dark:text-emerald-300 font-medium">{
                billParticipants(payBill).length === 1
                  ? t('bills.splitPayNote', { name: contactName(billParticipants(payBill)[0].contactId), amount: formatCurrency(billParticipants(payBill)[0].amount) })
                  : t('bills.splitPayNoteGroup', { n: billParticipants(payBill).length, amount: formatCurrency(billOthersShare(payBill)) })
              }</p>
            </div>
          ) : null}
          {payBill?.variable && billParticipants(payBill).length === 0 && (
            <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-2xl bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-100 dark:border-indigo-800/50">
              <Gauge className="w-4 h-4 text-indigo-600 dark:text-indigo-400 mt-0.5 shrink-0" />
              <p className="text-xs text-indigo-700 dark:text-indigo-300 font-medium">{t('bills.variablePayHint')}</p>
            </div>
          )}
          <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">This will record an expense transaction and save a recurring template for quick re-use.</p>
        </div>
        <div className="sticky bottom-0 bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700/60 -mx-6 sm:-mx-8 px-6 sm:px-8 py-4">
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={handleSkipPayment} disabled={paying}>{t('common.skip')}</Button>
            <Button className="flex-1 shadow-sm" onClick={handleRecordPayment} disabled={paying || !payForm.amount}>
              {paying ? t('bills.recording') : t('bills.recordPayment')}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={open} onClose={closeModal} title={editingId ? t('bills.editBill') : t('bills.addBill')}>
        <div className="space-y-4 pb-4">
          {/* ── Basic fields ─────────────────────────────────────────────── */}
          <Input label={t('bills.billName')} placeholder="e.g. Netflix, Rent, Car Insurance" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label={form.splitEnabled && !billHasTotal && billTotal > 0 ? t('bills.totalAmountAuto') : form.variable ? t('bills.estimatedAmount') : t('common.amountUsd')}
              type="number" min="0" step="0.01"
              placeholder={form.splitEnabled && !billHasTotal && billTotal > 0 ? billTotal.toFixed(2) : '0.00'}
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
            />
            <Select label={t('common.frequency')} value={form.frequency} options={Object.entries(FREQUENCY_LABELS).map(([value, label]) => ({ value, label }))} onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value as Bill['frequency'] }))} />
          </div>
          <Input label={t('bills.nextDueDate')} type="date" value={form.nextDue} onChange={(e) => setForm((f) => ({ ...f, nextDue: e.target.value }))} />
          <Select label={t('common.category')} value={form.category} options={expenseCategories.map((c) => ({ value: c, label: c }))} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} />
          {accounts.length > 0 && (
            <Select label={t('bills.payFromOptional')} value={form.account} options={[{ value: '', label: t('common.selectPlaceholder') }, ...accounts.filter((a) => a.type !== 'pool').map((a) => ({ value: a.id, label: a.name }))]} onChange={(e) => setForm((f) => ({ ...f, account: e.target.value }))} />
          )}

          {/* ── More options toggle ──────────────────────────────────────── */}
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="flex items-center gap-1.5 text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors pt-1"
          >
            <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${showAdvanced ? 'rotate-180' : ''}`} />
            {showAdvanced ? t('bills.fewerOptions') : t('bills.moreOptions')}
          </button>

          {/* ── Advanced options (collapsible) ────────────────────────────── */}
          <Collapsible open={showAdvanced}>
            <div className="space-y-3 pt-1">
              {/* Variable / flexible amount */}
              <label className="flex items-start gap-3 cursor-pointer select-none rounded-2xl border border-slate-200 dark:border-slate-700 p-3.5">
                <input
                  type="checkbox"
                  checked={form.variable}
                  onChange={(e) => setForm((f) => ({ ...f, variable: e.target.checked }))}
                  className="w-4 h-4 mt-0.5 rounded accent-indigo-600 shrink-0"
                />
                <span>
                  <span className="text-sm font-bold text-slate-700 dark:text-slate-300 flex items-center gap-2"><Gauge className="w-4 h-4" />{t('bills.variableAmount')}</span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5">{t('bills.variableAmountDesc')}</span>
                </span>
              </label>

              {/* Link to a loan account */}
              {accounts.some((a) => a.type === 'loan') && (
                <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-3.5 space-y-2">
                  <Select
                    label={t('bills.paysDownLoan')}
                    value={form.loanAccountId}
                    options={[{ value: '', label: t('bills.noLoanLink') }, ...accounts.filter((a) => a.type === 'loan').map((a) => ({ value: a.id, label: a.name })
                    )]}
                    onChange={(e) => {
                      const id = e.target.value;
                      const loan = accounts.find((a) => a.id === id);
                      setForm((f) => ({
                        ...f,
                        loanAccountId: id,
                        amount: id && loan?.monthlyPayment && !f.amount ? String(loan.monthlyPayment) : f.amount,
                        account: id && loan?.paymentAccountId && !f.account ? loan.paymentAccountId : f.account,
                      }));
                    }}
                  />
                  {form.loanAccountId && <p className="text-xs text-slate-500 dark:text-slate-400">{t('bills.paysDownLoanHint')}</p>}
                </div>
              )}

              {/* Split this bill with people */}
              <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-3.5 space-y-3">
                  <label className="flex items-center gap-3 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={form.splitEnabled}
                      onChange={(e) => setForm((f) => ({ ...f, splitEnabled: e.target.checked }))}
                      className="w-4 h-4 rounded accent-indigo-600"
                    />
                    <span className="text-sm font-bold text-slate-700 dark:text-slate-300 flex items-center gap-2"><Users className="w-4 h-4" />{t('bills.splitBill')}</span>
                  </label>
                  {form.splitEnabled && (
                    <div className="space-y-3 pt-1">
                      {billParticipantRows.map((row) => {
                        const isNew = row.contactId === NEW_CONTACT;
                        const blank = row.amount.trim() === '';
                        const autoShare = billShareByKey.get(row.key);
                        return (
                          <div key={row.key} className="space-y-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 p-2.5">
                            <div className="flex gap-2 items-end">
                              <div className="flex-1">
                                <Select
                                  label={t('bills.splitWith')}
                                  value={row.contactId}
                                  options={[
                                    { value: '', label: t('bills.selectContact') },
                                    ...contacts.map((c) => ({ value: c.id, label: c.name })),
                                    { value: NEW_CONTACT, label: t('bills.addNewContact') },
                                  ]}
                                  onChange={(e) => updateBillParticipant(row.key, { contactId: e.target.value })}
                                />
                              </div>
                              {billParticipantRows.length > 1 && (
                                <Button type="button" variant="secondary" className="shrink-0 px-2.5" onClick={() => removeBillParticipantRow(row.key)} title={t('common.delete')}><Trash2 className="w-4 h-4" /></Button>
                              )}
                            </div>
                            {isNew && (
                              <div className="flex gap-2 items-end">
                                <div className="flex-1"><Input label={t('bills.newContactName')} placeholder="e.g. Alex" value={row.newName} onChange={(e) => updateBillParticipant(row.key, { newName: e.target.value })} /></div>
                                <Button type="button" variant="secondary" className="shrink-0" onClick={() => handleAddParticipantContact(row)} disabled={addingContact || !row.newName.trim()}><UserPlus className="w-4 h-4" />{t('bills.addContact')}</Button>
                              </div>
                            )}
                            {!isNew && row.contactId && (
                              <Input
                                label={billHasTotal && blank && autoShare != null ? t('bills.shareAuto') : t('bills.theirShare')}
                                type="number" min="0" step="0.01"
                                placeholder={billHasTotal && autoShare != null ? autoShare.toFixed(2) : '0.00'}
                                value={row.amount}
                                onChange={(e) => updateBillParticipant(row.key, { amount: e.target.value })}
                              />
                            )}
                          </div>
                        );
                      })}
                      <div className="flex gap-2">
                        <Button type="button" variant="secondary" className="flex-1" onClick={addBillParticipantRow}><UserPlus className="w-4 h-4" />{t('loans.addPerson')}</Button>
                        {billIsGroup && billHasTotal && (
                          <Button type="button" variant="secondary" className="flex-1" onClick={billSplitEqually}>{t('bills.splitEqually')}</Button>
                        )}
                      </div>
                      {!billHasTotal && (
                        <Input label={t('bills.yourShareInput')} type="number" min="0" step="0.01" placeholder="0.00" value={billMyShare} onChange={(e) => setBillMyShare(e.target.value)} />
                      )}
                      {billTotal > 0 && billNamedRows.length > 0 && (
                        <div className="flex justify-between text-xs font-bold px-1">
                          <span className="text-slate-500 dark:text-slate-400">{t('bills.yourShare')}: <span className="text-slate-900 dark:text-slate-100">{formatCurrency(billMyShareNum)}</span></span>
                          <span className="text-slate-500 dark:text-slate-400">{t('bills.theirShareShort')}: <span className="text-emerald-600 dark:text-emerald-400">{formatCurrency(billOthersTotal)}</span></span>
                        </div>
                      )}
                      {billOver && <p className="text-xs font-bold text-rose-500 dark:text-rose-400 px-1">{t('bills.splitExpenseOverTotal')}</p>}
                      <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">{t('bills.splitSmartHint')}</p>
                    </div>
                  )}
                </div>
            </div>
          </Collapsible>
        </div>
        <div className="sticky bottom-0 bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700/60 -mx-6 sm:-mx-8 px-6 sm:px-8 py-4">
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={closeModal}>{t('common.cancel')}</Button>
            <Button className="flex-1 shadow-sm" onClick={handleSave} disabled={saving || !form.name || billTotal <= 0 || billOver}>{saving ? t('common.saving') : editingId ? t('bills.saveChanges') : t('bills.addBillBtn')}</Button>
          </div>
        </div>
      </Modal>

      {/* ── Shared payments tracker modal ── */}
      <Modal open={sharingOpen} onClose={() => { setSharingOpen(false); setShowSharingHistory(false); }} title={t('bills.sharedTitle')}>
        <div className="space-y-4 pb-4">
          {/* Total owed */}
          {totalOwed > 0 && (
            <div className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-100 dark:border-emerald-800/50">
              <p className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300 uppercase tracking-wider">{t('bills.owedToYou')}</p>
              <p className="text-lg font-extrabold text-emerald-600 dark:text-emerald-400 mt-0.5">{formatCurrency(totalOwed)}</p>
            </div>
          )}

          {/* Per-person breakdown */}
          {owedByContact.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {owedByContact.map(([name, amt]) => (
                <span key={name} className="text-xs font-medium bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border border-emerald-100 dark:border-emerald-800/50 rounded-lg px-2.5 py-1 flex items-center gap-1.5">
                  <Users className="w-3 h-3" /> {name} · {formatCurrency(amt)}
                </span>
              ))}
            </div>
          )}

          {/* Pending (unchecked) shares — grouped by bill/expense; multi-person
              events collapse into one card with a per-person breakdown. */}
          {pendingSplits.length === 0 ? (
            <p className="text-center text-sm text-slate-500 dark:text-slate-400 font-medium py-6">{t('bills.sharedEmpty')}</p>
          ) : (
            <div className="space-y-2.5">
              {pendingGroups.map((group) => {
                // Single-person split → standalone card (record-payment form inline).
                if (group.splits.length === 1) {
                  return (
                    <div key={group.key} className="rounded-2xl bg-white dark:bg-slate-800 border border-emerald-100 dark:border-emerald-800/40 overflow-hidden">
                      {renderPendingSplitRow(group.splits[0], true)}
                    </div>
                  );
                }
                // Multi-person event → grouped card with the running remaining total.
                const groupRemaining = group.splits.reduce((s, x) => s + splitRemaining(x), 0);
                return (
                  <div key={group.key} className="rounded-2xl bg-white dark:bg-slate-800 border border-emerald-100 dark:border-emerald-800/40 overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3 bg-emerald-50/60 dark:bg-emerald-900/20 border-b border-emerald-100 dark:border-emerald-800/40">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Users className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">{group.billName}</p>
                          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5">{t('bills.groupOwedSince', { n: group.splits.length, date: formatDate(group.date) })}</p>
                        </div>
                      </div>
                      <span className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400 shrink-0 ml-2">{formatCurrency(groupRemaining)}</span>
                    </div>
                    <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
                      {group.splits.map((split) => renderPendingSplitRow(split, false))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* History (settled) — hidden by default, expandable, last 10 groups,
              grouped the same way as pending. */}
          {settledSplits.length > 0 && (
            <div className="pt-1">
              <button
                onClick={() => setShowSharingHistory((v) => !v)}
                className="w-full flex items-center justify-between px-1 py-2 text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
              >
                <span>{t('bills.sharedHistory', { n: settledSplits.length })}</span>
                <ChevronDown className={`w-4 h-4 transition-transform ${showSharingHistory ? 'rotate-180' : ''}`} />
              </button>
              <Collapsible open={showSharingHistory}>
                <div className="space-y-2 pt-1">
                  {settledGroups.slice(0, 10).map((group) => {
                    // Single-person settled split → flat row (unchanged look).
                    if (group.splits.length === 1) {
                      const split = group.splits[0];
                      return (
                        <div key={group.key} className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-700/40 border border-slate-100 dark:border-slate-700/60 opacity-75">
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-slate-700 dark:text-slate-300 truncate">{split.contactName} · {split.billName}</p>
                            <p className="text-xs font-medium text-slate-400 dark:text-slate-500 mt-0.5">{t('bills.transferredOn', { date: formatDate(split.settledDate || split.date) })}</p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-sm font-bold text-slate-400 dark:text-slate-500 line-through">{formatCurrency(split.amount)}</span>
                            <span title={t('bills.transferred')} className="w-6 h-6 rounded-md bg-emerald-500 text-white flex items-center justify-center shrink-0">
                              <Check className="w-4 h-4" />
                            </span>
                            <button title={t('common.delete')} onClick={() => handleDeleteSplit(split)} className="p-1.5 text-slate-300 dark:text-slate-600 hover:text-rose-500 dark:hover:text-rose-400 rounded-lg transition-colors">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      );
                    }
                    // Multi-person settled event → grouped card.
                    return (
                      <div key={group.key} className="rounded-2xl bg-slate-50 dark:bg-slate-700/40 border border-slate-100 dark:border-slate-700/60 overflow-hidden opacity-90">
                        <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-slate-100 dark:border-slate-700/60">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <Users className="w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0" />
                            <div className="min-w-0">
                              <p className="text-sm font-bold text-slate-700 dark:text-slate-300 truncate">{group.billName}</p>
                              <p className="text-xs font-medium text-slate-400 dark:text-slate-500 mt-0.5">{t('bills.groupTransferredOn', { n: group.splits.length, date: formatDate(group.settledDate || group.date) })}</p>
                            </div>
                          </div>
                          <span className="text-sm font-bold text-slate-400 dark:text-slate-500 line-through shrink-0 ml-2">{formatCurrency(group.total)}</span>
                        </div>
                        <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
                          {group.splits.map((split) => (
                            <div key={split.id} className="flex items-center justify-between px-3.5 py-2">
                              <p className="text-sm font-semibold text-slate-600 dark:text-slate-400 truncate min-w-0">{split.contactName}</p>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="text-sm font-bold text-slate-400 dark:text-slate-500 line-through">{formatCurrency(split.amount)}</span>
                                <span title={t('bills.transferred')} className="w-5 h-5 rounded-md bg-emerald-500 text-white flex items-center justify-center shrink-0">
                                  <Check className="w-3.5 h-3.5" />
                                </span>
                                <button title={t('common.delete')} onClick={() => handleDeleteSplit(split)} className="p-1.5 text-slate-300 dark:text-slate-600 hover:text-rose-500 dark:hover:text-rose-400 rounded-lg transition-colors">
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Collapsible>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
