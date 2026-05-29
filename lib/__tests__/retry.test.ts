import { describe, it, expect, vi } from 'vitest';
import { isRetryableError, backoffDelay, withRetry, withRetryProxy } from '@/lib/retry';

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

describe('withRetryProxy', () => {
  const httpErr = (code: number) => Object.assign(new Error(`HTTP ${code}`), { code });
  const noSleep = () => Promise.resolve();

  // Mirrors the googleapis client shape: a `spreadsheets` resource nested under
  // the client, with `values` nested under that, and methods on each level.
  function makeFakeSheets() {
    const valuesGet = vi.fn().mockResolvedValue('values.get');
    const valuesAppend = vi.fn().mockResolvedValue('values.append');
    const spreadsheetsGet = vi.fn().mockResolvedValue('spreadsheets.get');
    const client = {
      spreadsheets: {
        get: spreadsheetsGet,
        values: { get: valuesGet, append: valuesAppend },
      },
    };
    return { client, valuesGet, valuesAppend, spreadsheetsGet };
  }

  it('forwards nested method calls through the proxy', async () => {
    const { client } = makeFakeSheets();
    const proxy = withRetryProxy(client, { sleep: noSleep });
    expect(await proxy.spreadsheets.values.get()).toBe('values.get');
    expect(await proxy.spreadsheets.get()).toBe('spreadsheets.get');
  });

  it('does NOT throw when a resource property is frozen (read-only, non-configurable)', async () => {
    // Reproduces the Vercel prod crash: googleapis exposes `spreadsheets` as a
    // non-configurable, non-writable data prop in the minified build. A naive
    // proxy-over-client returns a wrapper here, violating the get-trap invariant.
    const { client } = makeFakeSheets();
    Object.defineProperty(client, 'spreadsheets', {
      value: client.spreadsheets,
      writable: false,
      configurable: false,
      enumerable: true,
    });
    const proxy = withRetryProxy(client, { sleep: noSleep });
    // The throwing line was the property access itself, not the call.
    expect(() => proxy.spreadsheets).not.toThrow();
    expect(await proxy.spreadsheets.values.get()).toBe('values.get');
  });

  it('retries transient 429s on nested method calls', async () => {
    const { client, valuesAppend } = makeFakeSheets();
    valuesAppend
      .mockRejectedValueOnce(httpErr(429))
      .mockResolvedValue('ok-after-retry');
    const proxy = withRetryProxy(client, { sleep: noSleep });
    expect(await proxy.spreadsheets.values.append()).toBe('ok-after-retry');
    expect(valuesAppend).toHaveBeenCalledTimes(2);
  });

  it('does not retry 5xx on writes (append) but does on reads (get)', async () => {
    const { client, valuesAppend, valuesGet } = makeFakeSheets();
    valuesAppend.mockRejectedValue(httpErr(503));
    valuesGet.mockRejectedValueOnce(httpErr(503)).mockResolvedValue('read-ok');
    const proxy = withRetryProxy(client, { sleep: noSleep });

    await expect(proxy.spreadsheets.values.append()).rejects.toMatchObject({ code: 503 });
    expect(valuesAppend).toHaveBeenCalledTimes(1); // write: no 5xx retry

    expect(await proxy.spreadsheets.values.get()).toBe('read-ok');
    expect(valuesGet).toHaveBeenCalledTimes(2); // read: 5xx retried
  });
});
