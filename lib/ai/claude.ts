import Anthropic from '@anthropic-ai/sdk';
import type { Language } from '@/types';
import { MAX_TURNS, MAX_USER_CHARS } from '@/lib/ai/shared';

// Server-only Claude client for the Nova advisor + smart text. Returns null when
// ANTHROPIC_API_KEY is unset so every AI surface degrades to the template copy.

export const ADVISOR_MODEL = 'claude-sonnet-5-5';

/**
 * Refusal fallback: if Sonnet 5.5's safeguards decline, the API re-runs the same
 * request on a fallback model it picks. Sonnet 5.5 accepts only this "default"
 * form (Claude API only), which is why the calls go through client.beta.messages.
 */
export const FALLBACK_PARAMS = {
  betas: ['server-side-fallback-2026-07-01'],
  fallbacks: 'default',
} satisfies Pick<Anthropic.Beta.MessageCreateParams, 'betas' | 'fallbacks'>;

let client: Anthropic | null = null;

export function getClaude(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  return (client ??= new Anthropic());
}

export const languageName = (lang: Language) => (lang === 'vi' ? 'Vietnamese' : 'English');

/** Persona + ground rules shared by the chat and the smart-text calls (each adds its own language rule). */
export function advisorPersona(): string {
  return [
    'You are Nova, the friendly money coach inside NovaFi, a personal finance app.',
    'You get a JSON snapshot of the user\'s finances, amounts in USD; owedToYou is not part of net worth. Ground every point in the data and quote the numbers. Be warm, concrete and plain-spoken.',
    'You are not a licensed financial advisor: do not recommend specific stocks, funds, crypto or other securities, and suggest a professional for tax, legal or investment decisions.',
  ].join('\n');
}

// ── Chat request guards (trust boundary for /api/advisor) ────────────────────

const MAX_ASSISTANT_CHARS = 8000; // Nova's own earlier answers, echoed back

/** Valid history: 1–19 turns, alternating user/assistant, starting and ending with user; user turns ≤2000 chars, assistant turns trimmed. */
export function parseMessages(body: unknown): Anthropic.Beta.BetaMessageParam[] | null {
  const msgs = (body as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(msgs) || msgs.length === 0 || msgs.length > MAX_TURNS || msgs.length % 2 === 0) return null;
  const out: Anthropic.Beta.BetaMessageParam[] = [];
  for (const [i, m] of msgs.entries()) {
    const role = i % 2 === 0 ? 'user' : 'assistant';
    if (m?.role !== role || typeof m.content !== 'string') return null;
    // Nova's own earlier answers can legitimately be long — trim them rather than
    // rejecting, or one long answer would block every follow-up.
    const content = role === 'user' ? m.content.trim() : m.content.trim().slice(0, MAX_ASSISTANT_CHARS);
    if (!content || (role === 'user' && content.length > MAX_USER_CHARS)) return null;
    out.push({ role, content });
  }
  return out;
}

const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60 * 60 * 1000;
// ponytail: per-process limiter — resets on restart and isn't shared across
// serverless instances; move to a shared store (KV/Redis) if abuse matters.
const hits = new Map<string, number[]>();

/** True when `key` already made RATE_LIMIT chat requests in the last hour (otherwise records this one). */
export function rateLimited(key: string, now = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  const limited = recent.length >= RATE_LIMIT;
  if (!limited) recent.push(now);
  hits.set(key, recent);
  return limited;
}
