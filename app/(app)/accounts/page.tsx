'use client';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Plus, Trash2, CreditCard, Landmark, PiggyBank, TrendingUp, Pencil, CheckCircle2, RefreshCw, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { AccountsSkeleton } from '@/components/ui/Skeleton';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
import { FitText } from '@/components/ui/FitText';
import { formatCurrency, generateId, today } from '@/lib/utils';
import { useToast } from '@/lib/toast';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import type { Account } from '@/types';
import { useTranslation } from '@/lib/i18n/context';

const ACCOUNT_COLORS = [
  '#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#84cc16',
];

const ACCOUNT_TYPE_CONFIG = {
  checking: { icon: Landmark, colorClass: 'text-blue-600', bgClass: 'bg-blue-50' },
  savings: { icon: PiggyBank, colorClass: 'text-emerald-600', bgClass: 'bg-emerald-50' },
  credit: { icon: CreditCard, colorClass: 'text-rose-600', bgClass: 'bg-rose-50' },
  investment: { icon: TrendingUp, colorClass: 'text-indigo-600', bgClass: 'bg-indigo-50' },
  loan: { icon: CreditCard, colorClass: 'text-amber-600', bgClass: 'bg-amber-50' },
};

const EMPTY_FORM = {
  name: '',
  type: 'checking' as Account['type'],
  institution: '',
  balance: '',
  last4: '',
  color: ACCOUNT_COLORS[0],
};

export default function AccountsPage() {
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [open, setOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Account | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const toast = useToast();

  const ACCOUNT_TYPE_LABELS: Record<Account['type'], string> = {
    checking: t('accounts.typeChecking'),
    savings: t('accounts.typeSavings'),
    credit: t('accounts.typeCredit'),
    investment: t('accounts.typeInvestment'),
    loan: t('accounts.typeLoan'),
  };

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/accounts');
      if (!res.ok) throw new Error();
      setAccounts(await res.json());
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load);

  const { pullY, refreshing } = usePullToRefresh(load);

  function openAdd() { setEditTarget(null); setForm(EMPTY_FORM); setOpen(true); }
  function openEdit(account: Account) {
    setEditTarget(account);
    setForm({ name: account.name, type: account.type, institution: account.institution, balance: String(account.balance), last4: account.last4, color: account.color });
    setOpen(true);
  }

  async function handleSave() {
    if (!form.name) return;
    setSaving(true);
    const account: Account = {
      id: editTarget?.id ?? generateId(),
      name: form.name,
      type: form.type,
      institution: form.institution,
      balance: parseFloat(form.balance) || 0,
      last4: form.last4,
      color: form.color,
      createdAt: editTarget?.createdAt ?? today(),
    };

    // Optimistic update
    if (editTarget) {
      setAccounts((prev) => prev.map((a) => a.id === account.id ? account : a));
    } else {
      setAccounts((prev) => [...prev, account]);
    }
    setOpen(false);
    setForm(EMPTY_FORM);
    setEditTarget(null);

    try {
      const res = await fetch('/api/accounts', {
        method: 'POST',
        body: JSON.stringify(account),
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error();
      toast(editTarget ? t('accounts.toastUpdated') : t('accounts.toastAdded'), 'success');
      await load();
    } catch {
      toast(t('accounts.toastFailedSave'), 'error');
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm(t('accounts.confirmDelete'))) return;
    const prev = accounts;
    setAccounts((a) => a.filter((acc) => acc.id !== id));
    try {
      const res = await fetch('/api/accounts', { method: 'DELETE', body: JSON.stringify({ id }), headers: { 'Content-Type': 'application/json' } });
      if (!res.ok) throw new Error();
      toast(t('accounts.toastDeleted'), 'success');
    } catch {
      setAccounts(prev);
      toast(t('accounts.toastFailedDelete'), 'error');
    }
  }

  const netWorth = accounts.reduce((sum, a) => sum + (a.type === 'credit' || a.type === 'loan' ? -a.balance : a.balance), 0);
  const totalAssets = accounts.filter((a) => a.type !== 'credit' && a.type !== 'loan').reduce((s, a) => s + a.balance, 0);
  const totalDebt = accounts.filter((a) => (a.type === 'credit' || a.type === 'loan') && a.balance > 0).reduce((s, a) => s + a.balance, 0);
  const grouped = {
    checking: accounts.filter((a) => a.type === 'checking'),
    savings: accounts.filter((a) => a.type === 'savings'),
    credit: accounts.filter((a) => a.type === 'credit'),
    investment: accounts.filter((a) => a.type === 'investment'),
    loan: accounts.filter((a) => a.type === 'loan'),
  };

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6 sm:space-y-8 pb-24 md:pb-8">
      {/* Pull-to-refresh indicator */}
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
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-slate-900">{t('accounts.title')}</h1>
          <p className="text-slate-500 text-base font-medium mt-1">{t('accounts.subtitle')}</p>
        </div>
        <Button onClick={openAdd} className="w-full md:w-auto shadow-sm hover:shadow-md">
          <Plus className="w-5 h-5" />{t('accounts.addAccount')}
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-indigo-100 hover:border-indigo-200">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">{t('accounts.netWorth')}</p>
          <FitText maxSize={28} minSize={13} className={`font-extrabold mt-2 ${netWorth >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{formatCurrency(netWorth)}</FitText>
        </Card>
        <Card>
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">{t('accounts.totalAssets')}</p>
          <FitText maxSize={28} minSize={13} className="font-extrabold mt-2 text-slate-900">{formatCurrency(totalAssets)}</FitText>
        </Card>
        <Card>
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">{t('accounts.totalDebt')}</p>
          <FitText maxSize={28} minSize={13} className="font-extrabold mt-2 text-rose-600">{formatCurrency(totalDebt)}</FitText>
        </Card>
      </div>

      {loading ? (
        <AccountsSkeleton />
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-14 h-14 rounded-full bg-rose-50 flex items-center justify-center mb-4">
            <AlertCircle className="w-7 h-7 text-rose-400" />
          </div>
          <p className="text-slate-700 font-bold text-base mb-1">Couldn&apos;t load accounts</p>
          <p className="text-slate-500 text-sm mb-6">Check your connection and try again.</p>
          <Button variant="secondary" onClick={load}>Try Again</Button>
        </div>
      ) : accounts.length === 0 ? (
        <Card className="text-center py-16 bg-slate-50 border-slate-100">
          <div className="w-16 h-16 rounded-full bg-white flex items-center justify-center mx-auto mb-4 shadow-sm border border-slate-100">
            <Landmark className="w-8 h-8 text-slate-400" />
          </div>
          <p className="text-slate-900 font-bold text-lg mb-1">No accounts yet.</p>
          <p className="text-slate-500 font-medium mb-6">Add your checking account first — paychecks will be tracked there.</p>
          <Button onClick={openAdd} className="shadow-sm">Add Your First Account</Button>
        </Card>
      ) : (
        <div className="space-y-8">
          {(Object.entries(grouped) as [Account['type'], Account[]][])
            .filter(([, list]) => list.length > 0)
            .map(([type, list]) => {
              const config = ACCOUNT_TYPE_CONFIG[type];
              const Icon = config.icon;
              const label = ACCOUNT_TYPE_LABELS[type];
              return (
                <div key={type} className="bg-white rounded-3xl border border-slate-100 p-4 sm:p-6 shadow-sm">
                  <div className="flex items-center gap-3 mb-4 px-2">
                    <div className={`p-2 rounded-xl ${config.bgClass}`}><Icon className={`w-5 h-5 ${config.colorClass}`} /></div>
                    <h2 className="text-base font-bold text-slate-900">{label}s</h2>
                  </div>
                  <div className="space-y-3">
                    {list.map((account) => (
                      <div key={account.id} className="group flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-2xl bg-slate-50 border border-slate-100 hover:border-slate-200 hover:bg-white hover:shadow-sm transition-all duration-300 gap-4 sm:gap-0">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 shadow-sm border border-slate-100 bg-white">
                            <Icon className="w-6 h-6" style={{ color: account.color }} />
                          </div>
                          <div>
                            <p className="text-base font-bold text-slate-900">{account.name}</p>
                            <p className="text-sm font-medium text-slate-500 mt-0.5">{account.institution || label}{account.last4 ? ` ····${account.last4}` : ''}</p>
                          </div>
                        </div>
                        <div className="flex items-center justify-between sm:justify-end gap-6 sm:gap-8 w-full sm:w-auto pl-16 sm:pl-0">
                          <div className="text-left sm:text-right">
                            {type === 'credit' || type === 'loan' ? (
                              account.balance < 0 ? (
                                <><p className="text-lg font-extrabold text-emerald-600">+{formatCurrency(Math.abs(account.balance))}</p><p className="text-xs font-bold text-emerald-500">{t('accounts.creditNote')}</p></>
                              ) : account.balance === 0 ? (
                                <PaidOffBadge accountId={account.id} paidOffLabel={t('accounts.paidOff')} />
                              ) : (
                                <><p className="text-lg font-extrabold text-rose-600">-{formatCurrency(account.balance)}</p><p className="text-xs font-bold text-slate-400">{t('accounts.owed')}</p></>
                              )
                            ) : (
                              <p className="text-lg font-extrabold text-slate-900">{formatCurrency(account.balance)}</p>
                            )}
                          </div>
                          <div className="flex gap-2">
                            <Button variant="ghost" size="icon" className="text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 h-10 w-10 rounded-xl" onClick={() => openEdit(account)}><Pencil className="w-4 h-4" /></Button>
                            <Button variant="ghost" size="icon" className="text-slate-400 hover:text-rose-600 hover:bg-rose-50 h-10 w-10 rounded-xl" onClick={() => handleDelete(account.id)}><Trash2 className="w-4 h-4" /></Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
        </div>
      )}

      <Modal open={open} onClose={() => { setOpen(false); setForm(EMPTY_FORM); setEditTarget(null); }} title={editTarget ? t('accounts.editAccount') : t('accounts.addAccount')}>
        <div className="space-y-5 pb-4">
          <Select label={t('accounts.accountType')} value={form.type} options={Object.entries(ACCOUNT_TYPE_CONFIG).map(([value]) => ({ value, label: ACCOUNT_TYPE_LABELS[value as Account['type']] }))} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as Account['type'] }))} />
          <Input label={t('accounts.accountName')} placeholder={form.type === 'checking' ? 'e.g. Chase Checking' : form.type === 'credit' ? 'e.g. Chase Sapphire' : 'e.g. HYSA'} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          <Input label={t('accounts.institution')} placeholder="e.g. Chase, Bank of America" value={form.institution} onChange={(e) => setForm((f) => ({ ...f, institution: e.target.value }))} />
          <Input label={form.type === 'credit' || form.type === 'loan' ? `${t('accounts.balanceOwed')} — enter negative if bank owes you` : t('accounts.currentBalance')} type="number" step="0.01" placeholder="0.00" value={form.balance} onChange={(e) => setForm((f) => ({ ...f, balance: e.target.value }))} />
          <Input label={t('accounts.last4')} placeholder="1234" maxLength={4} value={form.last4} onChange={(e) => setForm((f) => ({ ...f, last4: e.target.value.replace(/\D/g, '').slice(0, 4) }))} />
          <div>
            <p className="text-sm font-bold text-slate-700 ml-1 mb-2">{t('common.color')}</p>
            <div className="flex gap-3 flex-wrap">
              {ACCOUNT_COLORS.map((c) => (
                <button key={c} onClick={() => setForm((f) => ({ ...f, color: c }))} className="w-10 h-10 rounded-full border-[3px] transition-all flex items-center justify-center shadow-sm hover:scale-110" style={{ backgroundColor: c, borderColor: form.color === c ? '#0f172a' : 'transparent' }}>
                  {form.color === c && <CheckCircle2 className="w-5 h-5 text-white" />}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="sticky bottom-0 bg-white border-t border-slate-100 -mx-6 sm:-mx-8 px-6 sm:px-8 py-4">
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => { setOpen(false); setForm(EMPTY_FORM); setEditTarget(null); }}>{t('common.cancel')}</Button>
            <Button className="flex-1 shadow-sm" onClick={handleSave} disabled={saving || !form.name}>{saving ? t('common.saving') : editTarget ? t('accounts.editAccount') : t('accounts.addAccount')}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ── Paid-off credit card celebration badge ───────────────────────────────────
//
// Shown when a credit/loan account's balance reaches exactly zero.
// Replaces the previous "-$0.00" treatment with a celebratory $0.00 badge:
//   • emerald-600 colour + check icon
//   • brief confetti burst on first appearance (per session, per account)
//   • subtle pulse + scale-in entry

const CONFETTI_COLORS = ['#10b981', '#34d399', '#6ee7b7', '#fbbf24', '#f472b6', '#60a5fa'];

function PaidOffBadge({ accountId, paidOffLabel }: { accountId: string; paidOffLabel: string }) {
  // Confetti fires once per account per session (sessionStorage gate) so the
  // animation doesn't replay on every re-render or list refresh.
  const sessionKey = `paidoff-confetti:${accountId}`;
  const fireRef = useRef<boolean>(false);
  const [showConfetti, setShowConfetti] = useState(false);

  // Pre-compute particle trajectories so the values stay stable across re-renders.
  const particles = useMemo(() => {
    const count = 14;
    return Array.from({ length: count }, (_, i) => {
      const angle = (i / count) * Math.PI * 2;
      const distance = 36 + ((i * 7) % 14); // deterministic jitter
      return {
        dx: Math.cos(angle) * distance,
        dy: Math.sin(angle) * distance,
        duration: 0.9 + ((i % 4) * 0.08),
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      };
    });
  }, []);

  useEffect(() => {
    if (fireRef.current) return;
    fireRef.current = true;
    if (typeof window === 'undefined') return;
    if (sessionStorage.getItem(sessionKey)) return;
    sessionStorage.setItem(sessionKey, '1');
    setShowConfetti(true);
    const t = setTimeout(() => setShowConfetti(false), 1400);
    return () => clearTimeout(t);
  }, [sessionKey]);

  return (
    <div className="relative inline-flex flex-col items-end">
      <motion.p
        initial={{ scale: 0.7, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 320, damping: 18 }}
        className="text-xl font-black text-emerald-600 inline-flex items-center gap-1.5 whitespace-nowrap"
      >
        <CheckCircle2 className="w-5 h-5 shrink-0" aria-hidden />
        $0.00
      </motion.p>
      <p className="text-xs font-bold text-emerald-500 mt-0.5">{paidOffLabel}</p>

      <AnimatePresence>
        {showConfetti && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
            {particles.map((p, i) => (
              <motion.span
                key={i}
                initial={{ x: 0, y: 0, opacity: 1, scale: 0.6 }}
                animate={{ x: p.dx, y: p.dy, opacity: 0, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: p.duration, ease: 'easeOut' }}
                className="absolute w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: p.color }}
              />
            ))}
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
