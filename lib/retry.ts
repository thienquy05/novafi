/**
 * Retry/backoff for Google Sheets API calls.
 *
 * Scaling motivation: Sheets quotas are ~60 reads + 60 writes per minute PER USER.
 * A bursty power user (or several open tabs) can momentarily exceed that and get a
 * 429 — without retries that surfaces as a hard failure. We retry transient errors
 * with exponential backoff so those bursts self-recover.
 *
 * Finance-safety: an `append` is NOT idempotent — blindly retrying one that may have
 * already succeeded could create a DUPLICATE transaction. So the policy is:
 *   • 429 (rate limit) and pre-response network errors → always safe (request was
 *     rejected/never processed) → retry.
 *   • 5xx (server error) → retry ONLY for idempotent reads, never for writes.
 */

// Extracts an HTTP status from the various shapes googleapis/gaxios throw.
function extractStatus(err: unknown): number | null {
  if (typeof err !== 'object' || err === null) return null;
  const e = err as Record<string, unknown>;
  if (typeof e.code === 'number') return e.code;
  if (typeof e.status === 'number') return e.status;
  const response = e.response as { status?: unknown } | undefined;
  if (response && typeof response.status === 'number') return response.status;
  return null;
}

const NETWORK_ERROR_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED']);

/**
 * Whether an error should be retried.
 * @param allow5xx permit retrying 5xx responses (only set for idempotent reads).
 */
export function isRetryableError(err: unknown, allow5xx = false): boolean {
  const status = extractStatus(err);
  if (status === 429) return true;
  if (status !== null) return allow5xx && status >= 500 && status < 600;
  // No HTTP status → a network-layer failure before any response was received.
  const code = (err as { code?: string } | null)?.code;
  return typeof code === 'string' && NETWORK_ERROR_CODES.has(code);
}

/** Capped exponential backoff (deterministic). attempt is 1-based: 1→base, 2→2·base… */
export function backoffDelay(attempt: number, baseMs = 300, maxMs = 8000): number {
  const exp = baseMs * 2 ** Math.max(0, attempt - 1);
  return Math.min(exp, maxMs);
}

export type RetryOptions = {
  retries?: number; // max retries AFTER the first attempt
  baseMs?: number;
  maxMs?: number;
  sleep?: (ms: number) => Promise<void>;
  shouldRetry?: (err: unknown) => boolean;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const { retries = 3, baseMs = 300, maxMs = 8000, sleep = defaultSleep, shouldRetry = isRetryableError } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retries || !shouldRetry(err)) throw err;
      const base = backoffDelay(attempt + 1, baseMs, maxMs);
      const jitter = base * 0.25 * Math.random(); // spread retries so tabs don't sync up
      await sleep(base + jitter);
    }
  }
  throw lastErr; // unreachable, but satisfies the type checker
}

// Method names that are safe to retry on 5xx (idempotent reads).
const IDEMPOTENT_READ_METHODS = new Set(['get', 'batchGet']);

/**
 * Recursively wraps a googleapis client so every method call auto-retries —
 * no per-call-site changes needed. `this` binding is preserved for prototype
 * methods. 5xx retries are enabled only for read methods (get/batchGet); all
 * other calls retry on 429/network errors only.
 */
export function withRetryProxy<T extends object>(client: T, opts: RetryOptions = {}): T {
  return new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof prop === 'symbol') return value;
      if (typeof value === 'function') {
        const allow5xx = IDEMPOTENT_READ_METHODS.has(prop);
        const fn = value as (...args: unknown[]) => unknown;
        return (...args: unknown[]) =>
          withRetry(() => Promise.resolve(fn.apply(target, args)), {
            ...opts,
            shouldRetry: opts.shouldRetry ?? ((err) => isRetryableError(err, allow5xx)),
          });
      }
      if (value && typeof value === 'object') {
        return withRetryProxy(value as object, opts);
      }
      return value;
    },
  }) as T;
}
