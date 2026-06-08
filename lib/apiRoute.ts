import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { cachedOrFetch } from '@/lib/cache';

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
 * Wrap a route handler so it only runs with a valid session. The handler
 * receives the non-null accessToken/spreadsheetId (and the request), removing
 * the repeated auth + 401 guard from every handler.
 */
export function withSession(
  handler: (ctx: SessionCtx) => Promise<NextResponse> | NextResponse,
): (req: NextRequest) => Promise<NextResponse> {
  return async (req: NextRequest) => {
    const session = await auth();
    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return handler({ accessToken: session.accessToken, spreadsheetId: session.spreadsheetId, req });
  };
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
    );
    return NextResponse.json(data);
  });
}
