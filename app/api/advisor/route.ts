import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { auth } from '@/lib/auth';
import { ADVISOR_MODEL, FALLBACK_PARAMS, advisorPersona, getClaude, parseMessages, rateLimited } from '@/lib/ai/claude';
import { loadAdvisorInputs } from '@/lib/ai/load';
import { STREAM_ERROR_MARK } from '@/lib/ai/shared';
import { ADVISOR_TOOLS, runAdvisorTool } from '@/lib/ai/tools';

const MAX_TOOL_ROUNDS = 3; // snapshot first; tools only for what it lacks — caps cost per question

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
  const { lang, context, toolEnv } = inputs; // errors after this point are streamed as STREAM_ERROR_MARK + i18n key

  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    {
      type: 'text',
      text: [
        advisorPersona(lang),
        'Chat style: answer only the question asked, in at most 80 words unless the user asks for more.',
        'Format: one short sentence with the direct answer, then at most 3 bullets ("- ") with the key numbers or steps. No greeting, no headings, no closing question, no extra sections.',
        'Round amounts (e.g. about $4,300). Mention odd-looking data only if it changes the answer.',
        'Tools (read-only, aggregates + merchant names): answer from the snapshot when it has what you need. For deeper history (cash flow, savings, categories, merchants) call ONE tool with the widest useful range (several tools only if truly different data) — never repeat a call.',
      ].join('\n'),
    },
    // Stable per-user snapshot after the persona; cached so follow-up turns are cheap.
    { type: 'text', text: `Financial snapshot:\n${JSON.stringify(context)}`, cache_control: { type: 'ephemeral' } },
  ];
  // Tool definitions render before the system prompt; marking the last one caches tools + system together.
  const tools = ADVISOR_TOOLS.map((t, i) => (i === ADVISOR_TOOLS.length - 1 ? { ...t, cache_control: { type: 'ephemeral' as const } } : t));
  const convo: Anthropic.Beta.BetaMessageParam[] = [...messages];
  let current: ReturnType<typeof client.beta.messages.stream> | null = null;

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for (let round = 0; ; round++) {
          current = client.beta.messages.stream({
            ...FALLBACK_PARAMS,
            model: ADVISOR_MODEL,
            max_tokens: 16000,
            output_config: { effort: 'medium' },
            system,
            // No tools on the last round → Nova must answer with what it has.
            ...(round < MAX_TOOL_ROUNDS ? { tools } : {}),
            messages: convo,
          });
          for await (const event of current) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
              controller.enqueue(encoder.encode(event.delta.text));
            }
          }
          const final = await current.finalMessage();
          if (final.stop_reason === 'refusal') controller.enqueue(encoder.encode(`${STREAM_ERROR_MARK}advisor.refused`));
          if (final.stop_reason !== 'tool_use') break;
          const results = final.content
            .filter((b: Anthropic.Beta.BetaContentBlock): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
            .map((b: Anthropic.Beta.BetaToolUseBlock) => ({ type: 'tool_result' as const, tool_use_id: b.id, content: runAdvisorTool(b.name, b.input, toolEnv) }));
          convo.push({ role: 'assistant', content: final.content }, { role: 'user', content: results });
        }
      } catch (err) {
        if (!current?.aborted) {
          console.error('[advisor]', err instanceof Anthropic.APIError ? `${err.status} ${err.message}` : err);
          const key = err instanceof Anthropic.RateLimitError ? 'advisor.busy' : 'advisor.error';
          controller.enqueue(encoder.encode(`${STREAM_ERROR_MARK}${key}`));
        }
      } finally {
        if (!current?.aborted) controller.close(); // a cancelled stream is already closed
      }
    },
    cancel() {
      current?.abort();
    },
  });

  return new NextResponse(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
}
