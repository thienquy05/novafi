import { NextResponse } from 'next/server';
import { getSettings, saveSettings } from '@/lib/sheets';
import { invalidateMany, CACHE_TTL } from '@/lib/cache';
import { cachedGet, withSession } from '@/lib/apiRoute';
import type { TaxSettings } from '@/types';

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
