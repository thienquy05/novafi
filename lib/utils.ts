import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number, showSign = false): string {
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(Math.abs(amount));
  if (showSign && amount < 0) return `-${formatted}`;
  if (showSign && amount > 0) return `+${formatted}`;
  return amount < 0 ? `-${formatted}` : formatted;
}

export function formatCompact(amount: number): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';
  // Collapse large values to K/M so they fit their container, keeping up to 2
  // decimals. Trailing zeros are trimmed ($1.20K → $1.2K, $5.00M → $5M) so the
  // label stays compact while preserving precision when it matters.
  const trim = (n: number) => parseFloat(n.toFixed(2)).toString();
  if (abs >= 1_000_000) return `${sign}$${trim(abs / 1_000_000)}M`;
  if (abs >= 1_000) return `${sign}$${trim(abs / 1_000)}K`;
  return formatCurrency(amount);
}

/**
 * Compact currency for chart axis ticks. Unlike formatCompact, it never shows
 * cents (axis labels must stay short) and scales to the actual magnitude so
 * small datasets render real values (e.g. "$250") instead of collapsing to
 * "$0k". Handles negatives for net-worth-style charts that cross zero.
 */
export function formatAxisCurrency(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${sign}$${Math.round(abs)}`;
}

export function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// ── Time zone ────────────────────────────────────────────────────────────────
// The app's "today" and "now" must agree everywhere — but the dashboard runs on
// the server (usually UTC) while every other page runs in the browser's local
// zone. Left unfixed, the dashboard's month/day math drifts a few hours off from
// the rest of the app. To keep them in lockstep we anchor all date math to a
// single user-chosen IANA time zone, resolved the same way on both sides.
//
// Default: America/New_York (Eastern — Toledo, OH and most of the US east).
export const DEFAULT_TIME_ZONE = 'America/New_York';

// Written by the settings page (mirrored from the persisted TaxSettings.timeZone)
// so server components can read the user's zone synchronously from the request,
// exactly like the nf_lang cookie.
export const TZ_COOKIE = 'nf_tz';

/**
 * Resolve the effective time zone on the *client*. Prefers the nf_tz cookie
 * (the user's saved choice), then the browser's own zone, then the default.
 * Server code should pass an explicit `timeZone` instead of relying on this.
 */
export function getTimeZone(): string {
  if (typeof document !== 'undefined') {
    const m = document.cookie.match(/(?:^|;\s*)nf_tz=([^;]+)/);
    if (m) {
      try { return decodeURIComponent(m[1]); } catch { /* fall through */ }
    }
  }
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIME_ZONE;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

/**
 * A Date whose *local* getters (getFullYear/getMonth/getDate/getHours…) reflect
 * the wall-clock time in `timeZone`. This lets existing code that reads
 * now.getMonth()/getDate() stay unchanged while becoming zone-correct.
 */
export function zonedNow(timeZone?: string): Date {
  const tz = timeZone || getTimeZone();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric',
    hour12: false,
  }).formatToParts(new Date());
  const p: Record<string, number> = {};
  for (const { type, value } of parts) if (type !== 'literal') p[type] = Number(value);
  // Some engines emit hour '24' at midnight; normalize to 0.
  const hour = p.hour === 24 ? 0 : p.hour;
  return new Date(p.year, p.month - 1, p.day, hour, p.minute, p.second);
}

/** Current date as YYYY-MM-DD in the given (or resolved) time zone. */
export function today(timeZone?: string): string {
  const tz = timeZone || getTimeZone();
  // en-CA renders as YYYY-MM-DD, which is exactly the storage format we use.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

/** Current wall-clock time (e.g. "3:45 PM") in the given (or resolved) zone. */
export function formatClock(timeZone?: string, withSeconds = false): string {
  const tz = timeZone || getTimeZone();
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric', minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' } : {}),
    hour12: true,
  }).format(new Date());
}

/** Short zone abbreviation (e.g. "EDT") for the given (or resolved) zone. */
export function timeZoneAbbrev(timeZone?: string): string {
  const tz = timeZone || getTimeZone();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: 'numeric', timeZoneName: 'short',
  }).formatToParts(new Date());
  return parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
}

export function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export const DEFAULT_TAX_SETTINGS = {
  displayName: '',
  filingStatus: 'single' as const,
  payPeriodsPerYear: 26,
  k401Pct: 5,
  hsaAnnual: 1600,
  iraAnnual: 0,
  federalRate: 22,
  stateRate: 3.125,
  cityRate: 1.5,
  ficaSsRate: 6.2,
  ficaSsWageBase: 176100,
  ficaMedicareRate: 1.45,
  useFederalBrackets: false,
  excludeLoansFromNetWorth: false,
  budgetRollover: false,
  customExpenseCategories: [] as string[],
  customIncomeCategories: [] as string[],
  hiddenExpenseCategories: [] as string[],
  hiddenIncomeCategories: [] as string[],
  language: 'en' as const,
  timeZone: DEFAULT_TIME_ZONE,
};
