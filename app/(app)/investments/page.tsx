'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { TrendingUp, Plus, Pencil, Trash2, RefreshCw, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { formatCurrency, generateId, today } from '@/lib/utils';
import { peekCache, ensureResources } from '@/lib/client/store';
import { useToast } from '@/lib/toast';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
import { useTranslation } from '@/lib/i18n/context';
import {
  holdingValue, holdingCost, holdingGain, holdingGainPct,
  portfolioStats, allocationByType, totalFromPerUnit, perUnitFromTotal,
} from '@/lib/investments';
import type { Holding, Account } from '@/types';

const ASSET_TYPES = ['etf', 'stock', 'crypto'] as const;

// Stable accent per asset class for the allocation bar + dots.
const TYPE_COLOR: Record<Holding['assetType'], string> = {
  etf: '#6366f1',    // indigo
  stock: '#0ea5e9',  // sky
  crypto: '#f59e0b', // amber
};

function fmtPct(pct: number | null): string {
  if (pct === null) return '—';
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

function fmtQty(n: number): string {
  // Show up to 6 decimals for fractional crypto, trim trailing zeros.
  return Number(n.toFixed(6)).toString();
}

const EMPTY_FORM: Omit<Holding, 'id' | 'createdAt'> = {
  accountId: '',
  symbol: '',
  name: '',
  assetType: 'etf',
  quantity: 0,
  avgCost: 0,
  currentPrice: 0,
  priceUpdatedAt: '',
  notes: '',
};

export default function InvestmentsPage() {
  const { t } = useTranslation();
  const toast = useToast();

  const [holdings, setHoldings] = useState<Holding[]>(() => peekCache(['holdings'])?.holdings ?? []);
  const [accounts, setAccounts] = useState<Account[]>(() => peekCache(['accounts'])?.accounts ?? []);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [open, setOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Holding | null>(null);
  const [form, setForm] = useState<Omit<Holding, 'id' | 'createdAt'>>(EMPTY_FORM);

  const load = useCallback(async (force = false) => {
    const data = await ensureResources(['holdings', 'accounts'], { force });
    setHoldings(data.holdings);
    setAccounts(data.accounts);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useAutoRefresh(() => load(true));

  const investAccounts = useMemo(
    () => accounts.filter((a) => a.type === 'investment'),
    [accounts],
  );
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? t('investments.unknownAccount');

  const stats = useMemo(() => portfolioStats(holdings), [holdings]);
  const allocation = useMemo(() => allocationByType(holdings), [holdings]);

  // Holdings grouped under each investment account, accounts with positions first.
  const grouped = useMemo(() => {
    const byAccount = new Map<string, Holding[]>();
    for (const h of holdings) {
      const list = byAccount.get(h.accountId) ?? [];
      list.push(h);
      byAccount.set(h.accountId, list);
    }
    return [...byAccount.entries()]
      .map(([accountId, items]) => ({
        accountId,
        items: [...items].sort((a, b) => holdingValue(b) - holdingValue(a)),
        value: items.reduce((s, h) => s + holdingValue(h), 0),
      }))
      .sort((a, b) => b.value - a.value);
  }, [holdings]);

  function openAdd() {
    setEditTarget(null);
    setForm({ ...EMPTY_FORM, accountId: investAccounts[0]?.id ?? '' });
    setOpen(true);
  }

  function openEdit(h: Holding) {
    setEditTarget(h);
    setForm({
      accountId: h.accountId, symbol: h.symbol, name: h.name, assetType: h.assetType,
      quantity: h.quantity, avgCost: h.avgCost, currentPrice: h.currentPrice,
      priceUpdatedAt: h.priceUpdatedAt, notes: h.notes,
    });
    setOpen(true);
  }

  const formValid = form.accountId && form.symbol.trim() && form.quantity > 0;

  async function handleSave() {
    if (!formValid) return;
    setSaving(true);
    const priceChanged = !editTarget || editTarget.currentPrice !== form.currentPrice;
    const body: Holding = {
      id: editTarget?.id ?? generateId(),
      createdAt: editTarget?.createdAt ?? today(),
      ...form,
      symbol: form.symbol.trim().toUpperCase(),
      priceUpdatedAt: form.currentPrice > 0 && priceChanged ? today() : form.priceUpdatedAt,
    };
    try {
      const res = await fetch('/api/investments', {
        method: 'POST', body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error();
      setHoldings((prev) => [...prev.filter((h) => h.id !== body.id), body]);
      setOpen(false);
      toast(editTarget ? t('investments.toastUpdated') : t('investments.toastAdded'), 'success');
      load(true); // re-pull so the account balance sync is reflected
    } catch {
      toast(t('investments.toastFailed'), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(h: Holding) {
    if (!confirm(t('investments.confirmDelete', { symbol: h.symbol }))) return;
    const prev = holdings;
    setHoldings((list) => list.filter((x) => x.id !== h.id));
    try {
      const res = await fetch('/api/investments', {
        method: 'DELETE', body: JSON.stringify({ id: h.id, accountId: h.accountId }),
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error();
      toast(t('investments.toastDeleted'), 'success');
      load(true);
    } catch {
      setHoldings(prev);
      toast(t('investments.toastFailedDelete'), 'error');
    }
  }

  async function handleRefreshPrices() {
    if (holdings.length === 0) return;
    setRefreshing(true);
    try {
      const items = holdings.map((h) => ({ symbol: h.symbol, assetType: h.assetType }));
      const res = await fetch('/api/investments/quote', {
        method: 'POST', body: JSON.stringify({ items }),
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error();
      const { quotes } = (await res.json()) as { quotes: Record<string, number>; failed: string[] };
      const updated = holdings.filter((h) => {
        const q = quotes[h.symbol.toUpperCase()];
        return q != null && q > 0 && q !== h.currentPrice;
      });
      if (updated.length === 0) {
        toast(t('investments.toastNoQuotes'), 'info');
        return;
      }
      // Persist each updated price (account balance re-syncs server-side).
      await Promise.all(updated.map((h) => {
        const next: Holding = { ...h, currentPrice: quotes[h.symbol.toUpperCase()], priceUpdatedAt: today() };
        return fetch('/api/investments', {
          method: 'POST', body: JSON.stringify(next),
          headers: { 'Content-Type': 'application/json' },
        });
      }));
      toast(t('investments.toastPricesUpdated', { n: updated.length }), 'success');
      load(true);
    } catch {
      toast(t('investments.toastQuoteFailed'), 'error');
    } finally {
      setRefreshing(false);
    }
  }

  const typeLabel = (ty: Holding['assetType']) => ({
    etf: t('investments.typeEtf'),
    stock: t('investments.typeStock'),
    crypto: t('investments.typeCrypto'),
  }[ty]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-indigo-500 border-t-transparent" />
      </div>
    );
  }

  const gainPositive = stats.gain >= 0;
  const gainColor = gainPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400';

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto space-y-6 pb-24 md:pb-8">
      <PageHeader
        icon={TrendingUp}
        tone="emerald"
        title={t('investments.title')}
        subtitle={t('investments.subtitle')}
        action={
          <div className="flex items-center gap-2 w-full md:w-auto">
            {holdings.length > 0 && (
              <Button variant="secondary" onClick={handleRefreshPrices} disabled={refreshing} className="shadow-sm">
                <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                {t('investments.refreshPrices')}
              </Button>
            )}
            <Button onClick={openAdd} disabled={investAccounts.length === 0} className="shadow-sm">
              <Plus className="w-4 h-4" />
              {t('investments.addBtn')}
            </Button>
          </div>
        }
      />

      {/* No investment account yet → point to Accounts */}
      {investAccounts.length === 0 ? (
        <Card className="py-12 text-center">
          <TrendingUp className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-600 mb-3" />
          <p className="text-base font-bold text-slate-700 dark:text-slate-300 mb-1">{t('investments.noAccountTitle')}</p>
          <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm mx-auto mb-5">{t('investments.noAccountBody')}</p>
          <Link href="/accounts">
            <Button className="mx-auto">
              <Plus className="w-4 h-4" />
              {t('investments.goToAccounts')}
            </Button>
          </Link>
        </Card>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-3 gap-3">
            <Card className="p-4 text-center flex flex-col">
              <p className="flex-1 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">{t('investments.totalValue')}</p>
              <p className="text-xl font-extrabold text-slate-900 dark:text-slate-100">{formatCurrency(stats.value)}</p>
            </Card>
            <Card className="p-4 text-center flex flex-col">
              <p className="flex-1 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">{t('investments.totalGain')}</p>
              <p className={`text-xl font-extrabold ${gainColor}`}>{formatCurrency(stats.gain, true)}</p>
            </Card>
            <Card className="p-4 text-center flex flex-col">
              <p className="flex-1 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">{t('investments.totalReturn')}</p>
              <p className={`text-xl font-extrabold ${gainColor}`}>{fmtPct(stats.gainPct)}</p>
            </Card>
          </div>

          {/* Allocation by asset class */}
          {allocation.length > 0 && stats.value > 0 && (
            <Card>
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-extrabold text-slate-800 dark:text-slate-100">{t('investments.allocation')}</p>
                <p className="text-xs text-slate-400 dark:text-slate-500">{t('investments.costBasis')}: {formatCurrency(stats.cost)}</p>
              </div>
              <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                {allocation.map((slice) => (
                  <div
                    key={slice.key}
                    style={{ width: `${slice.pct}%`, backgroundColor: TYPE_COLOR[slice.key as Holding['assetType']] }}
                    title={`${typeLabel(slice.key as Holding['assetType'])} · ${slice.pct.toFixed(1)}%`}
                  />
                ))}
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-2 mt-4">
                {allocation.map((slice) => (
                  <div key={slice.key} className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: TYPE_COLOR[slice.key as Holding['assetType']] }} />
                    <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">{typeLabel(slice.key as Holding['assetType'])}</span>
                    <span className="text-xs font-bold text-slate-900 dark:text-slate-100">{slice.pct.toFixed(0)}%</span>
                    <span className="text-xs text-slate-400 dark:text-slate-500">{formatCurrency(slice.value)}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Holdings grouped by account */}
          {holdings.length === 0 ? (
            <Card className="py-12 text-center">
              <TrendingUp className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-600 mb-3" />
              <p className="text-base font-bold text-slate-700 dark:text-slate-300 mb-1">{t('investments.empty')}</p>
              <p className="text-sm text-slate-500 dark:text-slate-400 max-w-xs mx-auto mb-5">{t('investments.emptyBody')}</p>
              <Button onClick={openAdd} className="mx-auto">
                <Plus className="w-4 h-4" />
                {t('investments.addBtn')}
              </Button>
            </Card>
          ) : (
            grouped.map((group) => (
              <div key={group.accountId} className="space-y-2">
                <div className="flex items-center justify-between px-1">
                  <p className="text-sm font-bold text-slate-600 dark:text-slate-300">{accountName(group.accountId)}</p>
                  <p className="text-sm font-extrabold text-slate-900 dark:text-slate-100">{formatCurrency(group.value)}</p>
                </div>
                {group.items.map((h) => {
                  const value = holdingValue(h);
                  const gain = holdingGain(h);
                  const pct = holdingGainPct(h);
                  const up = gain >= 0;
                  return (
                    <Card key={h.id} className="flex items-center gap-3 p-3.5">
                      <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-[11px] font-extrabold text-white"
                        style={{ backgroundColor: TYPE_COLOR[h.assetType] }}
                      >
                        {h.symbol.slice(0, 4)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-bold text-slate-800 dark:text-slate-200 truncate">{h.symbol}</p>
                          <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-700/60 text-slate-500 dark:text-slate-400 uppercase">
                            {typeLabel(h.assetType)}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                          {fmtQty(h.quantity)} @ {formatCurrency(h.avgCost)}
                          {h.currentPrice > 0 && <> · {formatCurrency(h.currentPrice)}/{t('investments.unit')}</>}
                        </p>
                      </div>
                      <div className="text-right shrink-0 mr-1">
                        <p className="text-sm font-extrabold text-slate-900 dark:text-slate-100">{formatCurrency(value)}</p>
                        <p className={`text-xs font-semibold flex items-center justify-end gap-0.5 ${up ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                          {up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                          {formatCurrency(gain, true)} ({fmtPct(pct)})
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => openEdit(h)}
                          title={t('common.edit')}
                          className="p-2 rounded-lg text-slate-400 dark:text-slate-500 hover:text-indigo-500 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(h)}
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
            ))
          )}
        </>
      )}

      {/* Add / Edit Modal */}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editTarget ? t('investments.editTitle') : t('investments.addTitle')}
      >
        <div className="space-y-4">
          <Select
            label={t('investments.account')}
            value={form.accountId}
            options={investAccounts.map((a) => ({ value: a.id, label: a.name }))}
            onChange={(e) => setForm((f) => ({ ...f, accountId: e.target.value }))}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label={t('investments.symbol')}
              placeholder={t('investments.symbolPlaceholder')}
              value={form.symbol}
              onChange={(e) => setForm((f) => ({ ...f, symbol: e.target.value.toUpperCase() }))}
            />
            <Select
              label={t('investments.assetType')}
              value={form.assetType}
              options={ASSET_TYPES.map((ty) => ({ value: ty, label: typeLabel(ty) }))}
              onChange={(e) => setForm((f) => ({ ...f, assetType: e.target.value as Holding['assetType'] }))}
            />
          </div>
          <Input
            label={t('investments.name')}
            placeholder={t('investments.namePlaceholder')}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <Input
            label={t('investments.quantity')}
            type="number"
            min="0"
            step="any"
            value={form.quantity || ''}
            onChange={(e) => setForm((f) => ({ ...f, quantity: parseFloat(e.target.value) || 0 }))}
          />

          {/* Cost basis & price each accept a per-unit figure OR the total you
              hold — editing one side chases the other through the quantity, so
              you can enter whichever number you actually know. */}
          <div className="grid grid-cols-2 gap-3">
            <Input
              label={t('investments.avgCost')}
              type="number"
              min="0"
              step="0.01"
              value={form.avgCost || ''}
              onChange={(e) => setForm((f) => ({ ...f, avgCost: parseFloat(e.target.value) || 0 }))}
            />
            <Input
              label={t('investments.totalCost')}
              type="number"
              min="0"
              step="0.01"
              disabled={form.quantity <= 0}
              value={form.quantity > 0 && form.avgCost > 0 ? totalFromPerUnit(form.avgCost, form.quantity) : ''}
              onChange={(e) => setForm((f) => ({ ...f, avgCost: perUnitFromTotal(parseFloat(e.target.value) || 0, f.quantity) }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label={t('investments.currentPrice')}
              type="number"
              min="0"
              step="0.01"
              value={form.currentPrice || ''}
              onChange={(e) => setForm((f) => ({ ...f, currentPrice: parseFloat(e.target.value) || 0 }))}
            />
            <Input
              label={t('investments.totalValue')}
              type="number"
              min="0"
              step="0.01"
              disabled={form.quantity <= 0}
              value={form.quantity > 0 && form.currentPrice > 0 ? totalFromPerUnit(form.currentPrice, form.quantity) : ''}
              onChange={(e) => setForm((f) => ({ ...f, currentPrice: perUnitFromTotal(parseFloat(e.target.value) || 0, f.quantity) }))}
            />
          </div>
          {form.quantity <= 0 && (
            <p className="text-xs text-slate-400 dark:text-slate-500 -mt-1">{t('investments.totalHint')}</p>
          )}

          {/* Live preview: cost basis, current market value, and unrealized gain */}
          {form.quantity > 0 && (() => {
            const cost = totalFromPerUnit(form.avgCost, form.quantity);
            const value = totalFromPerUnit(form.currentPrice > 0 ? form.currentPrice : form.avgCost, form.quantity);
            const gain = value - cost;
            const up = gain >= 0;
            return (
              <div className="space-y-1.5 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-700/40 border border-slate-100 dark:border-slate-700/60 text-sm">
                <div className="flex items-center justify-between gap-4">
                  <span className="font-semibold text-slate-600 dark:text-slate-300">{t('investments.costBasis')}</span>
                  <span className="font-bold text-slate-700 dark:text-slate-200">{formatCurrency(cost)}</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="font-semibold text-slate-600 dark:text-slate-300">{t('investments.marketValue')}</span>
                  <span className="font-extrabold text-slate-900 dark:text-slate-100">{formatCurrency(value)}</span>
                </div>
                {form.currentPrice > 0 && form.avgCost > 0 && (
                  <div className="flex items-center justify-between gap-4">
                    <span className="font-semibold text-slate-600 dark:text-slate-300">{t('investments.totalGain')}</span>
                    <span className={`font-extrabold ${up ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                      {formatCurrency(gain, true)}
                    </span>
                  </div>
                )}
              </div>
            );
          })()}
          <Input
            label={t('investments.notes')}
            placeholder={t('investments.notesPlaceholder')}
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          />
          <div className="flex gap-2 pt-1">
            <Button onClick={handleSave} disabled={saving || !formValid} className="flex-1">
              {saving ? t('common.saving') : t('investments.saveBtn')}
            </Button>
            <Button variant="secondary" onClick={() => setOpen(false)} className="flex-1">
              {t('investments.cancelBtn')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
