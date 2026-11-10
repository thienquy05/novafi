import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { auth } from '@/lib/auth';
import { ADVISOR_MODEL, FALLBACK_PARAMS, advisorPersona, getClaude, parseMessages, rateLimited } from '@/lib/ai/claude';
import { loadAdvisorInputs } from '@/lib/ai/load';
import { STREAM_ERROR_MARK } from '@/lib/ai/shared';

// Nova chat: streams Claude's answer as plain text. Hand-written auth (not
// withSession) because a chat message is not a write — withSession would stamp
// the write-version cookie and force needless Sheets refetches.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const client = getClaude();
  if (!client) return NextResponse.json({ error: 'not_configured' }, { status: 503 });

  const messages = parseMessages(await req.json().catch(() => null));
  if (!messages) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  if (rateLimited(session.spreadsheetId)) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  let inputs: Awaited<ReturnType<typeof loadAdvisorInputs>>;
  try {
    inputs = await loadAdvisorInputs({ accessToken: session.accessToken, spreadsheetId: session.spreadsheetId, req });
  } catch {
    return NextResponse.json({ error: 'data_unavailable' }, { status: 502 });
  }
  const { lang, context } = inputs; // errors after this point are streamed as STREAM_ERROR_MARK + i18n key

  const stream = client.beta.messages.stream({
    ...FALLBACK_PARAMS,
    model: ADVISOR_MODEL,
    max_tokens: 16000,
    output_config: { effort: 'medium' },
    system: [
      {
        type: 'text',
        text: [
          advisorPersona(lang),
          'Chat style: answer only the question asked, in at most 80 words unless the user asks for more.',
          'Format: one short sentence with the direct answer, then at most 3 bullets ("- ") with the key numbers or steps. No greeting, no headings, no closing question, no extra sections.',
          'Round amounts (e.g. about $4,300). Mention odd-looking data only if it changes the answer.',
        ].join('\n'),
      },
      // Stable per-user snapshot after the persona; cached so follow-up turns are cheap.
      { type: 'text', text: `Financial snapshot:\n${JSON.stringify(context)}`, cache_control: { type: 'ephemeral' } },
    ],
    messages,
  });

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
        const final = await stream.finalMessage();
        if (final.stop_reason === 'refusal') controller.enqueue(encoder.encode(`${STREAM_ERROR_MARK}advisor.refused`));
      } catch (err) {
        if (!stream.aborted) {
          console.error('[advisor]', err instanceof Anthropic.APIError ? `${err.status} ${err.message}` : err);
          const key = err instanceof Anthropic.RateLimitError ? 'advisor.busy' : 'advisor.error';
          controller.enqueue(encoder.encode(`${STREAM_ERROR_MARK}${key}`));
        }
      } finally {
        if (!stream.aborted) controller.close(); // a cancelled stream is already closed
      }
    },
    cancel() {
      stream.abort();
    },
  });

  return new NextResponse(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
}
