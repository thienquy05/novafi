'use client';
import { useState, useEffect, useCallback } from 'react';
import { ArrowDownLeft, ArrowUpRight, ArrowRightLeft, PiggyBank, Target } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { formatCurrency, formatDate, generateId, today } from '@/lib/utils';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
import type { Account, Transaction, Goal } from '@/types';
import { FitText } from '@/components/ui/FitText';

type ActionForm = {
  type: 'deposit' | 'withdraw';
  accountId: string;
  amount: string;
  description: string;
  date: string;
};

const EMPTY_FORM: ActionForm = {
  type: 'deposit',
  accountId: '',
  amount: '',
  description: '',
  date: today(),
};

export default function SavingsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<string>('all');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ActionForm>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [accRes, txRes, goalRes] = await Promise.all([
      fetch('/api/accounts'),
      fetch('/api/transactions'),
      fetch('/api/goals'),
    ]);
    const [accs, txs, gls] = await Promise.all([accRes.json(), txRes.json(), goalRes.json()]);
    const savingsAccs: Account[] = accs.filter((a: Account) => a.type === 'savings');
    setAccounts(savingsAccs);
    setTransactions(txs);
    setGoals(gls);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load);

  const savingsAccountIds = accounts.map((a) => a.id);

  const savingsTx = transactions
    .filter((t) => {
      const inSavings = savingsAccountIds.includes(t.account) || savingsAccountIds.includes(t.toAccount ?? '');
      if (selectedAccount === 'all') return inSavings;
      return t.account === selectedAccount || t.toAccount === selectedAccount;
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  const totalSaved = accounts.reduce((s, a) => s + a.balance, 0);

  async function handleAction() {
    if (!form.accountId || !form.amount) return;
    setSaving(true);

    const account = accounts.find((a) => a.id === form.accountId);
    if (!account) { setSaving(false); return; }

    const amount = parseFloat(form.amount);
    const tx: Transaction = {
      id: generateId(),
      date: form.date,
      description: form.description || (form.type === 'deposit' ? 'Savings Deposit' : 'Savings Withdrawal'),
      amount,
      type: form.type === 'deposit' ? 'income' : 'expense',
      category: 'Transfer',
      account: form.accountId,
    };

    await fetch('/api/transactions', {
      method: 'POST',
      body: JSON.stringify(tx),
      headers: { 'Content-Type': 'application/json' },
    });

    setOpen(false);
    setForm(EMPTY_FORM);
    await load();
    setSaving(false);
  }

  function openAction(type: 'deposit' | 'withdraw') {
    setForm({ ...EMPTY_FORM, type, accountId: accounts[0]?.id ?? '' });
    setOpen(true);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-indigo-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6 sm:space-y-8 pb-24 md:pb-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-slate-900">Savings</h1>
          <p className="text-slate-500 text-base font-medium mt-1">Track your savings accounts and progress</p>
        </div>
        {accounts.length > 0 && (
          <div className="flex gap-2 w-full md:w-auto">
            <Button variant="secondary" onClick={() => openAction('withdraw')} className="flex-1 md:flex-none shadow-sm">
              <ArrowUpRight className="w-5 h-5" />
              Withdraw
            </Button>
            <Button onClick={() => openAction('deposit')} className="flex-1 md:flex-none shadow-sm">
              <ArrowDownLeft className="w-5 h-5" />
              Deposit
            </Button>
          </div>
        )}
      </div>

      {accounts.length === 0 ? (
        <Card className="text-center py-16 bg-slate-50 border-slate-100">
          <div className="w-16 h-16 rounded-full bg-white flex items-center justify-center mx-auto mb-4 shadow-sm border border-slate-100">
            <PiggyBank className="w-8 h-8 text-slate-400" />
          </div>
          <p className="text-slate-900 font-bold text-lg mb-1">No savings accounts yet</p>
          <p className="text-slate-500 font-medium mb-6">
            Go to <a href="/accounts" className="text-indigo-600 font-bold hover:text-indigo-500 transition-colors">Accounts</a> and add a savings account to get started.
          </p>
        </Card>
      ) : (
        <>
          {/* Savings accounts summary */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <Card className={`md:col-span-1 ${totalSaved >= 0 ? 'border-emerald-100 hover:border-emerald-200' : 'border-rose-100 hover:border-rose-200'}`}>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total Saved</p>
              <FitText maxSize={28} minSize={13} className={`font-extrabold mt-2 ${totalSaved >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{formatCurrency(totalSaved)}</FitText>
            </Card>
            {accounts.map((a) => (
              <Card key={a.id} className="border-l-[6px]" style={{ borderLeftColor: a.color }}>
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider truncate">{a.name}</p>
                <FitText maxSize={28} minSize={13} className={`font-extrabold mt-2 ${a.balance < 0 ? 'text-rose-600' : 'text-slate-900'}`}>{formatCurrency(a.balance)}</FitText>
                {a.institution && <p className="text-sm font-medium text-slate-500 mt-1">{a.institution}</p>}
              </Card>
            ))}
          </div>

          {/* Goals linked to savings */}
          {goals.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2 px-1">
                <Target className="w-5 h-5 text-indigo-600" />
                Savings Goals
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {goals.map((g) => {
                  const linked = g.linkedAccountId ? accounts.find((a) => a.id === g.linkedAccountId) : null;
                  const current = linked ? linked.balance : g.currentAmount;
                  const rawPct = g.targetAmount > 0 ? (current / g.targetAmount) * 100 : 0;
                  const pct = Math.max(-100, Math.min(100, rawPct));
                  const remaining = g.targetAmount - current;
                  const negative = current < 0;
                  return (
                    <Card key={g.id} className="hover:shadow-md transition-all">
                      <div className="flex items-start justify-between mb-4">
                        <div>
                          <p className="text-base font-bold text-slate-900 flex items-center gap-2">
                            <span className="text-xl">{g.icon}</span> {g.name}
                          </p>
                          {g.deadline && (
                            <p className="text-sm font-medium text-slate-500 mt-1">By {formatDate(g.deadline)}</p>
                          )}
                        </div>
                        <span className={`text-sm font-extrabold px-2.5 py-1 rounded-lg ${negative ? 'text-rose-700 bg-rose-50' : 'text-indigo-600 bg-indigo-50'}`}>{pct.toFixed(0)}%</span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-2.5 mb-3 overflow-hidden relative">
                        {negative ? (
                          <div
                            className="absolute right-0 top-0 bg-rose-500 h-full rounded-full transition-all duration-500"
                            style={{ width: `${Math.min(100, Math.abs(pct))}%` }}
                            aria-label="Deficit"
                          />
                        ) : (
                          <div
                            className="bg-indigo-500 h-full rounded-full transition-all duration-500"
                            style={{ width: `${Math.max(0, pct)}%` }}
                          />
                        )}
                      </div>
                      <div className="flex justify-between text-sm font-bold text-slate-500">
                        <span className={negative ? 'text-rose-600' : 'text-slate-700'}>{formatCurrency(current)} saved</span>
                        <span>{formatCurrency(remaining)} to go</span>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}

          {/* Account filter */}
          {accounts.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-2 hide-scrollbar">
              <button
                onClick={() => setSelectedAccount('all')}
                className={`px-5 h-10 rounded-xl text-sm font-bold transition-all duration-300 whitespace-nowrap shadow-sm ${
                  selectedAccount === 'all'
                    ? 'bg-slate-900 text-white'
                    : 'bg-white text-slate-600 hover:text-slate-900 hover:bg-slate-50 border border-slate-200'
                }`}
              >
                All Accounts
              </button>
              {accounts.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setSelectedAccount(a.id)}
                  className={`px-5 h-10 rounded-xl text-sm font-bold transition-all duration-300 whitespace-nowrap shadow-sm ${
                    selectedAccount === a.id
                      ? 'bg-slate-900 text-white'
                      : 'bg-white text-slate-600 hover:text-slate-900 hover:bg-slate-50 border border-slate-200'
                  }`}
                >
                  {a.name}
                </button>
              ))}
            </div>
          )}

          {/* Transaction history */}
          <div className="space-y-4">
            <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider px-1">Transaction History</h2>
            {savingsTx.length === 0 ? (
              <Card className="text-center py-12 bg-slate-50 border-slate-100">
                <p className="text-slate-500 font-bold">No savings transactions yet. Make your first deposit!</p>
              </Card>
            ) : (
              <div className="space-y-3">
                {savingsTx.map((tx) => {
                  const fromName = accounts.find((a) => a.id === tx.account)?.name ?? tx.account;
                  const toName = tx.toAccount ? accounts.find((a) => a.id === tx.toAccount)?.name : null;
                  const isTransfer = tx.type === 'transfer';
                  const isIncoming = isTransfer
                    ? savingsAccountIds.includes(tx.toAccount ?? '')
                    : tx.type === 'income';
                  const displayDesc = tx.description || (isTransfer ? 'Transfer' : isIncoming ? 'Savings Deposit' : 'Savings Withdrawal');
                  const subtitle = isTransfer && toName
                    ? `${fromName} → ${toName} · ${formatDate(tx.date)}`
                    : `${fromName} · ${formatDate(tx.date)}`;
                  return (
                    <div
                      key={tx.id}
                      className="flex items-center justify-between p-4 sm:p-5 rounded-3xl bg-white border border-slate-100 hover:border-slate-200 hover:shadow-sm transition-all duration-300"
                    >
                      <div className="flex items-center gap-4">
                        <div className={`flex items-center justify-center w-12 h-12 rounded-2xl shrink-0 border ${
                          isTransfer ? 'bg-indigo-50 border-indigo-100' : isIncoming ? 'bg-emerald-50 border-emerald-100' : 'bg-rose-50 border-rose-100'
                        }`}>
                          {isTransfer
                            ? <ArrowRightLeft className="w-6 h-6 text-indigo-600" />
                            : isIncoming
                            ? <ArrowDownLeft className="w-6 h-6 text-emerald-600" />
                            : <ArrowUpRight className="w-6 h-6 text-rose-600" />}
                        </div>
                        <div>
                          <p className="text-base font-bold text-slate-900">{displayDesc}</p>
                          <p className="text-sm font-medium text-slate-500 mt-0.5">{subtitle}</p>
                        </div>
                      </div>
                      <span className={`text-lg font-extrabold ${isTransfer ? (isIncoming ? 'text-emerald-600' : 'text-rose-600') : isIncoming ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {isIncoming ? '+' : '-'}{formatCurrency(tx.amount)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* Deposit/Withdraw Modal */}
      <Modal
        open={open}
        onClose={() => { setOpen(false); setForm(EMPTY_FORM); }}
        title={form.type === 'deposit' ? 'Deposit to Savings' : 'Withdraw from Savings'}
      >
        <div className="space-y-5 pb-4">
          <div className="flex p-1.5 rounded-2xl bg-slate-100">
            <button
              onClick={() => setForm((f) => ({ ...f, type: 'deposit' }))}
              className={`flex-1 py-3 text-sm font-bold rounded-xl transition-all duration-300 ${
                form.type === 'deposit' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Deposit
            </button>
            <button
              onClick={() => setForm((f) => ({ ...f, type: 'withdraw' }))}
              className={`flex-1 py-3 text-sm font-bold rounded-xl transition-all duration-300 ${
                form.type === 'withdraw' ? 'bg-white text-rose-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Withdraw
            </button>
          </div>
          <Select
            label="Savings Account"
            value={form.accountId}
            options={accounts.map((a) => ({ value: a.id, label: `${a.name} (${formatCurrency(a.balance)})` }))}
            onChange={(e) => setForm((f) => ({ ...f, accountId: e.target.value }))}
          />
          <Input
            label="Amount"
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={form.amount}
            onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
          />
          <Input
            label="Description (optional)"
            placeholder={form.type === 'deposit' ? 'e.g. Monthly savings' : 'e.g. Emergency expense'}
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
          <Input
            label="Date"
            type="date"
            value={form.date}
            onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
          />
        </div>
        <div className="sticky bottom-0 bg-white border-t border-slate-100 -mx-6 sm:-mx-8 px-6 sm:px-8 py-4">
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => { setOpen(false); setForm(EMPTY_FORM); }}>
              Cancel
            </Button>
            <Button
              className={`flex-1 shadow-sm ${form.type === 'deposit' ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-rose-600 hover:bg-rose-500'}`}
              onClick={handleAction}
              disabled={saving || !form.amount || !form.accountId}
            >
              {saving ? 'Saving…' : form.type === 'deposit' ? 'Deposit' : 'Withdraw'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
