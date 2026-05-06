'use client';
import { useState, useEffect } from 'react';
import { Save, RotateCcw, ExternalLink, Plus, X } from 'lucide-react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { DEFAULT_TAX_SETTINGS } from '@/lib/utils';
import type { TaxSettings } from '@/types';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '@/types';
import { invalidateCategoriesCache } from '@/hooks/useCategories';

export default function SettingsPage() {
  const [settings, setSettings] = useState<TaxSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [newExpCat, setNewExpCat] = useState('');
  const [newIncCat, setNewIncCat] = useState('');

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((s: TaxSettings) => {
        setSettings({
          ...s,
          customExpenseCategories: s.customExpenseCategories ?? [],
          customIncomeCategories: s.customIncomeCategories ?? [],
        });
        setLoading(false);
      });
  }, []);

  function update<K extends keyof TaxSettings>(key: K, value: TaxSettings[K]) {
    setSettings((prev) => prev ? { ...prev, [key]: value } : prev);
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

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto pb-24 md:pb-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 md:mb-8">
        <div>
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-slate-900">Settings</h1>
          <p className="text-slate-500 text-base font-medium mt-1">Configure your payroll deductions and tax rates</p>
        </div>
        <div className="flex gap-3 w-full md:w-auto">
          <Button variant="secondary" onClick={handleReset} className="flex-1 md:flex-none shadow-sm">
            <RotateCcw className="w-4 h-4" />
            <span className="hidden sm:inline">Reset Defaults</span>
            <span className="sm:hidden">Reset</span>
          </Button>
          <Button onClick={handleSave} disabled={saving} className="flex-1 md:flex-none shadow-sm">
            <Save className="w-4 h-4" />
            {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save'}
          </Button>
        </div>
      </div>

      <div className="space-y-6">
        {/* Payroll Deductions */}
        <Card>
          <CardHeader>
            <CardTitle>Payroll & Deductions</CardTitle>
          </CardHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <Select
              label="Filing Status"
              value={settings.filingStatus}
              options={[
                { value: 'single', label: 'Single' },
                { value: 'mfj', label: 'Married Filing Jointly' },
                { value: 'mfs', label: 'Married Filing Separately' },
                { value: 'hoh', label: 'Head of Household' },
              ]}
              onChange={(e) => update('filingStatus', e.target.value as TaxSettings['filingStatus'])}
            />
            <Input
              label="Pay Periods per Year"
              type="number"
              min="1"
              max="52"
              value={settings.payPeriodsPerYear}
              onChange={(e) => update('payPeriodsPerYear', Number(e.target.value))}
            />
            <Input
              label="401(k) Contribution %"
              type="number"
              min="0"
              max="100"
              step="0.5"
              value={settings.k401Pct}
              onChange={(e) => update('k401Pct', Number(e.target.value))}
            />
            <Input
              label="HSA Annual Contribution ($)"
              type="number"
              min="0"
              step="50"
              value={settings.hsaAnnual}
              onChange={(e) => update('hsaAnnual', Number(e.target.value))}
            />
            <Input
              label="IRA Annual Contribution ($)"
              type="number"
              min="0"
              step="50"
              value={settings.iraAnnual}
              onChange={(e) => update('iraAnnual', Number(e.target.value))}
            />
          </div>
        </Card>

        {/* Tax Rates */}
        <Card>
          <CardHeader>
            <CardTitle>Tax Rates</CardTitle>
          </CardHeader>
          <p className="text-sm font-medium text-slate-500 mb-5">
            Enter your estimated flat rates. For federal, use your marginal or effective rate.
            Find your city rate on your local municipality&apos;s website.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            <div>
              <Input
                label="Federal Rate %"
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={settings.federalRate}
                onChange={(e) => update('federalRate', Number(e.target.value))}
              />
              <p className="text-xs font-bold text-slate-400 mt-2 ml-1">e.g. 22 for the 22% bracket</p>
            </div>
            <div>
              <Input
                label="State Rate %"
                type="number"
                min="0"
                max="20"
                step="0.01"
                value={settings.stateRate}
                onChange={(e) => update('stateRate', Number(e.target.value))}
              />
              <p className="text-xs font-bold text-slate-400 mt-2 ml-1">e.g. 3.125 for Ohio</p>
            </div>
            <div>
              <Input
                label="City Rate %"
                type="number"
                min="0"
                max="10"
                step="0.01"
                value={settings.cityRate}
                onChange={(e) => update('cityRate', Number(e.target.value))}
              />
              <p className="text-xs font-bold text-slate-400 mt-2 ml-1">e.g. 1.5 for Perrysburg</p>
            </div>
          </div>
        </Card>

        {/* FICA */}
        <Card>
          <CardHeader>
            <CardTitle>FICA</CardTitle>
          </CardHeader>
          <p className="text-sm font-medium text-slate-500 mb-5">Standard rates — only change if yours differ.</p>
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
            <CardTitle>Custom Categories</CardTitle>
          </CardHeader>
          <p className="text-sm font-medium text-slate-500 mb-5">
            Add categories beyond the defaults. They appear in all transaction, bill, and budget dropdowns.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {/* Expense */}
            <div>
              <p className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-3">Expense Categories</p>
              <div className="flex flex-wrap gap-2 mb-3">
                {[...EXPENSE_CATEGORIES].map((c) => (
                  <span key={c} className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-500 text-xs font-bold">{c}</span>
                ))}
                {(settings.customExpenseCategories ?? []).map((c) => (
                  <span key={c} className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-bold">
                    {c}
                    <button onClick={() => removeExpCat(c)} className="hover:text-rose-600 transition-colors ml-0.5"><X className="w-3 h-3" /></button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  className="flex-1 h-9 px-3 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/10"
                  placeholder="New category…"
                  value={newExpCat}
                  onChange={(e) => setNewExpCat(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addExpCat(); } }}
                />
                <button onClick={addExpCat} className="h-9 px-3 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 transition-colors">
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>
            {/* Income */}
            <div>
              <p className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-3">Income Categories</p>
              <div className="flex flex-wrap gap-2 mb-3">
                {[...INCOME_CATEGORIES].map((c) => (
                  <span key={c} className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-500 text-xs font-bold">{c}</span>
                ))}
                {(settings.customIncomeCategories ?? []).map((c) => (
                  <span key={c} className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold">
                    {c}
                    <button onClick={() => removeIncCat(c)} className="hover:text-rose-600 transition-colors ml-0.5"><X className="w-3 h-3" /></button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  className="flex-1 h-9 px-3 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/10"
                  placeholder="New category…"
                  value={newIncCat}
                  onChange={(e) => setNewIncCat(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addIncCat(); } }}
                />
                <button onClick={addIncCat} className="h-9 px-3 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 transition-colors">
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
          <p className="text-xs font-medium text-slate-400 mt-4">Changes take effect after clicking Save above.</p>
        </Card>

        {/* Data Storage */}
        <Card className="bg-indigo-50/50 border-indigo-100">
          <CardHeader>
            <CardTitle className="text-indigo-900">Data Storage</CardTitle>
          </CardHeader>
          <p className="text-sm font-medium text-slate-600 leading-relaxed">
            All your data is stored in a Google Sheets spreadsheet named{' '}
            <span className="text-indigo-700 font-bold">&quot;NovaFi Finance Data&quot;</span>{' '}
            in your Google Drive. You can view or edit it directly.
          </p>
          <a
            href="https://drive.google.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 mt-4 text-sm font-bold text-indigo-600 hover:text-indigo-500 transition-colors bg-white px-4 py-2 rounded-xl shadow-sm border border-indigo-100"
          >
            Open Google Drive <ExternalLink className="w-4 h-4" />
          </a>
        </Card>
      </div>
    </div>
  );
}
