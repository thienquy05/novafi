import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { auth } from '@/lib/auth';
import { cachedOrFetch } from '@/lib/cache';
import { batchGetDashboardData, type DashboardData } from '@/lib/sheets';

/**
 * Shared API-route helpers.
 *
 * Every route handler used to hand-write the same preamble:
 *   const session = await auth();
 *   if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
 * and every cached GET route additionally hand-wrote the get/fetch/set dance.
 * These helpers collapse both into a single composable call so the auth/cache
 * policy lives in one place.
 */

export type SessionCtx = {
  accessToken: string;
  spreadsheetId: string;
  req: NextRequest;
};

/**
 * Write-version cookie: the time of this browser's last successful write.
 * Every cached read passes it as `notBefore` (lib/cache.ts) so, on Vercel, an
 * instance that never saw the write's invalidateCache() still refetches instead
 * of serving a pre-write snapshot. Lifetime only needs to outlast the longest
 * server cache TTL.
 */
export const WRITE_VERSION_COOKIE = 'nf_wv';
const WRITE_VERSION_MAX_AGE_S = 120;

/** Parse the write-version cookie value (0 when absent/invalid). */
export function parseWriteVersion(value: string | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Wrap a route handler so it only runs with a valid session. The handler
 * receives the non-null accessToken/spreadsheetId (and the request), removing
 * the repeated auth + 401 guard from every handler. Successful writes stamp the
 * write-version cookie.
 */
export function withSession(
  handler: (ctx: SessionCtx) => Promise<NextResponse> | NextResponse,
): (req: NextRequest) => Promise<NextResponse> {
  return async (req: NextRequest) => {
    const session = await auth();
    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const res = await handler({ accessToken: session.accessToken, spreadsheetId: session.spreadsheetId, req });
    if (req.method !== 'GET' && req.method !== 'HEAD' && res.ok) {
      res.cookies.set(WRITE_VERSION_COOKIE, String(Date.now()), {
        path: '/',
        sameSite: 'lax',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: WRITE_VERSION_MAX_AGE_S,
      });
    }
    return res;
  };
}

/** The caller's last-write time, for use as a cache `notBefore`. */
export function writeVersionOf(req: NextRequest): number {
  // `cookies` is NextRequest-only; plain Requests (route tests) have none.
  return parseWriteVersion(req.cookies?.get(WRITE_VERSION_COOKIE)?.value);
}

/** Same, for server components / handlers without a request object. */
export async function currentWriteVersion(): Promise<number> {
  const jar = await cookies();
  return parseWriteVersion(jar.get(WRITE_VERSION_COOKIE)?.value);
}

/**
 * Build a cached GET route in one line. Composes withSession + cachedOrFetch
 * with the per-user cache key `${resource}:${spreadsheetId}` — the exact key the
 * mutating routes (and /api/batch) already invalidate, so freshness wiring is
 * unchanged. Use for the read-only resource routes; routes with bespoke 401
 * bodies (e.g. badges) or extra logic stay hand-written.
 */
export function cachedGet<T>(opts: {
  resource: string;
  ttl: number;
  fetch: (ctx: SessionCtx) => Promise<T>;
}): (req: NextRequest) => Promise<NextResponse> {
  return withSession(async (ctx) => {
    const data = await cachedOrFetch(
      `${opts.resource}:${ctx.spreadsheetId}`,
      opts.ttl,
      () => opts.fetch(ctx),
      writeVersionOf(ctx.req),
    );
    return NextResponse.json(data);
  });
}

/** Server TTL for the shared dashboard payload. */
export const DASHBOARD_TTL = 45_000;

/**
 * The one broad Sheets read (accounts, transactions, bills, budgets, goals,
 * paychecks, settings, net-worth history) behind the dashboard, the Money Flow
 * modal, the sidebar badges and the notification bell. All four share this key,
 * so a cold page load costs ONE Sheets round trip instead of four, concurrent
 * callers join the same in-flight read, and every write (which always stales
 * 'dashboard', see DERIVED_CACHES) refreshes all four together.
 */
export function getDashboardData(
  accessToken: string,
  spreadsheetId: string,
  notBefore: number,
): Promise<DashboardData> {
  return cachedOrFetch(
    `dashboard:${spreadsheetId}`,
    DASHBOARD_TTL,
    () => batchGetDashboardData(accessToken, spreadsheetId),
    notBefore,
  );
}
