import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import type Anthropic from '@anthropic-ai/sdk';
import { withSession } from '@/lib/apiRoute';
import { cachedOrFetch, getCache, invalidateCache } from '@/lib/cache';
import { ADVISOR_MODEL, FALLBACK_PARAMS, advisorPersona, getClaude } from '@/lib/ai/claude';
import { loadAdvisorInputs } from '@/lib/ai/load';
import { materialFingerprint, type AdvisorContext } from '@/lib/ai/context';
import { TIP_PAGES, type SmartText } from '@/lib/ai/shared';
import type { Insight } from '@/lib/insights';
import type { Language } from '@/types';

// Smart text: Claude rewrites the Money Flow insight cards and writes one short
// tip per page. Regenerated only when the numbers change materially (see
// materialFingerprint), never on a timer. Any failure returns {} (uncached) so
// the UI keeps the template copy.
export const maxDuration = 60;

// ponytail: no time-based expiry — the entry lives until the fingerprint changes or the
// process restarts (per-instance memory). Persist it (e.g. a Sheets tab) if regenerating
// after a deploy/cold start costs too much.
const NO_EXPIRY_MS = 365 * 24 * 60 * 60 * 1000;

export const GET = withSession(async (ctx) => {
  const client = getClaude();
  if (!client) return NextResponse.json({} satisfies SmartText);
  try {
    const { lang, insights, context } = await loadAdvisorInputs(ctx);
    const digest = createHash('sha1').update(materialFingerprint(context)).digest('hex').slice(0, 16);
    const prefix = `ai-insights:${ctx.spreadsheetId}:${lang}:`;
    // A new fingerprint replaces the user's old copy (keeps one entry per user + language).
    if (getCache(prefix + digest) === null) invalidateCache(prefix);
    const text = await cachedOrFetch(prefix + digest, NO_EXPIRY_MS, () => generate(client, lang, insights, context));
    return NextResponse.json(text);
  } catch (err) {
    console.error('[ai-insights]', err instanceof Error ? err.message : err);
    return NextResponse.json({} satisfies SmartText);
  }
});

async function generate(client: Anthropic, lang: Language, insights: Insight[], context: AdvisorContext): Promise<SmartText> {
  const ids = insights.map((i) => i.id);
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['insights', 'tips'],
    properties: {
      insights: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'title', 'body'],
          properties: { id: ids.length ? { type: 'string', enum: ids } : { type: 'string' }, title: { type: 'string' }, body: { type: 'string' } },
        },
      },
      tips: {
        type: 'object',
        additionalProperties: false,
        required: [...TIP_PAGES],
        properties: Object.fromEntries(TIP_PAGES.map((p) => [p, { type: 'string' }])),
      },
    },
  };

  const res = await client.beta.messages.create({
    ...FALLBACK_PARAMS,
    model: ADVISOR_MODEL,
    max_tokens: 4000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema } },
    system: advisorPersona(lang),
    messages: [
      {
        role: 'user',
        content: [
          `Financial snapshot:\n${JSON.stringify(context)}`,
          'Task 1: rewrite every appInsights card in a natural, encouraging voice: a title of at most 8 words and a body of at most 30 words. Keep every name and fact as given and add no new facts; quote amounts rounded to 2 significant figures (e.g. about $4,300, about $130,000), never more precisely. Use the same ids.',
          'Task 2: write one tip (1-2 sentences, at most 35 words) for each page, grounded in the snapshot (amounts rounded the same way): dashboard (the overall picture), planning (budgets and upcoming bills), transactions (spending habits), reports (trends over the months), savings (goals and emergency fund). If there is too little data, give a gentle getting-started tip.',
        ].join('\n\n'),
      },
    ],
  });

  if (res.stop_reason !== 'end_turn') throw new Error(`stop_reason ${res.stop_reason}`);
  const block = res.content.find((b) => b.type === 'text');
  if (!block || block.type !== 'text') throw new Error('no text block');
  const parsed = JSON.parse(block.text) as { insights?: unknown; tips?: unknown };

  const out: Required<SmartText> = { insights: {}, tips: {} };
  if (Array.isArray(parsed.insights)) {
    for (const i of parsed.insights as { id?: unknown; title?: unknown; body?: unknown }[]) {
      if (typeof i?.id === 'string' && ids.includes(i.id) && typeof i.title === 'string' && typeof i.body === 'string') {
        out.insights[i.id] = { title: i.title, body: i.body };
      }
    }
  }
  const tips = (parsed.tips ?? {}) as Record<string, unknown>;
  for (const p of TIP_PAGES) if (typeof tips[p] === 'string' && tips[p]) out.tips[p] = tips[p] as string;
  return out;
}
