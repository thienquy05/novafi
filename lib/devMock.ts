/**
 * DEV-ONLY test mode: an in-memory stand-in for the Google Sheets API plus a fake
 * signed-in session, so every page and every write can be exercised (Playwright,
 * manual QA) without Google sign-in or network access.
 *
 * Enabled only when NOVAFI_MOCK=1 AND NODE_ENV !== 'production' — it can never be
 * switched on in a production build. Each test profile (cookie `nf_mock_profile`:
 * extreme | negative | empty) is its own in-memory spreadsheet seeded from
 * lib/devFixture.ts; writes persist until the dev server restarts.
 *
 * Only the API surface NovaFi uses is implemented. Reads mimic Google's
 * behaviour closely enough to surface real bugs: missing tabs throw a 400
 * "Unable to parse range", trailing empty cells/rows are trimmed, and values come
 * back as strings unless valueRenderOption is UNFORMATTED_VALUE.
 */
import { buildFixture, type MockProfile } from './devFixture';

export const MOCK_MODE = process.env.NODE_ENV !== 'production' && process.env.NOVAFI_MOCK === '1';
export const MOCK_PROFILE_COOKIE = 'nf_mock_profile';
export const MOCK_PROFILES: readonly MockProfile[] = ['extreme', 'negative', 'empty'];

type Cell = string | number | boolean;
type Tab = { id: number; rows: Cell[][] };
type Book = Map<string, Tab>;

// Survive dev hot-reloads (module state would otherwise reset on every edit).
const g = globalThis as unknown as { __novafiMockBooks?: Map<string, Book> };
const books = (g.__novafiMockBooks ??= new Map());

export function mockSpreadsheetId(profile: MockProfile): string {
  return `mock-${profile}`;
}

function book(spreadsheetId: string): Book {
  let b = books.get(spreadsheetId);
  if (!b) {
    const profile = (spreadsheetId.replace(/^mock-/, '') as MockProfile);
    b = new Map();
    let id = 1;
    for (const [title, rows] of Object.entries(buildFixture(MOCK_PROFILES.includes(profile) ? profile : 'extreme'))) {
      b.set(title, { id: id++, rows: rows.map((r) => [...r]) });
    }
    books.set(spreadsheetId, b);
  }
  return b;
}

/** Test helper: drop all in-memory books so the next access re-seeds them. */
export function resetMockBooks(): void {
  books.clear();
}

// ── A1 ranges ──────────────────────────────────────────────────────────────
function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

type Range = { title: string; c1: number; r1: number; c2: number | null; r2: number | null; single: boolean };

export function parseRange(a1: string): Range {
  const bang = a1.lastIndexOf('!');
  const title = (bang >= 0 ? a1.slice(0, bang) : a1).replace(/^'|'$/g, '');
  const ref = bang >= 0 ? a1.slice(bang + 1) : 'A1:ZZ';
  const [start, end] = ref.split(':');
  const m1 = /^([A-Z]+)(\d*)$/i.exec(start);
  if (!m1) throw Object.assign(new Error(`Unable to parse range: ${a1}`), { code: 400 });
  const m2 = end ? /^([A-Z]+)(\d*)$/i.exec(end) : null;
  return {
    title,
    c1: colIndex(m1[1]),
    r1: m1[2] ? Number(m1[2]) - 1 : 0,
    c2: m2 ? colIndex(m2[1]) : null,
    r2: m2 && m2[2] ? Number(m2[2]) - 1 : null,
    single: !end,
  };
}

function tabOf(b: Book, title: string): Tab {
  const t = b.get(title);
  if (!t) throw Object.assign(new Error(`Unable to parse range: ${title}`), { code: 400 });
  return t;
}

function render(v: Cell, unformatted: boolean): Cell {
  if (unformatted) return v;
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return String(v);
}

function read(b: Book, a1: string, unformatted: boolean): Cell[][] {
  const r = parseRange(a1);
  const tab = tabOf(b, r.title);
  const lastRow = r.single ? r.r1 : r.r2 ?? tab.rows.length - 1;
  const out: Cell[][] = [];
  for (let i = r.r1; i <= lastRow && i < tab.rows.length; i++) {
    const row = tab.rows[i] ?? [];
    const end = r.single ? r.c1 : r.c2 ?? row.length - 1;
    const slice = row.slice(r.c1, end + 1).map((v) => render(v ?? '', unformatted));
    while (slice.length && (slice[slice.length - 1] === '' || slice[slice.length - 1] === undefined)) slice.pop();
    out.push(slice);
  }
  while (out.length && out[out.length - 1].length === 0) out.pop();
  return out;
}

function write(b: Book, a1: string, values: Cell[][]): void {
  const r = parseRange(a1);
  const tab = tabOf(b, r.title);
  values.forEach((vals, i) => {
    const row = (tab.rows[r.r1 + i] ??= []);
    vals.forEach((v, j) => { row[r.c1 + j] = v ?? ''; });
  });
  for (let i = 0; i < tab.rows.length; i++) tab.rows[i] ??= [];
}

function lastUsedRow(tab: Tab): number {
  for (let i = tab.rows.length - 1; i >= 0; i--) if ((tab.rows[i] ?? []).some((v) => v !== '' && v !== undefined)) return i;
  return -1;
}

type Params = { spreadsheetId: string; range?: string; ranges?: string[]; valueRenderOption?: string; requestBody?: Record<string, unknown> };

/** Drop-in for `google.sheets({ version: 'v4' })` covering what lib/sheets.ts uses. */
export function createMockSheetsClient() {
  const unformatted = (p: Params) => p.valueRenderOption === 'UNFORMATTED_VALUE';
  return {
    spreadsheets: {
      get: async (p: Params) => ({
        data: { sheets: [...book(p.spreadsheetId).entries()].map(([title, t]) => ({ properties: { title, sheetId: t.id } })) },
      }),
      batchUpdate: async (p: Params) => {
        const b = book(p.spreadsheetId);
        const requests = (p.requestBody?.requests ?? []) as Record<string, { properties?: { title: string }; range?: { sheetId: number; dimension: string; startIndex: number; endIndex: number } }>[];
        for (const req of requests) {
          if (req.addSheet?.properties) {
            const title = req.addSheet.properties.title;
            if (!b.has(title)) b.set(title, { id: Math.max(0, ...[...b.values()].map((t) => t.id)) + 1, rows: [] });
          } else if (req.deleteDimension?.range?.dimension === 'ROWS') {
            const { sheetId, startIndex, endIndex } = req.deleteDimension.range;
            const tab = [...b.values()].find((t) => t.id === sheetId);
            tab?.rows.splice(startIndex, endIndex - startIndex);
          }
          // Formatting / other requests are no-ops here.
        }
        return { data: {} };
      },
      values: {
        get: async (p: Params) => ({ data: { range: p.range, values: read(book(p.spreadsheetId), p.range!, unformatted(p)) } }),
        batchGet: async (p: Params) => {
          const b = book(p.spreadsheetId);
          return { data: { valueRanges: (p.ranges ?? []).map((range) => ({ range, values: read(b, range, unformatted(p)) })) } };
        },
        update: async (p: Params) => {
          write(book(p.spreadsheetId), p.range!, (p.requestBody?.values ?? []) as Cell[][]);
          return { data: {} };
        },
        batchUpdate: async (p: Params) => {
          const b = book(p.spreadsheetId);
          for (const d of (p.requestBody?.data ?? []) as { range: string; values: Cell[][] }[]) write(b, d.range, d.values);
          return { data: {} };
        },
        append: async (p: Params) => {
          const b = book(p.spreadsheetId);
          const tab = tabOf(b, parseRange(p.range!).title);
          const at = lastUsedRow(tab) + 1;
          const values = (p.requestBody?.values ?? []) as Cell[][];
          tab.rows.splice(at, 0, ...values.map((r) => [...r]));
          return { data: {} };
        },
        clear: async (p: Params) => {
          const b = book(p.spreadsheetId);
          const r = parseRange(p.range!);
          const tab = tabOf(b, r.title);
          const lastRow = r.r2 ?? tab.rows.length - 1;
          for (let i = r.r1; i <= lastRow && i < tab.rows.length; i++) {
            const row = tab.rows[i] ?? [];
            const end = r.c2 ?? row.length - 1;
            for (let j = r.c1; j <= end && j < row.length; j++) row[j] = '';
          }
          return { data: {} };
        },
      },
    },
  };
}
