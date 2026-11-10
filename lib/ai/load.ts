import { getDashboardData, writeVersionOf, type SessionCtx } from '@/lib/apiRoute';
import { cachedOrFetch, CACHE_TTL } from '@/lib/cache';
import { getFundings, getSplits } from '@/lib/sheets';
import { insightContextFor, topInsights } from '@/lib/insights';
import { buildAdvisorContext } from '@/lib/ai/context';
import { t } from '@/lib/i18n';
import { formatCurrency, zonedNow, DEFAULT_TIME_ZONE } from '@/lib/utils';
import type { Language } from '@/types';

/** Shared by the AI routes: language, the template insights (same ids as /api/money-flow) and the aggregate snapshot. */
export async function loadAdvisorInputs({ accessToken, spreadsheetId, req }: SessionCtx) {
  const lang: Language = req.cookies.get('nf_lang')?.value === 'vi' ? 'vi' : 'en';
  const notBefore = writeVersionOf(req);
  // Same reads (and cache keys) as the dashboard; a failed funding read must not break the advisor.
  const [data, fundings, splits] = await Promise.all([
    getDashboardData(accessToken, spreadsheetId, notBefore),
    cachedOrFetch(`funding:${spreadsheetId}`, CACHE_TTL.SHORT, () => getFundings(accessToken, spreadsheetId), notBefore).catch(() => []),
    cachedOrFetch(`splits:${spreadsheetId}`, CACHE_TTL.SHORT, () => getSplits(accessToken, spreadsheetId), notBefore).catch(() => []),
  ]);
  const now = zonedNow(data.settings.timeZone || req.cookies.get('nf_tz')?.value || DEFAULT_TIME_ZONE);
  const insights = topInsights(data, insightContextFor(now, (k, p) => t(k, lang, p), formatCurrency));
  return { lang, insights, context: buildAdvisorContext(data, now, insights, { fundings, splits }) };
}
