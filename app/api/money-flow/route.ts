import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { auth } from '@/lib/auth';
import { getDashboardData, parseWriteVersion, WRITE_VERSION_COOKIE } from '@/lib/apiRoute';
import { buildMoneyFlowSummary, insightContextFor, topInsights, type Insight, type MoneyFlowSummary } from '@/lib/insights';
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
    // Same cached payload as the dashboard (was a separate `moneyflow:` key that
    // no write invalidated, so the modal could lag a write by up to 60s).
    const data = await getDashboardData(
      session.accessToken,
      session.spreadsheetId,
      parseWriteVersion(jar.get(WRITE_VERSION_COOKIE)?.value),
    );
    const { accounts, transactions, bills, goals, settings, paychecks } = data;

    // Anchor "now" to the user's chosen time zone (same as the dashboard) so the
    // month/day math lines up with the rest of the app.
    const now = zonedNow(settings.timeZone || jar.get('nf_tz')?.value || DEFAULT_TIME_ZONE);
    const ctx = insightContextFor(now, (k, p) => t(k, lang, p), formatCurrency);

    const flow = buildMoneyFlowSummary(transactions, ctx.monthKey);
    const insights = topInsights({ accounts, transactions, bills, goals, paychecks, settings }, ctx);

    return NextResponse.json({ flow, insights } satisfies MoneyFlowPayload);
  } catch {
    return NextResponse.json({ flow: null, insights: [] } satisfies MoneyFlowPayload);
  }
}
