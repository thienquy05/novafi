import { createHash } from 'crypto';
import type Anthropic from '@anthropic-ai/sdk';
import { t } from '@/lib/i18n';
import { roundCents } from '@/lib/calculations';
import { formatCurrency, generateId } from '@/lib/utils';
import {
  repaymentBelongsTo, buildRefundTx, buildRepayTx, buildSpendTxs, defaultMyShare, groupFundingSpends, isRealPool,
  participantOverpaid, participantOwed, participantRepaid, planVirtualPoolEdit, resplitOpenTab,
  shiftAutoSplit, splitCents,
} from '@/lib/funding';
import { buildLoanTx } from '@/lib/loans';
import { buildSplitTx, splitRemaining } from '@/lib/splits';
import { fold, nameMatches, type ToolEnv } from '@/lib/ai/tools';
import { NOTE_MARK } from '@/lib/ai/shared';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '@/types';
import type { Account, Funding, FundingParticipant, Language, Loan, Split, Transaction } from '@/types';

// Nova's WRITE actions (phase 1: transactions, transfers, group tabs, loan/split
// paybacks). Nova never writes directly: a tool call only PLANS. planAction()
// validates the input against the user's data and returns a preview (title +
// lines) and the exact request one of the existing write routes would get from
// the manual UI — so balances, linked records and caches follow the same code
// path as a tap in the app. The chat shows the plan as a card; the client runs it
// through /api/advisor/execute, which re-plans against fresh data and refuses if
// the fingerprint changed ("what you saw is what runs"). Risky plans (deletes,
// anything touching several people or accounts, re-splits, refunds) wait for the
// user's Confirm; a clear simple one runs straight away.

export type ActionEnv = ToolEnv & { lang: Language };
export type ActionPath = '/api/transactions' | '/api/funding' | '/api/loans' | '/api/splits';
export type ActionRequest = { method: 'POST' | 'PUT' | 'DELETE'; path: ActionPath; body: unknown };
export type ActionPlan = { tool: string; title: string; lines: string[]; risky: boolean; request: ActionRequest; fp: string };
export type PlanResult = { ok: true; plan: ActionPlan } | { ok: false; error: string; options?: string[] };

class PlanError extends Error {
  constructor(message: string, public options?: string[]) { super(message); }
}

const CONFIRM_FIRST = {
  type: 'boolean',
  description: 'true when you had to assume something the user did not say (account, amount, person, date): the user then sees a summary and must OK it. Risky actions, and any account, tab or person name that is not typed exactly, always wait for OK anyway.',
} as const;
const DATE = { type: 'string', description: 'YYYY-MM-DD; default today.' } as const;
const TAB = { type: 'string', description: 'Group tab name (or its start), as listed by accounts_and_tabs.' } as const;
const ACCOUNT = (what: string) => ({ type: 'string', description: `${what} — account name as listed by accounts_and_tabs.` }) as const;

export const ACTION_TOOLS = [
  {
    name: 'add_transaction',
    description: 'Record a new expense or income ("I spent $24 on lunch with Chase"). Runs straight away when clear.',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['expense', 'income'] },
        amount: { type: 'number', description: 'Positive USD amount.' },
        description: { type: 'string' },
        category: { type: 'string', description: 'One of the categories from accounts_and_tabs; default Other / Other Income.' },
        account: ACCOUNT('Account paid with / received into'),
        date: DATE,
        tags: { type: 'array', items: { type: 'string' } },
        confirm_first: CONFIRM_FIRST,
      },
      required: ['type', 'amount', 'description', 'account'],
    },
  },
  {
    name: 'transfer_money',
    description: 'Move money between two of the user\'s accounts (also paying a credit card from checking). Always waits for OK.',
    input_schema: {
      type: 'object',
      properties: {
        from: ACCOUNT('From'),
        to: ACCOUNT('To'),
        amount: { type: 'number' },
        description: { type: 'string' },
        date: DATE,
        confirm_first: CONFIRM_FIRST,
      },
      required: ['from', 'to', 'amount'],
    },
  },
  {
    name: 'edit_transaction',
    description: 'Change one existing transaction by its id (from find_transactions). Only the given fields change.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        amount: { type: 'number' },
        description: { type: 'string' },
        category: { type: 'string' },
        date: DATE,
        account: ACCOUNT('New account (income/expense only)'),
        confirm_first: CONFIRM_FIRST,
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_transaction',
    description: 'Delete one transaction by its id (from find_transactions); its balance effect is reversed. Always waits for OK.',
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'group_tab_spend',
    description: 'Log a bill paid for a group tab. Open tabs split it: your share defaults to amount ÷ everyone, the rest is added to what each other person owes. Always waits for OK.',
    input_schema: {
      type: 'object',
      properties: {
        tab: TAB,
        amount: { type: 'number' },
        description: { type: 'string' },
        account: ACCOUNT('Account or card it was paid with (real pools default to the pool account)'),
        my_share: { type: 'number', description: 'The user\'s own part; default equal share (open tab) or 0 (other tabs).' },
        category: { type: 'string' },
        date: DATE,
      },
      required: ['tab', 'amount'],
    },
  },
  {
    name: 'group_tab_payback',
    description: 'Someone in a group tab paid the user back.',
    input_schema: {
      type: 'object',
      properties: { tab: TAB, person: { type: 'string' }, amount: { type: 'number' }, account: ACCOUNT('Account the money landed in'), date: DATE, confirm_first: CONFIRM_FIRST },
      required: ['tab', 'person', 'amount', 'account'],
    },
  },
  {
    name: 'group_tab_refund',
    description: 'Record that the user sent money back to someone who had paid more than their share (shown as "to refund" after a re-split). Always waits for OK.',
    input_schema: {
      type: 'object',
      properties: { tab: TAB, person: { type: 'string' }, amount: { type: 'number', description: 'Default: the full amount to refund.' }, account: ACCOUNT('Account the refund was sent from'), date: DATE },
      required: ['tab', 'person', 'account'],
    },
  },
  {
    name: 'group_tab_people',
    description: 'Add/remove people in a virtual group tab and re-split. split "equal" = everything spent so far (open tab) or the pool total (fixed-pledge tab) divided equally over the new roster, the user included if they are in the tab; "custom" = given amounts per person, anyone not named splits the rest equally; "keep" = shares unchanged (new people start at 0). People who already paid back more than their new share are marked "to refund" (no money moves until group_tab_refund). Removing someone reverses their paybacks. Always waits for OK.',
    input_schema: {
      type: 'object',
      properties: {
        tab: TAB,
        add: { type: 'array', items: { type: 'string' }, description: 'New people\'s names.' },
        remove: { type: 'array', items: { type: 'string' } },
        split: { type: 'string', enum: ['equal', 'custom', 'keep'] },
        amounts: {
          type: 'array',
          description: 'For split "custom": each person\'s total share. Use "me" for the user.',
          items: { type: 'object', properties: { name: { type: 'string' }, amount: { type: 'number' } }, required: ['name', 'amount'] },
        },
      },
      required: ['tab', 'split'],
    },
  },
  {
    name: 'group_tab_archive',
    description: 'Archive (wrap up) or reopen a group tab. No money moves.',
    input_schema: { type: 'object', properties: { tab: TAB, archived: { type: 'boolean' } }, required: ['tab', 'archived'] },
  },
  {
    name: 'record_payback',
    description: 'A payback on a personal loan or a bill/expense split (from people_owed): a person paid the user back, or the user repaid a loan they borrowed. Amount is capped at what is left.',
    input_schema: {
      type: 'object',
      properties: {
        person: { type: 'string' },
        amount: { type: 'number' },
        item_id: { type: 'string', description: 'The loan/split id from people_owed when the person has several open items.' },
        account: ACCOUNT('Account the money moved into/out of; default the item\'s own account'),
        confirm_first: CONFIRM_FIRST,
      },
      required: ['person', 'amount'],
    },
  },
] satisfies Anthropic.Beta.BetaTool[];

const ACTION_NAMES = new Set<string>(ACTION_TOOLS.map((a) => a.name));
export const isActionTool = (name: unknown): name is string => typeof name === 'string' && ACTION_NAMES.has(name);

// ── Input helpers ─────────────────────────────────────────────────────────────

const str = (v: unknown, max = 120) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function amountOf(v: unknown, field = 'amount'): number {
  const n = roundCents(Number(v));
  if (!Number.isFinite(n) || n <= 0 || n > 10_000_000) throw new PlanError(`${field} must be a positive number`);
  return n;
}

function dateOf(v: unknown, env: ActionEnv): string {
  if (v == null || v === '') return ymd(env.now);
  const s = str(v, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw new PlanError('date must be YYYY-MM-DD');
  return s;
}

/** Set when a name was matched loosely (word prefix, not the exact name): the plan then waits for the user's OK. */
type Flags = { loose: boolean };

/** One match by exact (accent/case-folded) name, else a unique word-prefix match (flagged as loose); otherwise list the options. */
function pickByName<T>(items: T[], name: (x: T) => string, query: string, what: string, flags: Flags): T {
  const q = fold(query);
  if (!q) throw new PlanError(`${what} is required`, items.map(name).slice(0, 30));
  const exact = items.filter((x) => fold(name(x)) === q);
  if (exact.length === 1) return exact[0];
  // Word-prefix only ("quy" ~ "Quý Phạm"); never a substring, so "An" can't land on "Lan".
  const loose = exact.length ? exact : items.filter((x) => nameMatches(name(x), query));
  if (loose.length === 1) {
    flags.loose = true;
    return loose[0];
  }
  throw new PlanError(loose.length ? `${what} "${query}" is ambiguous` : `no ${what} matching "${query}"`, (loose.length ? loose : items).map(name).slice(0, 30));
}

function accountOf(c: Ctx, query: unknown, what = 'account'): Account {
  const usable = c.env.data.accounts.filter((a) => a.type !== 'pool');
  const q = str(query);
  const byId = usable.find((a) => a.id === q);
  // Not the exact name ("chase" → "Chase Checking")? The card shows what was found and waits for the user's OK.
  return byId ?? pickByName(usable, (a) => a.name, q, what, c.flags);
}

function categoryOf(env: ActionEnv, type: 'expense' | 'income', query: unknown): string {
  const s = env.data.settings;
  const list = type === 'expense'
    ? [...EXPENSE_CATEGORIES, ...(s.customExpenseCategories ?? [])].filter((c) => !(s.hiddenExpenseCategories ?? []).includes(c))
    : [...INCOME_CATEGORIES, ...(s.customIncomeCategories ?? [])].filter((c) => !(s.hiddenIncomeCategories ?? []).includes(c));
  const q = str(query, 60);
  if (!q) return type === 'expense' ? 'Other' : 'Other Income';
  const hit = list.find((c) => fold(c) === fold(q));
  if (!hit) throw new PlanError(`unknown ${type} category "${q}"`, list);
  return hit;
}

function tabOf(c: Ctx, query: unknown): Funding {
  const { env } = c;
  if (env.unavailable?.includes('group tabs')) throw new PlanError('group tabs could not be read right now; try again');
  const q = str(query);
  // An exact name wins anywhere (archived too); a loose match only among open tabs, then all.
  const exact = env.fundings.filter((f) => fold(f.description) === fold(q));
  if (exact.length === 1) return exact[0];
  const open = env.fundings.filter((f) => !f.closed);
  try {
    return pickByName(open.length ? open : env.fundings, (f) => f.description, q, 'group tab', c.flags);
  } catch (e) {
    if (open.length === env.fundings.length) throw e;
    return pickByName(env.fundings, (f) => f.description, q, 'group tab', c.flags);
  }
}

/** Only the literal "me" means the user — Vietnamese pronouns like Minh / Anh / Em are also common names. */
const isMeWord = (s: string) => fold(s) === 'me';

function personIn(c: Ctx, f: Funding, query: unknown): FundingParticipant {
  return pickByName(f.participants.filter((p) => !p.isMe), (p) => p.name, str(query, 60), 'person in this tab', c.flags);
}

// ── Fingerprint ───────────────────────────────────────────────────────────────
// The plan's request with freshly generated ids / timestamps normalised away, so
// planning the same thing twice over the same data gives the same fingerprint and
// any change to the data in between gives a different one.

const GEN_ID = /^\d{13}_[a-z0-9]{1,9}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

function knownStrings(env: ActionEnv): Set<string> {
  const s = new Set<string>();
  for (const tx of env.data.transactions) { s.add(tx.id); if (tx.createdAt) s.add(tx.createdAt); }
  for (const a of env.data.accounts) s.add(a.id);
  for (const f of env.fundings) {
    s.add(f.id);
    for (const p of f.participants) if (p.id) s.add(p.id);
    for (const r of f.repayments) s.add(r.id);
  }
  for (const l of env.loans) s.add(l.id);
  for (const x of env.splits) s.add(x.id);
  return s;
}

/** `guard` = extra current data the request doesn't carry (e.g. the row a delete removes), so a change to it also changes the fingerprint. */
export function fingerprint(tool: string, request: ActionRequest, known: Set<string>, guard?: unknown): string {
  const norm = JSON.stringify({ request, guard: guard ?? null }, (_k, v) =>
    typeof v === 'string' && !known.has(v) && (GEN_ID.test(v) || ISO.test(v)) ? '#new' : v);
  return createHash('sha256').update(`${tool}\n${norm}`).digest('hex').slice(0, 12);
}

// ── Planners ──────────────────────────────────────────────────────────────────

type Draft = Omit<ActionPlan, 'fp' | 'tool'> & { guard?: unknown };
type Ctx = { env: ActionEnv; flags: Flags; tr: (k: string, p?: Record<string, string | number>) => string; money: (n: number) => string; acct: (id: string) => string };

function addTransaction(c: Ctx, i: Record<string, unknown>): Draft {
  const type = i.type === 'income' ? 'income' : i.type === 'expense' ? 'expense' : null;
  if (!type) throw new PlanError('type must be expense or income');
  const amount = amountOf(i.amount);
  const description = str(i.description, 100);
  if (!description) throw new PlanError('description is required');
  const account = accountOf(c, i.account);
  const category = categoryOf(c.env, type, i.category);
  const date = dateOf(i.date, c.env);
  const tags = Array.isArray(i.tags) ? i.tags.map((x) => str(x, 30)).filter(Boolean).slice(0, 8) : [];
  const tx: Transaction = { id: generateId(), date, description, amount, type, category, account: account.id, createdAt: new Date().toISOString(), ...(tags.length ? { tags } : {}) };
  return {
    title: c.tr(type === 'expense' ? 'nova.titleAddExpense' : 'nova.titleAddIncome'),
    lines: [c.tr('nova.lineTx', { amount: c.money(amount), desc: description, category, account: account.name, date })],
    risky: false,
    request: { method: 'POST', path: '/api/transactions', body: tx },
  };
}

function transferMoney(c: Ctx, i: Record<string, unknown>): Draft {
  const from = accountOf(c, i.from, 'from account');
  const to = accountOf(c, i.to, 'to account');
  if (from.id === to.id) throw new PlanError('from and to must be different accounts');
  const amount = amountOf(i.amount);
  const date = dateOf(i.date, c.env);
  const description = str(i.description, 100) || c.tr('nova.transferDesc', { from: from.name, to: to.name });
  const tx: Transaction = { id: generateId(), date, description, amount, type: 'transfer', category: 'Transfer', account: from.id, toAccount: to.id, createdAt: new Date().toISOString() };
  return {
    title: c.tr('nova.titleTransfer'),
    lines: [c.tr('nova.lineTransfer', { amount: c.money(amount), from: from.name, to: to.name, date })],
    risky: true,
    request: { method: 'POST', path: '/api/transactions', body: tx },
  };
}

const OWNED_CATEGORIES = new Set(['Funding', 'FundingRepay', 'FundingReimburse', 'Loan', 'Split']);

/** What record owns a ledger row (group tab spend/payback, loan, split, incl. a split's my-share expense), if any. */
function ownerOf(env: ActionEnv, id: string): string | null {
  for (const f of env.fundings) {
    const ids = [f.contributionTxId, ...f.spendTxIds, ...f.repayments.map((r) => r.id), ...(f.contributions ?? []).map((x) => x.id), ...(f.reimbursements ?? []).map((r) => r.id)];
    if (ids.includes(id)) return `group tab "${f.description}"`;
  }
  for (const l of env.loans) if (l.principalTxId === id || l.repaymentTxIds.includes(id)) return `a loan with ${l.contactName}`;
  for (const x of env.splits) if ([x.frontedTxId, x.settleTxId, x.myShareTxId, ...x.repaymentTxIds].includes(id)) return `a split with ${x.contactName}`;
  return null;
}

/** A plain ledger row Nova may edit/delete. Rows owned by a group tab, loan or split are changed through that record instead, so it never drifts. */
function txById(c: Ctx, id: unknown): Transaction {
  const tx = c.env.data.transactions.find((x) => x.id === str(id, 60));
  if (!tx) throw new PlanError('no transaction with that id; look it up with find_transactions first');
  const owner = ownerOf(c.env, tx.id) ?? (OWNED_CATEGORIES.has(tx.category) ? 'a group tab, loan or split' : null);
  if (owner) throw new PlanError(`this row belongs to ${owner}; change it from that record (the group tab actions, or the Funding / Transactions page) so it stays in sync`);
  return tx;
}

function editTransaction(c: Ctx, i: Record<string, unknown>): Draft {
  const original = txById(c, i.id);
  const updated: Transaction = { ...original };
  const lines: string[] = [c.tr('nova.lineTx', { amount: c.money(original.amount), desc: original.description, category: original.category, account: c.acct(original.account), date: original.date })];
  const change = (field: string, from: string, to: string) => lines.push(c.tr('nova.lineChange', { field: c.tr(`nova.field.${field}`), from, to }));
  if (i.amount != null) { updated.amount = amountOf(i.amount); change('amount', c.money(original.amount), c.money(updated.amount)); }
  if (str(i.description)) { updated.description = str(i.description, 100); change('description', original.description, updated.description); }
  if (str(i.category)) {
    if (original.type === 'transfer') throw new PlanError('a transfer has no category to change');
    updated.category = categoryOf(c.env, original.type, i.category);
    change('category', original.category, updated.category);
  }
  if (i.date != null && i.date !== '') { updated.date = dateOf(i.date, c.env); change('date', original.date, updated.date); }
  if (str(i.account)) {
    if (original.type === 'transfer') throw new PlanError('change a transfer\'s accounts by deleting it and adding a new one');
    updated.account = accountOf(c, i.account).id;
    change('account', c.acct(original.account), c.acct(updated.account));
  }
  if (lines.length === 1) throw new PlanError('nothing to change');
  // Moving a row to another account touches two balances → wait for OK.
  return { title: c.tr('nova.titleEdit'), lines, risky: updated.account !== original.account, request: { method: 'PUT', path: '/api/transactions', body: { original, updated } } };
}

function deleteTransaction(c: Ctx, i: Record<string, unknown>): Draft {
  const tx = txById(c, i.id);
  const lines = [c.tr('nova.lineTx', { amount: c.money(tx.amount), desc: tx.description, category: tx.category, account: c.acct(tx.account || tx.toAccount || ''), date: tx.date })];
  return { title: c.tr('nova.titleDelete'), lines, risky: true, request: { method: 'DELETE', path: '/api/transactions', body: { id: tx.id } }, guard: tx };
}

function tabSpend(c: Ctx, i: Record<string, unknown>): Draft {
  const f = tabOf(c, i.tab);
  const amount = amountOf(i.amount);
  const real = isRealPool(f);
  const account = i.account == null || i.account === ''
    ? (real && f.poolAccountId ? c.env.data.accounts.find((a) => a.id === f.poolAccountId) : undefined)
    : accountOf(c, i.account);
  if (!account) throw new PlanError('which account or card was it paid with?', c.env.data.accounts.filter((a) => a.type !== 'pool').map((a) => a.name));
  const mine = i.my_share != null ? roundCents(Number(i.my_share)) : f.autoSplit ? defaultMyShare(f, amount) : 0;
  if (!Number.isFinite(mine) || mine < 0 || mine > amount) throw new PlanError('my_share must be between 0 and the amount');
  const date = dateOf(i.date, c.env);
  const description = str(i.description, 100) || c.tr('funding.spendDefault', { desc: f.description });
  const category = categoryOf(c.env, 'expense', i.category);
  const txs = buildSpendTxs(account.id, amount, mine, description, date, category);
  let funding: Funding = { ...f, spent: roundCents(f.spent + amount), spendTxIds: [...f.spendTxIds, ...txs.map((x) => x.id)] };
  const lines = [c.tr('nova.lineSpend', { amount: c.money(amount), desc: description, account: account.name, date, mine: c.money(mine) })];
  if (f.autoSplit) {
    funding = shiftAutoSplit(funding, amount - mine, mine);
    const others = f.participants.filter((p) => !p.isMe).length;
    if (others > 0) lines.push(c.tr('nova.lineSpendEach', { n: others, each: c.money(splitCents(amount - mine, others)[0] ?? 0) }));
  }
  return { title: c.tr('nova.titleTabSpend', { tab: f.description }), lines, risky: true, request: { method: 'POST', path: '/api/funding', body: { funding, addTxs: txs, removeTxIds: [] } } };
}

function tabPayback(c: Ctx, i: Record<string, unknown>): Draft {
  const f = tabOf(c, i.tab);
  if (isRealPool(f)) throw new PlanError('a Group Vault has no paybacks — people put money in up front');
  const p = personIn(c, f, i.person);
  const amount = amountOf(i.amount);
  const account = accountOf(c, i.account);
  const date = dateOf(i.date, c.env);
  const owed = participantOwed(p, f.repayments);
  const { tx, repayment } = buildRepayTx(account.id, amount, p.name, c.tr('funding.paymentDesc', { name: p.name, desc: f.description }), date);
  const funding: Funding = { ...f, repayments: [...f.repayments, { ...repayment, participantId: p.id }] };
  const left = roundCents(owed - amount);
  const lines = [c.tr('nova.linePayback', { name: p.name, amount: c.money(amount), account: account.name, date })];
  if (left > 0) lines.push(c.tr('nova.lineStillOwes', { name: p.name, amount: c.money(left) }));
  else if (left < 0) lines.push(c.tr('nova.lineOverpay', { name: p.name, amount: c.money(-left) }));
  else lines.push(c.tr('nova.lineSettled', { name: p.name }));
  return { title: c.tr('nova.titleTabPayback', { tab: f.description }), lines, risky: left < 0, request: { method: 'POST', path: '/api/funding', body: { funding, addTxs: [tx], removeTxIds: [] } } };
}

function tabRefund(c: Ctx, i: Record<string, unknown>): Draft {
  const f = tabOf(c, i.tab);
  if (isRealPool(f)) throw new PlanError('refunds are only for group tabs with paybacks');
  const p = personIn(c, f, i.person);
  const over = participantOverpaid(p, f.repayments);
  if (!(over > 0)) throw new PlanError(`${p.name} has nothing to refund (they haven't paid more than their share)`);
  const amount = i.amount == null ? over : amountOf(i.amount);
  if (amount > over + 0.005) throw new PlanError(`only ${formatCurrency(over)} is owed back to ${p.name}`);
  const account = accountOf(c, i.account);
  const date = dateOf(i.date, c.env);
  const { tx, repayment } = buildRefundTx(account.id, amount, p.name, c.tr('nova.refundDesc', { name: p.name, desc: f.description }), date);
  const funding: Funding = { ...f, repayments: [...f.repayments, { ...repayment, participantId: p.id }] };
  const lines = [c.tr('nova.lineRefund', { amount: c.money(amount), name: p.name, account: account.name, date })];
  if (amount < over) lines.push(c.tr('nova.lineRefundLeft', { amount: c.money(roundCents(over - amount)) }));
  return { title: c.tr('nova.titleTabRefund', { tab: f.description }), lines, risky: true, request: { method: 'POST', path: '/api/funding', body: { funding, addTxs: [tx], removeTxIds: [] } } };
}

function tabPeople(c: Ctx, i: Record<string, unknown>): Draft {
  const f = tabOf(c, i.tab);
  if (isRealPool(f)) throw new PlanError('a Group Vault\'s people come from who put money in — add a contribution in the Funding page instead');
  const mode = i.split === 'equal' || i.split === 'custom' || i.split === 'keep' ? i.split : null;
  if (!mode) throw new PlanError('split must be equal, custom or keep');

  const removeNames = (Array.isArray(i.remove) ? i.remove : []).map((x) => str(x, 60)).filter(Boolean);
  const removed = removeNames.map((n) => personIn(c, f, n));
  // Someone who already paid back can't just vanish (that would reverse real cash): they stay
  // listed with a $0 share, so what they paid shows as "to refund" until the user refunds them.
  // (Paybacks already refunded into/out of the same account cancel out, so those people can go.)
  const movesCash = (p: FundingParticipant) => {
    const net = new Map<string, number>();
    for (const r of f.repayments) if (repaymentBelongsTo(r, p)) net.set(r.account, roundCents((net.get(r.account) ?? 0) + r.amount));
    return [...net.values()].some((v) => v !== 0);
  };
  const parked = new Set(removed.filter(movesCash));
  const removedSet = new Set(removed.filter((p) => !parked.has(p)));
  const kept = f.participants.filter((p) => !removedSet.has(p));
  const addNames = [...new Set((Array.isArray(i.add) ? i.add : []).map((x) => str(x, 60)).filter(Boolean))];
  for (const n of addNames) {
    if (isMeWord(n)) throw new PlanError('the user is added with the "me" row, not by name');
    if (kept.some((p) => fold(p.name) === fold(n))) throw new PlanError(`${n} is already in this tab`);
  }
  const added: FundingParticipant[] = addNames.map((name) => ({ id: generateId(), name, contributed: 0, isMe: false }));
  const roster = [...kept, ...added];
  const active = roster.filter((p) => !parked.has(p)); // the people the bill is split over
  if (!active.some((p) => !p.isMe)) throw new PlanError('a tab needs at least one other person');
  if (!removed.length && !added.length && mode === 'keep') throw new PlanError('nothing to change');

  // The amount being split: everything spent so far (open tab) or the pool size (fixed pledges).
  const spends = f.autoSplit ? groupFundingSpends(f.spendTxIds, c.env.data.transactions) : [];
  const total = f.autoSplit ? roundCents(spends.reduce((s, x) => s + x.amount, 0)) : roundCents(f.totalContributed);
  let shares: number[];
  if (mode === 'keep') {
    shares = roster.map((p) => (parked.has(p) ? 0 : p.contributed || 0));
    if (f.autoSplit && removed.some((p) => (p.contributed || 0) > 0)) throw new PlanError('removing someone who has a share needs split "equal" or "custom" so their part is re-assigned');
  } else if (mode === 'equal') {
    const equal = splitCents(total, active.length);
    shares = roster.map((p) => (parked.has(p) ? 0 : equal[active.indexOf(p)]));
  } else {
    const amounts = Array.isArray(i.amounts) ? i.amounts : [];
    if (!amounts.length) throw new PlanError('custom split needs amounts');
    const fixed = new Map<FundingParticipant, number>();
    for (const a of amounts as Record<string, unknown>[]) {
      const name = str(a?.name, 60);
      const value = roundCents(Number(a?.amount));
      if (!Number.isFinite(value) || value < 0) throw new PlanError(`invalid amount for ${name}`);
      const who = isMeWord(name)
        ? active.find((p) => p.isMe)
        : pickByName(active.filter((p) => !p.isMe), (p) => p.name, name, 'person in the new roster', c.flags);
      if (!who) throw new PlanError('the user is not part of this tab');
      fixed.set(who, value);
    }
    const fixedSum = roundCents([...fixed.values()].reduce((s, x) => s + x, 0));
    const rest = active.filter((p) => !fixed.has(p));
    if (fixedSum > total + 0.005) throw new PlanError(`the amounts add up to ${formatCurrency(fixedSum)}, more than the ${formatCurrency(total)} to split`);
    if (!rest.length && Math.abs(fixedSum - total) > 0.005) throw new PlanError(`the amounts add up to ${formatCurrency(fixedSum)} but ${formatCurrency(total)} has to be split`);
    const restShares = splitCents(roundCents(total - fixedSum), rest.length);
    shares = roster.map((p) => (parked.has(p) ? 0 : fixed.get(p) ?? restShares[rest.indexOf(p)] ?? 0));
  }

  // Roster with the new shares (removed people's paybacks reversed, a legacy
  // contribution row rebuilt), then — open tab, re-split — the spend rows to match.
  const keptRename = Object.fromEntries(kept.map((p) => [p.name, p.name]));
  const pledged = roster.map((p, idx) => ({ ...p, contributed: shares[idx] }));
  const edit = planVirtualPoolEdit(f, pledged, f.description, c.env.data.transactions, keptRename);
  let funding = edit.funding;
  let addTxs = edit.addTxs;
  let removeTxIds = edit.removeTxIds;
  let rebuilt = 0;
  if (f.autoSplit && mode !== 'keep') {
    const r = resplitOpenTab(edit.funding, roster, shares, c.env.data.transactions);
    funding = r.funding;
    addTxs = [...addTxs, ...r.addTxs];
    removeTxIds = [...removeTxIds, ...r.removeTxIds];
    rebuilt = r.rebuiltSpends;
  }

  const lines: string[] = [];
  if (added.length) lines.push(c.tr('nova.lineAdded', { names: added.map((p) => p.name).join(', ') }));
  if (removedSet.size) lines.push(c.tr('nova.lineRemoved', { names: [...removedSet].map((p) => p.name).join(', ') }));
  for (const p of parked) lines.push(c.tr('nova.lineParked', { name: p.name }));
  lines.push(c.tr('nova.lineSplitTotal', { amount: c.money(total), n: active.length }));
  const before = new Map(f.participants.map((p) => [p, p.contributed || 0]));
  funding.participants.forEach((p, idx) => {
    const name = p.isMe ? c.tr('funding.me') : p.name;
    const old = before.get(roster[idx]);
    const over = participantOverpaid(p, funding.repayments);
    if (over > 0) {
      lines.push(c.tr('nova.lineToRefund', { name, paid: c.money(participantRepaid(funding.repayments, p)), share: c.money(p.contributed), amount: c.money(over) }));
    } else if (old === undefined) {
      lines.push(c.tr('nova.lineShareNew', { name, to: c.money(p.contributed) }));
    } else if (roundCents(old) !== roundCents(p.contributed)) {
      lines.push(c.tr('nova.lineShare', { name, from: c.money(old), to: c.money(p.contributed) }));
    }
  });
  if (rebuilt > 0) lines.push(c.tr('nova.lineRowsRebuilt', { n: rebuilt }));
  if (!f.autoSplit && mode !== 'keep') lines.push(c.tr('nova.linePledgesOnly'));
  if (f.closed && funding.participants.some((p) => participantOwed(p, funding.repayments) > 0)) {
    funding = { ...funding, closed: false };
    lines.push(c.tr('nova.lineReopen'));
  }
  return { title: c.tr('nova.titleTabPeople', { tab: f.description }), lines, risky: true, request: { method: 'POST', path: '/api/funding', body: { funding, addTxs, removeTxIds } } };
}

function tabArchive(c: Ctx, i: Record<string, unknown>): Draft {
  const f = tabOf(c, i.tab);
  const closed = i.archived !== false;
  if (f.closed === closed) throw new PlanError(closed ? 'that tab is already archived' : 'that tab is already open');
  return {
    title: c.tr(closed ? 'nova.titleTabArchive' : 'nova.titleTabReopen', { tab: f.description }),
    lines: [c.tr('nova.lineNoMoney')],
    risky: false,
    request: { method: 'POST', path: '/api/funding', body: { funding: { ...f, closed }, addTxs: [], removeTxIds: [] } },
  };
}

type OpenItem = { kind: 'loan'; loan: Loan; left: number } | { kind: 'split'; split: Split; left: number };

function recordPayback(c: Ctx, i: Record<string, unknown>): Draft {
  if (c.env.unavailable?.some((u) => u === 'loans' || u === 'splits' || u === 'contacts')) throw new PlanError('loans/splits could not be read right now; try again');
  const query = str(i.person, 60);
  const contactName = new Map(c.env.contacts.map((x) => [x.id, x.name]));
  const who = (stored: string, id: string) => contactName.get(id) || stored;
  const matches = (stored: string, id: string) => nameMatches(who(stored, id), query) || nameMatches(stored, query);
  const items: OpenItem[] = [
    ...c.env.loans.filter((l) => !l.settled && matches(l.contactName, l.contactId))
      .map((loan) => ({ kind: 'loan' as const, loan, left: roundCents(loan.principal - (loan.repaidAmount || 0)) })),
    ...c.env.splits.filter((s) => splitRemaining(s) > 0 && matches(s.contactName, s.contactId))
      .map((split) => ({ kind: 'split' as const, split, left: splitRemaining(split) })),
  ].filter((x) => x.left > 0);
  const label = (x: OpenItem) => x.kind === 'loan'
    ? `${x.loan.id}: loan ${x.loan.direction === 'lent' ? 'to' : 'from'} ${who(x.loan.contactName, x.loan.contactId)} (${x.loan.note || 'loan'}), ${formatCurrency(x.left)} left`
    : `${x.split.id}: ${who(x.split.contactName, x.split.contactId)} — ${x.split.billName}, ${formatCurrency(x.left)} left`;
  const id = str(i.item_id, 60);
  const picked = id ? items.find((x) => (x.kind === 'loan' ? x.loan.id : x.split.id) === id) : items.length === 1 ? items[0] : undefined;
  if (!picked) throw new PlanError(items.length ? 'which item? pass item_id' : `no open loan or split for "${query}" (group tabs use group_tab_payback)`, items.map(label));
  const requested = amountOf(i.amount);
  const amount = Math.min(requested, picked.left);
  const [storedName, contactId] = picked.kind === 'loan' ? [picked.loan.contactName, picked.loan.contactId] : [picked.split.contactName, picked.split.contactId];
  if (fold(who(storedName, contactId)) !== fold(query) && fold(storedName) !== fold(query)) c.flags.loose = true;
  const capped = requested > amount; // what gets saved differs from what the user said → wait for OK
  const date = ymd(c.env.now);
  const lines: string[] = [];
  if (picked.kind === 'loan') {
    const l = picked.loan;
    const name = who(l.contactName, l.contactId);
    const account = str(i.account) ? accountOf(c, i.account) : c.env.data.accounts.find((a) => a.id === l.account);
    const desc = l.direction === 'lent' ? t('loans.txRepaidToYou', c.env.lang, { name }) : t('loans.txYouRepaid', c.env.lang, { name });
    const tx = account ? buildLoanTx(l.direction, 'payback', amount, account.id, desc, date) : null;
    const repaid = roundCents((l.repaidAmount || 0) + amount);
    const settled = repaid >= roundCents(l.principal) - 0.005;
    const loan: Loan = { ...l, repaidAmount: repaid, settled, settledDate: settled ? date : '', repaymentTxIds: tx ? [...l.repaymentTxIds, tx.id] : l.repaymentTxIds };
    lines.push(c.tr(l.direction === 'lent' ? 'nova.linePayback' : 'nova.lineYouRepay', { name, amount: c.money(amount), account: account?.name ?? c.tr('nova.noAccount'), date }));
    if (capped) lines.push(c.tr('nova.lineCapped', { amount: c.money(amount) }));
    lines.push(settled ? c.tr('nova.lineSettled', { name }) : c.tr('nova.lineLeft', { amount: c.money(roundCents(l.principal - repaid)) }));
    return { title: c.tr('nova.titlePayback', { name }), lines, risky: capped, request: { method: 'POST', path: '/api/loans', body: tx ? { loan, tx } : { loan } } };
  }
  const s = picked.split;
  const name = who(s.contactName, s.contactId);
  const account = str(i.account) ? accountOf(c, i.account) : c.env.data.accounts.find((a) => a.id === s.account);
  const tx = account ? buildSplitTx('cashIn', amount, account.id, t('bills.txSettled', c.env.lang, { name, bill: s.billName }), date) : null;
  const repaid = roundCents((s.repaidAmount || 0) + amount);
  const settled = repaid >= roundCents(s.amount) - 0.005;
  const split: Split = { ...s, repaidAmount: repaid, settled, settledDate: settled ? date : '', repaymentTxIds: tx ? [...s.repaymentTxIds, tx.id] : s.repaymentTxIds };
  lines.push(c.tr('nova.linePayback', { name, amount: c.money(amount), account: account?.name ?? c.tr('nova.noAccount'), date }));
  if (capped) lines.push(c.tr('nova.lineCapped', { amount: c.money(amount) }));
  lines.push(settled ? c.tr('nova.lineSettled', { name }) : c.tr('nova.lineLeft', { amount: c.money(roundCents(s.amount - repaid)) }));
  return { title: c.tr('nova.titlePayback', { name }), lines, risky: capped, request: { method: 'POST', path: '/api/splits', body: tx ? { split, tx } : split } };
}

const PLANNERS: Record<string, (c: Ctx, i: Record<string, unknown>) => Draft> = {
  add_transaction: addTransaction,
  transfer_money: transferMoney,
  edit_transaction: editTransaction,
  delete_transaction: deleteTransaction,
  group_tab_spend: tabSpend,
  group_tab_payback: tabPayback,
  group_tab_refund: tabRefund,
  group_tab_people: tabPeople,
  group_tab_archive: tabArchive,
  record_payback: recordPayback,
};

/** Validate an action against the user's data and build its preview + write request. Never throws. */
export function planAction(tool: string, input: unknown, env: ActionEnv): PlanResult {
  const planner = PLANNERS[tool];
  if (!planner) return { ok: false, error: 'unknown action' };
  const args = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const accountName = new Map(env.data.accounts.map((a) => [a.id, a.name]));
  const ctx: Ctx = {
    env,
    flags: { loose: false },
    tr: (k, p) => t(k, env.lang, p),
    money: (n) => formatCurrency(n),
    acct: (id) => accountName.get(id) ?? (id ? id : '—'),
  };
  try {
    const { guard, ...d } = planner(ctx, args);
    // A name matched only by its start (not exactly) waits for the user's OK too.
    return { ok: true, plan: { ...d, risky: d.risky || ctx.flags.loose, tool, fp: fingerprint(tool, d.request, knownStrings(env), guard) } };
  } catch (e) {
    if (e instanceof PlanError) return { ok: false, error: e.message, ...(e.options?.length ? { options: e.options } : {}) };
    console.error('[nova action]', tool, e);
    return { ok: false, error: 'could not plan this action' };
  }
}

/**
 * Action fingerprints the user was asked to OK in Nova's previous reply. Only the
 * note lines the CLIENT appends count — each starts with NOTE_MARK, which the chat
 * route strips from everything the model writes, so Nova can't fake an approval.
 */
export function pendingFingerprints(previousAssistant: string | undefined): Set<string> {
  const re = new RegExp(`^${NOTE_MARK}\\[action ([0-9a-f]{12}) pending\\]`, 'gm');
  return new Set([...(previousAssistant ?? '').matchAll(re)].map((m) => m[1]));
}

/** The user's latest message reads as a yes (English / Vietnamese). Only then does a re-planned pending action skip the card. */
export function looksLikeApproval(text: string): boolean {
  const t = fold(text).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const words = t ? t.split(' ').length : 0;
  if (!words || words > 12) return false;
  if (/\b(yes|yeah|yep|confirm|confirmed|go ahead|do it|approve|approved|sounds good|dong y|xac nhan|lam di|chot)\b/.test(t)) return true;
  // Short replies only: "ok", "có", "ừ", "được", "đúng rồi".
  return words <= 4 && /^(ok|okay|sure|correct|co|u|uh|um|duoc|dung|dung roi|ok luon|oke|okie)( .*)?$/.test(t);
}
