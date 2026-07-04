import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { auth } from '@/lib/auth';
import { batchGetDashboardData, type DashboardData } from '@/lib/sheets';
import { getCache, setCache } from '@/lib/cache';
import { buildMoneyFlowSummary, topInsights, type Insight, type MoneyFlowSummary } from '@/lib/insights';
import { t } from '@/lib/i18n';
import { formatCurrency, zonedNow, DEFAULT_TIME_ZONE } from '@/lib/utils';
import type { Language } from '@/types';

type MoneyFlowPayload = { flow: MoneyFlowSummary | null; insights: Insight[] };

// Feeds the header Money Flow modal — the same In/Out/Kept + insight guidance the
// dashboard used to render inline, now fetched on demand from any page. Reads the
// same sheets and runs the same calculators (lib/insights.ts) as the dashboard,
// so its numbers always match the dashboard KPIs.
export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ flow: null, insights: [] } satisfies MoneyFlowPayload);

  const jar = await cookies();
  const lang: Language = jar.get('nf_lang')?.value === 'vi' ? 'vi' : 'en';

  try {
    // Cache the raw dashboard payload for a short TTL so repeated modal opens (and
    // the 60s background refresh) share one Sheets round trip.
    const dataKey = `moneyflow:${session.spreadsheetId}:data`;
    let data = getCache<DashboardData>(dataKey);
    if (!data) {
      data = await batchGetDashboardData(session.accessToken, session.spreadsheetId);
      setCache(dataKey, data, 60_000);
    }
    const { accounts, transactions, bills, goals, settings } = data;

    // Anchor "now" to the user's chosen time zone (same as the dashboard) so the
    // month/day math lines up with the rest of the app.
    const now = zonedNow(settings.timeZone || jar.get('nf_tz')?.value || DEFAULT_TIME_ZONE);
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonthKey = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, '0')}`;
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const daysElapsed = now.getDate();

    const flow = buildMoneyFlowSummary(transactions, thisMonth);
    const insights = topInsights(
      { accounts, transactions, bills, goals },
      {
        now,
        monthKey: thisMonth,
        prevMonthKey,
        daysInMonth,
        daysElapsed,
        tr: (k, p) => t(k, lang, p),
        fmt: formatCurrency,
      },
    );

    return NextResponse.json({ flow, insights } satisfies MoneyFlowPayload);
  } catch {
    return NextResponse.json({ flow: null, insights: [] } satisfies MoneyFlowPayload);
  }
}
