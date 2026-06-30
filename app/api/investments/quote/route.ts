import { NextResponse } from 'next/server';
import { withSession } from '@/lib/apiRoute';

/**
 * Best-effort live price lookup for the Investments page. Manual price entry is
 * always available; this just saves typing when the network allows it.
 *
 * - Stocks / ETFs → Stooq's free CSV endpoint (no API key).
 * - Crypto       → CoinGecko's free simple-price endpoint (no API key), via a
 *                  small symbol→id map for the common coins.
 *
 * Every fetch is wrapped so a blocked network, a rate-limit, or an unknown
 * symbol degrades to "no quote for that symbol" rather than failing the request.
 * Response: { quotes: { SYMBOL: price }, failed: SYMBOL[] }.
 */

export const dynamic = 'force-dynamic';

type QuoteItem = { symbol: string; assetType: 'stock' | 'etf' | 'crypto' };

// Common coin tickers → CoinGecko ids. Unknown symbols simply return no quote.
const COINGECKO_IDS: Record<string, string> = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', ADA: 'cardano',
  XRP: 'ripple', DOGE: 'dogecoin', DOT: 'polkadot', MATIC: 'matic-network',
  AVAX: 'avalanche-2', LINK: 'chainlink', LTC: 'litecoin', BCH: 'bitcoin-cash',
  USDC: 'usd-coin', USDT: 'tether', SHIB: 'shiba-inu', UNI: 'uniswap',
  ATOM: 'cosmos', XLM: 'stellar', ALGO: 'algorand', NEAR: 'near',
};

const FETCH_TIMEOUT_MS = 6000;

async function fetchWithTimeout(url: string): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: ctrl.signal, headers: { accept: 'text/csv,application/json' } });
  } finally {
    clearTimeout(timer);
  }
}

// Stooq returns one CSV row per symbol: Symbol,Date,Time,Open,High,Low,Close,Volume.
// US tickers are suffixed `.us`. A missing quote comes back as "N/D".
async function fetchStooq(symbols: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (symbols.length === 0) return out;
  const list = symbols.map((s) => `${s.toLowerCase()}.us`).join(',');
  try {
    const res = await fetchWithTimeout(`https://stooq.com/q/l/?s=${encodeURIComponent(list)}&f=sc&h&e=csv`);
    if (!res.ok) return out;
    const text = await res.text();
    const lines = text.trim().split('\n').slice(1); // drop header
    for (const line of lines) {
      const [sym, close] = line.split(',');
      if (!sym) continue;
      const base = sym.replace(/\.us$/i, '').toUpperCase();
      const price = Number(close);
      if (Number.isFinite(price) && price > 0) out[base] = price;
    }
  } catch { /* network blocked / aborted — leave quotes unfilled */ }
  return out;
}

async function fetchCrypto(symbols: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const ids = symbols
    .map((s) => ({ symbol: s.toUpperCase(), id: COINGECKO_IDS[s.toUpperCase()] }))
    .filter((x) => x.id);
  if (ids.length === 0) return out;
  try {
    const idParam = ids.map((x) => x.id).join(',');
    const res = await fetchWithTimeout(
      `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(idParam)}&vs_currencies=usd`,
    );
    if (!res.ok) return out;
    const data = (await res.json()) as Record<string, { usd?: number }>;
    for (const { symbol, id } of ids) {
      const price = data[id]?.usd;
      if (Number.isFinite(price) && (price as number) > 0) out[symbol] = price as number;
    }
  } catch { /* network blocked / aborted — leave quotes unfilled */ }
  return out;
}

export const POST = withSession(async ({ req }) => {
  const { items } = (await req.json()) as { items: QuoteItem[] };
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ quotes: {}, failed: [] });
  }

  const equities = [...new Set(items.filter((i) => i.assetType !== 'crypto').map((i) => i.symbol).filter(Boolean))];
  const cryptos = [...new Set(items.filter((i) => i.assetType === 'crypto').map((i) => i.symbol).filter(Boolean))];

  const [stooq, crypto] = await Promise.all([fetchStooq(equities), fetchCrypto(cryptos)]);
  const quotes = { ...stooq, ...crypto };

  const failed = items
    .map((i) => i.symbol.toUpperCase())
    .filter((s) => s && !(s in quotes));

  return NextResponse.json({ quotes, failed: [...new Set(failed)] });
});
