import { NextResponse } from 'next/server';
import { getSettings, saveSettings } from '@/lib/sheets';
import { invalidateMany, CACHE_TTL } from '@/lib/cache';
import { cachedGet, withSession } from '@/lib/apiRoute';
import type { TaxSettings, SettingsListKey } from '@/types';

export const GET = cachedGet({
  resource: 'settings',
  ttl: CACHE_TTL.LONG,
  fetch: ({ accessToken, spreadsheetId }) => getSettings(accessToken, spreadsheetId),
});

export const PUT = withSession(async ({ accessToken, spreadsheetId, req }) => {
  const body: TaxSettings = await req.json();
  await saveSettings(accessToken, spreadsheetId, body);
  // Settings carry dashboard-affecting toggles (liquid net worth, budget rollover,
  // display name, language) and the custom/hidden category lists — so a save must
  // freshen the settings, categories, and dashboard caches. 'badges' too: the
  // rollover toggle changes the over-budget badge/notification math.
  invalidateMany(spreadsheetId, ['settings', 'categories', 'dashboard', 'badges']);
  return NextResponse.json({ ok: true });
});

const LIST_KEYS: readonly SettingsListKey[] = ['dismissedSubscriptions', 'dismissedCancelReminders'];
const MAX_LIST = 500;

// PATCH { list, add?: string[], remove?: string[] } — add/remove entries in one of
// the app-managed lists (e.g. "Not a subscription" dismissals) against the STORED
// settings, so a dismissal from the Subscriptions page can never overwrite other
// settings with a stale copy, and two quick dismissals can't drop each other.
export const PATCH = withSession(async ({ accessToken, spreadsheetId, req }) => {
  const body = (await req.json()) as { list?: string; add?: unknown; remove?: unknown };
  const list = LIST_KEYS.find((k) => k === body.list);
  if (!list) return NextResponse.json({ error: 'Unknown list' }, { status: 400 });
  // '|' is the storage separator, so it can't appear inside an entry.
  const clean = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((x) => x.replace(/\|/g, '').trim()).filter(Boolean) : [];

  const current = await getSettings(accessToken, spreadsheetId);
  const remove = new Set(clean(body.remove));
  const next = [...new Set([...(current[list] ?? []), ...clean(body.add)])].filter((x) => !remove.has(x)).slice(-MAX_LIST);
  await saveSettings(accessToken, spreadsheetId, { ...current, [list]: next });
  invalidateMany(spreadsheetId, ['settings']);
  return NextResponse.json({ [list]: next });
});
