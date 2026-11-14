import { describe, it, expect } from 'vitest';
import { planAction, pendingFingerprints, looksLikeApproval, type ActionEnv, type ActionPlan } from '../ai/actions';
import { NOTE_MARK, actionNote } from '../ai/shared';
import { allocateCents, participantOverpaid, participantOwed, groupFundingSpends } from '@/lib/funding';
import { DEFAULT_TAX_SETTINGS } from '@/lib/utils';
import type { Account, Funding, Loan, Split, Transaction } from '@/types';

const NOW = new Date(2026, 10, 14); // Nov 14, 2026
const acct = (id: string, name: string, type: Account['type'] = 'checking'): Account =>
  ({ id, name, type, institution: 'Bank', balance: 1000, last4: '1234', color: '#000', createdAt: '2026-01-01' });

// "New York trip": an open tab, me + 6 friends, two bills already split 7 ways.
const people = ['An', 'Bình', 'Chi', 'Dũng', 'Đạt', 'Hà'];
const spendRows: Transaction[] = [
  { id: 's1e', date: '2026-10-01', description: 'Hotel', amount: 60, type: 'expense', category: 'Travel', account: 'card', createdAt: '2026-10-01T10:00:00.000Z', tags: ['nyc'] },
  { id: 's1t', date: '2026-10-01', description: 'Hotel', amount: 360, type: 'transfer', category: 'Funding', account: 'card', toAccount: '', createdAt: '2026-10-01T10:00:00.000Z', tags: ['nyc'] },
  { id: 's2e', date: '2026-10-02', description: 'Dinner', amount: 40, type: 'expense', category: 'Food', account: 'card', createdAt: '2026-10-02T20:00:00.000Z' },
  { id: 's2t', date: '2026-10-02', description: 'Dinner', amount: 240, type: 'transfer', category: 'Funding', account: 'card', toAccount: '', createdAt: '2026-10-02T20:00:00.000Z' },
  { id: 'r1', date: '2026-10-05', description: 'payback', amount: 100, type: 'transfer', category: 'FundingRepay', account: '', toAccount: 'chk' },
  { id: 'lunch', date: '2026-11-10', description: 'Lunch', amount: 12, type: 'expense', category: 'Food', account: 'chk' },
];
const nyc: Funding = {
  id: 'f-nyc', description: 'New York trip', account: 'card', date: '2026-10-01', kind: 'virtual', autoSplit: true,
  participants: [{ id: 'me', name: '', contributed: 100, isMe: true }, ...people.map((name, i) => ({ id: `p${i}`, name, contributed: 100, isMe: false }))],
  totalContributed: 700, spent: 700, contributionTxId: '', spendTxIds: ['s1e', 's1t', 's2e', 's2t'],
  repayments: [{ id: 'r1', participant: 'An', participantId: 'p0', amount: 100, account: 'chk', date: '2026-10-05' }],
  closed: false,
};
const loan: Loan = { id: 'l1', direction: 'lent', contactId: 'c1', contactName: 'Quý', account: 'chk', category: '', principal: 200, repaidAmount: 50, date: '2026-09-01', note: 'rent', settled: false, settledDate: '', principalTxId: '', repaymentTxIds: [] };
const split: Split = { id: 'sp1', billId: 'oneoff:x', billName: 'Pizza', contactId: 'c2', contactName: 'Lan', amount: 20, category: 'Food', account: 'chk', date: '2026-11-01', settled: false, settledDate: '', repaidAmount: 0, repaymentTxIds: [] };

const makeEnv = (over: Partial<ActionEnv> = {}): ActionEnv => ({
  now: NOW,
  lang: 'en',
  fundings: [nyc],
  loans: [loan],
  splits: [split],
  contacts: [{ id: 'c1', name: 'Quý Phạm', createdAt: '2026-01-01' }, { id: 'c2', name: 'Lan', createdAt: '2026-01-01' }],
  data: {
    paychecks: [], bills: [], budgets: [], goals: [], netWorthHistory: [], settings: DEFAULT_TAX_SETTINGS,
    accounts: [acct('chk', 'Chase Checking'), acct('sav', 'Ally Savings', 'savings'), acct('card', 'Sapphire Card', 'credit')],
    transactions: spendRows,
  },
  ...over,
});
const plan = (tool: string, input: unknown, env = makeEnv()): ActionPlan => {
  const r = planAction(tool, input, env);
  if (!r.ok) throw new Error(`${r.error} ${JSON.stringify(r.options ?? [])}`);
  return r.plan;
};
type FundingBody = { funding: Funding; addTxs: Transaction[]; removeTxIds: string[] };

describe('Nova actions — group tab re-split (New York trip: 7 → 9 people)', () => {
  const p = plan('group_tab_people', { tab: 'new york', add: ['Khoa', 'Linh'], split: 'equal' });
  const body = p.request.body as FundingBody;
  const f = body.funding;

  it('is risky (waits for Confirm) and posts to the funding route', () => {
    expect(p.risky).toBe(true);
    expect(p.request).toMatchObject({ method: 'POST', path: '/api/funding' });
  });

  it('splits everything spent equally over 9 people, the user included, to the cent', () => {
    expect(f.participants).toHaveLength(9);
    expect(f.participants.map((x) => x.contributed)).toEqual([77.78, 77.78, 77.78, 77.78, 77.78, 77.78, 77.78, 77.77, 77.77]);
    expect(f.totalContributed).toBe(700);
    expect(f.spent).toBe(700);
    expect(f.participants.slice(-2).map((x) => x.name)).toEqual(['Khoa', 'Linh']);
  });

  it('marks someone who already paid more than the new share as "to refund" without moving money', () => {
    const an = f.participants.find((x) => x.name === 'An')!;
    expect(participantOwed(an, f.repayments)).toBe(0);
    expect(participantOverpaid(an, f.repayments)).toBe(22.22);
    expect(p.lines.some((l) => l.includes('An') && l.includes('to refund $22.22'))).toBe(true);
    expect(body.addTxs.every((t) => t.category !== 'FundingRepay')).toBe(true);
  });

  it('rebuilds the past spend rows to the new my-share, keeping each account\'s total unchanged', () => {
    const rebuilt = groupFundingSpends(f.spendTxIds, [...spendRows.filter((t) => !body.removeTxIds.includes(t.id)), ...body.addTxs]);
    expect(rebuilt.map((s) => [s.description, s.amount, s.myShare])).toEqual([['Dinner', 280, 31.11], ['Hotel', 420, 46.67]]);
    const sum = (rows: Transaction[]) => Math.round(rows.reduce((s, t) => s + t.amount, 0) * 100) / 100;
    expect(sum(body.addTxs)).toBe(sum(spendRows.filter((t) => body.removeTxIds.includes(t.id))));
    expect(body.addTxs.every((t) => t.account === 'card')).toBe(true);
    // Same createdAt + tags so a rebuilt spend still groups as one and keeps its labels.
    expect(body.addTxs.filter((t) => t.description === 'Hotel').every((t) => t.createdAt === '2026-10-01T10:00:00.000Z' && t.tags?.[0] === 'nyc')).toBe(true);
  });

  it('gives the same fingerprint for the same data and a different one once the data changes', () => {
    const again = plan('group_tab_people', { tab: 'new york', add: ['Khoa', 'Linh'], split: 'equal' });
    expect(again.fp).toBe(p.fp);
    const changed = makeEnv({ fundings: [{ ...nyc, repayments: [...nyc.repayments, { id: 'r2', participant: 'Bình', participantId: 'p1', amount: 10, account: 'chk', date: '2026-11-01' }] }] });
    expect(plan('group_tab_people', { tab: 'new york', add: ['Khoa', 'Linh'], split: 'equal' }, changed).fp).not.toBe(p.fp);
  });

  it('custom amounts: named people get theirs, the rest split what is left', () => {
    const c = plan('group_tab_people', { tab: 'New York', add: ['Khoa', 'Linh'], split: 'custom', amounts: [{ name: 'me', amount: 140 }, { name: 'khoa', amount: 0 }] });
    const parts = (c.request.body as FundingBody).funding.participants;
    expect(parts[0].contributed).toBe(140);
    expect(parts.find((x) => x.name === 'Khoa')!.contributed).toBe(0);
    expect(parts.filter((x) => !x.isMe && x.name !== 'Khoa').map((x) => x.contributed)).toEqual([80, 80, 80, 80, 80, 80, 80]);
  });

  it('rejects custom amounts that do not add up, and duplicate people', () => {
    const over = planAction('group_tab_people', { tab: 'new york', split: 'custom', amounts: [{ name: 'me', amount: 800 }] }, makeEnv());
    expect(over.ok).toBe(false);
    const dup = planAction('group_tab_people', { tab: 'new york', add: ['dat'], split: 'equal' }, makeEnv());
    expect(dup).toMatchObject({ ok: false }); // "dat" folds to "Đạt": refused so Nova asks instead of adding a look-alike
  });

  it('refund: records money out and clears the "to refund"', () => {
    const after = makeEnv({ fundings: [f] });
    const r = plan('group_tab_refund', { tab: 'new york', person: 'an', account: 'chase' }, after);
    expect(r.risky).toBe(true);
    const rb = r.request.body as FundingBody;
    expect(rb.addTxs[0]).toMatchObject({ type: 'transfer', category: 'FundingRepay', account: 'chk', toAccount: '', amount: 22.22 });
    const an = rb.funding.participants.find((x) => x.name === 'An')!;
    expect(participantOverpaid(an, rb.funding.repayments)).toBe(0);
    expect(planAction('group_tab_refund', { tab: 'new york', person: 'Bình', account: 'chase' }, after).ok).toBe(false);
  });

  it('keep: only adds people, spend rows untouched', () => {
    const k = plan('group_tab_people', { tab: 'new york', add: ['Khoa'], split: 'keep' });
    const kb = k.request.body as FundingBody;
    expect(kb.addTxs).toEqual([]);
    expect(kb.removeTxIds).toEqual([]);
    expect(kb.funding.participants.at(-1)).toMatchObject({ name: 'Khoa', contributed: 0 });
  });
});

describe('Nova actions — transactions and paybacks', () => {
  it('a clear expense runs straight away (not risky) on the matched account and category', () => {
    const p = plan('add_transaction', { type: 'expense', amount: 24.5, description: 'Lunch', category: 'food', account: 'chase' });
    expect(p.risky).toBe(false);
    expect(p.request).toMatchObject({ method: 'POST', path: '/api/transactions', body: { amount: 24.5, category: 'Food', account: 'chk', date: '2026-11-14', type: 'expense' } });
  });

  it('an unknown or ambiguous account comes back as options instead of a guess', () => {
    const r = planAction('add_transaction', { type: 'expense', amount: 5, description: 'x', account: 'citi' }, makeEnv());
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.options).toEqual(['Chase Checking', 'Ally Savings', 'Sapphire Card']);
  });

  it('transfers touch two accounts, so they wait for OK', () => {
    const p = plan('transfer_money', { from: 'chase', to: 'ally', amount: 500 });
    expect(p.risky).toBe(true);
    expect(p.request.body).toMatchObject({ type: 'transfer', category: 'Transfer', account: 'chk', toAccount: 'sav', amount: 500 });
  });

  it('edit and delete work by id; delete always waits for OK', () => {
    const e = plan('edit_transaction', { id: 'lunch', amount: 15 });
    expect(e.risky).toBe(false);
    expect(e.request).toMatchObject({ method: 'PUT', body: { original: { amount: 12 }, updated: { amount: 15 } } });
    expect(plan('delete_transaction', { id: 'lunch' })).toMatchObject({ risky: true, request: { method: 'DELETE', body: { id: 'lunch' } } });
    expect(planAction('delete_transaction', { id: 'nope' }, makeEnv()).ok).toBe(false);
  });

  it('record_payback finds the open loan by accent-free name and caps at what is left', () => {
    const p = plan('record_payback', { person: 'quy', amount: 500 });
    const body = p.request.body as { loan: Loan; tx: Transaction };
    expect(body.loan).toMatchObject({ repaidAmount: 200, settled: true });
    expect(body.tx).toMatchObject({ amount: 150, category: 'Loan', toAccount: 'chk' });
    expect(p.request.path).toBe('/api/loans');
  });

  it('record_payback on a split', () => {
    const p = plan('record_payback', { person: 'Lan', amount: 5 });
    expect(p.request).toMatchObject({ path: '/api/splits', body: { split: { repaidAmount: 5, settled: false }, tx: { amount: 5, category: 'Split' } } });
  });

  it('group tab spend on an open tab splits it across everyone', () => {
    const p = plan('group_tab_spend', { tab: 'new york', amount: 70, description: 'Taxi', account: 'sapphire' });
    const b = p.request.body as FundingBody;
    expect(b.addTxs.map((t) => [t.type, t.amount])).toEqual([['expense', 10], ['transfer', 60]]);
    expect(b.funding.participants.map((x) => x.contributed)).toEqual([110, 110, 110, 110, 110, 110, 110]);
  });

  it('reads back only the client-written notes of actions the user was asked to OK', () => {
    const reply = `Sure!\n\n${actionNote({ fp: 'abcdef012345', status: 'pending', title: 'Update group' })}\n${actionNote({ fp: '111111111111', status: 'done', title: 'Log' })}`;
    expect([...pendingFingerprints(reply)]).toEqual(['abcdef012345']);
    // Text the model wrote itself (no NOTE_MARK — the route strips it from model output) never counts.
    expect([...pendingFingerprints('[action abcdef012345 pending] Update group')]).toEqual([]);
    expect(NOTE_MARK).toBe('\u001d');
  });

  it('a spoken approval must read as a yes', () => {
    for (const yes of ['yes', 'OK', 'ok luôn', 'Đồng ý', 'ừ', 'được', 'go ahead please', 'xác nhận nhé']) expect(looksLikeApproval(yes)).toBe(true);
    for (const no of ['what is my food spend?', 'có thể cho tôi xem chi tiêu tháng này không', 'no', 'wait', '']) expect(looksLikeApproval(no)).toBe(false);
  });
});

describe('Nova actions — review fixes', () => {
  it('"Minh" / "Anh" are people, not the user; only "me" means the user', () => {
    const tab: Funding = { ...nyc, participants: [nyc.participants[0], { id: 'm', name: 'Minh', contributed: 100, isMe: false }, { id: 'h', name: 'Hà', contributed: 100, isMe: false }], spendTxIds: [], totalContributed: 300, spent: 300, autoSplit: false, repayments: [] };
    const p = plan('group_tab_people', { tab: 'new york', split: 'custom', amounts: [{ name: 'Minh', amount: 200 }, { name: 'me', amount: 50 }] }, makeEnv({ fundings: [tab] }));
    expect((p.request.body as FundingBody).funding.participants.map((x) => x.contributed)).toEqual([50, 200, 50]);
    expect(plan('group_tab_people', { tab: 'new york', add: ['Anh'], split: 'keep' }, makeEnv({ fundings: [tab] })).lines[0]).toContain('Anh');
  });

  it('never matches a person by substring ("An" ≠ "Lan"); a start-of-name match waits for OK', () => {
    const tab: Funding = { ...nyc, participants: [nyc.participants[0], { id: 'l', name: 'Lan', contributed: 50, isMe: false }, { id: 't', name: 'Anh Tuấn', contributed: 50, isMe: false }], repayments: [] };
    const env = makeEnv({ fundings: [tab] });
    const r = plan('group_tab_payback', { tab: 'new york', person: 'an', amount: 20, account: 'chase' }, env);
    expect(r.lines[0]).toContain('Anh Tuấn');
    expect(r.risky).toBe(true); // loose → card
    expect(plan('group_tab_payback', { tab: 'new york', person: 'Lan', amount: 20, account: 'chase' }, env).risky).toBe(false);
  });

  it('refuses to edit/delete rows owned by a group tab, loan or split', () => {
    for (const id of ['s1e', 's1t', 'r1']) {
      const r = planAction('delete_transaction', { id }, makeEnv());
      expect(r.ok).toBe(false);
      expect(!r.ok && r.error).toContain('New York trip');
    }
    expect(planAction('edit_transaction', { id: 's2e', amount: 1 }, makeEnv()).ok).toBe(false);
  });

  it('moving a row to another account waits for OK', () => {
    expect(plan('edit_transaction', { id: 'lunch', account: 'ally' }).risky).toBe(true);
  });

  it('a delete card goes stale when the row changes', () => {
    const a = plan('delete_transaction', { id: 'lunch' });
    const edited = makeEnv({ data: { ...makeEnv().data, transactions: spendRows.map((t) => (t.id === 'lunch' ? { ...t, amount: 120 } : t)) } });
    expect(plan('delete_transaction', { id: 'lunch' }, edited).fp).not.toBe(a.fp);
  });

  it('removing someone who paid back moves no money: they stay with a $0 share and show "to refund"', () => {
    const p = plan('group_tab_people', { tab: 'new york', remove: ['An'], split: 'equal' });
    const b = p.request.body as FundingBody;
    expect(b.removeTxIds).not.toContain('r1');
    expect(b.addTxs.every((t) => t.category !== 'FundingRepay')).toBe(true);
    const an = b.funding.participants.find((x) => x.name === 'An')!;
    expect(an.contributed).toBe(0);
    expect(participantOverpaid(an, b.funding.repayments)).toBe(100);
    expect(b.funding.participants.filter((x) => x.name !== 'An').map((x) => x.contributed)).toEqual([116.67, 116.67, 116.67, 116.67, 116.66, 116.66]);
    // Someone who never paid is simply removed.
    expect((plan('group_tab_people', { tab: 'new york', remove: ['Hà'], split: 'equal' }).request.body as FundingBody).funding.participants).toHaveLength(6);
  });

  it('a capped payback waits for OK', () => {
    expect(plan('record_payback', { person: 'Quý Phạm', amount: 500 }).risky).toBe(true);
    expect(plan('record_payback', { person: 'Quý Phạm', amount: 20 }).risky).toBe(false);
  });
});

describe('allocateCents', () => {
  it('is cent-exact and proportional', () => {
    expect(allocateCents(77.78, [420, 280])).toEqual([46.67, 31.11]);
    expect(allocateCents(0.01, [1, 1, 1])).toEqual([0.01, 0, 0]);
    expect(allocateCents(10, [0, 0])).toEqual([0, 0]);
  });
});
