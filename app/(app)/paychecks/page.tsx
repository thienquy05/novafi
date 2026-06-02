'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus, Trash2, DollarSign } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { formatCurrency, formatDate, generateId, today } from '@/lib/utils';
import { calcPaycheckTax } from '@/lib/tax';
import { calcPaycheckTaxToSave, calcPaycheckDeposited } from '@/lib/calculations';
import type { PaycheckEntry, TaxSettings, Account } from '@/types';
import { useTranslation } from '@/lib/i18n/context';

const EMPTY_FORM = {
  date: today(),
  // Total paycheck amount the user receives (taxable wages + tips combined).
  totalAmount: '',
  // Tips/gratuity portion — subtracted from total to derive the taxable wage base.
  gratuityAmount: '',
  checkingAccountId: '',
};

export default function PaychecksPage() {
  const [paychecks, setPaychecks] = useState<PaycheckEntry[]>([]);
  const [settings, setSettings] = useState<TaxSettings | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [preview, setPreview] = useState<ReturnType<typeof calcPaycheckTax> | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { t } = useTranslation();

  const load = useCallback(async () => {
    setLoading(true);
    const [pcRes, stRes, accRes] = await Promise.all([
      fetch('/api/paychecks'),
      fetch('/api/settings'),
      fetch('/api/accounts'),
    ]);
    const [pc, st, accs] = await Promise.all([pcRes.json(), stRes.json(), accRes.json()]);
    const sorted = [...pc].sort((a: PaycheckEntry, b: PaycheckEntry) => b.date.localeCompare(a.date));
    setPaychecks(sorted);
    setSettings(st);
    setAccounts(accs);

    // Auto-select first checking account
    const firstChecking = accs.find((a: Account) => a.type === 'checking');
    if (firstChecking) {
      setForm((f) => ({ ...f, checkingAccountId: f.checkingAccountId || firstChecking.id }));
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!settings || !form.totalAmount) { setPreview(null); return; }
    const total = parseFloat(form.totalAmount);
    if (isNaN(total) || total <= 0) { setPreview(null); return; }

    // Tips are non-taxable: peel them off to get the wage base used for federal/state/FICA.
    const tips = parseFloat(form.gratuityAmount) || 0;
    const taxableGross = Math.max(0, total - tips);
    if (taxableGross <= 0) { setPreview(null); return; }

    const ytdGross = paychecks
      .filter((p) => new Date(p.date).getFullYear() === new Date(form.date).getFullYear())
      .reduce((s, p) => s + p.grossAmount, 0);

    setPreview(calcPaycheckTax(taxableGross, settings, ytdGross));
  }, [form.totalAmount, form.gratuityAmount, form.date, settings, paychecks]);

  async function handleSave() {
    if (!settings || !preview) return;
    setSaving(true);
    const gratuity = parseFloat(form.gratuityAmount) || 0;
    // Full-deposit model: the whole paycheck is real money you keep. We don't
    // withhold anything — netAmount = the wages kept, no 401k/HSA is taken out —
    // and the tax pieces are just what you should set aside (save) for later.
    const entry: PaycheckEntry = {
      id: generateId(),
      date: form.date,
      grossAmount: preview.grossPaycheck,
      federalWithheld: preview.federalTax,
      stateWithheld: preview.stateTax,
      localWithheld: preview.cityTax,
      ficaWithheld: preview.ficaSs + preview.ficaMedicare,
      k401: 0,
      hsa: 0,
      netAmount: preview.grossPaycheck,
      notes: form.checkingAccountId,
      gratuityAmount: gratuity,
    };
    await fetch('/api/paychecks', {
      method: 'POST',
      body: JSON.stringify(entry),
      headers: { 'Content-Type': 'application/json' },
    });

    // Auto-create an income transaction: the full amount received (wages + tips)
    // is deposited as real money. Taxes are tracked separately, not withheld.
    if (form.checkingAccountId) {
      await fetch('/api/transactions', {
        method: 'POST',
        body: JSON.stringify({
          id: generateId(),
          date: form.date,
          description: 'Paycheck',
          amount: preview.grossPaycheck + gratuity,
          type: 'income',
          category: 'Paycheck',
          account: form.checkingAccountId,
        }),
        headers: { 'Content-Type': 'application/json' },
      });
    }

    setOpen(false);
    setForm(EMPTY_FORM);
    setPreview(null);
    await load();
    setSaving(false);
  }

  async function handleDelete(id: string) {
    if (!confirm(t('paychecks.confirmDelete'))) return;
    await fetch('/api/paychecks', {
      method: 'DELETE',
      body: JSON.stringify({ id }),
      headers: { 'Content-Type': 'application/json' },
    });
    await load();
  }

  const currentYear = new Date().getFullYear();
  const ytdPaychecks = useMemo(
    () => paychecks.filter((p) => new Date(p.date).getFullYear() === currentYear),
    [paychecks, currentYear],
  );
  const { ytdIncome, ytdTax, ytdWages, ytdTips } = useMemo(() => {
    let income = 0, tax = 0, wages = 0, tips = 0;
    for (const p of ytdPaychecks) {
      income += calcPaycheckDeposited(p);
      tax += calcPaycheckTaxToSave(p);
      wages += p.grossAmount;
      tips += p.gratuityAmount ?? 0;
    }
    return { ytdIncome: income, ytdTax: tax, ytdWages: wages, ytdTips: tips };
  }, [ytdPaychecks]);

  const accountMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const a of accounts) m[a.id] = a.name;
    return m;
  }, [accounts]);
  const checkingAccounts = useMemo(() => accounts.filter((a) => a.type === 'checking'), [accounts]);
  const accountName = (id: string) => accountMap[id] ?? '';

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6 sm:space-y-8 pb-24 md:pb-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">{t('paychecks.title')}</h1>
          <p className="text-slate-500 dark:text-slate-400 text-base font-medium mt-1">{t('paychecks.subtitle')}</p>
        </div>
        <Button onClick={() => setOpen(true)} className="w-full md:w-auto shadow-sm hover:shadow-md">
          <Plus className="w-5 h-5" />
          {t('paychecks.logPaycheck')}
        </Button>
      </div>

      {/* YTD Summary */}
      <div className="grid grid-cols-2 gap-4">
        {[
          { label: t('paychecks.ytdIncome'), value: ytdIncome, color: 'text-emerald-600 dark:text-emerald-400' },
          { label: t('paychecks.ytdTax'), value: ytdTax, color: 'text-rose-600 dark:text-rose-400' },
          { label: t('paychecks.ytdTaxableWages'), value: ytdWages, color: 'text-slate-900 dark:text-slate-100' },
          { label: t('paychecks.ytdTips'), value: ytdTips, color: 'text-blue-600 dark:text-blue-400' },
        ].map(({ label, value, color }) => (
          <Card key={label}>
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{label}</p>
            <p className={`text-2xl md:text-3xl font-extrabold mt-2 tracking-tight ${color}`}>{formatCurrency(value)}</p>
          </Card>
        ))}
      </div>

      {/* Paycheck list */}
      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-indigo-600 border-t-transparent" />
        </div>
      ) : paychecks.length === 0 ? (
        <Card className="text-center py-16 bg-slate-50 dark:bg-slate-700/50 border-slate-100 dark:border-slate-700/60">
          <div className="w-16 h-16 rounded-full bg-white dark:bg-slate-800 flex items-center justify-center mx-auto mb-4 shadow-sm border border-slate-100 dark:border-slate-700/60">
            <DollarSign className="w-8 h-8 text-slate-400 dark:text-slate-500" />
          </div>
          <p className="text-slate-900 dark:text-slate-100 font-bold text-lg mb-1">No paychecks logged yet.</p>
          <p className="text-slate-500 dark:text-slate-400 font-medium mb-6">Log your first paycheck to start tracking income.</p>
          <Button onClick={() => setOpen(true)} className="shadow-sm">{t('paychecks.logPaycheck')}</Button>
        </Card>
      ) : (
        <div className="space-y-4">
          {paychecks.map((p) => (
            <div key={p.id} className="group flex flex-col md:flex-row md:items-center justify-between p-4 sm:p-6 rounded-3xl bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700/60 hover:border-slate-200 dark:hover:border-slate-700 hover:shadow-sm transition-all duration-300 gap-4">
              <div className="flex items-center gap-4">
                <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-100 dark:border-emerald-800/50 shrink-0">
                  <DollarSign className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div>
                  <p className="text-base font-bold text-slate-900 dark:text-slate-100">{formatDate(p.date)}</p>
                  {p.notes && accountName(p.notes) && (
                    <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mt-0.5">→ {accountName(p.notes)}</p>
                  )}
                  {p.grossAmount > 0 && (
                    <p className="text-xs font-bold text-slate-400 dark:text-slate-500 mt-0.5">
                      {((calcPaycheckTaxToSave(p) / p.grossAmount) * 100).toFixed(1)}% {t('paychecks.effectiveTaxRate')}
                      {(p.k401 + p.hsa) > 0 && (
                        <span className="ml-1 text-indigo-500 dark:text-indigo-400">
                          · {(((p.k401 + p.hsa) / p.grossAmount) * 100).toFixed(1)}% {t('paychecks.deductions')}
                        </span>
                      )}
                    </p>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 md:flex md:items-center gap-4 md:gap-8 text-left md:text-right w-full md:w-auto">
                <div>
                  <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Wages</p>
                  <p className="text-sm font-extrabold text-slate-700 dark:text-slate-300 mt-1">{formatCurrency(p.grossAmount)}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t('paychecks.tax')}</p>
                  <p className="text-sm font-extrabold text-rose-600 dark:text-rose-400 mt-1">
                    {formatCurrency(calcPaycheckTaxToSave(p))}
                  </p>
                </div>
                {(p.k401 + p.hsa) > 0 && (
                  <div>
                    <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">401k+HSA</p>
                    <p className="text-sm font-extrabold text-indigo-600 dark:text-indigo-400 mt-1">-{formatCurrency(p.k401 + p.hsa)}</p>
                  </div>
                )}
                {(p.gratuityAmount ?? 0) > 0 && (
                  <div>
                    <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Tips</p>
                    <p className="text-sm font-extrabold text-sky-600 dark:text-sky-400 mt-1">+{formatCurrency(p.gratuityAmount)}</p>
                  </div>
                )}
                <div className="flex flex-row md:flex-col justify-between md:justify-end items-center md:items-end col-span-2 md:col-span-1 border-t border-slate-100 dark:border-slate-700/60 md:border-t-0 pt-4 md:pt-0 mt-2 md:mt-0">
                  <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider md:block hidden">
                    {t('paychecks.deposited')}
                  </p>
                  <p className="text-xl font-extrabold text-emerald-600 dark:text-emerald-400 md:mt-1">
                    {formatCurrency(calcPaycheckDeposited(p))}
                  </p>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/30 md:ml-4 h-10 w-10 rounded-xl"
                    onClick={() => handleDelete(p.id)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Paycheck Modal */}
      <Modal open={open} onClose={() => { setOpen(false); setForm(EMPTY_FORM); setPreview(null); }} title={t('paychecks.logPaycheck')}>
        <div className="space-y-5 pb-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label={t('paychecks.payDate')}
              type="date"
              value={form.date}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
            />
            <Input
              label={t('paychecks.totalAmount')}
              type="number"
              min="0"
              step="0.01"
              placeholder="e.g. 3650.00"
              value={form.totalAmount}
              onChange={(e) => setForm((f) => ({ ...f, totalAmount: e.target.value }))}
            />
          </div>
          <Input
            label={t('paychecks.tips')}
            type="number"
            min="0"
            step="0.01"
            placeholder="e.g. 150.00"
            value={form.gratuityAmount}
            onChange={(e) => setForm((f) => ({ ...f, gratuityAmount: e.target.value }))}
          />
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 -mt-3 px-1">
            Enter the full amount you received. If part of it is non-taxable tips, list it separately so tax is only applied to the wage portion.
          </p>
          {checkingAccounts.length > 0 && (
            <Select
              label={t('paychecks.depositAccount')}
              value={form.checkingAccountId}
              options={checkingAccounts.map((a) => ({ value: a.id, label: a.name }))}
              onChange={(e) => setForm((f) => ({ ...f, checkingAccountId: e.target.value }))}
            />
          )}

          {/* Live Preview */}
          {preview && (
            <div className="rounded-2xl bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-700 p-5 space-y-3 shadow-sm">
              <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-4 border-b border-slate-200 dark:border-slate-700 pb-2">{t('paychecks.estimatedBreakdown')}</p>
              {(() => {
                const total = parseFloat(form.totalAmount) || 0;
                const tips = parseFloat(form.gratuityAmount) || 0;
                return tips > 0 ? (
                  <>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-600 dark:text-slate-300 font-medium">{t('paychecks.totalAmountLabel')}</span>
                      <span className="text-slate-900 dark:text-slate-100 font-extrabold">{formatCurrency(total)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-600 dark:text-slate-300 font-medium">{t('paychecks.lessTips')}</span>
                      <span className="text-sky-600 dark:text-sky-400 font-bold">-{formatCurrency(tips)}</span>
                    </div>
                  </>
                ) : null;
              })()}
              {[
                { label: t('paychecks.taxableWages'), value: preview.grossPaycheck, cls: 'text-slate-900 dark:text-slate-100 font-extrabold' },
                {
                  label: settings?.useFederalBrackets
                    ? `Federal Tax (progressive${preview.marginalRate !== undefined ? ` · ${preview.marginalRate.toFixed(0)}% marginal` : ''})`
                    : `Federal Tax (${settings?.federalRate}%)`,
                  value: preview.federalTax,
                  cls: 'text-rose-600 dark:text-rose-400 font-bold',
                },
                { label: `State Tax (${settings?.stateRate}%)`, value: preview.stateTax, cls: 'text-rose-600 dark:text-rose-400 font-bold' },
                { label: `City Tax (${settings?.cityRate}%)`, value: preview.cityTax, cls: 'text-rose-600 dark:text-rose-400 font-bold' },
                { label: 'FICA (SS + Medicare)', value: preview.ficaSs + preview.ficaMedicare, cls: 'text-rose-600 dark:text-rose-400 font-bold' },
              ].map(({ label, value, cls }) => (
                <div key={label} className="flex justify-between text-sm">
                  <span className="text-slate-600 dark:text-slate-300 font-medium">{label}</span>
                  <span className={cls}>{formatCurrency(value)}</span>
                </div>
              ))}
              {(() => {
                const gratuity = parseFloat(form.gratuityAmount) || 0;
                const deposited = preview.grossPaycheck + gratuity;
                return (
                  <>
                    {gratuity > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-600 dark:text-slate-300 font-medium">{t('paychecks.addBackTips')}</span>
                        <span className="text-sky-600 dark:text-sky-400 font-bold">+{formatCurrency(gratuity)}</span>
                      </div>
                    )}
                    <div className="border-t border-slate-200 dark:border-slate-700 pt-3 mt-1 flex justify-between items-center">
                      <span className="text-slate-900 dark:text-slate-100 font-bold">{t('paychecks.income')}</span>
                      <span className="text-emerald-600 dark:text-emerald-400 font-extrabold text-lg">{formatCurrency(deposited)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-900 dark:text-slate-100 font-bold">{t('paychecks.tax')}</span>
                      <span className="text-rose-600 dark:text-rose-400 font-extrabold text-lg">{formatCurrency(preview.totalTax)}</span>
                    </div>
                  </>
                );
              })()}
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400 text-right mt-1 space-y-0.5">
                <p>{t('paychecks.effectiveRate')} {preview.effectiveRate.toFixed(1)}%</p>
                {settings?.useFederalBrackets && preview.taxableIncome !== undefined && (
                  <p>{t('paychecks.annualTaxableIncome')} {preview.taxableIncome.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}</p>
                )}
              </div>
            </div>
          )}

        </div>
        <div className="sticky bottom-0 bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700/60 -mx-6 sm:-mx-8 px-6 sm:px-8 py-4">
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => { setOpen(false); setForm(EMPTY_FORM); setPreview(null); }}>
              {t('common.cancel')}
            </Button>
            <Button className="flex-1 shadow-sm" onClick={handleSave} disabled={!preview || saving}>
              {saving ? t('common.saving') : t('paychecks.savePaycheck')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
