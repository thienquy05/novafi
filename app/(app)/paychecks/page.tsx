'use client';
import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, DollarSign } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { formatCurrency, formatDate, generateId, today } from '@/lib/utils';
import { calcPaycheckTax } from '@/lib/tax';
import type { PaycheckEntry, TaxSettings, Account } from '@/types';

const EMPTY_FORM = {
  date: today(),
  grossAmount: '',
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
    if (!settings || !form.grossAmount) { setPreview(null); return; }
    const gross = parseFloat(form.grossAmount);
    if (isNaN(gross) || gross <= 0) { setPreview(null); return; }

    const ytdGross = paychecks
      .filter((p) => new Date(p.date).getFullYear() === new Date(form.date).getFullYear())
      .reduce((s, p) => s + p.grossAmount, 0);

    setPreview(calcPaycheckTax(gross, settings, ytdGross));
  }, [form.grossAmount, form.date, settings, paychecks]);

  async function handleSave() {
    if (!settings || !preview) return;
    setSaving(true);
    const gratuity = parseFloat(form.gratuityAmount) || 0;
    const entry: PaycheckEntry = {
      id: generateId(),
      date: form.date,
      grossAmount: preview.grossPaycheck,
      federalWithheld: preview.federalTax,
      stateWithheld: preview.stateTax,
      localWithheld: preview.cityTax,
      k401: preview.k401,
      hsa: preview.hsa,
      netAmount: preview.netPaycheck,
      notes: form.checkingAccountId,
      gratuityAmount: gratuity,
    };
    await fetch('/api/paychecks', {
      method: 'POST',
      body: JSON.stringify(entry),
      headers: { 'Content-Type': 'application/json' },
    });

    // Auto-create an income transaction: net pay + gratuity deposited together
    if (form.checkingAccountId) {
      await fetch('/api/transactions', {
        method: 'POST',
        body: JSON.stringify({
          id: generateId(),
          date: form.date,
          description: 'Paycheck',
          amount: preview.netPaycheck + gratuity,
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
    if (!confirm('Delete this paycheck entry?')) return;
    await fetch('/api/paychecks', {
      method: 'DELETE',
      body: JSON.stringify({ id }),
      headers: { 'Content-Type': 'application/json' },
    });
    await load();
  }

  const currentYear = new Date().getFullYear();
  const ytdPaychecks = paychecks.filter((p) => new Date(p.date).getFullYear() === currentYear);
  const ytdNet = ytdPaychecks.reduce((s, p) => s + p.netAmount, 0);
  const ytdGross = ytdPaychecks.reduce((s, p) => s + p.grossAmount, 0);
  const ytdGratuity = ytdPaychecks.reduce((s, p) => s + (p.gratuityAmount ?? 0), 0);

  const checkingAccounts = accounts.filter((a) => a.type === 'checking');
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? '';

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6 sm:space-y-8 pb-24 md:pb-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-slate-900">Paychecks</h1>
          <p className="text-slate-500 text-base font-medium mt-1">Log income — net pay is deposited to your checking account</p>
        </div>
        <Button onClick={() => setOpen(true)} className="w-full md:w-auto shadow-sm hover:shadow-md">
          <Plus className="w-5 h-5" />
          Log Paycheck
        </Button>
      </div>

      {/* YTD Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'YTD Gross', value: ytdGross, color: 'text-slate-900' },
          { label: 'YTD Net (take-home)', value: ytdNet, color: 'text-emerald-600' },
          { label: 'YTD Taxes & Deductions', value: ytdGross - ytdNet, color: 'text-rose-600' },
          { label: 'YTD Gratuity', value: ytdGratuity, color: 'text-sky-600' },
        ].map(({ label, value, color }) => (
          <Card key={label}>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">{label}</p>
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
        <Card className="text-center py-16 bg-slate-50 border-slate-100">
          <div className="w-16 h-16 rounded-full bg-white flex items-center justify-center mx-auto mb-4 shadow-sm border border-slate-100">
            <DollarSign className="w-8 h-8 text-slate-400" />
          </div>
          <p className="text-slate-900 font-bold text-lg mb-1">No paychecks logged yet.</p>
          <p className="text-slate-500 font-medium mb-6">Log your first paycheck to start tracking income.</p>
          <Button onClick={() => setOpen(true)} className="shadow-sm">Log your first paycheck</Button>
        </Card>
      ) : (
        <div className="space-y-4">
          {paychecks.map((p) => (
            <div key={p.id} className="group flex flex-col md:flex-row md:items-center justify-between p-4 sm:p-6 rounded-3xl bg-white border border-slate-100 hover:border-slate-200 hover:shadow-sm transition-all duration-300 gap-4">
              <div className="flex items-center gap-4">
                <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-emerald-50 border border-emerald-100 shrink-0">
                  <DollarSign className="w-6 h-6 text-emerald-600" />
                </div>
                <div>
                  <p className="text-base font-bold text-slate-900">{formatDate(p.date)}</p>
                  {p.notes && accountName(p.notes) && (
                    <p className="text-sm font-medium text-slate-500 mt-0.5">→ {accountName(p.notes)}</p>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 md:flex md:items-center gap-4 md:gap-8 text-left md:text-right w-full md:w-auto">
                <div>
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Gross</p>
                  <p className="text-sm font-extrabold text-slate-700 mt-1">{formatCurrency(p.grossAmount)}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Taxes</p>
                  <p className="text-sm font-extrabold text-rose-600 mt-1">
                    -{formatCurrency(p.federalWithheld + p.stateWithheld + p.localWithheld)}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">401k+HSA</p>
                  <p className="text-sm font-extrabold text-indigo-600 mt-1">-{formatCurrency(p.k401 + p.hsa)}</p>
                </div>
                {(p.gratuityAmount ?? 0) > 0 && (
                  <div>
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Gratuity</p>
                    <p className="text-sm font-extrabold text-sky-600 mt-1">+{formatCurrency(p.gratuityAmount)}</p>
                  </div>
                )}
                <div className="flex flex-row md:flex-col justify-between md:justify-end items-center md:items-end col-span-2 md:col-span-1 border-t border-slate-100 md:border-t-0 pt-4 md:pt-0 mt-2 md:mt-0">
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wider md:block hidden">
                    {(p.gratuityAmount ?? 0) > 0 ? 'Total' : 'Net'}
                  </p>
                  <p className="text-xl font-extrabold text-emerald-600 md:mt-1">
                    {formatCurrency(p.netAmount + (p.gratuityAmount ?? 0))}
                  </p>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-slate-400 hover:text-rose-600 hover:bg-rose-50 md:ml-4 h-10 w-10 rounded-xl"
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
      <Modal open={open} onClose={() => { setOpen(false); setForm(EMPTY_FORM); setPreview(null); }} title="Log Paycheck">
        <div className="space-y-5 pb-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Pay Date"
              type="date"
              value={form.date}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
            />
            <Input
              label="Gross Amount (taxable)"
              type="number"
              min="0"
              step="0.01"
              placeholder="e.g. 3500.00"
              value={form.grossAmount}
              onChange={(e) => setForm((f) => ({ ...f, grossAmount: e.target.value }))}
            />
          </div>
          <Input
            label="Gratuity (optional, non-taxable)"
            type="number"
            min="0"
            step="0.01"
            placeholder="e.g. 150.00"
            value={form.gratuityAmount}
            onChange={(e) => setForm((f) => ({ ...f, gratuityAmount: e.target.value }))}
          />
          {checkingAccounts.length > 0 && (
            <Select
              label="Deposit to Checking Account"
              value={form.checkingAccountId}
              options={checkingAccounts.map((a) => ({ value: a.id, label: a.name }))}
              onChange={(e) => setForm((f) => ({ ...f, checkingAccountId: e.target.value }))}
            />
          )}

          {/* Live Preview */}
          {preview && (
            <div className="rounded-2xl bg-slate-50 border border-slate-200 p-5 space-y-3 shadow-sm">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-4 border-b border-slate-200 pb-2">Estimated Breakdown</p>
              {[
                { label: 'Gross Pay (taxable)', value: preview.grossPaycheck, cls: 'text-slate-900 font-extrabold' },
                { label: `401(k) (${settings?.k401Pct}%)`, value: -preview.k401, cls: 'text-indigo-600 font-bold' },
                { label: 'HSA', value: -preview.hsa, cls: 'text-indigo-600 font-bold' },
                {
                  label: settings?.useFederalBrackets
                    ? `Federal Tax (progressive${preview.marginalRate !== undefined ? ` · ${preview.marginalRate.toFixed(0)}% marginal` : ''})`
                    : `Federal Tax (${settings?.federalRate}%)`,
                  value: -preview.federalTax,
                  cls: 'text-rose-600 font-bold',
                },
                { label: `State Tax (${settings?.stateRate}%)`, value: -preview.stateTax, cls: 'text-rose-600 font-bold' },
                { label: `City Tax (${settings?.cityRate}%)`, value: -preview.cityTax, cls: 'text-rose-600 font-bold' },
                { label: 'FICA (SS + Medicare)', value: -(preview.ficaSs + preview.ficaMedicare), cls: 'text-rose-600 font-bold' },
              ].map(({ label, value, cls }) => (
                <div key={label} className="flex justify-between text-sm">
                  <span className="text-slate-600 font-medium">{label}</span>
                  <span className={cls}>{value >= 0 ? formatCurrency(value) : `-${formatCurrency(Math.abs(value))}`}</span>
                </div>
              ))}
              {(() => {
                const gratuity = parseFloat(form.gratuityAmount) || 0;
                return gratuity > 0 ? (
                  <>
                    <div className="border-t border-slate-200 pt-3 mt-1 flex justify-between text-sm">
                      <span className="text-slate-600 font-medium">Net Paycheck</span>
                      <span className="text-slate-700 font-bold">{formatCurrency(preview.netPaycheck)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-600 font-medium">Gratuity (non-taxable)</span>
                      <span className="text-sky-600 font-bold">+{formatCurrency(gratuity)}</span>
                    </div>
                    <div className="border-t border-slate-200 pt-3 mt-1 flex justify-between items-center">
                      <span className="text-slate-900 font-bold">Total Take-Home</span>
                      <span className="text-emerald-600 font-extrabold text-lg">{formatCurrency(preview.netPaycheck + gratuity)}</span>
                    </div>
                  </>
                ) : (
                  <div className="border-t border-slate-200 pt-3 mt-3 flex justify-between items-center">
                    <span className="text-slate-900 font-bold">Net Take-Home</span>
                    <span className="text-emerald-600 font-extrabold text-lg">{formatCurrency(preview.netPaycheck)}</span>
                  </div>
                );
              })()}
              <div className="text-xs font-medium text-slate-500 text-right mt-1 space-y-0.5">
                <p>Effective rate: {preview.effectiveRate.toFixed(1)}%</p>
                {settings?.useFederalBrackets && preview.taxableIncome !== undefined && (
                  <p>Annual taxable income: {preview.taxableIncome.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}</p>
                )}
              </div>
            </div>
          )}

        </div>
        <div className="sticky bottom-0 bg-white border-t border-slate-100 -mx-6 sm:-mx-8 px-6 sm:px-8 py-4">
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => { setOpen(false); setForm(EMPTY_FORM); setPreview(null); }}>
              Cancel
            </Button>
            <Button className="flex-1 shadow-sm" onClick={handleSave} disabled={!preview || saving}>
              {saving ? 'Saving…' : 'Save Paycheck'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
