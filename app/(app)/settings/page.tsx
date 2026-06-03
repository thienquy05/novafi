'use client';
import { useState, useEffect } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { Save, RotateCcw, ExternalLink, Plus, X, Info, Globe, RefreshCw, User, SlidersHorizontal, Receipt, Tags, Landmark, Building2, Database, ShieldCheck, ChevronDown, LogOut, Users, UserPlus, Trash2, Archive } from 'lucide-react';
import { BRACKETS_2026, STANDARD_DEDUCTION_2026 } from '@/lib/tax';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { DEFAULT_TAX_SETTINGS } from '@/lib/utils';
import type { TaxSettings, Contact } from '@/types';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '@/types';
import { generateId } from '@/lib/utils';
import { invalidateCategoriesCache } from '@/hooks/useCategories';
import { useToast } from '@/lib/toast';
import { useTranslation } from '@/lib/i18n/context';

type SectionId = 'general' | 'taxes' | 'categories' | 'contacts' | 'about';

// Reusable labeled toggle row — replaces the four near-identical switch blocks
// that the settings page used to repeat inline.
function ToggleRow({ label, desc, checked, onChange, divider = false }: {
  label: string;
  desc: string;
  checked: boolean;
  onChange: () => void;
  divider?: boolean;
}) {
  return (
    <div className={`flex items-start justify-between gap-4 ${divider ? 'pt-4 border-t border-slate-100 dark:border-slate-700/60' : ''}`}>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{label}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{desc}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={onChange}
        className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 ${checked ? 'bg-indigo-600' : 'bg-slate-200 dark:bg-slate-600'}`}
      >
        <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white dark:bg-slate-800 shadow ring-0 transition-transform duration-200 ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
      </button>
    </div>
  );
}

// Consistent icon + title header used by every settings card.
function SectionTitle({ icon: Icon, children }: { icon: typeof User; children: React.ReactNode }) {
  return (
    <CardTitle className="flex items-center gap-2.5">
      <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-indigo-50 dark:bg-indigo-900/30 text-indigo-500 dark:text-indigo-400">
        <Icon className="w-4 h-4" />
      </span>
      {children}
    </CardTitle>
  );
}

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
  const [section, setSection] = useState<SectionId>('general');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [newContactName, setNewContactName] = useState('');
  const [addingContact, setAddingContact] = useState(false);
  // Which custom category the user clicked X on (drives the Archive/Delete dialog).
  const [catToRemove, setCatToRemove] = useState<{ cat: string; kind: 'exp' | 'inc' } | null>(null);
  // Categories that tag at least one transaction — Delete is blocked for these
  // (archive keeps history findable). Counted from the ledger on mount.
  const [catUsage, setCatUsage] = useState<Record<string, number>>({});
  const toast = useToast();

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

  useEffect(() => {
    fetch('/api/contacts')
      .then((r) => r.json())
      .then((c: Contact[]) => setContacts([...(c ?? [])].sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => { /* tab may not exist yet; created on first add */ });
  }, []);

  // Tally how many transactions reference each category so the remove dialog can
  // block a hard Delete (and steer to Archive) when history would be orphaned.
  useEffect(() => {
    fetch('/api/transactions')
      .then((r) => r.json())
      .then((txs: { category: string }[]) => {
        const counts: Record<string, number> = {};
        for (const tx of txs ?? []) counts[tx.category] = (counts[tx.category] ?? 0) + 1;
        setCatUsage(counts);
      })
      .catch(() => { /* leave empty — Delete simply isn't blocked */ });
  }, []);

  // Contacts persist to Google Sheets (shared with the bill-splitting flows), so
  // they're available everywhere — not just this device's local storage.
  async function addContact() {
    const name = newContactName.trim();
    if (!name || addingContact) return;
    if (contacts.some((c) => c.name.toLowerCase() === name.toLowerCase())) { setNewContactName(''); return; }
    setAddingContact(true);
    const contact: Contact = { id: generateId(), name, createdAt: new Date().toISOString() };
    setContacts((prev) => [...prev, contact].sort((a, b) => a.name.localeCompare(b.name)));
    setNewContactName('');
    try {
      const res = await fetch('/api/contacts', { method: 'POST', body: JSON.stringify(contact), headers: { 'Content-Type': 'application/json' } });
      if (!res.ok) throw new Error();
      toast(t('settings.contactAdded'), 'success');
    } catch {
      setContacts((prev) => prev.filter((c) => c.id !== contact.id));
      toast(t('settings.contactSaveFailed'), 'error');
    } finally {
      setAddingContact(false);
    }
  }

  async function removeContact(contact: Contact) {
    if (!confirm(t('settings.contactDeleteConfirm', { name: contact.name }))) return;
    const prev = contacts;
    setContacts((cs) => cs.filter((c) => c.id !== contact.id));
    try {
      const res = await fetch('/api/contacts', { method: 'DELETE', body: JSON.stringify({ id: contact.id }), headers: { 'Content-Type': 'application/json' } });
      if (!res.ok) throw new Error();
    } catch {
      setContacts(prev);
      toast(t('settings.contactSaveFailed'), 'error');
    }
  }

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

  // Guard against a misclick — signing out drops you back to the login screen.
  function handleSignOut() {
    if (!confirm(t('settings.signOutConfirm'))) return;
    signOut({ callbackUrl: '/' });
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

  const SECTIONS: { id: SectionId; label: string; icon: typeof User }[] = [
    { id: 'general', label: t('settings.sectionGeneral'), icon: SlidersHorizontal },
    { id: 'taxes', label: t('settings.sectionTaxes'), icon: Receipt },
    { id: 'categories', label: t('settings.sectionCategories'), icon: Tags },
    { id: 'contacts', label: t('settings.sectionContacts'), icon: Users },
    { id: 'about', label: t('settings.sectionAbout'), icon: Database },
  ];

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto pb-24 md:pb-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
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

      {/* In-page section tabs — sticky, scrollable on mobile. These live inside
          the Settings page only; the app nav bar is unchanged. */}
      <div className="sticky top-0 z-20 -mx-4 md:mx-0 px-4 md:px-0 py-2 mb-6 bg-slate-50/80 dark:bg-slate-900/80 backdrop-blur supports-[backdrop-filter]:bg-slate-50/60 dark:supports-[backdrop-filter]:bg-slate-900/60">
        <div className="flex gap-2 overflow-x-auto hide-scrollbar">
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setSection(id)}
              className={`flex items-center gap-2 whitespace-nowrap px-4 py-2 rounded-xl text-sm font-bold border transition-all duration-200 ${
                section === id
                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                  : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-700'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── General ── */}
      {section === 'general' && (
        <div className="space-y-6">
          {/* Name Preference */}
          <Card>
            <CardHeader>
              <SectionTitle icon={User}>{t('settings.namePreference')}</SectionTitle>
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
              <SectionTitle icon={Globe}>{t('settings.languageRegion')}</SectionTitle>
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
            </div>
          </Card>

          {/* Dashboard Preferences */}
          <Card>
            <CardHeader>
              <SectionTitle icon={SlidersHorizontal}>{t('settings.dashboardPreferences')}</SectionTitle>
            </CardHeader>
            <div className="space-y-4">
              <ToggleRow
                label={t('dashboard.liquidNetWorth')}
                desc="Excludes long-term loan balances from the net worth headline. Full debt is still shown in the Liabilities card."
                checked={settings.excludeLoansFromNetWorth}
                onChange={() => update('excludeLoansFromNetWorth', !settings.excludeLoansFromNetWorth)}
              />
              <ToggleRow
                divider
                label={t('settings.darkMode')}
                desc={t('settings.darkModeDesc')}
                checked={darkMode}
                onChange={toggleDarkMode}
              />
              <ToggleRow
                divider
                label={t('settings.budgetRollover')}
                desc={t('settings.budgetRolloverDesc')}
                checked={settings.budgetRollover}
                onChange={() => update('budgetRollover', !settings.budgetRollover)}
              />
            </div>
          </Card>

          {/* Account — sign out (moved here from the nav; confirms before leaving) */}
          <Card>
            <CardHeader>
              <SectionTitle icon={LogOut}>{t('settings.account')}</SectionTitle>
            </CardHeader>
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{t('nav.signOut')}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{t('settings.signOutDesc')}</p>
              </div>
              <Button
                variant="secondary"
                onClick={handleSignOut}
                className="shrink-0 shadow-sm text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20"
              >
                <LogOut className="w-4 h-4" />
                {t('nav.signOut')}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* ── Taxes & Payroll ── */}
      {section === 'taxes' && (
        <div className="space-y-6">
          {/* Payroll Deductions */}
          <Card>
            <CardHeader>
              <SectionTitle icon={Receipt}>{t('settings.payrollDeductions')}</SectionTitle>
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
              <SectionTitle icon={Landmark}>{t('settings.federalTax')}</SectionTitle>
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
                {/* Heavy reference content tucked into an expandable so it doesn't
                    dominate the page; the active filing status stays visible. */}
                <details className="group rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                  <summary className="flex items-center justify-between gap-2 px-4 py-3 cursor-pointer select-none list-none bg-slate-50 dark:bg-slate-700/50 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                    <span className="flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-300">
                      <Info className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                      2026 IRS brackets — {
                        {
                          single: t('settings.single'),
                          mfj: t('settings.mfj'),
                          mfs: t('settings.mfs'),
                          hoh: t('settings.hoh'),
                        }[settings.filingStatus]
                      }
                    </span>
                    <ChevronDown className="w-4 h-4 text-slate-400 transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="p-4 border-t border-slate-200 dark:border-slate-700">
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-3">
                      Update your filing status in <span className="font-bold">{t('settings.payrollDeductions')}</span> to change these.
                    </p>
                    <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden mb-4">
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
                    <div className="flex flex-wrap items-center gap-2 px-1">
                      <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Standard deduction:</span>
                      <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                        {STANDARD_DEDUCTION_2026[settings.filingStatus].toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}
                      </span>
                      <span className="text-xs text-slate-400 dark:text-slate-500">subtracted before brackets apply</span>
                    </div>
                  </div>
                </details>

                <div className="mt-4 p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-100 dark:border-emerald-800/50">
                  <p className="text-xs font-bold text-emerald-800 dark:text-emerald-300 mb-1">Maximize Your Tax Savings</p>
                  <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300 leading-relaxed">
                    Pre-tax contributions to your 401(k), HSA, and IRA reduce your taxable income before brackets apply — every dollar contributed saves you money at your marginal rate.
                    Raise your 401(k) % or HSA amount in <span className="font-bold">{t('settings.payrollDeductions')}</span> and re-open a paycheck to see the difference.
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
              <SectionTitle icon={Building2}>{t('settings.stateLocalTax')}</SectionTitle>
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
              <SectionTitle icon={ShieldCheck}>{t('settings.fica')}</SectionTitle>
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
        </div>
      )}

      {/* ── Categories ── */}
      {section === 'categories' && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <SectionTitle icon={Tags}>{t('settings.customCategories')}</SectionTitle>
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
                      <button onClick={() => hideExpCat(c)} title={t('categories.archiveAction')} className="text-slate-400 dark:text-slate-500 ml-0.5"><X className="w-3 h-3" /></button>
                    </span>
                  ))}
                  {(settings.customExpenseCategories ?? []).filter((c) => !(settings.hiddenExpenseCategories ?? []).includes(c)).map((c) => (
                    <span key={c} className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-800/50 text-indigo-700 dark:text-indigo-300 text-xs font-bold">
                      {c}
                      <button onClick={() => setCatToRemove({ cat: c, kind: 'exp' })} title={t('categories.archiveTitle')} className="text-slate-400 dark:text-slate-500 ml-0.5"><X className="w-3 h-3" /></button>
                    </span>
                  ))}
                </div>
                {(settings.hiddenExpenseCategories ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-3 p-2.5 rounded-xl bg-amber-50 dark:bg-amber-900/30 border border-amber-100 dark:border-amber-800/50">
                    <span className="text-xs font-bold text-amber-500 dark:text-amber-400 w-full mb-1 flex items-center gap-1"><Archive className="w-3 h-3" />{t('categories.archivedSection')} — {t('categories.restoreHint')}:</span>
                    {(settings.hiddenExpenseCategories ?? []).map((c) => (
                      <button key={c} onClick={() => restoreExpCat(c)} className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-amber-200 dark:border-amber-800/50 text-amber-600 dark:text-amber-400 text-xs font-bold">{c}</button>
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
                      <button onClick={() => hideIncCat(c)} title={t('categories.archiveAction')} className="text-slate-400 dark:text-slate-500 ml-0.5"><X className="w-3 h-3" /></button>
                    </span>
                  ))}
                  {(settings.customIncomeCategories ?? []).filter((c) => !(settings.hiddenIncomeCategories ?? []).includes(c)).map((c) => (
                    <span key={c} className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800/50 text-emerald-700 dark:text-emerald-300 text-xs font-bold">
                      {c}
                      <button onClick={() => setCatToRemove({ cat: c, kind: 'inc' })} title={t('categories.archiveTitle')} className="text-slate-400 dark:text-slate-500 ml-0.5"><X className="w-3 h-3" /></button>
                    </span>
                  ))}
                </div>
                {(settings.hiddenIncomeCategories ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-3 p-2.5 rounded-xl bg-amber-50 dark:bg-amber-900/30 border border-amber-100 dark:border-amber-800/50">
                    <span className="text-xs font-bold text-amber-500 dark:text-amber-400 w-full mb-1 flex items-center gap-1"><Archive className="w-3 h-3" />{t('categories.archivedSection')} — {t('categories.restoreHint')}:</span>
                    {(settings.hiddenIncomeCategories ?? []).map((c) => (
                      <button key={c} onClick={() => restoreIncCat(c)} className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-amber-200 dark:border-amber-800/50 text-amber-600 dark:text-amber-400 text-xs font-bold">{c}</button>
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
        </div>
      )}

      {/* ── Contacts ── */}
      {section === 'contacts' && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <SectionTitle icon={Users}>{t('settings.contactsTitle')}</SectionTitle>
            </CardHeader>
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-5">
              {t('settings.contactsDesc')}
            </p>

            <div className="flex gap-2 mb-5">
              <input
                className="flex-1 h-9 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/10"
                placeholder={t('settings.contactNamePlaceholder')}
                value={newContactName}
                onChange={(e) => setNewContactName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addContact(); } }}
              />
              <button onClick={addContact} disabled={addingContact || !newContactName.trim()} className="h-9 px-3 rounded-xl bg-indigo-600 text-white disabled:opacity-40 flex items-center gap-1.5 text-sm font-bold">
                <UserPlus className="w-4 h-4" /><span className="hidden sm:inline">{t('settings.addContactBtn')}</span>
              </button>
            </div>

            {contacts.length === 0 ? (
              <p className="text-center text-sm text-slate-400 dark:text-slate-500 font-medium py-8">{t('settings.contactsEmpty')}</p>
            ) : (
              <div className="space-y-2">
                {contacts.map((c) => (
                  <div key={c.id} className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-700/40 border border-slate-100 dark:border-slate-700/60">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="flex items-center justify-center w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-300 text-sm font-bold shrink-0">{c.name.charAt(0).toUpperCase()}</span>
                      <span className="text-sm font-bold text-slate-800 dark:text-slate-200 truncate">{c.name}</span>
                    </div>
                    <button onClick={() => removeContact(c)} title={t('common.delete')} className="p-2 text-slate-400 dark:text-slate-500 hover:text-rose-500 dark:hover:text-rose-400 rounded-lg transition-colors shrink-0">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs font-medium text-slate-400 dark:text-slate-500 mt-4">{t('settings.contactsNote')}</p>
          </Card>
        </div>
      )}

      {/* ── About & Data ── */}
      {section === 'about' && (
        <div className="space-y-6">
          {/* App Update */}
          <Card>
            <CardHeader>
              <SectionTitle icon={RefreshCw}>{t('settings.appUpdate')}</SectionTitle>
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
          <Card className="bg-indigo-50/50 dark:bg-indigo-900/10 border-indigo-100 dark:border-indigo-800/50">
            <CardHeader>
              <SectionTitle icon={Database}>{t('settings.dataStorage')}</SectionTitle>
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
      )}

      {/* Archive / Delete a custom category. Delete is blocked when transactions
          reference the category so history is never orphaned; Archive always
          works and keeps the category in history filters. */}
      {catToRemove && (() => {
        const used = catUsage[catToRemove.cat] ?? 0;
        const archive = () => {
          if (catToRemove.kind === 'exp') hideExpCat(catToRemove.cat); else hideIncCat(catToRemove.cat);
          setCatToRemove(null);
        };
        const del = () => {
          if (used > 0) return;
          if (catToRemove.kind === 'exp') removeExpCat(catToRemove.cat); else removeIncCat(catToRemove.cat);
          setCatToRemove(null);
        };
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setCatToRemove(null)}>
            <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-800 p-5 shadow-xl border border-slate-200 dark:border-slate-700" onClick={(e) => e.stopPropagation()}>
              <p className="text-base font-extrabold text-slate-900 dark:text-slate-100 mb-1">{t('categories.archiveTitle')}</p>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">{t('categories.archivePrompt', { name: catToRemove.cat })}</p>
              <div className="space-y-2.5">
                <button onClick={archive} className="w-full text-left p-3 rounded-xl bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800/50 hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors">
                  <span className="flex items-center gap-2 text-sm font-bold text-amber-700 dark:text-amber-300"><Archive className="w-4 h-4" />{t('categories.archiveAction')}</span>
                  <span className="block text-xs text-amber-600/80 dark:text-amber-400/80 mt-0.5">{t('categories.archiveDesc')}</span>
                </button>
                <button onClick={del} disabled={used > 0} className="w-full text-left p-3 rounded-xl bg-rose-50 dark:bg-rose-900/30 border border-rose-200 dark:border-rose-800/50 enabled:hover:bg-rose-100 dark:enabled:hover:bg-rose-900/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                  <span className="flex items-center gap-2 text-sm font-bold text-rose-700 dark:text-rose-300"><Trash2 className="w-4 h-4" />{t('categories.deleteAction')}</span>
                  <span className="block text-xs text-rose-600/80 dark:text-rose-400/80 mt-0.5">{used > 0 ? t('categories.deleteBlocked', { count: used }) : t('categories.deleteDesc')}</span>
                </button>
                <button onClick={() => setCatToRemove(null)} className="w-full p-2.5 rounded-xl text-sm font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">{t('common.cancel')}</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
