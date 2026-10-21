import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { auth } from '@/lib/auth';
import { getDashboardData, parseWriteVersion, WRITE_VERSION_COOKIE } from '@/lib/apiRoute';
import { buildNotifications, type NotificationItem } from '@/lib/notifications';
import { t } from '@/lib/i18n';
import { formatCurrency, zonedNow, DEFAULT_TIME_ZONE } from '@/lib/utils';
import type { Account, Bill, Budget, Transaction, Language, TaxSettings } from '@/types';

type BadgesData = { bills: Bill[]; budgets: Budget[]; transactions: Transaction[]; accounts: Account[]; settings: TaxSettings };

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ notifications: [] as NotificationItem[] });

  const jar = await cookies();
  const lang: Language = jar.get('nf_lang')?.value === 'vi' ? 'vi' : 'en';
  const timeZone = jar.get('nf_tz')?.value || DEFAULT_TIME_ZONE;

  try {
    // Shares the dashboard payload (a superset of what the bell needs) so the
    // bell, badges, Money Flow and Home cost one Sheets read between them.
    const data: BadgesData = await getDashboardData(
      session.accessToken,
      session.spreadsheetId,
      parseWriteVersion(jar.get(WRITE_VERSION_COOKIE)?.value),
    );

    const now = zonedNow(timeZone);
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const notifications = buildNotifications(data, {
      now,
      monthKey,
      tr: (k, p) => t(k, lang, p),
      fmt: (n) => formatCurrency(n),
    }, data.settings);
    return NextResponse.json({ notifications });
  } catch {
    return NextResponse.json({ notifications: [] as NotificationItem[] });
  }
}
