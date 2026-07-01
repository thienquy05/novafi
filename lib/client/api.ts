import type {
  Account, Transaction, Bill, PaycheckEntry, Budget, Goal, Contact, Split, Loan, Funding, TaxSettings, TrackedSubscription,
} from '@/types';

/**
 * Client-side API helpers.
 *
 * `loadBatch` collapses a page's several `/api/*` GETs into one `/api/batch`
 * round trip (one Google Sheets quota hit instead of N).
 *
 * Only `import type` from server modules here — these are erased at build time, so
 * this stays a pure client module (no googleapis pulled into the browser bundle).
 */

/** Mirror of the server's BatchResult (lib/sheets.ts) for typing /api/batch responses. */
export type BatchData = {
  accounts: Account[];
  transactions: Transaction[];
  bills: Bill[];
  paychecks: PaycheckEntry[];
  budgets: Budget[];
  goals: Goal[];
  contacts: Contact[];
  splits: Split[];
  loans: Loan[];
  funding: Funding[];
  settings: TaxSettings;
  subscriptions: TrackedSubscription[];
};

export type BatchKey = keyof BatchData;

/** One round trip for several resources via /api/batch. Returns only the requested keys. */
export async function loadBatch<K extends BatchKey>(
  keys: readonly K[],
): Promise<Pick<BatchData, K>> {
  const res = await fetch(`/api/batch?keys=${keys.join(',')}`);
  if (!res.ok) throw new Error(`batch load failed: ${res.status}`);
  return res.json() as Promise<Pick<BatchData, K>>;
}

/**
 * Fetch ONLY the given transaction rows by id (one targeted GET).
 *
 * Feature pages whose records reference a handful of ledger rows (e.g. Funding,
 * which links each pool to its spend/contribution transactions) use this to
 * resolve just those rows — instead of loading the entire `transactions`
 * resource, which grows without bound as settled payments accumulate. Returns
 * `[]` for an empty id list without a round trip.
 */
export async function loadTransactionsByIds(ids: readonly string[]): Promise<Transaction[]> {
  if (ids.length === 0) return [];
  const res = await fetch(`/api/transactions?ids=${ids.map(encodeURIComponent).join(',')}`);
  if (!res.ok) throw new Error(`transactions load failed: ${res.status}`);
  return res.json() as Promise<Transaction[]>;
}
