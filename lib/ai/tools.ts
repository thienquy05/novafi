import type Anthropic from '@anthropic-ai/sdk';
import type { DashboardData } from '@/lib/sheets';
import {
  aggregateMonthlyTotals,
  calcCashFlowProjection,
  calcLongestUntouchedSavings,
  calcNetWorth,
  calcSavingsRate,
  normalizeMerchant,
} from '@/lib/calculations';
import { isRealPool, participantOverpaid, participantOwed, participantRepaid } from '@/lib/funding';
import { isOneOffSplit, splitRemaining } from '@/lib/splits';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '@/types';
import type { Contact, Funding, Loan, Split } from '@/types';

// On-demand, read-only tools for the Nova chat. The always-sent snapshot stays
// small (lib/ai/context.ts); Nova calls these only when a question needs more
// history. Aggregates come from the same calculators the pages use — whole
// dollars, months as parallel arrays (fewer tokens than rows). By the user's
// choice two tools go deeper: find_transactions lists single transactions
// (description, date, amount) but only for the last 2 months, and people_owed
// names the people in loans/splits/group tabs. Record ids are included only so
// Nova's write actions (lib/ai/actions.ts) can point at one; never account
// numbers (long digit runs in descriptions are masked).

export type ToolEnv = {
  data: DashboardData; fundings: Funding[]; loans: Loan[]; splits: Split[]; contacts: Contact[]; now: Date;
  /** Side reads that failed (shown as a warning instead of silently reporting $0 owed). */
  unavailable?: string[];
};

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const usd = (n: number) => Math.round(n);
const usd2 = (n: number) => Math.round(n * 100) / 100; // cents matter for what one person owes
const clamp = (v: unknown, lo: number, hi: number, dflt: number) =>
  Math.min(hi, Math.max(lo, Number.isFinite(Number(v)) && v != null ? Math.floor(Number(v)) : dflt));

/** Oldest → newest month keys ending at the current month. */
function lastMonths(now: Date, n: number): string[] {
  return Array.from({ length: n }, (_, i) => monthKey(new Date(now.getFullYear(), now.getMonth() - (n - 1) + i, 1)));
}

const MONTHS_DESC = 'How many months back, including the current (partial) month.';

/** Accent/case-insensitive form: "Quý" → "quy", "Đạt" → "dat" (Vietnamese đ has no NFD decomposition). */
export const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().trim();

/** Every query word is a prefix of some name word: "quy" ~ "Quý Phạm", "pham q" ~ "Phạm Quý". */
export function nameMatches(name: string, query: string): boolean {
  const words = fold(name).split(/\s+/);
  const q = fold(query).split(/\s+/).filter(Boolean);
  return q.length > 0 && q.every((w) => words.some((n) => n.startsWith(w)));
}

const DETAIL_MONTHS = 2; // single transactions are only ever listed for this window
/** Free text sent to Claude: runs of 4+ digits (even "1234-5678", "12 34 56") become "…" so no card/account number leaks. */
export const maskDigits = (s: string) => s.replace(/\d(?:[ -]?\d){3,}/g, '…').slice(0, 60);

export const ADVISOR_TOOLS = [
  {
    name: 'monthly_history',
    description: 'Income, spending, net and savings rate per month. Use for trends, "how have I been doing", seasonal patterns.',
    input_schema: { type: 'object', properties: { months: { type: 'integer', description: `${MONTHS_DESC} Default 12, max 24.` } } },
  },
  {
    name: 'category_trend',
    description: 'Spending per month for one category, or for the top 8 categories when none is given.',
    input_schema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Exact category name; omit for the top 8.' },
        months: { type: 'integer', description: `${MONTHS_DESC} Default 6, max 12.` },
      },
    },
  },
  {
    name: 'top_merchants',
    description: 'Biggest spending merchants (name, total, number of purchases) over a period. Use for "where does my money go".',
    input_schema: {
      type: 'object',
      properties: {
        months: { type: 'integer', description: `${MONTHS_DESC} Default 3, max 12.` },
        limit: { type: 'integer', description: 'Default 10, max 20.' },
      },
    },
  },
  {
    name: 'account_flows',
    description: 'Per account: current balance and money in, out, transfers in and transfers out per month. Use for savings history, where cash moves, and money-flow questions.',
    input_schema: { type: 'object', properties: { months: { type: 'integer', description: `${MONTHS_DESC} Default 6, max 12.` } } },
  },
  {
    name: 'people_owed',
    description: 'Who owes the user money and whom the user owes, from loans (lent/borrowed), bill and expense splits, and group tabs, merged per person, with each open item. Use for any question about a person ("how much does Quý owe me", "ai còn nợ tôi"). Also lists active split bills that will add to what people owe.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Person name or its start, as the user typed it (accents optional: "Quy" finds "Quý"). Omit for everyone with an open balance. With a name, settled items are included too.' },
      },
    },
  },
  {
    name: 'find_transactions',
    description: `Spending or income matching a merchant/description text and/or category: totals per month, the grand total, and the matching single transactions (date, description, amount, category, account) from the last ${DETAIL_MONTHS} months. With no filter it lists the latest transactions. Use for "how much did I pay for Spotify", "what did I buy at Costco", "show my recent transactions".`,
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text inside the description, e.g. "spotify" (case- and accent-insensitive).' },
        category: { type: 'string', description: 'Exact category name.' },
        months: { type: 'integer', description: `${MONTHS_DESC} Default ${DETAIL_MONTHS}, max 24 (single transactions are still only the last ${DETAIL_MONTHS}).` },
      },
    },
  },
  {
    name: 'accounts_and_tabs',
    description: 'Exact names to use in actions: the user\'s accounts (name, type, balance), expense and income categories, and group tabs (name, kind, open tab or not, archived, spent, each person\'s share, paid back, still owes, to refund). Call before an action when you are not sure of a name.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'cash_flow_outlook',
    description: 'Projected net worth for the next 6 months from the recent average monthly savings (total and liquid basis), plus the savings account that has gone longest without a deposit.',
    input_schema: { type: 'object', properties: {} },
  },
] satisfies Anthropic.Beta.BetaTool[];

function monthlyHistory(env: ToolEnv, input: Record<string, unknown>) {
  const months = lastMonths(env.now, clamp(input.months, 1, 24, 12));
  const byMonth = new Map(aggregateMonthlyTotals(env.data.transactions).map((m) => [m.monthKey, m]));
  const rows = months.map((m) => byMonth.get(m));
  return {
    months,
    income: rows.map((r) => usd(r?.income ?? 0)),
    spending: rows.map((r) => usd(r?.expense ?? 0)),
    net: rows.map((r) => usd(r?.net ?? 0)),
    savingsRatePct: rows.map((r) => Math.round(calcSavingsRate(r?.income ?? 0, r?.expense ?? 0))),
  };
}

function categoryTrend(env: ToolEnv, input: Record<string, unknown>) {
  const months = lastMonths(env.now, clamp(input.months, 1, 12, 6));
  const idx = new Map(months.map((m, i) => [m, i]));
  const wanted = typeof input.category === 'string' ? input.category.trim().toLowerCase() : '';
  const series = new Map<string, number[]>();
  for (const t of env.data.transactions) {
    const i = idx.get(t.date.slice(0, 7));
    if (t.type !== 'expense' || i === undefined) continue;
    if (wanted && t.category.toLowerCase() !== wanted) continue;
    const arr = series.get(t.category) ?? new Array(months.length).fill(0);
    arr[i] += t.amount;
    series.set(t.category, arr);
  }
  const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);
  const top = [...series.entries()].sort((a, b) => sum(b[1]) - sum(a[1])).slice(0, wanted ? 1 : 8);
  return { months, categories: Object.fromEntries(top.map(([c, a]) => [c, a.map(usd)])) };
}

function topMerchants(env: ToolEnv, input: Record<string, unknown>) {
  const months = new Set(lastMonths(env.now, clamp(input.months, 1, 12, 3)));
  const limit = clamp(input.limit, 1, 20, 10);
  const byMerchant = new Map<string, { total: number; count: number }>();
  for (const t of env.data.transactions) {
    if (t.type !== 'expense' || !months.has(t.date.slice(0, 7))) continue;
    const name = normalizeMerchant(t.description).slice(0, 40) || t.category.toLowerCase();
    const row = byMerchant.get(name) ?? { total: 0, count: 0 };
    row.total += t.amount;
    row.count += 1;
    byMerchant.set(name, row);
  }
  return {
    merchants: [...byMerchant.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, limit)
      .map(([merchant, r]) => ({ merchant, total: usd(r.total), purchases: r.count })),
  };
}

function accountFlows(env: ToolEnv, input: Record<string, unknown>) {
  const months = lastMonths(env.now, clamp(input.months, 1, 12, 6));
  const idx = new Map(months.map((m, i) => [m, i]));
  const blank = () => new Array<number>(months.length).fill(0);
  const flows = new Map(env.data.accounts.filter((a) => a.type !== 'pool').map((a) => [a.id, { in: blank(), out: blank(), xferIn: blank(), xferOut: blank() }]));
  for (const t of env.data.transactions) {
    const i = idx.get(t.date.slice(0, 7));
    if (i === undefined) continue;
    if (t.type === 'income') { const f = flows.get(t.account); if (f) f.in[i] += t.amount; }
    else if (t.type === 'expense') { const f = flows.get(t.account); if (f) f.out[i] += t.amount; }
    else {
      const from = flows.get(t.account);
      const to = t.toAccount ? flows.get(t.toAccount) : undefined;
      if (from) from.xferOut[i] += t.amount;
      if (to) to.xferIn[i] += t.amount;
    }
  }
  return {
    months,
    accounts: env.data.accounts
      .filter((a) => flows.has(a.id))
      .map((a) => {
        const f = flows.get(a.id)!;
        return { name: a.name, type: a.type, balance: usd(a.balance), in: f.in.map(usd), out: f.out.map(usd), transfersIn: f.xferIn.map(usd), transfersOut: f.xferOut.map(usd) };
      }),
  };
}

function cashFlowOutlook(env: ToolEnv) {
  const { data, fundings, now } = env;
  const project = (basis: 'total' | 'liquid') =>
    calcCashFlowProjection({ liveNetWorth: calcNetWorth(data.accounts, fundings, basis), transactions: data.transactions, accounts: data.accounts, basis, now });
  const fmt = (f: ReturnType<typeof project>) => (f ? { monthlyChange: usd(f.monthlyChange), next6Months: f.values.map(usd), basedOnMonths: f.basedOnMonths } : null);
  const stale = calcLongestUntouchedSavings(data.accounts, data.transactions, now);
  return {
    total: fmt(project('total')),
    liquid: fmt(project('liquid')),
    longestUntouchedSavings: stale ? { account: stale.account.name, lastDeposit: stale.lastDeposit, daysSince: stale.daysSince } : null,
  };
}

type OweItem = { id: string; source: 'loan' | 'bill_split' | 'expense_split' | 'group_tab'; what: string; date: string; direction: 'they_owe_me' | 'i_owe_them'; original: number; paidBack: number; remaining: number };

function peopleOwed(env: ToolEnv, input: Record<string, unknown>) {
  const query = typeof input.name === 'string' ? input.name.trim() : '';
  // Grouped by contact id (or exact name for tab participants, which have none) —
  // accent folding is only for SEARCH, so "Hòa" and "Hoa" stay two people.
  const contactIdByName = new Map(env.contacts.map((c) => [c.name.trim().toLowerCase(), c.id]));
  const contactById = new Map(env.contacts.map((c) => [c.id, c.name]));
  const people = new Map<string, { name: string; items: OweItem[] }>();
  const add = (stored: string, contactId: string, item: OweItem) => {
    const name = contactById.get(contactId) || stored; // current name wins after a rename; the stored one still matches
    if (!name.trim() || (query && !nameMatches(name, query) && !nameMatches(stored, query))) return;
    if (!query && item.remaining <= 0) return; // overview: open balances only
    const key = contactId || contactIdByName.get(name.trim().toLowerCase()) || `name:${name.trim().toLowerCase()}`;
    const p = people.get(key) ?? { name: name.trim(), items: [] };
    p.items.push({ ...item, what: maskDigits(item.what), original: usd2(item.original), paidBack: usd2(item.paidBack), remaining: usd2(item.remaining) });
    people.set(key, p);
  };

  for (const l of env.loans) {
    const remaining = l.settled ? 0 : Math.max(0, l.principal - (l.repaidAmount || 0));
    add(l.contactName, l.contactId, { id: l.id, source: 'loan', what: l.note || 'loan', date: l.date, direction: l.direction === 'lent' ? 'they_owe_me' : 'i_owe_them', original: l.principal, paidBack: l.repaidAmount || 0, remaining });
  }
  for (const s of env.splits) {
    add(s.contactName, s.contactId, { id: s.id, source: isOneOffSplit(s) ? 'expense_split' : 'bill_split', what: s.billName, date: s.date, direction: 'they_owe_me', original: s.amount, paidBack: s.repaidAmount || 0, remaining: splitRemaining(s) });
  }
  for (const f of env.fundings) {
    if (isRealPool(f)) continue; // everyone already paid in — nothing to settle
    for (const p of f.participants) {
      if (p.isMe) continue;
      add(p.name, '', { id: f.id, source: 'group_tab', what: f.description, date: f.date, direction: 'they_owe_me', original: p.contributed || 0, paidBack: participantRepaid(f.repayments, p), remaining: f.closed ? 0 : participantOwed(p, f.repayments) });
      // Paid back more than their (re-split) share → the user owes them a refund.
      const refund = participantOverpaid(p, f.repayments);
      if (refund > 0) add(p.name, '', { id: f.id, source: 'group_tab', what: `refund — ${f.description}`, date: f.date, direction: 'i_owe_them', original: refund, paidBack: 0, remaining: refund });
    }
  }

  const contactName = new Map(env.contacts.map((c) => [c.id, c.name]));
  const upcomingSplitBills = env.data.bills
    .filter((b) => b.isActive)
    .flatMap((b) => {
      const shares = b.splitParticipants?.length ? b.splitParticipants : b.splitContactId ? [{ contactId: b.splitContactId, amount: b.splitAmount ?? 0 }] : [];
      return shares
        .map((x) => ({ person: contactName.get(x.contactId) ?? '', bill: maskDigits(b.name), nextDue: b.nextDue, frequency: b.frequency, theirShare: usd2(x.amount) }))
        .filter((x) => x.person && (!query || nameMatches(x.person, query)));
    });

  const sum = (items: OweItem[], d: OweItem['direction']) => usd2(items.filter((i) => i.direction === d).reduce((s, i) => s + i.remaining, 0));
  const list = [...people.values()]
    .map((p) => {
      const theyOweMe = sum(p.items, 'they_owe_me');
      const iOweThem = sum(p.items, 'i_owe_them');
      const items = p.items.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 25);
      return { name: p.name, theyOweMe, iOweThem, net: usd2(theyOweMe - iOweThem), items };
    })
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  return {
    ...(env.unavailable?.length ? { warning: `could not read ${env.unavailable.join(', ')} — amounts may be incomplete` } : {}),
    ...(query && !list.length ? { note: `no person matching "${query.slice(0, 40)}"`, knownPeople: [...new Set([...env.contacts.map((c) => c.name), ...env.loans.map((l) => l.contactName)])].filter(Boolean).slice(0, 40) } : {}),
    people: list.slice(0, 30),
    ...(list.length > 30 ? { morePeopleNotShown: list.length - 30 } : {}),
    totals: { theyOweMe: usd2(list.reduce((s, p) => s + p.theyOweMe, 0)), iOweThem: usd2(list.reduce((s, p) => s + p.iOweThem, 0)) },
    upcomingSplitBills,
  };
}

function findTransactions(env: ToolEnv, input: Record<string, unknown>) {
  const months = lastMonths(env.now, clamp(input.months, 1, 24, DETAIL_MONTHS));
  const idx = new Map(months.map((m, i) => [m, i]));
  const detail = new Set(lastMonths(env.now, DETAIL_MONTHS));
  const q = typeof input.query === 'string' ? fold(input.query) : '';
  const cat = typeof input.category === 'string' ? input.category.trim().toLowerCase() : '';
  const accountName = new Map(env.data.accounts.map((a) => [a.id, a.name]));
  const spending = new Array<number>(months.length).fill(0);
  const income = new Array<number>(months.length).fill(0);
  const rows: { id: string; date: string; description: string; amount: number; type: string; category: string; account: string }[] = [];
  let count = 0;
  for (const t of env.data.transactions) {
    const i = idx.get(t.date.slice(0, 7));
    if (i === undefined) continue;
    if (cat && t.category.toLowerCase() !== cat) continue;
    if (q && !fold(t.description).includes(q) && !fold(t.category).includes(q)) continue;
    if (t.type === 'expense') spending[i] += t.amount;
    else if (t.type === 'income') income[i] += t.amount;
    else if (q || cat) continue; // transfers only show up in the unfiltered "latest" list
    count += 1;
    if (detail.has(t.date.slice(0, 7))) {
      rows.push({ id: t.id, date: t.date, description: maskDigits(t.description), amount: usd2(t.amount), type: t.type, category: t.category, account: maskDigits(accountName.get(t.account) ?? '') });
    }
  }
  rows.sort((a, b) => b.date.localeCompare(a.date));
  return {
    months,
    spending: spending.map(usd2),
    income: income.map(usd2),
    totalSpending: usd2(spending.reduce((s, x) => s + x, 0)),
    totalIncome: usd2(income.reduce((s, x) => s + x, 0)),
    matches: count,
    transactions: rows.slice(0, 40),
    ...(rows.length > 40 ? { moreNotShown: rows.length - 40 } : {}),
  };
}

function accountsAndTabs(env: ToolEnv) {
  const s = env.data.settings;
  const name = (p: { name: string; isMe: boolean }) => (p.isMe ? 'me' : maskDigits(p.name));
  return {
    accounts: env.data.accounts.filter((a) => a.type !== 'pool').map((a) => ({ name: maskDigits(a.name), type: a.type, balance: usd2(a.balance) })),
    expenseCategories: [...EXPENSE_CATEGORIES, ...(s.customExpenseCategories ?? [])].filter((c) => !(s.hiddenExpenseCategories ?? []).includes(c)),
    incomeCategories: [...INCOME_CATEGORIES, ...(s.customIncomeCategories ?? [])].filter((c) => !(s.hiddenIncomeCategories ?? []).includes(c)),
    groupTabs: env.fundings.slice(0, 30).map((f) => ({
      name: maskDigits(f.description),
      kind: isRealPool(f) ? 'group_vault' : f.autoSplit ? 'open_tab' : 'fixed_pledge_tab',
      archived: f.closed,
      spent: usd2(f.spent),
      people: f.participants.map((p) => ({
        name: name(p),
        share: usd2(p.contributed || 0),
        ...(isRealPool(f) || p.isMe ? {} : {
          paidBack: participantRepaid(f.repayments, p),
          owes: participantOwed(p, f.repayments),
          toRefund: participantOverpaid(p, f.repayments),
        }),
      })),
    })),
    ...(env.unavailable?.length ? { warning: `could not read ${env.unavailable.join(', ')}` } : {}),
  };
}

/** Runs one tool; always returns a compact JSON string (errors included) so a bad call never breaks the chat. */
export function runAdvisorTool(name: string, input: unknown, env: ToolEnv): string {
  const args = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  try {
    switch (name) {
      case 'monthly_history': return JSON.stringify(monthlyHistory(env, args));
      case 'category_trend': return JSON.stringify(categoryTrend(env, args));
      case 'top_merchants': return JSON.stringify(topMerchants(env, args));
      case 'account_flows': return JSON.stringify(accountFlows(env, args));
      case 'people_owed': return JSON.stringify(peopleOwed(env, args));
      case 'find_transactions': return JSON.stringify(findTransactions(env, args));
      case 'cash_flow_outlook': return JSON.stringify(cashFlowOutlook(env));
      case 'accounts_and_tabs': return JSON.stringify(accountsAndTabs(env));
      default: return JSON.stringify({ error: 'unknown_tool' });
    }
  } catch {
    return JSON.stringify({ error: 'tool_failed' });
  }
}
