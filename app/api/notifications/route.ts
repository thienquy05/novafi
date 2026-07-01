import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { auth } from '@/lib/auth';
import { batchGetBadgesData } from '@/lib/sheets';
import { getCache, setCache } from '@/lib/cache';
import { buildNotifications, type NotificationItem } from '@/lib/notifications';
import { t } from '@/lib/i18n';
import { formatCurrency, zonedNow, DEFAULT_TIME_ZONE } from '@/lib/utils';
import type { Account, Bill, Budget, Transaction, Language } from '@/types';

type BadgesData = { bills: Bill[]; budgets: Budget[]; transactions: Transaction[]; accounts: Account[] };

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ notifications: [] as NotificationItem[] });

  const jar = await cookies();
  const lang: Language = jar.get('nf_lang')?.value === 'vi' ? 'vi' : 'en';
  const timeZone = jar.get('nf_tz')?.value || DEFAULT_TIME_ZONE;

  try {
    // The bell reads the same four sheets the sidebar badges do — cache the raw
    // payload so the two requests share one Sheets round trip within the TTL.
    const dataKey = `badgesData:${session.spreadsheetId}`;
    let data = getCache<BadgesData>(dataKey);
    if (!data) {
      data = await batchGetBadgesData(session.accessToken, session.spreadsheetId);
      setCache(dataKey, data, 60_000);
    }

    const now = zonedNow(timeZone);
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const notifications = buildNotifications(data, {
      now,
      monthKey,
      tr: (k, p) => t(k, lang, p),
      fmt: (n) => formatCurrency(n),
    });
    return NextResponse.json({ notifications });
  } catch {
    return NextResponse.json({ notifications: [] as NotificationItem[] });
  }
}
