import type { Account, Bill, Budget, Transaction, TaxSettings } from '@/types';
import {
  detectOverdraftRisks,
  cardPaymentStatus,
  buildCreditReport,
  calcLongestUntouchedSavings,
  normalizeMonthlyBudget,
  isOverCreditTarget,
  CREDIT_UTIL_TARGET,
} from './calculations';

// The notification center aggregates the same warnings the app already surfaces
// in scattered places (the dashboard overdraft card, sidebar badges, stale-savings
// nudge) into one bell. Each item carries a STABLE `id` derived from the thing it
// warns about so the client can persist read/dismissed state across reloads — and
// so a resolved warning (whose id stops being produced) naturally drops out.

export type NotificationType = 'overdraft' | 'bill' | 'budget' | 'credit' | 'savings';
export type NotificationSeverity = 'critical' | 'warning' | 'info';

export interface NotificationItem {
  id: string;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  body: string;
  href: string; // deep link to the page where the user can act on it
}

export interface NotificationContext {
  now: Date;
  monthKey: string; // YYYY-MM of the current month, for the over-budget check
  /** Localized string lookup, e.g. (k, p) => t(k, lang, p). */
  tr: (key: string, params?: Record<string, string | number>) => string;
  /** Currency formatter, e.g. formatCurrency. */
  fmt: (n: number) => string;
}

// Mirror the dashboard's stale-savings threshold so the bell and the dashboard
// nudge agree on when an account counts as "hasn't grown lately".
const STALE_SAVINGS_DAYS = 45;

/** User notification controls (Settings → Notifications). All optional. */
export type NotificationPrefs = Partial<Pick<TaxSettings, 'mutedNotifications' | 'budgetAlertPct' | 'billReminderDays'>>;

const dayIndex = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
};

export function buildNotifications(
  data: { accounts: Account[]; bills: Bill[]; budgets: Budget[]; transactions: Transaction[] },
  ctx: NotificationContext,
  prefs: NotificationPrefs = {},
): NotificationItem[] {
  const { accounts, bills, budgets, transactions } = data;
  const { now, monthKey, tr, fmt } = ctx;
  const items: NotificationItem[] = [];
  const reminderDays = Math.max(0, prefs.billReminderDays ?? 0);
  const budgetPct = Math.min(100, Math.max(50, prefs.budgetAlertPct ?? 100));
  const todayIdx = Math.round(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000);

  // 1. Account overdraft risks. The wording is split into three plain-language
  //    cases so the numbers make sense at a glance:
  //      • already overdrawn — the balance itself is below $0 right now (the bills
  //        drawn from it are beside the point);
  //      • will overdraft — positive today, but the bills drawn from this account
  //        push the projected balance below $0;
  //      • below buffer — stays positive but dips under the cushion the user set.
  //    "Bills" is specifically the sum of YOUR share of the active bills whose
  //    pay-from account is this account (see assessAccountOverdraft).
  for (const risk of detectOverdraftRisks(accounts, bills, now)) {
    const name = risk.account.name;
    let severity: NotificationItem['severity'];
    let title: string;
    let body: string;

    if (risk.kind === 'credit') {
      // A credit card whose upcoming bills would push its balance past the
      // credit limit. The "balance" here is debt owed and the line is the limit,
      // so the wording talks about available credit rather than cash on hand.
      severity = 'critical';
      title = tr('notifications.creditLimitTitle', { name });
      body = tr('notifications.creditLimitBody', {
        available: fmt(risk.availableCredit ?? 0),
        bills: fmt(risk.upcomingTotal),
        over: fmt(risk.shortfall),
      });
      items.push({ id: `overdraft:${risk.account.id}`, type: 'overdraft', severity, title, body, href: '/credit' });
      continue;
    }

    if (risk.currentBalance < 0) {
      severity = 'critical';
      title = tr('notifications.overdrawnTitle', { name });
      body =
        risk.upcomingTotal > 0
          ? tr('notifications.overdrawnBodyBills', {
              balance: fmt(risk.currentBalance),
              bills: fmt(risk.upcomingTotal),
              projected: fmt(risk.projectedBalance),
            })
          : tr('notifications.overdrawnBody', {
              balance: fmt(risk.currentBalance),
              short: fmt(risk.shortfall),
            });
    } else if (risk.willOverdraft) {
      severity = 'critical';
      title = tr('notifications.overdraftWillTitle', { name });
      body = tr('notifications.overdraftWillBody', {
        balance: fmt(risk.currentBalance),
        bills: fmt(risk.upcomingTotal),
        projected: fmt(risk.projectedBalance),
      });
    } else {
      severity = 'warning';
      title = tr('notifications.overdraftBufferTitle', { name });
      body = tr('notifications.overdraftBufferBody', {
        projected: fmt(risk.projectedBalance),
        bills: fmt(risk.upcomingTotal),
        buffer: fmt(risk.threshold),
      });
    }

    items.push({ id: `overdraft:${risk.account.id}`, type: 'overdraft', severity, title, body, href: '/accounts' });
  }

  // 2. Overdue bills (sidebar "overdueBills" badge, expanded to one item each),
  //    plus — when the user asked for reminders — bills due within N days.
  for (const bill of bills) {
    if (!bill.isActive) continue;
    if (new Date(bill.nextDue) < now) {
      items.push({
        id: `bill:${bill.id}`,
        type: 'bill',
        severity: 'warning',
        title: tr('notifications.billTitle', { name: bill.name }),
        body: tr('notifications.billBody', { amount: fmt(bill.amount), date: bill.nextDue }),
        href: '/bills',
      });
      continue;
    }
    const daysUntil = dayIndex(bill.nextDue) - todayIdx;
    if (reminderDays > 0 && daysUntil >= 0 && daysUntil <= reminderDays) {
      items.push({
        id: `billsoon:${bill.id}:${bill.nextDue}`,
        type: 'bill',
        severity: 'info',
        title: daysUntil === 0 ? tr('notifications.billTodayTitle', { name: bill.name }) : tr('notifications.billSoonTitle', { name: bill.name, days: daysUntil }),
        body: tr('notifications.billSoonBody', { amount: fmt(bill.amount), date: bill.nextDue }),
        href: '/bills',
      });
    }
  }

  // 2b. Credit-card payments (due day set on the card): overdue always, due
  //     soon within the reminder window (at least 3 days).
  for (const account of accounts) {
    const pay = cardPaymentStatus(account, transactions, now);
    if (!pay || pay.status === 'paid') continue;
    if (pay.status === 'due' && pay.daysUntilDue > Math.max(3, reminderDays)) continue;
    items.push({
      id: `carddue:${account.id}:${pay.dueDate}`,
      type: 'bill',
      severity: pay.status === 'overdue' ? 'critical' : 'warning',
      title: pay.status === 'overdue'
        ? tr('notifications.cardOverdueTitle', { name: account.name })
        : tr('notifications.cardDueTitle', { name: account.name, days: pay.daysUntilDue }),
      body: pay.minDue > 0
        ? tr('notifications.cardDueBodyMin', { amount: fmt(pay.minDue), date: pay.dueDate })
        : tr('notifications.cardDueBody', { date: pay.dueDate }),
      href: '/credit',
    });
  }

  // 3. Over-budget categories (sidebar "overBudget" badge, per category).
  const monthExpenses = transactions.filter(
    (t) => t.type === 'expense' && t.date.startsWith(monthKey),
  );
  for (const b of budgets) {
    const monthly = normalizeMonthlyBudget(
      b.amount,
      b.period === 'weekly' || b.period === 'yearly' ? b.period : 'monthly',
    );
    const spent = monthExpenses
      .filter((t) => t.category === b.category)
      .reduce((s, t) => s + t.amount, 0);
    const over = spent > monthly;
    // Alert once spending crosses the user's threshold (default: only when over).
    if (!over && (budgetPct >= 100 || monthly <= 0 || spent < monthly * (budgetPct / 100))) continue;
    items.push({
      id: over ? `budget:${b.id || b.category}` : `budgetnear:${b.id || b.category}:${monthKey}`,
      type: 'budget',
      severity: over ? 'warning' : 'info',
      title: over
        ? tr('notifications.budgetTitle', { category: b.category })
        : tr('notifications.budgetNearTitle', { category: b.category, pct: Math.round((spent / monthly) * 100) }),
      body: tr('notifications.budgetBody', { spent: fmt(spent), budget: fmt(monthly) }),
      href: '/planning',
    });
  }

  // 4. Credit cards over the 30% cap (sidebar "creditAlerts" badge, per card).
  for (const card of buildCreditReport(accounts).cards) {
    if (card.util === null || !isOverCreditTarget(card.util)) continue;
    items.push({
      id: `credit:${card.account.id}`,
      type: 'credit',
      severity: 'warning',
      title: tr('notifications.creditTitle', { name: card.account.name }),
      body: tr('notifications.creditBody', { util: Math.round(card.util), target: CREDIT_UTIL_TARGET }),
      href: '/credit',
    });
  }

  // 5. Stale savings — the single worst account, matching the dashboard nudge.
  const stale = calcLongestUntouchedSavings(accounts, transactions, now);
  if (stale && stale.daysSince >= STALE_SAVINGS_DAYS) {
    items.push({
      id: `savings:${stale.account.id}`,
      type: 'savings',
      severity: 'info',
      title: tr('notifications.savingsTitle', { name: stale.account.name }),
      body: stale.lastDeposit
        ? tr('notifications.savingsBody', { days: stale.daysSince })
        : tr('notifications.savingsNeverBody'),
      href: '/savings',
    });
  }

  // Types the user muted never reach the bell.
  const muted = new Set(prefs.mutedNotifications ?? []);
  return muted.size ? items.filter((i) => !muted.has(i.type)) : items;
}
