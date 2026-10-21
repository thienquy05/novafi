'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus, RefreshCw, Pencil, Trash2, AlertTriangle, X, TrendingUp, EyeOff } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { PullToRefresh } from '@/components/PullToRefresh';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { FitText } from '@/components/ui/FitText';
import { StaggerReveal } from '@/components/ui/Reveal';
import { formatCurrency, generateId, today, zonedNow } from '@/lib/utils';
import { detectSubscriptions, merchantMatches } from '@/lib/calculations';
import type { Subscription } from '@/lib/calculations';
import { peekCache, ensureResources } from '@/lib/client/store';
import { useToast } from '@/lib/toast';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
import { useCategories } from '@/hooks/useCategories';
import { useTranslation } from '@/lib/i18n/context';
import { LoadError } from '@/components/ui/LoadError';
import { SubscriptionsSkeleton } from './loading';
import type { TrackedSubscription, Account, Transaction, SettingsListKey } from '@/types';

// Legacy device-only store for dismissed cancel reminders; migrated into the
// account-synced settings list on first load, then removed.
const LEGACY_DISMISSED_KEY = 'nf_sub_dismissed_v1';
// One chip style for every badge on this page (they used to mix sizes).
const CHIP = 'inline-flex items-center gap-1 text-[11px] leading-4 font-bold px-1.5 py-0.5 rounded-md';
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

function readLegacyDismissed(): string[] {
  try { return JSON.parse(localStorage.getItem(LEGACY_DISMISSED_KEY) ?? '[]'); } catch { return []; }
}

/** Add/remove entries in an account-synced settings list (server-side merge). */
async function patchSettingsList(list: SettingsListKey, change: { add?: string[]; remove?: string[] }): Promise<void> {
  const res = await fetch('/api/settings', {
    method: 'PATCH',
    body: JSON.stringify({ list, ...change }),
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error();
}

export default function SubscriptionsPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const { expenseCategories } = useCategories();

  const [subs, setSubs] = useState<TrackedSubscription[]>(() => peekCache(['subscriptions'])?.subscriptions ?? []);
  const [accounts, setAccounts] = useState<Account[]>(() => peekCache(['accounts'])?.accounts ?? []);
  const [transactions, setTransactions] = useState<Transaction[]>(() => peekCache(['transactions'])?.transactions ?? []);
  const [loading, setLoading] = useState(() => !peekCache(['accounts', 'transactions', 'subscriptions', 'settings']));
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<TrackedSubscription | null>(null);
  const [form, setForm] = useState<Omit<TrackedSubscription, 'id'>>(EMPTY_FORM);
  // Account-synced dismissals (settings): detected merchants marked "Not a
  // subscription", and tracked subs whose "unused?" reminder was hidden.
  const [dismissedSubs, setDismissedSubs] = useState<string[]>(() => peekCache(['settings'])?.settings.dismissedSubscriptions ?? []);
  const [dismissedReminders, setDismissedReminders] = useState<string[]>(() => peekCache(['settings'])?.settings.dismissedCancelReminders ?? []);

  // One request (served from the shared client cache when fresh) for everything
  // the page reads. Failures surface an error + retry instead of spinning forever.
  const load = useCallback(async (force = false) => {
    try {
      const data = await ensureResources(['accounts', 'transactions', 'subscriptions', 'settings'], { force });
      setAccounts(data.accounts);
      setTransactions(data.transactions);
      setSubs(data.subscriptions ?? []);
      setDismissedSubs(data.settings.dismissedSubscriptions ?? []);
      setDismissedReminders(data.settings.dismissedCancelReminders ?? []);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useAutoRefresh(() => load(true));

  // One-time move of reminders dismissed on this device (old localStorage store)
  // into the synced settings list.
  useEffect(() => {
    if (loading || error) return;
    const legacy = readLegacyDismissed().filter((id) => !dismissedReminders.includes(id));
    if (legacy.length === 0) return;
    patchSettingsList('dismissedCancelReminders', { add: legacy })
      .then(() => {
        setDismissedReminders((prev) => [...new Set([...prev, ...legacy])]);
        try { localStorage.removeItem(LEGACY_DISMISSED_KEY); } catch { /* ignore */ }
      })
      .catch(() => { /* keep the local copy; retried next visit */ });
  }, [loading, error, dismissedReminders]);

  // ── Auto-detected from transactions ──
  const detected: Subscription[] = useMemo(
    () => detectSubscriptions(transactions, zonedNow(), dismissedSubs),
    [transactions, dismissedSubs],
  );

  // Only show detected entries that haven't already been manually tracked.
  const untracked = useMemo(
    () => detected.filter((d) => !subs.some((s) => merchantMatches(s.merchant, d.merchant))),
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
      if (dismissedReminders.includes(sub.id)) return false;
      // If auto-detection sees it, it's clearly still active — not a candidate.
      if (detected.some((d) => merchantMatches(sub.merchant, d.merchant) && d.isActive)) return false;
      return !recentTx.some((tx) => tx.type === 'expense' && merchantMatches(sub.merchant, tx.description));
    });
  }, [activeSubs, recentTx, dismissedReminders, detected]);

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

  async function saveSub(sub: TrackedSubscription): Promise<void> {
    const res = await fetch('/api/subscriptions', {
      method: 'POST', body: JSON.stringify(sub),
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error();
  }

  // Delete right away with an Undo in the toast (re-saves the same row), instead
  // of a blocking browser confirm().
  async function handleDelete(sub: TrackedSubscription) {
    setSubs((s) => s.filter((x) => x.id !== sub.id));
    try {
      const res = await fetch('/api/subscriptions', {
        method: 'DELETE', body: JSON.stringify({ id: sub.id }),
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error();
      toast(t('subscriptions.toastDeleted'), 'success', {
        label: t('common.undo'),
        onClick: () => {
          setSubs((s) => [...s.filter((x) => x.id !== sub.id), sub]);
          saveSub(sub).catch(() => {
            setSubs((s) => s.filter((x) => x.id !== sub.id));
            toast(t('subscriptions.toastFailed'), 'error');
          });
        },
      });
    } catch {
      setSubs((s) => [...s.filter((x) => x.id !== sub.id), sub]);
      toast(t('subscriptions.toastFailedDelete'), 'error');
    }
  }

  // Optimistically update a synced dismissal list, persist it, offer Undo.
  async function changeDismissal(
    list: SettingsListKey,
    value: string,
    setList: React.Dispatch<React.SetStateAction<string[]>>,
    message: string,
  ) {
    setList((prev) => [...new Set([...prev, value])]);
    try {
      await patchSettingsList(list, { add: [value] });
      toast(message, 'success', {
        label: t('common.undo'),
        onClick: () => {
          setList((prev) => prev.filter((v) => v !== value));
          patchSettingsList(list, { remove: [value] }).catch(() => {
            setList((prev) => [...new Set([...prev, value])]);
            toast(t('subscriptions.toastFailedDismiss'), 'error');
          });
        },
      });
    } catch {
      setList((prev) => prev.filter((v) => v !== value));
      toast(t('subscriptions.toastFailedDismiss'), 'error');
    }
  }

  const dismissDetected = (det: Subscription, name: string) =>
    changeDismissal('dismissedSubscriptions', det.key, setDismissedSubs, t('subscriptions.notSubscriptionToast', { name }));
  const dismissCandidate = (id: string) =>
    changeDismissal('dismissedCancelReminders', id, setDismissedReminders, t('subscriptions.reminderHidden'));

  const freqLabel = (freq: TrackedSubscription['frequency']) => ({
    weekly: t('subscriptions.freqWeekly'),
    biweekly: t('subscriptions.freqBiweekly'),
    monthly: t('subscriptions.freqMonthly'),
    quarterly: t('subscriptions.freqQuarterly'),
    yearly: t('subscriptions.freqYearly'),
  }[freq] ?? freq);

  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? '';

  if (loading) return <SubscriptionsSkeleton />;

  const sorted = [...subs].sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    return toMonthly(b.amount, b.frequency) - toMonthly(a.amount, a.frequency);
  });

  return (
    <StaggerReveal className="p-4 md:p-8 max-w-3xl mx-auto space-y-6 pb-24 md:pb-8">
      <PullToRefresh onRefresh={() => load(true)} />
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

      {error && subs.length === 0 && transactions.length === 0 ? (
        <LoadError onRetry={() => { setLoading(true); load(true); }} />
      ) : null}

      {/* Summary cards — shown once there's something to summarise */}
      {activeSubs.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {/* Labels reserve two lines and clamp, so all three cards line up even
              when one label wraps (long Vietnamese labels) on a narrow phone. */}
          {[
            { label: t('subscriptions.monthlyCost'), value: formatCurrency(monthlyTotal), tone: 'text-slate-900 dark:text-slate-100' },
            { label: t('subscriptions.yearlyCost'), value: formatCurrency(monthlyTotal * 12), tone: 'text-slate-900 dark:text-slate-100' },
            { label: t('subscriptions.activeSubscriptions'), value: String(activeSubs.length), tone: 'text-indigo-600 dark:text-indigo-400' },
          ].map((c) => (
            <Card key={c.label} className="p-3 sm:p-4 text-center flex flex-col justify-between gap-2 min-w-0">
              <p className="text-[11px] sm:text-xs leading-tight font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide wrap-anywhere min-h-[2lh]">{c.label}</p>
              <FitText maxSize={20} minSize={12} className={`font-extrabold ${c.tone}`}>{c.value}</FitText>
            </Card>
          ))}
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
                // Wraps on narrow phones: name/amount on the first line, actions
                // on their own line, so nothing gets squeezed or truncated to "…".
                <div
                  key={det.key}
                  className={`flex flex-wrap items-center gap-x-3 gap-y-2 p-3 rounded-xl border transition-all ${det.isActive ? 'bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700/60' : 'bg-slate-50 dark:bg-slate-700/30 border-slate-100 dark:border-slate-700/40 opacity-75'}`}
                >
                  <div className="flex items-center gap-3 flex-1 min-w-[60%]">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-sm font-extrabold ${det.isActive ? color : 'bg-slate-100 dark:bg-slate-700/60 text-slate-400 dark:text-slate-500'}`}>
                      {initial}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-slate-800 dark:text-slate-200 wrap-anywhere">{pretty}</p>
                      <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                        <span className={`${CHIP} ${det.confidence === 'likely' ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'}`}>
                          {det.confidence === 'likely' ? t('subscriptions.likely') : t('subscriptions.possible')}
                        </span>
                        <span className="text-xs text-slate-500 dark:text-slate-400">{t('subscriptions.seenFor', { n: det.months })}</span>
                        {det.hasPriceCreep && (
                          <span className={`${CHIP} bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300`}>
                            <TrendingUp className="w-3 h-3" />
                            {t('subscriptions.priceWentUp', { amount: formatCurrency(det.priceIncrease) })}
                          </span>
                        )}
                        {!det.isActive && (
                          <span className={`${CHIP} bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400`}>
                            {t('subscriptions.stoppedCharging')}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-extrabold text-slate-800 dark:text-slate-100">{formatCurrency(det.amount)}</p>
                      <p className="text-xs text-slate-400 dark:text-slate-500">{freqLabel(det.frequency)}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-2 ml-auto">
                    <Button
                      variant="ghost"
                      onClick={() => dismissDetected(det, pretty)}
                      aria-label={`${t('subscriptions.notSubscription')}: ${pretty}`}
                      className="text-xs px-3 h-9 text-slate-500 dark:text-slate-400"
                    >
                      <EyeOff className="w-3.5 h-3.5" />
                      {t('subscriptions.notSubscription')}
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => openAdd({
                        merchant: pretty,
                        amount: det.amount,
                        frequency: det.frequency,
                        startDate: det.firstDate,
                        category: det.category,
                      })}
                      className="text-xs px-3 h-9"
                    >
                      {t('subscriptions.track')}
                    </Button>
                  </div>
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
                    <p className="text-sm font-bold text-slate-800 dark:text-slate-200 truncate">{sub.merchant}</p>
                    <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">{t('subscriptions.noRecentCharge')}</p>
                  </div>
                  <div className="text-right shrink-0 mr-2">
                    <p className="text-sm font-extrabold text-slate-800 dark:text-slate-100">{formatCurrency(sub.amount)}</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500">{freqLabel(sub.frequency)}</p>
                  </div>
                  <button
                    onClick={() => dismissCandidate(sub.id)}
                    title={t('subscriptions.dismissDetection')}
                    aria-label={`${t('subscriptions.dismissDetection')}: ${sub.merchant}`}
                    className="hit-area p-1.5 rounded-lg text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors shrink-0"
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
                    <p className="text-sm font-bold text-slate-800 dark:text-slate-200 wrap-anywhere">{sub.merchant}</p>
                    {!sub.isActive && (
                      <span className={`${CHIP} shrink-0 bg-slate-100 dark:bg-slate-700/60 text-slate-500 dark:text-slate-400`}>
                        {t('subscriptions.inactive')}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 mt-0.5">
                    <span className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">{freqLabel(sub.frequency)}</span>
                    {sub.category && <span className="text-xs text-slate-400 dark:text-slate-500 truncate max-w-full">· {sub.category}</span>}
                    {sub.account && accountName(sub.account) && (
                      <span className="text-xs text-slate-400 dark:text-slate-500 truncate max-w-full">· {accountName(sub.account)}</span>
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
                    aria-label={`${t('common.edit')}: ${sub.merchant}`}
                    className="hit-area p-2 rounded-lg text-slate-400 dark:text-slate-500 hover:text-indigo-500 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(sub)}
                    title={t('common.delete')}
                    aria-label={`${t('common.delete')}: ${sub.merchant}`}
                    className="hit-area p-2 rounded-lg text-slate-400 dark:text-slate-500 hover:text-rose-500 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors"
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
              options={[{ value: '', label: `— ${t('subscriptions.noAccount')} —` }, ...accounts.map((a) => ({ value: a.id, label: a.name }))]}
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
              aria-label={t('subscriptions.isActive')}
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
