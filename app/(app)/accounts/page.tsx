'use client';
import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, CreditCard, Landmark, PiggyBank, TrendingUp, Pencil, CheckCircle2 } from 'lucide-react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { formatCurrency, generateId, today } from '@/lib/utils';
import type { Account } from '@/types';

const ACCOUNT_COLORS = [
  '#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#84cc16',
];

const ACCOUNT_TYPE_CONFIG = {
  checking: { label: 'Checking', icon: Landmark, colorClass: 'text-blue-600', bgClass: 'bg-blue-50' },
  savings: { label: 'Savings', icon: PiggyBank, colorClass: 'text-emerald-600', bgClass: 'bg-emerald-50' },
  credit: { label: 'Credit Card', icon: CreditCard, colorClass: 'text-rose-600', bgClass: 'bg-rose-50' },
  investment: { label: 'Investment', icon: TrendingUp, colorClass: 'text-indigo-600', bgClass: 'bg-indigo-50' },
  loan: { label: 'Loan', icon: CreditCard, colorClass: 'text-amber-600', bgClass: 'bg-amber-50' },
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
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [open, setOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Account | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/accounts');
    setAccounts(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  function openAdd() {
    setEditTarget(null);
    setForm(EMPTY_FORM);
    setOpen(true);
  }

  function openEdit(account: Account) {
    setEditTarget(account);
    setForm({
      name: account.name,
      type: account.type,
      institution: account.institution,
      balance: String(account.balance),
      last4: account.last4,
      color: account.color,
    });
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
    await fetch('/api/accounts', {
      method: 'POST',
      body: JSON.stringify(account),
      headers: { 'Content-Type': 'application/json' },
    });
    setOpen(false);
    setForm(EMPTY_FORM);
    setEditTarget(null);
    await load();
    setSaving(false);
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this account?')) return;
    await fetch('/api/accounts', {
      method: 'DELETE',
      body: JSON.stringify({ id }),
      headers: { 'Content-Type': 'application/json' },
    });
    await load();
  }

  const netWorth = accounts.reduce((sum, a) => {
    return sum + (a.type === 'credit' || a.type === 'loan' ? -a.balance : a.balance);
  }, 0);

  const totalAssets = accounts
    .filter((a) => a.type !== 'credit' && a.type !== 'loan')
    .reduce((s, a) => s + a.balance, 0);

  const totalDebt = accounts
    .filter((a) => (a.type === 'credit' || a.type === 'loan') && a.balance > 0)
    .reduce((s, a) => s + a.balance, 0);

  const grouped = {
    checking: accounts.filter((a) => a.type === 'checking'),
    savings: accounts.filter((a) => a.type === 'savings'),
    credit: accounts.filter((a) => a.type === 'credit'),
    investment: accounts.filter((a) => a.type === 'investment'),
    loan: accounts.filter((a) => a.type === 'loan'),
  };

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6 sm:space-y-8 pb-24 md:pb-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-slate-900">Accounts</h1>
          <p className="text-slate-500 text-base font-medium mt-1">Manage your checking, savings, and credit cards</p>
        </div>
        <Button onClick={openAdd} className="w-full md:w-auto shadow-sm hover:shadow-md">
          <Plus className="w-5 h-5" />
          Add Account
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-indigo-100 hover:border-indigo-200">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Net Worth</p>
          <p className={`text-2xl md:text-3xl font-extrabold mt-2 tracking-tight ${netWorth >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
            {formatCurrency(netWorth)}
          </p>
        </Card>
        <Card>
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total Assets</p>
          <p className="text-2xl md:text-3xl font-extrabold mt-2 text-slate-900 tracking-tight">{formatCurrency(totalAssets)}</p>
        </Card>
        <Card>
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total Debt</p>
          <p className="text-2xl md:text-3xl font-extrabold mt-2 text-rose-600 tracking-tight">{formatCurrency(totalDebt)}</p>
        </Card>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-indigo-600 border-t-transparent" />
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
              return (
                <div key={type} className="bg-white rounded-3xl border border-slate-100 p-4 sm:p-6 shadow-sm">
                  <div className="flex items-center gap-3 mb-4 px-2">
                    <div className={`p-2 rounded-xl ${config.bgClass}`}>
                      <Icon className={`w-5 h-5 ${config.colorClass}`} />
                    </div>
                    <h2 className="text-base font-bold text-slate-900">{config.label}s</h2>
                  </div>
                  <div className="space-y-3">
                    {list.map((account) => (
                      <div
                        key={account.id}
                        className="group flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-2xl bg-slate-50 border border-slate-100 hover:border-slate-200 hover:bg-white hover:shadow-sm transition-all duration-300 gap-4 sm:gap-0"
                      >
                        <div className="flex items-center gap-4">
                          <div
                            className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 shadow-sm border border-slate-100 bg-white"
                          >
                            <Icon className="w-6 h-6" style={{ color: account.color }} />
                          </div>
                          <div>
                            <p className="text-base font-bold text-slate-900">{account.name}</p>
                            <p className="text-sm font-medium text-slate-500 mt-0.5">
                              {account.institution || config.label}
                              {account.last4 ? ` ····${account.last4}` : ''}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center justify-between sm:justify-end gap-6 sm:gap-8 w-full sm:w-auto pl-16 sm:pl-0">
                          <div className="text-left sm:text-right">
                            {type === 'credit' || type === 'loan' ? (
                              account.balance < 0 ? (
                                <>
                                  <p className="text-lg font-extrabold text-emerald-600">
                                    +{formatCurrency(Math.abs(account.balance))}
                                  </p>
                                  <p className="text-xs font-bold text-emerald-500">credit (bank owes you)</p>
                                </>
                              ) : (
                                <>
                                  <p className="text-lg font-extrabold text-rose-600">
                                    -{formatCurrency(account.balance)}
                                  </p>
                                  <p className="text-xs font-bold text-slate-400">owed</p>
                                </>
                              )
                            ) : (
                              <p className="text-lg font-extrabold text-slate-900">
                                {formatCurrency(account.balance)}
                              </p>
                            )}
                          </div>
                          <div className="flex gap-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 h-10 w-10 rounded-xl"
                              onClick={() => openEdit(account)}
                            >
                              <Pencil className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-slate-400 hover:text-rose-600 hover:bg-rose-50 h-10 w-10 rounded-xl"
                              onClick={() => handleDelete(account.id)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
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

      {/* Add/Edit Account Modal */}
      <Modal
        open={open}
        onClose={() => { setOpen(false); setForm(EMPTY_FORM); setEditTarget(null); }}
        title={editTarget ? 'Edit Account' : 'Add Account'}
      >
        <div className="space-y-5">
          <Select
            label="Account Type"
            value={form.type}
            options={Object.entries(ACCOUNT_TYPE_CONFIG).map(([value, { label }]) => ({ value, label }))}
            onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as Account['type'] }))}
          />
          <Input
            label="Account Name"
            placeholder={form.type === 'checking' ? 'e.g. Chase Checking' : form.type === 'credit' ? 'e.g. Chase Sapphire' : 'e.g. HYSA'}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <Input
            label="Institution (optional)"
            placeholder="e.g. Chase, Bank of America"
            value={form.institution}
            onChange={(e) => setForm((f) => ({ ...f, institution: e.target.value }))}
          />
          <Input
            label={
              form.type === 'credit' || form.type === 'loan'
                ? 'Balance Owed ($) — enter negative if bank owes you'
                : 'Current Balance ($)'
            }
            type="number"
            step="0.01"
            placeholder="0.00"
            value={form.balance}
            onChange={(e) => setForm((f) => ({ ...f, balance: e.target.value }))}
          />
          <Input
            label="Last 4 digits (optional)"
            placeholder="1234"
            maxLength={4}
            value={form.last4}
            onChange={(e) => setForm((f) => ({ ...f, last4: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
          />
          <div>
            <p className="text-sm font-bold text-slate-700 ml-1 mb-2">Color</p>
            <div className="flex gap-3 flex-wrap">
              {ACCOUNT_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setForm((f) => ({ ...f, color: c }))}
                  className="w-10 h-10 rounded-full border-[3px] transition-all flex items-center justify-center shadow-sm hover:scale-110"
                  style={{
                    backgroundColor: c,
                    borderColor: form.color === c ? '#0f172a' : 'transparent',
                  }}
                >
                  {form.color === c && <CheckCircle2 className="w-5 h-5 text-white" />}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-3 pt-4">
            <Button variant="secondary" className="flex-1" onClick={() => { setOpen(false); setForm(EMPTY_FORM); setEditTarget(null); }}>
              Cancel
            </Button>
            <Button className="flex-1 shadow-sm" onClick={handleSave} disabled={saving || !form.name}>
              {saving ? 'Saving…' : editTarget ? 'Update Account' : 'Add Account'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
