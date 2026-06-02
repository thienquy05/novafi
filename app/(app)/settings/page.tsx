'use client';
import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { Save, RotateCcw, ExternalLink, Plus, X, Info, Globe, RefreshCw, User } from 'lucide-react';
import { BRACKETS_2026, STANDARD_DEDUCTION_2026 } from '@/lib/tax';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { DEFAULT_TAX_SETTINGS } from '@/lib/utils';
import type { TaxSettings } from '@/types';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '@/types';
import { invalidateCategoriesCache } from '@/hooks/useCategories';
import { useTranslation } from '@/lib/i18n/context';

export default function SettingsPage() {
  const { t, lang, setLang } = useTranslation();
  const { data: gSession } = useSession();
  const googleName = gSession?.user?.name ?? '';
  const [settings, setSettings] = useState<TaxSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [newExpCat, setNewExpCat] = useState('');
  const [newIncCat, setNewIncCat] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [darkMode, setDarkMode] = useState(false);

  useEffect(() => {
    try { setDarkMode(localStorage.getItem('nf_theme') === 'dark'); } catch { /* noop */ }
  }, []);

  function toggleDarkMode() {
    const next = !darkMode;
    setDarkMode(next);
    try {
      if (next) {
        document.documentElement.classList.add('dark');
        localStorage.setItem('nf_theme', 'dark');
      } else {
        document.documentElement.classList.remove('dark');
        localStorage.setItem('nf_theme', 'light');
      }
    } catch { /* noop */ }
  }

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((s: TaxSettings) => {
        setSettings({
          ...s,
          displayName: s.displayName ?? '',
          customExpenseCategories: s.customExpenseCategories ?? [],
          customIncomeCategories: s.customIncomeCategories ?? [],
          hiddenExpenseCategories: s.hiddenExpenseCategories ?? [],
          hiddenIncomeCategories: s.hiddenIncomeCategories ?? [],
        });
        if (s.language && s.language !== lang) {
          setLang(s.language);
        }
        setLoading(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function update<K extends keyof TaxSettings>(key: K, value: TaxSettings[K]) {
    setSettings((prev) => prev ? { ...prev, [key]: value } : prev);
  }

  function handleLangChange(newLang: 'en' | 'vi') {
    setLang(newLang);
    setSettings((prev) => prev ? { ...prev, language: newLang } : prev);
  }

  async function handleSave() {
    if (!settings) return;
    setSaving(true);
    await fetch('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
      headers: { 'Content-Type': 'application/json' },
    });
    invalidateCategoriesCache();
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function addExpCat() {
    const cat = newExpCat.trim();
    if (!cat || !settings) return;
    const existing = [...EXPENSE_CATEGORIES as readonly string[], ...(settings.customExpenseCategories ?? [])];
    if (existing.includes(cat)) return;
    setSettings((s) => s ? { ...s, customExpenseCategories: [...(s.customExpenseCategories ?? []), cat] } : s);
    setNewExpCat('');
  }

  function removeExpCat(cat: string) {
    setSettings((s) => s ? { ...s, customExpenseCategories: (s.customExpenseCategories ?? []).filter((c) => c !== cat) } : s);
  }

  function hideExpCat(cat: string) {
    setSettings((s) => s ? { ...s, hiddenExpenseCategories: [...(s.hiddenExpenseCategories ?? []), cat] } : s);
  }

  function restoreExpCat(cat: string) {
    setSettings((s) => s ? { ...s, hiddenExpenseCategories: (s.hiddenExpenseCategories ?? []).filter((c) => c !== cat) } : s);
  }

  function addIncCat() {
    const cat = newIncCat.trim();
    if (!cat || !settings) return;
    const existing = [...INCOME_CATEGORIES as readonly string[], ...(settings.customIncomeCategories ?? [])];
    if (existing.includes(cat)) return;
    setSettings((s) => s ? { ...s, customIncomeCategories: [...(s.customIncomeCategories ?? []), cat] } : s);
    setNewIncCat('');
  }

  function removeIncCat(cat: string) {
    setSettings((s) => s ? { ...s, customIncomeCategories: (s.customIncomeCategories ?? []).filter((c) => c !== cat) } : s);
  }

  function hideIncCat(cat: string) {
    setSettings((s) => s ? { ...s, hiddenIncomeCategories: [...(s.hiddenIncomeCategories ?? []), cat] } : s);
  }

  function restoreIncCat(cat: string) {
    setSettings((s) => s ? { ...s, hiddenIncomeCategories: (s.hiddenIncomeCategories ?? []).filter((c) => c !== cat) } : s);
  }

  async function handleHardRefresh() {
    setRefreshing(true);
    sessionStorage.clear();
    if ('caches' in window) {
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n)));
    }
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    const url = new URL(window.location.href);
    url.searchParams.set('t', Date.now().toString());
    window.location.replace(url.toString());
  }

  function handleReset() {
    if (!confirm('Reset all settings to defaults?')) return;
    setSettings(DEFAULT_TAX_SETTINGS as TaxSettings);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-indigo-500 border-t-transparent" />
      </div>
    );
  }

  if (!settings) return null;

  const currentLang = settings.language ?? lang;

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto pb-24 md:pb-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 md:mb-8">
        <div>
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">{t('settings.title')}</h1>
          <p className="text-slate-500 dark:text-slate-400 text-base font-medium mt-1">{t('settings.subtitle')}</p>
        </div>
        <div className="flex gap-3 w-full md:w-auto">
          <Button variant="secondary" onClick={handleReset} className="flex-1 md:flex-none shadow-sm">
            <RotateCcw className="w-4 h-4" />
            <span className="hidden sm:inline">Reset Defaults</span>
            <span className="sm:hidden">Reset</span>
          </Button>
          <Button onClick={handleSave} disabled={saving} className="flex-1 md:flex-none shadow-sm">
            <Save className="w-4 h-4" />
            {saving ? t('common.saving') : saved ? t('settings.saved') : t('settings.saveSettings')}
          </Button>
        </div>
      </div>

      <div className="space-y-6">
        {/* Name Preference */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />
              {t('settings.namePreference')}
            </CardTitle>
          </CardHeader>
          <div>
            <Input
              label={t('settings.displayName')}
              value={settings.displayName ?? ''}
              placeholder={googleName || t('settings.displayNamePlaceholder')}
              onChange={(e) => update('displayName', e.target.value)}
            />
            <div className="flex items-center justify-between gap-2 mt-2">
              <p className="text-xs text-slate-400 dark:text-slate-500">
                {t('settings.displayNameDesc')}
              </p>
              {googleName && (settings.displayName ?? '').trim() !== '' && (
                <button
                  type="button"
                  onClick={() => update('displayName', '')}
                  className="shrink-0 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                  {t('settings.useGoogleName')}
                </button>
              )}
            </div>
          </div>
        </Card>

        {/* Language & Region */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />
              {t('settings.languageRegion')}
            </CardTitle>
          </CardHeader>
          <div>
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-3">{t('settings.displayLanguage')}</p>
            <div className="flex gap-2">
              {(['en', 'vi'] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => handleLangChange(l)}
                  className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-bold border transition-all duration-200 ${
                    currentLang === l
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                      : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-indigo-300'
                  }`}
                >
                  {l === 'en' ? t('settings.langEn') : t('settings.langVi')}
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-2">{t('common.saving').replace('…', '')} — {t('settings.saveSettings').toLowerCase()} {t('common.saving').toLowerCase().replace('…','')} across devices.</p>
          </div>
        </Card>

        {/* Dashboard Preferences */}
        <Card>
          <CardHeader>
            <CardTitle>{t('settings.dashboardPreferences')}</CardTitle>
          </CardHeader>
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{t('dashboard.liquidNetWorth')}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Excludes long-term loan balances from the net worth headline. Full debt is still shown in the Liabilities card.</p>
              </div>
              <button
                type="button"
                onClick={() => update('excludeLoansFromNetWorth', !settings.excludeLoansFromNetWorth)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                  settings.excludeLoansFromNetWorth ? 'bg-indigo-600' : 'bg-slate-200 dark:bg-slate-600'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white dark:bg-slate-800 shadow ring-0 transition-transform duration-200 ${
                    settings.excludeLoansFromNetWorth ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            <div className="flex items-start justify-between gap-4 pt-4 border-t border-slate-100 dark:border-slate-700/60">
              <div>
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{t('settings.darkMode')}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{t('settings.darkModeDesc')}</p>
              </div>
              <button
                type="button"
                onClick={toggleDarkMode}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                  darkMode ? 'bg-indigo-600' : 'bg-slate-200 dark:bg-slate-600'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white dark:bg-slate-800 shadow ring-0 transition-transform duration-200 ${
                    darkMode ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            <div className="flex items-start justify-between gap-4 pt-4 border-t border-slate-100 dark:border-slate-700/60">
              <div>
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{t('settings.budgetRollover')}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{t('settings.budgetRolloverDesc')}</p>
              </div>
              <button
                type="button"
                onClick={() => update('budgetRollover', !settings.budgetRollover)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                  settings.budgetRollover ? 'bg-indigo-600' : 'bg-slate-200 dark:bg-slate-600'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white dark:bg-slate-800 shadow ring-0 transition-transform duration-200 ${
                    settings.budgetRollover ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>
        </Card>

        {/* Payroll Deductions */}
        <Card>
          <CardHeader>
            <CardTitle>{t('settings.payrollDeductions')}</CardTitle>
          </CardHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <Select
              label={t('settings.filingStatus')}
              value={settings.filingStatus}
              options={[
                { value: 'single', label: t('settings.single') },
                { value: 'mfj',    label: t('settings.mfj') },
                { value: 'mfs',    label: t('settings.mfs') },
                { value: 'hoh',    label: t('settings.hoh') },
              ]}
              onChange={(e) => update('filingStatus', e.target.value as TaxSettings['filingStatus'])}
            />
            <Input
              label={t('settings.payPeriodsPerYear')}
              type="number"
              min="1"
              max="52"
              value={settings.payPeriodsPerYear}
              onChange={(e) => update('payPeriodsPerYear', Number(e.target.value))}
            />
            <Input
              label={t('settings.k401Contribution')}
              type="number"
              min="0"
              max="100"
              step="0.5"
              value={settings.k401Pct}
              onChange={(e) => update('k401Pct', Number(e.target.value))}
            />
            <Input
              label={t('settings.hsaAnnual') + ' ($)'}
              type="number"
              min="0"
              step="50"
              value={settings.hsaAnnual}
              onChange={(e) => update('hsaAnnual', Number(e.target.value))}
            />
            <Input
              label={t('settings.iraAnnual') + ' ($)'}
              type="number"
              min="0"
              step="50"
              value={settings.iraAnnual}
              onChange={(e) => update('iraAnnual', Number(e.target.value))}
            />
          </div>
        </Card>

        {/* Federal Tax */}
        <Card>
          <CardHeader>
            <CardTitle>{t('settings.federalTax')}</CardTitle>
          </CardHeader>

          <div className="flex items-start gap-4 p-4 rounded-2xl bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-100 dark:border-indigo-800/50 mb-5">
            <button
              type="button"
              role="switch"
              aria-checked={settings.useFederalBrackets}
              onClick={() => update('useFederalBrackets', !settings.useFederalBrackets)}
              className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 ${settings.useFederalBrackets ? 'bg-indigo-600' : 'bg-slate-300'}`}
            >
              <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white dark:bg-slate-800 shadow ring-0 transition-transform ${settings.useFederalBrackets ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{t('settings.useFederalBrackets')}</p>
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5">
                {settings.useFederalBrackets
                  ? 'Federal withholding uses real IRS brackets + standard deduction for your filing status. More accurate than a flat rate.'
                  : 'Enter a flat federal rate below. Switch to progressive brackets for automatic IRS bracket calculations.'}
              </p>
            </div>
          </div>

          {settings.useFederalBrackets ? (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Info className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Brackets below are for <span className="font-bold text-slate-700 dark:text-slate-300">{
                    {
                      single: t('settings.single'),
                      mfj: t('settings.mfj'),
                      mfs: t('settings.mfs'),
                      hoh: t('settings.hoh'),
                    }[settings.filingStatus]
                  }</span> — update your filing status in {t('settings.payrollDeductions')} above.
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden mb-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-700/50 border-b border-slate-200 dark:border-slate-700">
                      <th className="text-left px-4 py-2.5 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Taxable Income</th>
                      <th className="text-right px-4 py-2.5 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const brackets = BRACKETS_2026[settings.filingStatus];
                      return brackets.map(({ max, rate }, i) => {
                        const prev = i === 0 ? 0 : brackets[i - 1].max;
                        const from = prev.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
                        const to = max === Infinity ? '∞' : max.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
                        return (
                          <tr key={rate} className="border-b border-slate-100 dark:border-slate-700/60 last:border-0 hover:bg-slate-50/50">
                            <td className="px-4 py-2.5 text-slate-700 dark:text-slate-300 font-medium">{from} – {to}</td>
                            <td className="px-4 py-2.5 text-right">
                              <span className={`inline-block px-2 py-0.5 rounded-lg text-xs font-bold ${rate >= 0.32 ? 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300' : rate >= 0.22 ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300' : 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'}`}>
                                {(rate * 100).toFixed(0)}%
                              </span>
                            </td>
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center gap-2 px-1 mb-5">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Standard deduction:</span>
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  {STANDARD_DEDUCTION_2026[settings.filingStatus].toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}
                </span>
                <span className="text-xs text-slate-400 dark:text-slate-500">subtracted from your income before brackets apply</span>
              </div>

              <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-100 dark:border-emerald-800/50">
                <p className="text-xs font-bold text-emerald-800 dark:text-emerald-300 mb-1">Maximize Your Tax Savings</p>
                <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300 leading-relaxed">
                  Pre-tax contributions to your 401(k), HSA, and IRA reduce your taxable income before brackets apply — every dollar contributed saves you money at your marginal rate.
                  Raise your 401(k) % or HSA amount in <span className="font-bold">{t('settings.payrollDeductions')}</span> above and re-open a paycheck to see the difference.
                </p>
              </div>
            </div>
          ) : (
            <div>
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-5">
                Enter your estimated flat federal rate. Use your marginal bracket rate (e.g. 22%) or your effective rate from last year&apos;s return.
              </p>
              <div>
                <Input
                  label={t('settings.federalRate')}
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={settings.federalRate}
                  onChange={(e) => update('federalRate', Number(e.target.value))}
                />
                <p className="text-xs font-bold text-slate-400 dark:text-slate-500 mt-2 ml-1">e.g. 22 for the 22% bracket</p>
              </div>
            </div>
          )}
        </Card>

        {/* State & Local Tax */}
        <Card>
          <CardHeader>
            <CardTitle>{t('settings.stateLocalTax')}</CardTitle>
          </CardHeader>
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-5">
            Most states and cities use flat rates. Find your city rate on your local municipality&apos;s website.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <Input
                label={t('settings.stateRate')}
                type="number"
                min="0"
                max="20"
                step="0.01"
                value={settings.stateRate}
                onChange={(e) => update('stateRate', Number(e.target.value))}
              />
              <p className="text-xs font-bold text-slate-400 dark:text-slate-500 mt-2 ml-1">e.g. 3.125 for Ohio</p>
            </div>
            <div>
              <Input
                label={t('settings.cityRate')}
                type="number"
                min="0"
                max="10"
                step="0.01"
                value={settings.cityRate}
                onChange={(e) => update('cityRate', Number(e.target.value))}
              />
              <p className="text-xs font-bold text-slate-400 dark:text-slate-500 mt-2 ml-1">e.g. 1.5 for Perrysburg</p>
            </div>
          </div>
        </Card>

        {/* FICA */}
        <Card>
          <CardHeader>
            <CardTitle>{t('settings.fica')}</CardTitle>
          </CardHeader>
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-5">Standard rates — only change if yours differ.</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            <Input
              label="Social Security Rate %"
              type="number"
              min="0"
              step="0.01"
              value={settings.ficaSsRate}
              onChange={(e) => update('ficaSsRate', Number(e.target.value))}
            />
            <Input
              label="SS Wage Base ($)"
              type="number"
              min="0"
              step="100"
              value={settings.ficaSsWageBase}
              onChange={(e) => update('ficaSsWageBase', Number(e.target.value))}
            />
            <Input
              label="Medicare Rate %"
              type="number"
              min="0"
              step="0.01"
              value={settings.ficaMedicareRate}
              onChange={(e) => update('ficaMedicareRate', Number(e.target.value))}
            />
          </div>
        </Card>

        {/* Custom Categories */}
        <Card>
          <CardHeader>
            <CardTitle>{t('settings.customCategories')}</CardTitle>
          </CardHeader>
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-5">
            Add categories beyond the defaults. They appear in all transaction, bill, and budget dropdowns.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {/* Expense */}
            <div>
              <p className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-3">{t('settings.expenseCategories')}</p>
              <div className="flex flex-wrap gap-2 mb-3">
                {[...EXPENSE_CATEGORIES].filter((c) => !(settings.hiddenExpenseCategories ?? []).includes(c)).map((c) => (
                  <span key={c} className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 text-xs font-bold">
                    {c}
                    <button onClick={() => hideExpCat(c)} title="Hide category" className="text-slate-400 dark:text-slate-500 ml-0.5"><X className="w-3 h-3" /></button>
                  </span>
                ))}
                {(settings.customExpenseCategories ?? []).map((c) => (
                  <span key={c} className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-800/50 text-indigo-700 dark:text-indigo-300 text-xs font-bold">
                    {c}
                    <button onClick={() => removeExpCat(c)} className="text-slate-400 dark:text-slate-500 ml-0.5"><X className="w-3 h-3" /></button>
                  </span>
                ))}
              </div>
              {(settings.hiddenExpenseCategories ?? []).length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-3 p-2.5 rounded-xl bg-rose-50 dark:bg-rose-900/30 border border-rose-100 dark:border-rose-800/50">
                  <span className="text-xs font-bold text-rose-400 w-full mb-1">Hidden — click to restore:</span>
                  {(settings.hiddenExpenseCategories ?? []).map((c) => (
                    <button key={c} onClick={() => restoreExpCat(c)} className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-rose-200 dark:border-rose-800/50 text-rose-500 dark:text-rose-400 text-xs font-bold line-through">{c}</button>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <input
                  className="flex-1 h-9 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/10"
                  placeholder={t('settings.addCategory') + '…'}
                  value={newExpCat}
                  onChange={(e) => setNewExpCat(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addExpCat(); } }}
                />
                <button onClick={addExpCat} className="h-9 px-3 rounded-xl bg-indigo-600 text-white">
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>
            {/* Income */}
            <div>
              <p className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-3">{t('settings.incomeCategories')}</p>
              <div className="flex flex-wrap gap-2 mb-3">
                {[...INCOME_CATEGORIES].filter((c) => !(settings.hiddenIncomeCategories ?? []).includes(c)).map((c) => (
                  <span key={c} className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 text-xs font-bold">
                    {c}
                    <button onClick={() => hideIncCat(c)} title="Hide category" className="text-slate-400 dark:text-slate-500 ml-0.5"><X className="w-3 h-3" /></button>
                  </span>
                ))}
                {(settings.customIncomeCategories ?? []).map((c) => (
                  <span key={c} className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800/50 text-emerald-700 dark:text-emerald-300 text-xs font-bold">
                    {c}
                    <button onClick={() => removeIncCat(c)} className="text-slate-400 dark:text-slate-500 ml-0.5"><X className="w-3 h-3" /></button>
                  </span>
                ))}
              </div>
              {(settings.hiddenIncomeCategories ?? []).length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-3 p-2.5 rounded-xl bg-rose-50 dark:bg-rose-900/30 border border-rose-100 dark:border-rose-800/50">
                  <span className="text-xs font-bold text-rose-400 w-full mb-1">Hidden — click to restore:</span>
                  {(settings.hiddenIncomeCategories ?? []).map((c) => (
                    <button key={c} onClick={() => restoreIncCat(c)} className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-rose-200 dark:border-rose-800/50 text-rose-500 dark:text-rose-400 text-xs font-bold line-through">{c}</button>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <input
                  className="flex-1 h-9 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/10"
                  placeholder={t('settings.addCategory') + '…'}
                  value={newIncCat}
                  onChange={(e) => setNewIncCat(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addIncCat(); } }}
                />
                <button onClick={addIncCat} className="h-9 px-3 rounded-xl bg-emerald-600 text-white">
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
          <p className="text-xs font-medium text-slate-400 dark:text-slate-500 mt-4">Changes take effect after clicking {t('settings.saveSettings')}.</p>
        </Card>

        {/* App Update */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />
              {t('settings.appUpdate')}
            </CardTitle>
          </CardHeader>
          <p className="text-sm font-medium text-slate-600 dark:text-slate-300 leading-relaxed mb-4">
            {t('settings.appUpdateDesc')}
          </p>
          <Button variant="secondary" onClick={handleHardRefresh} disabled={refreshing} className="shadow-sm">
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? t('settings.refreshing') : t('settings.forceRefresh')}
          </Button>
        </Card>

        {/* Data Storage */}
        <Card className="bg-indigo-50/50 border-indigo-100 dark:border-indigo-800/50">
          <CardHeader>
            <CardTitle className="text-indigo-900">{t('settings.dataStorage')}</CardTitle>
          </CardHeader>
          <p className="text-sm font-medium text-slate-600 dark:text-slate-300 leading-relaxed">
            All your data is stored in a Google Sheets spreadsheet named{' '}
            <span className="text-indigo-700 dark:text-indigo-300 font-bold">&quot;NovaFi Finance Data&quot;</span>{' '}
            in your Google Drive. You can view or edit it directly.
          </p>
          <a
            href="https://drive.google.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 mt-4 text-sm font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-400 transition-colors bg-white dark:bg-slate-800 px-4 py-2 rounded-xl shadow-sm border border-indigo-100 dark:border-indigo-800/50"
          >
            Open Google Drive <ExternalLink className="w-4 h-4" />
          </a>
        </Card>
      </div>
    </div>
  );
}
