import { NextRequest, NextResponse } from 'next/server';
import { withSession } from '@/lib/apiRoute';
import { loadAdvisorInputs } from '@/lib/ai/load';
import { isActionTool, planAction, type ActionPath } from '@/lib/ai/actions';
import * as transactions from '@/app/api/transactions/route';
import * as funding from '@/app/api/funding/route';
import * as loans from '@/app/api/loans/route';
import * as splits from '@/app/api/splits/route';

// Runs one action Nova planned (lib/ai/actions.ts), after the user's Confirm or
// straight away for a clear simple one. The client sends back only the tool name,
// its input and the fingerprint it was shown; the plan is rebuilt here from fresh
// data and refused with 409 if anything it would write differs from what the card
// showed. The write itself goes through the SAME route handler the manual UI uses
// (balances, linked records, cache invalidation), and withSession stamps the
// write-version cookie so every page refetches.

export const maxDuration = 60;

type Handler = (req: NextRequest) => Promise<NextResponse>;
const ROUTES: Record<ActionPath, Partial<Record<'POST' | 'PUT' | 'DELETE', Handler>>> = {
  '/api/transactions': transactions,
  '/api/funding': funding,
  '/api/loans': loans,
  '/api/splits': splits,
};

export const POST = withSession(async ({ accessToken, spreadsheetId, req }) => {
  const body = (await req.json().catch(() => null)) as { tool?: unknown; input?: unknown; fp?: unknown } | null;
  if (!body || !isActionTool(body.tool) || typeof body.fp !== 'string') return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  let inputs: Awaited<ReturnType<typeof loadAdvisorInputs>>;
  try {
    inputs = await loadAdvisorInputs({ accessToken, spreadsheetId, req });
  } catch {
    return NextResponse.json({ error: 'data_unavailable' }, { status: 502 });
  }
  const res = planAction(body.tool, body.input, { ...inputs.toolEnv, lang: inputs.lang });
  if (!res.ok || res.plan.fp !== body.fp) return NextResponse.json({ error: 'changed' }, { status: 409 });

  const { method, path, body: payload } = res.plan.request;
  const handler = ROUTES[path]?.[method];
  if (!handler) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  // A failure may be partial (the handlers write the ledger row first), so the client
  // says "check the page" rather than offering a blind retry that could double it.
  try {
    const inner = await handler(new NextRequest(new URL(path, req.url), {
      method,
      headers: { 'content-type': 'application/json', cookie: req.headers.get('cookie') ?? '' },
      body: JSON.stringify(payload),
    }));
    if (!inner.ok) return NextResponse.json({ error: 'failed' }, { status: 502 });
  } catch (err) {
    console.error('[nova execute]', body.tool, err);
    return NextResponse.json({ error: 'failed' }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
});
