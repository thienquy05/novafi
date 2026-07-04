'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus, RefreshCw, Pencil, Trash2, AlertTriangle, X, TrendingUp } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { FitText } from '@/components/ui/FitText';
import { StaggerReveal } from '@/components/ui/Reveal';
import { formatCurrency, generateId, today, zonedNow } from '@/lib/utils';
import { detectSubscriptions } from '@/lib/calculations';
import type { Subscription } from '@/lib/calculations';
import { peekCache, ensureResources } from '@/lib/client/store';
import { useToast } from '@/lib/toast';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
import { useCategories } from '@/hooks/useCategories';
import { useTranslation } from '@/lib/i18n/context';
import type { TrackedSubscription, Account, Transaction } from '@/types';

const DISMISSED_KEY = 'nf_sub_dismissed_v1';
const FREQ_OPTIONS = ['weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'] as const;

function toMonthly(amount: number, freq: TrackedSubscription['frequency']): number {
  switch (freq) {
    case 'weekly':    return (amount * 52) / 12;
    case 'biweekly':  return (amount * 26) / 12;
    case 'monthly':   return amount;
    case 'quarterly': return amount / 3;
    case 'yearly':    return amount / 12;
  }
}

// Cleans a raw transaction description into a display-ready merchant name.
// "NETFLIX.COM 12345" → "Netflix", "SPOTIFY USA" → "Spotify Usa" (then user edits if needed)
function prettifyMerchant(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[0-9#*/.,_-]+/g, ' ')
    .replace(/\b(com|www|llc|inc|corp)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Loose match so "Netflix" and "NETFLIX.COM 1234" are considered the same service.
function serviceMatches(tracked: string, detected: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
  const a = norm(tracked), b = norm(detected);
  const aWords = a.split(' ').filter((w) => w.length > 2);
  const bWords = b.split(' ').filter((w) => w.length > 2);
  return aWords.some((w) => b.includes(w)) || bWords.some((w) => a.includes(w));
}

const AVATAR_COLORS = [
  'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
  'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300',
  'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/40 dark:text-fuchsia-300',
];

function avatarFor(merchant: string): { initial: string; color: string } {
  let hash = 0;
  for (let i = 0; i < merchant.length; i++) hash = (hash * 31 + merchant.charCodeAt(i)) | 0;
  return {
    initial: merchant.trim().charAt(0).toUpperCase() || '?',
    color: AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length],
  };
}

const EMPTY_FORM: Omit<TrackedSubscription, 'id'> = {
  merchant: '',
  amount: 0,
  frequency: 'monthly',
  startDate: today(),
  category: 'Entertainment',
  account: '',
  notes: '',
  isActive: true,
};

function getDismissed(): string[] {
  try { return JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]'); } catch { return []; }
}

export default function SubscriptionsPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const { expenseCategories } = useCategories();

  const [subs, setSubs] = useState<TrackedSubscription[]>([]);
  const [accounts, setAccounts] = useState<Account[]>(() => peekCache(['accounts'])?.accounts ?? []);
  const [transactions, setTransactions] = useState<Transaction[]>(() => peekCache(['transactions'])?.transactions ?? []);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<TrackedSubscription | null>(null);
  const [form, setForm] = useState<Omit<TrackedSubscription, 'id'>>(EMPTY_FORM);
  const [dismissed, setDismissedState] = useState<string[]>(() => getDismissed());

  const load = useCallback(async (force = false) => {
    const [data, subsRes] = await Promise.all([
      ensureResources(['accounts', 'transactions'], { force }),
      fetch('/api/subscriptions').then((r) => r.json() as Promise<TrackedSubscription[]>),
    ]);
    setAccounts(data.accounts);
    setTransactions(data.transactions);
    setSubs(subsRes ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useAutoRefresh(() => load(true));

  // ── Auto-detected from transactions ──
  const detected: Subscription[] = useMemo(
    () => detectSubscriptions(transactions, zonedNow()),
    [transactions],
  );

  // Only show detected entries that haven't already been manually tracked.
  const untracked = useMemo(
    () => detected.filter((d) => !subs.some((s) => serviceMatches(s.merchant, d.merchant))),
    [detected, subs],
  );

  // ── Manually-tracked summary ──
  const activeSubs = useMemo(() => subs.filter((s) => s.isActive), [subs]);
  const monthlyTotal = useMemo(
    () => activeSubs.reduce((sum, s) => sum + toMonthly(s.amount, s.frequency), 0),
    [activeSubs],
  );

  // ── Cancel candidates ──
  // A tracked sub with no matching charge in 90 days AND not currently auto-detected.
  const cutoff = useMemo(() => {
    // zonedNow()'s local getters carry the configured zone's wall clock, so build
    // the YYYY-MM-DD from them (toISOString would shift back toward UTC).
    const d = zonedNow();
    d.setDate(d.getDate() - 90);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);

  const recentTx = useMemo(() => transactions.filter((tx) => tx.date >= cutoff), [transactions, cutoff]);

  const cancelCandidates = useMemo(() => {
    return activeSubs.filter((sub) => {
      if (dismissed.includes(sub.id)) return false;
      // If auto-detection sees it, it's clearly still active — not a candidate.
      if (detected.some((d) => serviceMatches(sub.merchant, d.merchant) && d.isActive)) return false;
      const name = sub.merchant.toLowerCase();
      return !recentTx.some((tx) => tx.description.toLowerCase().includes(name));
    });
  }, [activeSubs, recentTx, dismissed, detected]);

  // ── CRUD ──
  function openAdd(prefill?: Partial<Omit<TrackedSubscription, 'id'>>) {
    setEditTarget(null);
    setForm({ ...EMPTY_FORM, account: accounts[0]?.id ?? '', ...prefill });
    setOpen(true);
  }

  function openEdit(sub: TrackedSubscription) {
    setEditTarget(sub);
    setForm({
      merchant: sub.merchant, amount: sub.amount, frequency: sub.frequency,
      startDate: sub.startDate, category: sub.category, account: sub.account,
      notes: sub.notes, isActive: sub.isActive,
    });
    setOpen(true);
  }

  async function handleSave() {
    if (!form.merchant.trim() || form.amount <= 0) return;
    setSaving(true);
    const body: TrackedSubscription = { id: editTarget?.id ?? generateId(), ...form };
    try {
      const res = await fetch('/api/subscriptions', {
        method: 'POST', body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error();
      setSubs((prev) => [...prev.filter((s) => s.id !== body.id), body]);
      setOpen(false);
      toast(editTarget ? t('subscriptions.toastUpdated') : t('subscriptions.toastAdded'), 'success');
    } catch {
      toast(t('subscriptions.toastFailed'), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(sub: TrackedSubscription) {
    if (!confirm(t('subscriptions.confirmDelete'))) return;
    const prev = subs;
    setSubs((s) => s.filter((x) => x.id !== sub.id));
    try {
      const res = await fetch('/api/subscriptions', {
        method: 'DELETE', body: JSON.stringify({ id: sub.id }),
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error();
      toast(t('subscriptions.toastDeleted'), 'success');
    } catch {
      setSubs(prev);
      toast(t('subscriptions.toastFailedDelete'), 'error');
    }
  }

  function dismissCandidate(id: string) {
    const next = [...dismissed, id];
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
    setDismissedState(next);
  }

  const freqLabel = (freq: TrackedSubscription['frequency']) => ({
    weekly: t('subscriptions.freqWeekly'),
    biweekly: t('subscriptions.freqBiweekly'),
    monthly: t('subscriptions.freqMonthly'),
    quarterly: t('subscriptions.freqQuarterly'),
    yearly: t('subscriptions.freqYearly'),
  }[freq] ?? freq);

  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? '';

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-indigo-500 border-t-transparent" />
      </div>
    );
  }

  const sorted = [...subs].sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    return toMonthly(b.amount, b.frequency) - toMonthly(a.amount, a.frequency);
  });

  return (
    <StaggerReveal className="p-4 md:p-8 max-w-3xl mx-auto space-y-6 pb-24 md:pb-8">
      <PageHeader
        icon={RefreshCw}
        tone="default"
        title={t('subscriptions.title')}
        subtitle={t('subscriptions.subtitle')}
        action={
          <Button onClick={() => openAdd()} className="shadow-sm">
            <Plus className="w-4 h-4" />
            {t('subscriptions.addBtn')}
          </Button>
        }
      />

      {/* Summary cards — shown once there's something to summarise */}
      {activeSubs.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {/* min-w-0 + break-words keep long labels (incl. Vietnamese) inside
              these narrow 3-col cards instead of spilling past the border. */}
          <Card className="p-4 text-center flex flex-col min-w-0">
            <p className="flex-1 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide break-words mb-2">{t('subscriptions.monthlyCost')}</p>
            <FitText maxSize={20} minSize={12} className="font-extrabold text-slate-900 dark:text-slate-100">{formatCurrency(monthlyTotal)}</FitText>
          </Card>
          <Card className="p-4 text-center flex flex-col min-w-0">
            <p className="flex-1 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide break-words mb-2">{t('subscriptions.yearlyCost')}</p>
            <FitText maxSize={20} minSize={12} className="font-extrabold text-slate-900 dark:text-slate-100">{formatCurrency(monthlyTotal * 12)}</FitText>
          </Card>
          <Card className="p-4 text-center flex flex-col min-w-0">
            <p className="flex-1 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide break-words mb-2">{t('subscriptions.activeSubscriptions')}</p>
            <p className="text-xl font-extrabold text-indigo-600 dark:text-indigo-400">{activeSubs.length}</p>
          </Card>
        </div>
      )}

      {/* ── Spotted in Your History ── */}
      {untracked.length > 0 && (
        <Card>
          <div className="flex items-start gap-3 mb-4">
            <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-900/30 text-indigo-500 dark:text-indigo-400 shrink-0 mt-0.5">
              <RefreshCw className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-extrabold text-slate-800 dark:text-slate-100">{t('subscriptions.spottedTitle')}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{t('subscriptions.spottedDesc')}</p>
            </div>
          </div>
          <div className="space-y-2">
            {untracked.map((det) => {
              const pretty = prettifyMerchant(det.merchant);
              const { initial, color } = avatarFor(pretty);
              return (
                <div
                  key={det.merchant}
                  className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${det.isActive ? 'bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700/60' : 'bg-slate-50 dark:bg-slate-700/30 border-slate-100 dark:border-slate-700/40 opacity-75'}`}
                >
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-sm font-extrabold ${det.isActive ? color : 'bg-slate-100 dark:bg-slate-700/60 text-slate-400 dark:text-slate-500'}`}>
                    {initial}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-800 dark:text-slate-200 truncate">{pretty}</p>
                    <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                      <span className="text-xs text-slate-500 dark:text-slate-400">{t('subscriptions.seenFor', { n: det.months })}</span>
                      {det.hasPriceCreep && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold px-1.5 py-0.5 rounded-md bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
                          <TrendingUp className="w-3 h-3" />
                          {t('subscriptions.priceWentUp', { amount: formatCurrency(det.priceIncrease) })}
                        </span>
                      )}
                      {!det.isActive && (
                        <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400">
                          {t('subscriptions.stoppedCharging')}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0 mr-1">
                    <p className="text-sm font-extrabold text-slate-800 dark:text-slate-100">{formatCurrency(det.monthlyAmount)}</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500">{t('subscriptions.perMonth')}</p>
                  </div>
                  <Button
                    variant="secondary"
                    onClick={() => openAdd({
                      merchant: pretty,
                      amount: det.monthlyAmount,
                      frequency: 'monthly',
                      startDate: det.firstDate,
                      category: det.category,
                    })}
                    className="shrink-0 text-xs px-3 py-1.5 h-auto"
                  >
                    {t('subscriptions.startTracking')}
                  </Button>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* ── Cancel Candidates ── */}
      {cancelCandidates.length > 0 && (
        <Card className="border-amber-200 dark:border-amber-800/50 bg-amber-50/40 dark:bg-amber-900/10">
          <div className="flex items-start gap-3 mb-4">
            <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5">
              <AlertTriangle className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-extrabold text-amber-800 dark:text-amber-300">{t('subscriptions.cancelCandidates')}</p>
              <p className="text-xs text-amber-700/80 dark:text-amber-400/80 mt-0.5">{t('subscriptions.cancelCandidatesDesc')}</p>
            </div>
          </div>
          <div className="space-y-2">
            {cancelCandidates.map((sub) => {
              const { initial, color } = avatarFor(sub.merchant);
              return (
                <div key={sub.id} className="flex items-center gap-3 p-3 rounded-xl bg-white dark:bg-slate-800 border border-amber-100 dark:border-amber-800/40">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-sm font-extrabold ${color}`}>{initial}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-800 dark:text-slate-200">{sub.merchant}</p>
                    <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">{t('subscriptions.noRecentCharge')}</p>
                  </div>
                  <div className="text-right shrink-0 mr-2">
                    <p className="text-sm font-extrabold text-slate-800 dark:text-slate-100">{formatCurrency(sub.amount)}</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500">{freqLabel(sub.frequency)}</p>
                  </div>
                  <button
                    onClick={() => dismissCandidate(sub.id)}
                    title={t('subscriptions.dismissDetection')}
                    className="p-1.5 rounded-lg text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* ── Tracked Subscriptions list ── */}
      {subs.length === 0 && untracked.length === 0 ? (
        <Card className="py-12 text-center">
          <RefreshCw className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-600 mb-3" />
          <p className="text-base font-bold text-slate-700 dark:text-slate-300 mb-1">{t('subscriptions.empty')}</p>
          <p className="text-sm text-slate-500 dark:text-slate-400 max-w-xs mx-auto mb-5">{t('subscriptions.emptyBody')}</p>
          <Button onClick={() => openAdd()} className="mx-auto">
            <Plus className="w-4 h-4" />
            {t('subscriptions.addBtn')}
          </Button>
        </Card>
      ) : sorted.length > 0 ? (
        <div className="space-y-2">
          {sorted.map((sub) => {
            const { initial, color } = avatarFor(sub.merchant);
            const monthly = toMonthly(sub.amount, sub.frequency);
            return (
              <Card
                key={sub.id}
                className={`flex items-center gap-3 p-3.5 transition-all ${!sub.isActive ? 'opacity-60' : ''}`}
              >
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-sm font-extrabold ${sub.isActive ? color : 'bg-slate-100 dark:bg-slate-700/60 text-slate-400 dark:text-slate-500'}`}>
                  {initial}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-slate-800 dark:text-slate-200 truncate">{sub.merchant}</p>
                    {!sub.isActive && (
                      <span className="shrink-0 px-1.5 py-0.5 rounded text-xs font-bold bg-slate-100 dark:bg-slate-700/60 text-slate-500 dark:text-slate-400">
                        {t('subscriptions.inactive')}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 mt-0.5">
                    <span className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">{freqLabel(sub.frequency)}</span>
                    {sub.category && <span className="text-xs text-slate-400 dark:text-slate-500 whitespace-nowrap">· {sub.category}</span>}
                    {sub.account && accountName(sub.account) && (
                      <span className="text-xs text-slate-400 dark:text-slate-500 whitespace-nowrap">· {accountName(sub.account)}</span>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0 mr-1">
                  <p className="text-sm font-extrabold text-slate-900 dark:text-slate-100">{formatCurrency(sub.amount)}</p>
                  {sub.frequency !== 'monthly' && (
                    <p className="text-xs text-slate-400 dark:text-slate-500">{formatCurrency(monthly)}{t('subscriptions.perMonth')}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => openEdit(sub)}
                    title={t('common.edit')}
                    className="p-2 rounded-lg text-slate-400 dark:text-slate-500 hover:text-indigo-500 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(sub)}
                    title={t('common.delete')}
                    className="p-2 rounded-lg text-slate-400 dark:text-slate-500 hover:text-rose-500 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      ) : null}

      {/* Add / Edit Modal */}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editTarget ? t('subscriptions.editTitle') : t('subscriptions.addTitle')}
      >
        <div className="space-y-4">
          <Input
            label={t('subscriptions.merchant')}
            placeholder={t('subscriptions.merchantPlaceholder')}
            value={form.merchant}
            onChange={(e) => setForm((f) => ({ ...f, merchant: e.target.value }))}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label={t('subscriptions.amount')}
              type="number"
              min="0"
              step="0.01"
              value={form.amount || ''}
              onChange={(e) => setForm((f) => ({ ...f, amount: parseFloat(e.target.value) || 0 }))}
            />
            <Select
              label={t('subscriptions.frequency')}
              value={form.frequency}
              options={FREQ_OPTIONS.map((f) => ({ value: f, label: freqLabel(f) }))}
              onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value as TrackedSubscription['frequency'] }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label={t('subscriptions.startDate')}
              type="date"
              value={form.startDate}
              onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
            />
            <Select
              label={t('subscriptions.category')}
              value={form.category}
              options={expenseCategories.map((c) => ({ value: c, label: c }))}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
            />
          </div>
          {accounts.length > 0 && (
            <Select
              label={t('subscriptions.account')}
              value={form.account}
              options={[{ value: '', label: '— None —' }, ...accounts.map((a) => ({ value: a.id, label: a.name }))]}
              onChange={(e) => setForm((f) => ({ ...f, account: e.target.value }))}
            />
          )}
          <Input
            label={t('subscriptions.notes')}
            placeholder={t('subscriptions.notesPlaceholder')}
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          />
          <div className="flex items-center justify-between gap-4 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-700/40 border border-slate-100 dark:border-slate-700/60">
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{t('subscriptions.isActive')}</p>
            <button
              type="button"
              role="switch"
              aria-checked={form.isActive}
              onClick={() => setForm((f) => ({ ...f, isActive: !f.isActive }))}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 ${form.isActive ? 'bg-indigo-600' : 'bg-slate-200 dark:bg-slate-600'}`}
            >
              <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white dark:bg-slate-800 shadow ring-0 transition-transform duration-200 ${form.isActive ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>
          <div className="flex gap-2 pt-1">
            <Button onClick={handleSave} disabled={saving || !form.merchant.trim() || form.amount <= 0} className="flex-1">
              {saving ? t('common.saving') : t('subscriptions.saveBtn')}
            </Button>
            <Button variant="secondary" onClick={() => setOpen(false)} className="flex-1">
              {t('subscriptions.cancelBtn')}
            </Button>
          </div>
        </div>
      </Modal>
    </StaggerReveal>
  );
}
