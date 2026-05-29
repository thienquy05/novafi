import type { Transaction } from '@/types';

const CSV_HEADERS = ['Date', 'Description', 'Amount', 'Type', 'Category', 'Account', 'To Account'] as const;

// Quotes a single CSV field, escaping embedded quotes per RFC 4180.
function csvField(value: unknown): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

/**
 * Serializes transactions to an RFC-4180 CSV string (pure — no DOM).
 * `accountName` maps an account id to its display name; unknown ids fall back to
 * the raw id. Amounts are fixed to 2 decimals. Transfers include the destination.
 */
export function transactionsToCsv(
  transactions: Transaction[],
  accountName: (id: string) => string = (id) => id,
): string {
  const rows = transactions.map((tx) => [
    tx.date,
    tx.description,
    tx.amount.toFixed(2),
    tx.type,
    tx.category,
    accountName(tx.account),
    tx.type === 'transfer' && tx.toAccount ? accountName(tx.toAccount) : '',
  ]);
  return [CSV_HEADERS, ...rows]
    .map((row) => row.map(csvField).join(','))
    .join('\n');
}
