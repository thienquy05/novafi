// Client-safe AI types (no SDK import) shared by the routes and the UI.

/** Pages that show a <NovaTip/>. */
export const TIP_PAGES = ['dashboard', 'planning', 'transactions', 'reports', 'savings'] as const;
export type TipPage = (typeof TIP_PAGES)[number];

/** /api/ai/insights payload. Empty object = AI off/failed → keep the template copy. */
export type SmartText = {
  insights?: Record<string, { title: string; body: string }>;
  tips?: Partial<Record<TipPage, string>>;
};

export type ChatMessage = { role: 'user' | 'assistant'; content: string };

/** Chat limits, enforced server-side in lib/ai/claude.ts#parseMessages. */
export const MAX_TURNS = 19; // odd: history starts and ends with a user turn
export const MAX_USER_CHARS = 2000;

/** Separates a streamed answer from a trailing error key (e.g. "advisor.error") the server appends mid-stream. */
export const STREAM_ERROR_MARK = '\u0000';
