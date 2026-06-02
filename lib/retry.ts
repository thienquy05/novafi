/**
 * Retry/backoff for Google Sheets API calls.
 *
 * Scaling motivation: Sheets quotas are ~60 reads + 60 writes per minute PER USER.
 * A bursty power user (or several open tabs) can momentarily exceed that and get a
 * 429 — without retries that surfaces as a hard failure. We retry transient errors
 * with exponential backoff so those bursts self-recover.
 *
 * Finance-safety: an `append` is NOT idempotent — blindly retrying one that may have
 * already succeeded could create a DUPLICATE transaction (and permanently distort an
 * account balance). So the policy is:
 *   • 429 (rate limit) → always safe to retry: the request was rejected by the quota
 *     gate and never processed, so it can't have partially applied.
 *   • 5xx (server error) AND network-layer errors (no HTTP status) → retry ONLY for
 *     idempotent reads, NEVER for writes. A network drop can happen AFTER the server
 *     already processed the write (the response is just lost), so retrying the write
 *     risks duplicating it. For writes we'd rather surface a visible failure (the
 *     caller can safely re-issue) than silently double-apply money.
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
 * @param idempotent permit retrying ambiguous failures (5xx and network errors)
 *   that may have already been processed by the server. Only set for idempotent
 *   reads — never for non-idempotent writes (append/update/delete), which could
 *   be duplicated by a retry.
 */
export function isRetryableError(err: unknown, idempotent = false): boolean {
  const status = extractStatus(err);
  // 429 is always safe: the quota gate rejected the request, so it never ran.
  if (status === 429) return true;
  // 5xx: ambiguous (the write may have applied) → idempotent reads only.
  if (status !== null) return idempotent && status >= 500 && status < 600;
  // No HTTP status → a network-layer failure. This may have happened AFTER the
  // server processed the request (lost response), so retrying a write could
  // duplicate it. Retry only for idempotent reads.
  const code = (err as { code?: string } | null)?.code;
  return idempotent && typeof code === 'string' && NETWORK_ERROR_CODES.has(code);
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
 * methods. 5xx and network-error retries are enabled only for idempotent read
 * methods (get/batchGet); all other (write) calls retry on 429 only.
 *
 * The Proxy target is a fresh empty object, NOT `client` — and the trap reads
 * the real values from `client` via closure. This is deliberate: the get-trap
 * invariant only constrains the value returned for the *target's* own
 * non-configurable, non-writable properties. In the minified production build,
 * googleapis exposes its resource properties (e.g. `spreadsheets`) as frozen
 * data props, so proxying the client directly and returning a wrapper throws
 *   "'get' on proxy: property 'spreadsheets' is a read-only and
 *    non-configurable data property ... but the proxy did not return its
 *    actual value"
 * (seen only on Vercel; local dev builds don't freeze these props). Keeping the
 * target empty means there are no frozen own props to violate, so we can return
 * wrapped values freely.
 */
export function withRetryProxy<T extends object>(client: T, opts: RetryOptions = {}): T {
  return new Proxy({} as T, {
    get(_target, prop) {
      const value = Reflect.get(client, prop);
      if (typeof prop === 'symbol') return value;
      if (typeof value === 'function') {
        const idempotent = IDEMPOTENT_READ_METHODS.has(prop);
        const fn = value as (...args: unknown[]) => unknown;
        return (...args: unknown[]) =>
          withRetry(() => Promise.resolve(fn.apply(client, args)), {
            ...opts,
            shouldRetry: opts.shouldRetry ?? ((err) => isRetryableError(err, idempotent)),
          });
      }
      if (value && typeof value === 'object') {
        return withRetryProxy(value as object, opts);
      }
      return value;
    },
    has(_target, prop) {
      return Reflect.has(client, prop);
    },
  }) as T;
}
