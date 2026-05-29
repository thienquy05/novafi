import { describe, it, expect, vi } from 'vitest';
import { isRetryableError, backoffDelay, withRetry } from '@/lib/retry';

// Mimics how googleapis/gaxios attach status info.
const httpErr = (code: number) => Object.assign(new Error(`HTTP ${code}`), { code });
const networkErr = (code: string) => Object.assign(new Error(code), { code });

describe('isRetryableError', () => {
  it('retries 429 regardless of method type', () => {
    expect(isRetryableError(httpErr(429))).toBe(true);
    expect(isRetryableError(httpErr(429), true)).toBe(true);
  });

  it('only retries 5xx when explicitly allowed (idempotent reads)', () => {
    expect(isRetryableError(httpErr(503))).toBe(false);
    expect(isRetryableError(httpErr(503), true)).toBe(true);
    expect(isRetryableError(httpErr(500), true)).toBe(true);
  });

  it('never retries client errors like 400/404', () => {
    expect(isRetryableError(httpErr(400), true)).toBe(false);
    expect(isRetryableError(httpErr(404), true)).toBe(false);
  });

  it('retries pre-response network failures', () => {
    expect(isRetryableError(networkErr('ECONNRESET'))).toBe(true);
    expect(isRetryableError(networkErr('ETIMEDOUT'))).toBe(true);
    expect(isRetryableError(networkErr('NOPE'))).toBe(false);
  });

  it('reads status from .status and .response.status shapes', () => {
    expect(isRetryableError({ status: 429 })).toBe(true);
    expect(isRetryableError({ response: { status: 429 } })).toBe(true);
  });

  it('does not retry unknown/plain errors', () => {
    expect(isRetryableError(new Error('boom'))).toBe(false);
    expect(isRetryableError(null)).toBe(false);
  });
});

describe('backoffDelay', () => {
  it('grows exponentially from the base', () => {
    expect(backoffDelay(1, 300)).toBe(300);
    expect(backoffDelay(2, 300)).toBe(600);
    expect(backoffDelay(3, 300)).toBe(1200);
  });
  it('caps at maxMs', () => {
    expect(backoffDelay(10, 300, 8000)).toBe(8000);
  });
});

describe('withRetry', () => {
  const noSleep = () => Promise.resolve();

  it('returns immediately on success without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    expect(await withRetry(fn, { sleep: noSleep })).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries transient failures then succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(httpErr(429))
      .mockRejectedValueOnce(httpErr(429))
      .mockResolvedValue('ok');
    expect(await withRetry(fn, { sleep: noSleep })).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('gives up after exhausting retries and rethrows the last error', async () => {
    const fn = vi.fn().mockRejectedValue(httpErr(429));
    await expect(withRetry(fn, { retries: 2, sleep: noSleep })).rejects.toMatchObject({ code: 429 });
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('does not retry a non-retryable error', async () => {
    const fn = vi.fn().mockRejectedValue(httpErr(400));
    await expect(withRetry(fn, { sleep: noSleep })).rejects.toMatchObject({ code: 400 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('honors a custom shouldRetry predicate', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue('done');
    const result = await withRetry(fn, { sleep: noSleep, shouldRetry: () => true });
    expect(result).toBe('done');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
