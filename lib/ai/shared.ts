// Client-safe AI types (no SDK import) shared by the routes and the UI.

/** Pages that show a <NovaTip/>. */
export const TIP_PAGES = ['dashboard', 'planning', 'transactions', 'reports', 'savings'] as const;
export type TipPage = (typeof TIP_PAGES)[number];

/** /api/ai/insights payload. Empty object = AI off/failed → keep the template copy. */
export type SmartText = {
  insights?: Record<string, { title: string; body: string }>;
  tips?: Partial<Record<TipPage, string>>;
};

/** A write Nova planned, shown as a card under its reply (see lib/ai/actions.ts). */
export type ActionStatus = 'pending' | 'running' | 'done' | 'failed' | 'changed' | 'cancelled' | 'replaced';
export type ActionCard = {
  /** Client-side identity of this card (two identical requests share an fp but are separate cards). */
  id: string;
  fp: string;
  tool: string;
  input: unknown;
  title: string;
  lines: string[];
  needsConfirm: boolean;
  status: ActionStatus;
};

export type ChatMessage = { role: 'user' | 'assistant'; content: string; actions?: ActionCard[] };

/** Chat limits, enforced server-side in lib/ai/claude.ts#parseMessages. */
export const MAX_TURNS = 19; // odd: history starts and ends with a user turn
export const MAX_USER_CHARS = 2000;

/** Separates a streamed answer from a trailing error key (e.g. "advisor.error") the server appends mid-stream. */
export const STREAM_ERROR_MARK = '\u0000';

/** Wraps a planned action (JSON of ActionCard minus status) inside the streamed answer: ACTION_MARK + json + ACTION_END. */
export const ACTION_MARK = '\u001e';
export const ACTION_END = '\u001f';

/** Starts every action note the client appends; the chat route strips it (and the stream marks) from model text so notes and cards can't be forged. */
export const NOTE_MARK = '\u001d';
/** Control characters the model's text may never contain (they delimit errors, cards and notes). */
export const RESERVED_CHARS = /[\u0000\u001d\u001e\u001f]/g;

/** The note appended to an assistant turn in the history sent back, so Nova knows each action's outcome. */
export const actionNote = (a: Pick<ActionCard, 'fp' | 'status' | 'title'>) => `${NOTE_MARK}[action ${a.fp} ${a.status}] ${a.title}`;
