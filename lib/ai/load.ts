import { getDashboardData, writeVersionOf, type SessionCtx } from '@/lib/apiRoute';
import { cachedOrFetch, CACHE_TTL } from '@/lib/cache';
import { getContacts, getFundings, getLoans, getSplits } from '@/lib/sheets';
import { insightContextFor, topInsights } from '@/lib/insights';
import { buildAdvisorContext } from '@/lib/ai/context';
import { t } from '@/lib/i18n';
import { formatCurrency, zonedNow, DEFAULT_TIME_ZONE } from '@/lib/utils';
import type { Language } from '@/types';

/** Shared by the AI routes: language, the template insights (same ids as /api/money-flow) and the aggregate snapshot. */
export async function loadAdvisorInputs({ accessToken, spreadsheetId, req }: SessionCtx) {
  const lang: Language = req.cookies.get('nf_lang')?.value === 'vi' ? 'vi' : 'en';
  const notBefore = writeVersionOf(req);
  // Same reads (and cache keys) as the dashboard; a failed side read must not break the advisor,
  // but the people_owed tool is told so it never reports a missing debt as $0.
  const unavailable: string[] = [];
  const soft = <T,>(name: string, p: Promise<T[]>) => p.catch(() => { unavailable.push(name); return [] as T[]; });
  const [data, fundings, splits, loans, contacts] = await Promise.all([
    getDashboardData(accessToken, spreadsheetId, notBefore),
    soft('group tabs', cachedOrFetch(`funding:${spreadsheetId}`, CACHE_TTL.SHORT, () => getFundings(accessToken, spreadsheetId), notBefore)),
    soft('splits', cachedOrFetch(`splits:${spreadsheetId}`, CACHE_TTL.SHORT, () => getSplits(accessToken, spreadsheetId), notBefore)),
    soft('loans', cachedOrFetch(`loans:${spreadsheetId}`, CACHE_TTL.SHORT, () => getLoans(accessToken, spreadsheetId), notBefore)),
    soft('contacts', cachedOrFetch(`contacts:${spreadsheetId}`, CACHE_TTL.LONG, () => getContacts(accessToken, spreadsheetId), notBefore)),
  ]);
  const now = zonedNow(data.settings.timeZone || req.cookies.get('nf_tz')?.value || DEFAULT_TIME_ZONE);
  const insights = topInsights(data, insightContextFor(now, (k, p) => t(k, lang, p), formatCurrency));
  return { lang, insights, context: buildAdvisorContext(data, now, insights, { fundings, splits }), toolEnv: { data, fundings, loans, splits, contacts, now, unavailable } };
}
