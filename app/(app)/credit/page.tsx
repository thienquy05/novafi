'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  CreditCard, AlertCircle, AlertTriangle, CheckCircle2, ShieldCheck,
  TrendingUp, Pencil, Sparkles, Lightbulb, Target, CalendarClock,
  History, ArrowUpCircle, Shuffle, Calculator,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardIcon } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { AccountsSkeleton } from '@/components/ui/Skeleton';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
import { peekCache, ensureResources } from '@/lib/client/store';
import { formatCurrency } from '@/lib/utils';
import { useToast } from '@/lib/toast';
import {
  buildCreditReport, CREDIT_UTIL_TARGET, CREDIT_UTIL_IDEAL, daysUntilStatement,
  allocateSmartPayment, buildLimitIncreaseAdvisories, buildStatementArbitrage,
  buildBalanceTransferAdvice, creditUtilStatus,
  type CreditUtilStatus, type CreditCardReport, type PaymentAllocation, type LimitIncreaseAdvice,
  type StatementArbitrageItem, type BalanceTransferAdvice,
} from '@/lib/calculations';
import type { Account, Transaction } from '@/types';
import { useTranslation } from '@/lib/i18n/context';

// Literal Tailwind class strings per status band (Tailwind v4 needs literals —
// no templating from a variable). Greens for at/under target, amber→rose as it
// climbs past the recommended cap.
const STATUS_STYLE: Record<CreditUtilStatus, { bar: string; text: string; chip: string }> = {
  excellent: { bar: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', chip: 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' },
  good:      { bar: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', chip: 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' },
  fair:      { bar: 'bg-amber-500',   text: 'text-amber-600 dark:text-amber-400',     chip: 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' },
  high:      { bar: 'bg-orange-500',  text: 'text-orange-600 dark:text-orange-400',   chip: 'bg-orange-50 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300' },
  maxed:     { bar: 'bg-rose-500',    text: 'text-rose-600 dark:text-rose-400',       chip: 'bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300' },
  over:      { bar: 'bg-rose-600',    text: 'text-rose-600 dark:text-rose-400',       chip: 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300' },
};

// Parse a limit input: keep digits + a single decimal, drop currency symbols.
function parseNum(input: string): number {
  const cleaned = String(input ?? '').replace(/[^0-9.]/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

// Compact percent: whole numbers stay whole, otherwise one decimal.
function fmtPct(util: number): string {
  const rounded = Math.round(util * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`;
}

export default function CreditPage() {
  const { t } = useTranslation();
  // Seed from the client cache so revisiting Credit shows numbers instantly
  // (no skeleton flash) instead of refetching every time we switch sections.
  const [accounts, setAccounts] = useState<Account[]>(() => peekCache(['accounts'])?.accounts ?? []);
  // Transactions power the Limit Increase Advisor's "solid payment history" check.
  const [transactions, setTransactions] = useState<Transaction[]>(() => peekCache(['transactions'])?.transactions ?? []);
  const [loading, setLoading] = useState(() => peekCache(['accounts', 'transactions']) === null);
  const [error, setError] = useState(false);
  const toast = useToast();

  const load = useCallback(async (force = false) => {
    try {
      const { accounts, transactions } = await ensureResources(['accounts', 'transactions'], { force });
      setAccounts(accounts);
      setTransactions(transactions);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  // Background re-sync forces past the cache to catch edits made elsewhere.
  useAutoRefresh(() => load(true));

  const report = useMemo(() => buildCreditReport(accounts), [accounts]);
  const advisories = useMemo(() => buildLimitIncreaseAdvisories(accounts, transactions, new Date()), [accounts, transactions]);
  const arbitrage = useMemo(() => buildStatementArbitrage(accounts, new Date()), [accounts]);
  const transferAdvice = useMemo(() => buildBalanceTransferAdvice(accounts), [accounts]);
  const hasCards = report.cards.length > 0;

  // Persist a single card's credit fields (limit and/or statement day) —
  // optimistic, reconcile on failure. Sends the full account; the API preserves
  // the server-maintained openingBalance when we leave it as-is.
  async function saveCard(account: Account, patch: Partial<Pick<Account, 'creditLimit' | 'statementDay'>>) {
    const updated: Account = { ...account, ...patch };
    setAccounts((prev) => prev.map((a) => (a.id === account.id ? updated : a)));
    try {
      const res = await fetch('/api/accounts', {
        method: 'POST',
        body: JSON.stringify(updated),
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error();
      toast(t('credit.limitSaved'), 'success');
    } catch {
      toast(t('credit.limitFailed'), 'error');
      await load(true);
    }
  }

  const overOrLimit = report.cardsOverTarget;

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-6 sm:space-y-7 pb-24 md:pb-8">
      <PageHeader
        icon={CreditCard}
        tone="rose"
        title={t('credit.title')}
        subtitle={t('credit.subtitle')}
      />

      {loading ? (
        <AccountsSkeleton />
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-14 h-14 rounded-full bg-rose-50 dark:bg-rose-900/30 flex items-center justify-center mb-4">
            <AlertCircle className="w-7 h-7 text-rose-400" />
          </div>
          <p className="text-slate-700 dark:text-slate-300 font-bold text-base mb-1">{t('credit.loadError')}</p>
          <Button variant="secondary" onClick={() => load(true)} className="mt-4">{t('credit.tryAgain')}</Button>
        </div>
      ) : !hasCards ? (
        <Card className="text-center py-16 bg-slate-50 dark:bg-slate-700/50 border-slate-100 dark:border-slate-700/60">
          <div className="w-16 h-16 rounded-full bg-white dark:bg-slate-800 flex items-center justify-center mx-auto mb-4 shadow-sm border border-slate-100 dark:border-slate-700/60">
            <CreditCard className="w-8 h-8 text-slate-400 dark:text-slate-500" />
          </div>
          <p className="text-slate-900 dark:text-slate-100 font-bold text-lg mb-1">{t('credit.emptyTitle')}</p>
          <p className="text-slate-500 dark:text-slate-400 font-medium mb-6 max-w-sm mx-auto">{t('credit.emptyDesc')}</p>
          <Link href="/accounts"><Button className="shadow-sm">{t('credit.goToAccounts')}</Button></Link>
        </Card>
      ) : (
        <>
          {/* ── Overall utilization hero ─────────────────────────────────── */}
          <OverallCard report={report} />

          {/* ── Alert / all-clear banner ─────────────────────────────────── */}
          {report.hasLimits && (
            overOrLimit > 0 ? (
              <div className="flex items-start gap-3 rounded-2xl border border-rose-200 dark:border-rose-800/50 bg-rose-50 dark:bg-rose-900/20 p-4">
                <AlertTriangle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-rose-700 dark:text-rose-300 text-sm">
                    {t('credit.alertOverTitle', { count: overOrLimit, pct: CREDIT_UTIL_TARGET })}
                  </p>
                  <p className="text-rose-600/90 dark:text-rose-400/90 text-sm mt-0.5">
                    {t('credit.alertOverDesc', { pct: CREDIT_UTIL_TARGET })}
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 dark:border-emerald-800/50 bg-emerald-50 dark:bg-emerald-900/20 p-4">
                <ShieldCheck className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-emerald-700 dark:text-emerald-300 text-sm">{t('credit.allGoodTitle')}</p>
                  <p className="text-emerald-600/90 dark:text-emerald-400/90 text-sm mt-0.5">
                    {t('credit.allGoodDesc', { pct: CREDIT_UTIL_TARGET })}
                  </p>
                </div>
              </div>
            )
          )}

          {/* ── Statement-close arbitrage (pay before the bureau snapshot) ── */}
          {arbitrage.length > 0 && <StatementArbitrageCard items={arbitrage} />}

          {/* ── Per-card breakdown ───────────────────────────────────────── */}
          <div className="space-y-4">
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 px-1">{t('credit.yourCards')}</h2>
            {report.cards.map((c) => (
              <CreditCardItem key={c.account.id} report={c} onSave={saveCard} />
            ))}
          </div>

          {/* ── Limit increase advisor ───────────────────────────────────── */}
          {advisories.length > 0 && <LimitAdvisorCard advisories={advisories} />}

          {/* ── Smart payment planner ────────────────────────────────────── */}
          {report.totalBalance > 0 && <SmartPaymentPlanner accounts={accounts} />}

          {/* ── Balance-transfer / APR optimizer ─────────────────────────── */}
          {transferAdvice.length > 0 && <BalanceTransferCard advice={transferAdvice} />}

          {/* ── How to improve ───────────────────────────────────────────── */}
          <TipsCard />
        </>
      )}
    </div>
  );
}

// ── Overall utilization hero card ─────────────────────────────────────────────
function OverallCard({ report }: { report: ReturnType<typeof buildCreditReport> }) {
  const { t } = useTranslation();
  const util = report.overallUtil;
  const status = report.overallStatus;
  const style = status ? STATUS_STYLE[status] : null;

  return (
    <Card tone={status && util! > CREDIT_UTIL_TARGET ? 'rose' : 'emerald'} className="bento-hero">
      <div className="flex items-center gap-3 mb-5">
        <CardIcon tone="indigo"><TrendingUp className="w-5 h-5" /></CardIcon>
        <div>
          <p className="text-sm font-bold text-slate-800 dark:text-slate-200">{t('credit.overallTitle')}</p>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{t('credit.overallSub')}</p>
        </div>
      </div>

      {util === null ? (
        <div className="rounded-2xl bg-white/60 dark:bg-slate-900/30 border border-slate-100 dark:border-slate-700/60 p-5 text-center">
          <p className="font-bold text-slate-900 dark:text-slate-100 mb-1">{t('credit.noLimitsTitle')}</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('credit.noLimitsDesc')}</p>
        </div>
      ) : (
        <>
          <div className="flex items-end justify-between gap-4 mb-3">
            <div>
              <p className={`text-5xl font-extrabold font-display leading-none ${style!.text}`}>{fmtPct(util)}</p>
              <p className="text-sm font-bold text-slate-500 dark:text-slate-400 mt-2">{t(`credit.status.${status}`)}</p>
            </div>
            <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 text-right">
              {t('credit.keepUnder', { pct: CREDIT_UTIL_TARGET })}
            </p>
          </div>

          <UtilBar util={util} barClass={style!.bar} />

          <div className="grid grid-cols-3 gap-3 mt-5">
            <Stat label={t('credit.totalBalance')} value={formatCurrency(report.totalBalance)} tone="rose" />
            <Stat label={t('credit.totalLimit')} value={formatCurrency(report.totalLimit)} tone="slate" />
            <Stat label={t('credit.available')} value={formatCurrency(report.totalAvailable)} tone="emerald" />
          </div>
        </>
      )}
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: 'rose' | 'emerald' | 'slate' }) {
  const color =
    tone === 'rose' ? 'text-rose-600 dark:text-rose-400'
    : tone === 'emerald' ? 'text-emerald-600 dark:text-emerald-400'
    : 'text-slate-900 dark:text-slate-100';
  return (
    <div className="rounded-2xl bg-white/60 dark:bg-slate-900/30 border border-slate-100 dark:border-slate-700/60 p-3">
      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">{label}</p>
      <p className={`text-base sm:text-lg font-extrabold mt-1 ${color}`}>{value}</p>
    </div>
  );
}

// Utilization bar with a dashed marker at the 30% recommended cap.
function UtilBar({ util, barClass }: { util: number; barClass: string }) {
  const width = Math.min(100, Math.max(0, util));
  return (
    <div className="relative h-3 w-full rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
      <div className={`h-full rounded-full ${barClass} transition-[width] duration-500`} style={{ width: `${width}%` }} />
      {/* 30% target marker */}
      <div
        className="absolute top-0 bottom-0 w-px bg-slate-500/70 dark:bg-slate-300/60"
        style={{ left: `${CREDIT_UTIL_TARGET}%` }}
        aria-hidden
      />
    </div>
  );
}

// ── Single credit card row ────────────────────────────────────────────────────
function CreditCardItem({
  report,
  onSave,
}: {
  report: CreditCardReport;
  onSave: (account: Account, patch: Partial<Pick<Account, 'creditLimit' | 'statementDay'>>) => void;
}) {
  const { t } = useTranslation();
  const { account, util, status, available, paydownToTarget, paydownToIdeal } = report;
  const [editing, setEditing] = useState(false);
  const [limitInput, setLimitInput] = useState(account.creditLimit ? String(account.creditLimit) : '');
  const [stmtInput, setStmtInput] = useState(account.statementDay ? String(account.statementDay) : '');
  const style = status ? STATUS_STYLE[status] : null;
  const owed = Math.max(0, account.balance);
  const stmtDays = daysUntilStatement(account.statementDay, new Date());
  const stmtSoon = stmtDays !== null && stmtDays <= 7;

  function resetInputs() {
    setLimitInput(account.creditLimit ? String(account.creditLimit) : '');
    setStmtInput(account.statementDay ? String(account.statementDay) : '');
  }
  function parseStmt(s: string): number | undefined {
    const n = parseInt(s, 10);
    return Number.isFinite(n) && n >= 1 && n <= 31 ? n : undefined;
  }
  function submitFull() {
    onSave(account, { creditLimit: parseNum(limitInput), statementDay: parseStmt(stmtInput) });
    setEditing(false);
  }

  return (
    <Card className="space-y-4">
      {/* Header: name + status chip */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 shadow-sm border border-slate-100 dark:border-slate-700/60 bg-white dark:bg-slate-800">
            <CreditCard className="w-5 h-5" style={{ color: account.color }} />
          </div>
          <div className="min-w-0">
            <p className="font-bold text-slate-900 dark:text-slate-100 truncate">{account.name}</p>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 truncate">
              {account.institution || t('credit.creditCard')}{account.last4 ? ` ····${account.last4}` : ''}
            </p>
          </div>
        </div>
        {status && (
          <span className={`text-xs font-bold px-2.5 py-1 rounded-full whitespace-nowrap ${style!.chip}`}>
            {t(`credit.status.${status}`)}
          </span>
        )}
      </div>

      {util === null ? (
        // No limit set → inline prompt to add one.
        <div className="rounded-2xl bg-slate-50 dark:bg-slate-700/40 border border-slate-100 dark:border-slate-700/60 p-4">
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">{t('credit.setLimitPrompt')}</p>
          <div className="flex gap-2">
            <Input
              type="text"
              inputMode="decimal"
              placeholder={t('credit.creditLimit')}
              value={limitInput}
              onChange={(e) => setLimitInput(e.target.value.replace(/[^0-9.]/g, ''))}
              className="flex-1"
            />
            <Button onClick={() => onSave(account, { creditLimit: parseNum(limitInput) })} disabled={!parseNum(limitInput)} className="shrink-0">{t('credit.save')}</Button>
          </div>
        </div>
      ) : (
        <>
          {/* Utilization figure + bar */}
          <div>
            <div className="flex items-end justify-between gap-3 mb-2">
              <p className={`text-2xl font-extrabold ${style!.text}`}>{fmtPct(util)}</p>
              <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">
                {t('credit.owedOfLimit', { balance: formatCurrency(owed), limit: formatCurrency(account.creditLimit ?? 0) })}
              </p>
            </div>
            <UtilBar util={util} barClass={style!.bar} />
          </div>

          {/* Available credit + statement info + edit */}
          {editing ? (
            <div className="rounded-2xl bg-slate-50 dark:bg-slate-700/40 border border-slate-100 dark:border-slate-700/60 p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label={t('credit.creditLimit')}
                  type="text"
                  inputMode="decimal"
                  value={limitInput}
                  onChange={(e) => setLimitInput(e.target.value.replace(/[^0-9.]/g, ''))}
                />
                <Input
                  label={t('credit.statementDay')}
                  type="text"
                  inputMode="numeric"
                  placeholder="1–31"
                  value={stmtInput}
                  onChange={(e) => setStmtInput(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))}
                />
              </div>
              <p className="text-xs text-slate-400 dark:text-slate-500">{t('credit.statementDayHint')}</p>
              <div className="flex gap-2">
                <Button size="sm" onClick={submitFull}>{t('credit.save')}</Button>
                <Button size="sm" variant="ghost" onClick={() => { setEditing(false); resetInputs(); }}>{t('credit.cancel')}</Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3 text-sm">
              <div className="flex items-center gap-2 min-w-0 flex-wrap">
                <span className="text-slate-500 dark:text-slate-400 font-medium">
                  {t('credit.availableLine', { amount: formatCurrency(available ?? 0) })}
                </span>
                {stmtDays !== null && (
                  <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-lg ${stmtSoon ? 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'}`}>
                    <CalendarClock className="w-3 h-3" />
                    {stmtDays === 0 ? t('credit.statementToday') : t('credit.statementCloses', { days: stmtDays })}
                  </span>
                )}
              </div>
              <button
                onClick={() => setEditing(true)}
                className="inline-flex items-center gap-1.5 font-semibold text-indigo-600 dark:text-indigo-400 hover:underline shrink-0"
              >
                <Pencil className="w-3.5 h-3.5" />{t('credit.editLimit')}
              </button>
            </div>
          )}

          {/* Actionable paydown guidance */}
          <div className="rounded-2xl bg-slate-50 dark:bg-slate-700/40 border border-slate-100 dark:border-slate-700/60 p-4 space-y-1.5">
            {paydownToTarget > 0 && stmtSoon && stmtDays !== null ? (
              <p className="text-sm font-semibold text-amber-700 dark:text-amber-300 flex items-center gap-2">
                <CalendarClock className="w-4 h-4 shrink-0" />
                {t('credit.payBeforeStmt', { amount: formatCurrency(paydownToTarget), card: account.name, days: stmtDays, pct: CREDIT_UTIL_TARGET })}
              </p>
            ) : paydownToTarget > 0 ? (
              <p className="text-sm font-semibold text-amber-700 dark:text-amber-300 flex items-center gap-2">
                <Target className="w-4 h-4 shrink-0" />
                {t('credit.payToTarget', { amount: formatCurrency(paydownToTarget), pct: CREDIT_UTIL_TARGET })}
              </p>
            ) : paydownToIdeal > 0 ? (
              <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                <Sparkles className="w-4 h-4 shrink-0" />
                {t('credit.underTarget', { pct: CREDIT_UTIL_TARGET })}
              </p>
            ) : (
              <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                {t('credit.atIdeal')}
              </p>
            )}
            {/* Always show the path to the ideal <10% when not already there. */}
            {paydownToIdeal > 0 && (
              <p className="text-xs text-slate-500 dark:text-slate-400 pl-6">
                {t('credit.payToIdeal', { amount: formatCurrency(paydownToIdeal), pct: CREDIT_UTIL_IDEAL })}
              </p>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

// ── Statement-close arbitrage banner ──────────────────────────────────────────
// Promotes the "pay before your statement closes" nudge to a prominent, sorted
// list (logic in buildStatementArbitrage) so the time-sensitive action isn't
// buried in the per-card rows.
function StatementArbitrageCard({ items }: { items: StatementArbitrageItem[] }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-2xl border border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-900/20 p-4">
      <div className="flex items-center gap-2 mb-3">
        <CalendarClock className="w-5 h-5 text-amber-500 shrink-0" />
        <div>
          <p className="font-bold text-amber-700 dark:text-amber-300 text-sm">{t('credit.arbTitle')}</p>
          <p className="text-amber-600/90 dark:text-amber-400/90 text-xs mt-0.5">{t('credit.arbSub')}</p>
        </div>
      </div>
      <ul className="space-y-1.5">
        {items.map((i) => (
          <li key={i.account.id} className="flex items-start gap-2 text-sm font-semibold text-amber-800 dark:text-amber-200">
            <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" aria-hidden />
            <span>
              {(i.daysUntil === 0
                ? t('credit.arbItemToday', { card: i.account.name, amount: formatCurrency(i.recommendedPayment), pct: i.targetPct })
                : t('credit.arbItem', { card: i.account.name, days: i.daysUntil, amount: formatCurrency(i.recommendedPayment), pct: i.targetPct }))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Limit increase advisor ────────────────────────────────────────────────────
// High-utilization cards with a solid payment record: requesting a higher limit
// dilutes utilization to a healthy band without spending cash. Logic lives in
// buildLimitIncreaseAdvisories; this is pure display.
function LimitAdvisorCard({ advisories }: { advisories: LimitIncreaseAdvice[] }) {
  const { t } = useTranslation();
  return (
    <Card>
      <div className="flex items-center gap-3 mb-5">
        <CardIcon tone="emerald"><ArrowUpCircle className="w-5 h-5" /></CardIcon>
        <div>
          <p className="text-base font-bold text-slate-900 dark:text-slate-100">{t('credit.advTitle')}</p>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5">{t('credit.advSub')}</p>
        </div>
      </div>
      <div className="space-y-3">
        {advisories.map((a) => {
          const styleBefore = STATUS_STYLE[creditUtilStatus(a.currentUtil)];
          return (
            <div key={a.account.id} className="rounded-2xl bg-emerald-50/60 dark:bg-emerald-900/15 border border-emerald-100 dark:border-emerald-800/40 p-4 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <CreditCard className="w-4 h-4 shrink-0" style={{ color: a.account.color }} />
                  <span className="font-bold text-sm text-slate-900 dark:text-slate-100 truncate">{a.account.name}</span>
                </div>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${styleBefore.chip}`}>{fmtPct(a.currentUtil)}</span>
              </div>
              <p className="text-sm font-bold text-emerald-700 dark:text-emerald-300">
                {a.account.institution
                  ? t('credit.advAskBank', { bank: a.account.institution, amount: formatCurrency(a.increase) })
                  : t('credit.advAsk', { amount: formatCurrency(a.increase) })}
              </p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
                <span>{t('credit.advNewLimit', { amount: formatCurrency(a.recommendedLimit) })}</span>
                <span className="text-emerald-600 dark:text-emerald-400">{t('credit.advDilute', { before: fmtPct(a.currentUtil), after: fmtPct(a.resultingUtil) })}</span>
              </div>
              <p className="text-[11px] text-slate-400 dark:text-slate-500">{t('credit.advRecord', { payments: a.history.payments, months: a.history.monthsWithPayment })}</p>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ── Smart payment planner ─────────────────────────────────────────────────────
// Type a budget; NovaFi splits it across cards to clear the most >30% spikes
// first (the move that maximizes the immediate score gain), then pushes toward
// the 10% ideal. All math lives in allocateSmartPayment — this is pure display.
function SmartPaymentPlanner({ accounts }: { accounts: Account[] }) {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const budget = parseNum(input);
  const plan = useMemo(() => allocateSmartPayment(accounts, budget), [accounts, budget]);
  const active = budget > 0;

  const headline =
    plan.spikesBefore > 0 && plan.spikesAfter === 0
      ? t('credit.simAllClear', { pct: CREDIT_UTIL_TARGET })
      : plan.spikesAfter < plan.spikesBefore
        ? t('credit.simReduced', { pct: CREDIT_UTIL_TARGET, before: plan.spikesBefore, after: plan.spikesAfter })
        : plan.spikesBefore === 0 && plan.totalPaid > 0
          ? t('credit.simTowardIdeal', { pct: CREDIT_UTIL_TARGET })
          : t('credit.simNothing');

  return (
    <Card>
      <div className="flex items-center gap-3 mb-5">
        <CardIcon tone="indigo"><Calculator className="w-5 h-5" /></CardIcon>
        <div>
          <p className="text-base font-bold text-slate-900 dark:text-slate-100">{t('credit.simTitle')}</p>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5">{t('credit.simSub', { pct: CREDIT_UTIL_TARGET })}</p>
        </div>
      </div>

      <Input
        label={t('credit.simInputLabel')}
        type="text"
        inputMode="decimal"
        placeholder={t('credit.simPlaceholder')}
        value={input}
        onChange={(e) => setInput(e.target.value.replace(/[^0-9.]/g, ''))}
      />

      {!active ? (
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-4">{t('credit.simPrompt')}</p>
      ) : (
        <div className="mt-5 space-y-4">
          {/* Headline outcome */}
          <div className={`flex items-start gap-2 rounded-2xl p-4 text-sm font-semibold ${
            plan.spikesAfter === 0
              ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300'
              : 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300'
          }`}>
            <Sparkles className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{headline}</span>
          </div>

          {/* Before/after summary */}
          <div className="grid grid-cols-2 gap-3">
            <Stat
              label={t('credit.simSpikesLabel', { pct: CREDIT_UTIL_TARGET })}
              value={t('credit.simArrow', { before: plan.spikesBefore, after: plan.spikesAfter })}
              tone={plan.spikesAfter < plan.spikesBefore ? 'emerald' : 'slate'}
            />
            <Stat
              label={t('credit.simOverallLabel')}
              value={t('credit.simArrow', { before: fmtPct(plan.overallUtilBefore ?? 0), after: fmtPct(plan.overallUtilAfter ?? 0) })}
              tone={(plan.overallUtilAfter ?? 0) < (plan.overallUtilBefore ?? 0) ? 'emerald' : 'slate'}
            />
          </div>

          {/* Per-card recommended split */}
          {plan.allocations.length > 0 && (
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2 px-1">{t('credit.simRecommended')}</p>
              <div className="space-y-2">
                {plan.allocations.map((a) => <PlannerRow key={a.account.id} alloc={a} />)}
              </div>
            </div>
          )}

          {plan.leftover > 0 && (
            <p className="text-xs text-slate-500 dark:text-slate-400">{t('credit.simLeftover', { amount: formatCurrency(plan.leftover) })}</p>
          )}
        </div>
      )}
    </Card>
  );
}

// One card's recommended payment with a before→after utilization bar.
function PlannerRow({ alloc }: { alloc: PaymentAllocation }) {
  const { t } = useTranslation();
  const styleBefore = STATUS_STYLE[alloc.statusBefore];
  const styleAfter = STATUS_STYLE[alloc.statusAfter];
  return (
    <div className="rounded-2xl bg-slate-50 dark:bg-slate-700/40 border border-slate-100 dark:border-slate-700/60 p-3">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <CreditCard className="w-4 h-4 shrink-0" style={{ color: alloc.account.color }} />
          <span className="font-bold text-sm text-slate-900 dark:text-slate-100 truncate">{alloc.account.name}</span>
        </div>
        <span className="text-sm font-extrabold text-indigo-600 dark:text-indigo-400 shrink-0">{t('credit.simPay', { amount: formatCurrency(alloc.payment) })}</span>
      </div>
      <div className="flex items-center gap-2 text-xs font-semibold">
        <span className={styleBefore.text}>{fmtPct(alloc.utilBefore)}</span>
        <div className="flex-1 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
          <div className={`h-full rounded-full ${styleAfter.bar} transition-[width] duration-500`} style={{ width: `${Math.min(100, Math.max(0, alloc.utilAfter))}%` }} />
        </div>
        <span className={styleAfter.text}>{fmtPct(alloc.utilAfter)}</span>
      </div>
    </div>
  );
}

// ── Balance-transfer / APR optimizer ──────────────────────────────────────────
// Surfaces interest cost on high-APR cards and the savings from moving the
// balance to a 0%/low-APR card (logic in buildBalanceTransferAdvice). Only shows
// when a card has its APR set and runs hot.
function BalanceTransferCard({ advice }: { advice: BalanceTransferAdvice[] }) {
  const { t } = useTranslation();
  return (
    <Card>
      <div className="flex items-center gap-3 mb-5">
        <CardIcon tone="rose"><Shuffle className="w-5 h-5" /></CardIcon>
        <div>
          <p className="text-base font-bold text-slate-900 dark:text-slate-100">{t('credit.bxTitle')}</p>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5">{t('credit.bxSub')}</p>
        </div>
      </div>
      <div className="space-y-3">
        {advice.map((a) => (
          <div key={a.account.id} className="rounded-2xl bg-slate-50 dark:bg-slate-700/40 border border-slate-100 dark:border-slate-700/60 p-4 space-y-1.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <CreditCard className="w-4 h-4 shrink-0" style={{ color: a.account.color }} />
                <span className="font-bold text-sm text-slate-900 dark:text-slate-100 truncate">{a.account.name}</span>
              </div>
              <span className="text-xs font-bold text-rose-600 dark:text-rose-400 shrink-0">{a.apr}% APR</span>
            </div>
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              {t('credit.bxInterest', { monthly: formatCurrency(a.monthlyInterest), annual: formatCurrency(a.annualInterest), apr: a.apr })}
            </p>
            <p className="text-sm font-bold text-emerald-700 dark:text-emerald-300">
              {a.destinationName
                ? t('credit.bxMove', { amount: formatCurrency(a.transferable), dest: a.destinationName, savings: formatCurrency(a.savings), months: a.introMonths })
                : t('credit.bxMoveHypo', { savings: formatCurrency(a.savings), months: a.introMonths })}
            </p>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── Credit-score education ────────────────────────────────────────────────────
function TipsCard() {
  const { t } = useTranslation();
  const tips = [
    { icon: Target,        key: 'tip1' },
    { icon: CalendarClock, key: 'tip2' },
    { icon: CheckCircle2,  key: 'tip3' },
    { icon: History,       key: 'tip4' },
    { icon: ArrowUpCircle, key: 'tip5' },
    { icon: Shuffle,       key: 'tip6' },
  ];
  return (
    <Card>
      <div className="flex items-center gap-3 mb-5">
        <CardIcon tone="amber"><Lightbulb className="w-5 h-5" /></CardIcon>
        <p className="text-base font-bold text-slate-900 dark:text-slate-100">{t('credit.tipsTitle')}</p>
      </div>
      <div className="space-y-4">
        {tips.map(({ icon: Icon, key }) => (
          <div key={key} className="flex gap-3">
            <div className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-700/60 flex items-center justify-center shrink-0">
              <Icon className="w-4 h-4 text-slate-500 dark:text-slate-300" />
            </div>
            <div>
              <p className="font-bold text-sm text-slate-900 dark:text-slate-100">{t(`credit.${key}Title`)}</p>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{t(`credit.${key}Body`)}</p>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
