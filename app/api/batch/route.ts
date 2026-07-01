import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { batchGetSheets, BATCH_KEYS, type BatchKey } from '@/lib/sheets';
import { getCache, setCache, CACHE_TTL } from '@/lib/cache';

/**
 * One-round-trip read for pages that need several resources at once (e.g. the
 * bills page wants bills+accounts+paychecks+transactions+contacts+splits).
 *
 * It reuses the SAME per-resource cache keys (`accounts:<id>`, `bills:<id>`, …)
 * the individual GET routes use, so the mutating routes' existing
 * invalidateCache() calls keep this endpoint fresh with zero extra wiring. Only
 * the keys that miss the cache are fetched, in a single Sheets batchGet.
 *
 * Usage: GET /api/batch?keys=bills,accounts,transactions
 */

// Mirror each resource's own-route TTL so cached values are interchangeable.
const TTL: Record<BatchKey, number> = {
  accounts: CACHE_TTL.SHORT,
  transactions: CACHE_TTL.SHORT,
  splits: CACHE_TTL.SHORT,
  loans: CACHE_TTL.SHORT,
  funding: CACHE_TTL.SHORT,
  bills: CACHE_TTL.LONG,
  paychecks: CACHE_TTL.LONG,
  budgets: CACHE_TTL.LONG,
  goals: CACHE_TTL.LONG,
  contacts: CACHE_TTL.LONG,
  settings: CACHE_TTL.LONG,
  subscriptions: CACHE_TTL.LONG,
};

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const requested = (req.nextUrl.searchParams.get('keys') ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter((k): k is BatchKey => (BATCH_KEYS as string[]).includes(k));

  if (requested.length === 0) {
    return NextResponse.json({ error: 'No valid keys requested' }, { status: 400 });
  }

  const result: Record<string, unknown> = {};
  const misses: BatchKey[] = [];

  for (const key of requested) {
    const cached = getCache(`${key}:${session.spreadsheetId}`);
    if (cached !== null) result[key] = cached;
    else misses.push(key);
  }

  if (misses.length > 0) {
    try {
      const fetched = await batchGetSheets(session.accessToken, session.spreadsheetId, misses);
      for (const key of misses) {
        const data = fetched[key] ?? [];
        setCache(`${key}:${session.spreadsheetId}`, data, TTL[key]);
        result[key] = data;
      }
    } catch {
      return NextResponse.json({ error: 'Failed to load data' }, { status: 500 });
    }
  }

  return NextResponse.json(result);
}
