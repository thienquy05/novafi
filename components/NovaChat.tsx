'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Send, RotateCcw, X, Check, Loader2, AlertTriangle, Ban } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from '@/lib/i18n/context';
import { cn } from '@/lib/utils';
import { NovaFace } from '@/components/NovaFace';
import { useKeyboardViewport } from '@/hooks/useKeyboardViewport';
import { ACTION_END, ACTION_MARK, MAX_TURNS, MAX_USER_CHARS, STREAM_ERROR_MARK, actionNote, type ActionCard, type ActionStatus, type ChatMessage } from '@/lib/ai/shared';

// Nova chat as a floating bubble on every app page (mounted once in
// app/(app)/layout.tsx, so it survives navigation and keeps streaming while
// closed). Nova only answers when the user asks — nothing is sent on open.
// Only the last MAX_TURNS messages are sent, so long chats keep a sliding window.

const STORE_KEY = 'nf_advisor_chat_v1';
/** Dispatch on window to open the bubble from anywhere (e.g. NovaTip's "Ask Nova"). */
export const OPEN_NOVA_EVENT = 'nova:open';
const CHIPS = ['advisor.chipOwed', 'advisor.chipBills', 'advisor.chipCut', 'advisor.chipAfford'] as const;

/** Tiny Markdown subset (paragraphs, bullet/numbered lists, **bold**, headings) rendered as text — no HTML injection. */
function inline(s: string) {
  return s
    .replace(/^#{1,6}\s+/, '')
    .split(/(\*\*[^*]+\*\*)/g)
    .map((part, i) => (part.length > 4 && part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part));
}
const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+/;
function Rich({ text }: { text: string }) {
  const blocks: ({ kind: 'p'; text: string } | { kind: 'ul'; items: string[] })[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (BULLET.test(line)) {
      const last = blocks[blocks.length - 1];
      if (last?.kind === 'ul') last.items.push(line.replace(BULLET, ''));
      else blocks.push({ kind: 'ul', items: [line.replace(BULLET, '')] });
    } else {
      blocks.push({ kind: 'p', text: line });
    }
  }
  return (
    <div className="space-y-2">
      {blocks.map((b, i) =>
        b.kind === 'ul' ? (
          <ul key={i} className="space-y-1.5">
            {b.items.map((item, j) => (
              <li key={j} className="flex gap-2">
                <span className="mt-[7px] w-1.5 h-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400 shrink-0" />
                <span className="min-w-0">{inline(item)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p key={i}>{inline(b.text)}</p>
        ),
      )}
    </div>
  );
}

/** Split a streamed answer into its text and the action cards embedded in it (an unfinished trailing card is dropped until it completes). */
type PlannedCard = Omit<ActionCard, 'status' | 'id'>;
function parseStream(raw: string): { text: string; cards: PlannedCard[] } {
  const cards: PlannedCard[] = [];
  let text = '';
  let rest = raw;
  for (;;) {
    const start = rest.indexOf(ACTION_MARK);
    if (start < 0) { text += rest; break; }
    text += rest.slice(0, start);
    const end = rest.indexOf(ACTION_END, start);
    if (end < 0) break; // still streaming
    try { cards.push(JSON.parse(rest.slice(start + 1, end))); } catch { /* ignore a malformed card */ }
    rest = rest.slice(end + 1);
  }
  return { text, cards };
}

/** What the server sees: the reply plus one note per action so Nova knows what was saved, cancelled or still waiting. */
const forServer = (m: ChatMessage) => ({
  role: m.role,
  content: m.actions?.length ? `${m.content || '…'}\n\n${m.actions.map(actionNote).join('\n')}` : m.content || '…',
});

let cardSeq = 0;
const toCards = (cards: PlannedCard[], ids?: string[]): ActionCard[] | undefined =>
  cards.length ? cards.map((c, i) => ({ ...c, id: ids?.[i] ?? `c${Date.now()}-${cardSeq++}`, status: 'pending' })) : undefined;

/** A card re-planned in this reply (the user said "yes" in words) supersedes its earlier pending copy. */
function markReplaced(history: ChatMessage[], cards: PlannedCard[]): ChatMessage[] {
  const fps = new Set(cards.map((c) => c.fp));
  if (!fps.size) return history;
  return history.map((m) => (m.actions?.some((a) => fps.has(a.fp) && a.status === 'pending')
    ? { ...m, actions: m.actions.map((a) => (fps.has(a.fp) && a.status === 'pending' ? { ...a, status: 'replaced' as const } : a)) }
    : m));
}

function ActionCardView({ card, locked, onConfirm, onCancel }: { card: ActionCard; locked: boolean; onConfirm: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const tone: Record<ActionStatus, string> = {
    pending: 'ring-indigo-200 dark:ring-indigo-800 bg-indigo-50/60 dark:bg-indigo-950/30',
    running: 'ring-slate-200 dark:ring-slate-700 bg-white dark:bg-slate-800',
    done: 'ring-emerald-200 dark:ring-emerald-800 bg-emerald-50/60 dark:bg-emerald-950/30',
    failed: 'ring-rose-200 dark:ring-rose-800 bg-rose-50/60 dark:bg-rose-950/30',
    changed: 'ring-amber-200 dark:ring-amber-800 bg-amber-50/60 dark:bg-amber-950/30',
    cancelled: 'ring-slate-200 dark:ring-slate-700 bg-slate-50 dark:bg-slate-800/60 opacity-75',
    replaced: 'ring-slate-200 dark:ring-slate-700 bg-slate-50 dark:bg-slate-800/60 opacity-75',
  };
  return (
    <div className={cn('rounded-2xl ring-1 px-4 py-3 text-[13px] leading-relaxed', tone[card.status])}>
      <p className="font-bold text-slate-900 dark:text-white wrap-anywhere">{card.title}</p>
      <ul className="mt-1.5 space-y-1 text-slate-600 dark:text-slate-300">
        {card.lines.map((line, i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-[7px] w-1 h-1 rounded-full bg-slate-400 shrink-0" />
            <span className="min-w-0 wrap-anywhere">{line}</span>
          </li>
        ))}
      </ul>
      <div className="mt-2.5" aria-live="polite">
        {card.status === 'pending' ? (
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={onConfirm} disabled={locked} className="min-h-11 disabled:opacity-50 px-4 rounded-xl bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500">
              {t('advisor.actionConfirm')}
            </button>
            <button onClick={onCancel} disabled={locked} className="min-h-11 disabled:opacity-50 px-4 rounded-xl bg-white dark:bg-slate-800 ring-1 ring-slate-200 dark:ring-slate-600 text-sm font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-indigo-500">
              {t('advisor.actionCancel')}
            </button>
            <span className="text-xs text-slate-500 dark:text-slate-400 wrap-anywhere">{t('advisor.actionWaiting')}</span>
          </div>
        ) : (
          <p className={cn('flex items-center gap-1.5 text-xs font-bold wrap-anywhere', {
            'text-slate-500 dark:text-slate-400': card.status === 'running' || card.status === 'cancelled' || card.status === 'replaced',
            'text-emerald-700 dark:text-emerald-300': card.status === 'done',
            'text-rose-700 dark:text-rose-300': card.status === 'failed',
            'text-amber-700 dark:text-amber-300': card.status === 'changed',
          })}>
            {card.status === 'running' && <Loader2 className="w-3.5 h-3.5 shrink-0 motion-safe:animate-spin" />}
            {card.status === 'done' && <Check className="w-3.5 h-3.5 shrink-0" />}
            {(card.status === 'failed' || card.status === 'changed') && <AlertTriangle className="w-3.5 h-3.5 shrink-0" />}
            {(card.status === 'cancelled' || card.status === 'replaced') && <Ban className="w-3.5 h-3.5 shrink-0" />}
            {t(`advisor.action_${card.status}`)}
          </p>
        )}
      </div>
    </div>
  );
}

function TypingDots() {
  return (
    <span className="flex items-center gap-1 py-1" aria-hidden>
      {[0, 150, 300].map((d) => (
        <span key={d} className="w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-slate-500 motion-safe:animate-bounce" style={{ animationDelay: `${d}ms` }} />
      ))}
    </span>
  );
}

export function NovaChat() {
  const { t, lang } = useTranslation();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const send = useCallback(async (history: ChatMessage[], text: string) => {
    const content = text.trim().slice(0, MAX_USER_CHARS);
    if (!content) return;
    abortRef.current?.abort();
    const next: ChatMessage[] = [...history, { role: 'user', content }];
    setMessages([...next, { role: 'assistant', content: '' }]);
    setInput('');
    setError(null);
    setBusy(true);
    const ac = new AbortController();
    abortRef.current = ac;
    let answer = '';
    try {
      const res = await fetch('/api/advisor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // History is always odd-length and alternating, so the last MAX_TURNS (odd) still starts with a user turn.
        body: JSON.stringify({ messages: next.slice(-MAX_TURNS).map(forServer) }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        throw new Error(res.status === 503 ? 'advisor.notConfigured' : res.status === 429 ? 'advisor.rateLimited' : 'advisor.error');
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      // Only the reply being streamed is replaced (functional update), so a Confirm / Cancel
      // tapped on an older card meanwhile is never overwritten. This reply's cards stay locked
      // until the stream ends; each keeps one id from first appearance.
      const ids: string[] = [];
      const replaceLast = (msg: ChatMessage) => setMessages((list) => [...list.slice(0, -1), msg]);
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        answer += decoder.decode(value, { stream: true });
        const live = parseStream(answer.split(STREAM_ERROR_MARK)[0]);
        const cards = toCards(live.cards, ids);
        cards?.forEach((c, i) => { ids[i] = c.id; });
        replaceLast({ role: 'assistant', content: live.text, actions: cards });
      }
      // A server-side failure arrives as MARK + i18n key: show it as an error, never as a saved answer.
      const [raw, failKey] = answer.split(STREAM_ERROR_MARK);
      const { text, cards } = parseStream(raw);
      if (failKey && !cards.length) throw new Error(failKey.trim());
      if (!text.trim() && !cards.length) throw new Error('advisor.error');
      const actions = toCards(cards, ids);
      setMessages((list) => [...markReplaced(list.slice(0, -1), cards), { role: 'assistant', content: text.trim(), actions }]);
      if (failKey) setError(failKey.trim());
      // A clear simple action runs straight away; risky ones wait for Confirm.
      for (const a of actions ?? []) if (!a.needsConfirm) void runRef.current(a);
    } catch (err) {
      if (ac.signal.aborted) return;
      // Drop the failed exchange (the user turn + the reply) so the history stays alternating.
      setMessages((list) => list.slice(0, -2));
      setError(err instanceof Error && err.message.startsWith('advisor.') ? err.message : 'advisor.error');
    } finally {
      if (abortRef.current === ac) {
        abortRef.current = null;
        setBusy(false);
      }
    }
  }, []);

  const setStatus = useCallback((id: string, status: ActionStatus) => {
    setMessages((list) => list.map((m) => (m.actions?.some((a) => a.id === id)
      ? { ...m, actions: m.actions.map((a) => (a.id === id ? { ...a, status } : a)) }
      : m)));
  }, []);

  // Each card runs at most once per page load, whatever the render state says.
  const startedRef = useRef(new Set<string>());
  // Run one planned action through /api/advisor/execute (re-planned server-side; 409 = data changed since the card was shown).
  const runAction = useCallback(async (card: ActionCard) => {
    if (startedRef.current.has(card.id)) return;
    startedRef.current.add(card.id);
    setStatus(card.id, 'running');
    try {
      const res = await fetch('/api/advisor/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: card.tool, input: card.input, fp: card.fp }),
      });
      setStatus(card.id, res.ok ? 'done' : res.status === 409 ? 'changed' : 'failed');
    } catch {
      setStatus(card.id, 'failed');
    }
  }, [setStatus]);
  const runRef = useRef(runAction);
  useEffect(() => { runRef.current = runAction; }, [runAction]);

  const startFresh = useCallback(() => {
    abortRef.current?.abort();
    try { sessionStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
    setMessages([]);
    setError(null);
    setBusy(false);
  }, []);

  // Restore this session's chat (same language) once on mount — no request is made.
  // An action that was still running when the page went away has an unknown outcome: never re-run it blindly.
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(STORE_KEY) ?? 'null') as { lang: string; messages: ChatMessage[] } | null;
      if (saved?.lang === lang && Array.isArray(saved.messages) && saved.messages.length >= 2) {
        setMessages(saved.messages.map((m) => (m.actions
          ? { ...m, actions: m.actions.map((a, j) => ({ ...a, id: a.id || `r${j}-${a.fp}`, status: a.status === 'running' ? 'changed' as const : a.status })) }
          : m)));
      }
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, []);

  // Open from anywhere; Esc closes. The stream keeps running while closed.
  useEffect(() => {
    const onOpen = () => setOpen(true);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener(OPEN_NOVA_EVENT, onOpen);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener(OPEN_NOVA_EVENT, onOpen);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // Keep the finished chat (and each action's status) for this tab session.
  useEffect(() => {
    if (busy || messages.length < 2) return;
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify({ lang, messages })); } catch { /* ignore */ }
  }, [messages, busy, lang]);

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => { if (open) endRef.current?.scrollIntoView({ block: 'end' }); }, [messages, open]);
  useKeyboardViewport(open);
  // Auto-focus only where there's a physical keyboard: on phones it would pop the keyboard up over the welcome chips.
  useEffect(() => { if (open && window.matchMedia('(min-width: 768px)').matches) inputRef.current?.focus({ preventScroll: true }); }, [open]);
  // The visible area changes when the keyboard opens/closes — keep the latest message in view.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!open || !vv) return;
    const onResize = () => endRef.current?.scrollIntoView({ block: 'end' });
    vv.addEventListener('resize', onResize);
    return () => vv.removeEventListener('resize', onResize);
  }, [open]);

  const canSend = !busy && input.trim().length > 0;
  const empty = messages.length === 0;

  return (
    <>
      {/* Launcher */}
      <AnimatePresence>
        {!open && (
          <motion.button
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.6, opacity: 0 }}
            onClick={() => setOpen(true)}
            aria-label={t('advisor.openChat')}
            title={t('advisor.openChat')}
            className="fixed z-[55] right-4 bottom-[104px] md:right-6 md:bottom-6 flex items-center justify-center w-16 h-16 rounded-full bg-[#fff9ed] dark:bg-slate-800 shadow-lg shadow-slate-900/15 ring-1 ring-[#e6d6b5] dark:ring-slate-600 hover:bg-white dark:hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-500 tap-highlight-none"
          >
            <NovaFace reaction={busy ? 'sparkle' : 'blink'} size={56} />
            {busy && <span className="absolute top-0.5 right-0.5 w-3.5 h-3.5 rounded-full bg-emerald-400 ring-2 ring-white dark:ring-slate-800 motion-safe:animate-pulse" />}
          </motion.button>
        )}
      </AnimatePresence>

      {/* Panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label={t('advisor.title')}
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.98 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className={cn(
              'fixed z-[150] left-0 right-0 top-[var(--vvt,0px)] h-[var(--vvh,100dvh)] md:top-auto md:left-auto md:right-6 md:bottom-6 md:w-[400px] flex flex-col',
              // Desktop: hug the welcome content, then grow to a fixed height once chatting.
              empty ? 'md:h-auto md:max-h-[calc(100dvh-48px)]' : 'md:h-[min(560px,calc(100dvh-48px))]',
              'bg-white dark:bg-slate-900 md:rounded-3xl md:shadow-2xl md:shadow-slate-900/20 md:ring-1 md:ring-slate-200/80 md:dark:ring-slate-700 overflow-hidden',
            )}
          >
            {/* Header */}
            <div className="shrink-0 pt-safe bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2 px-4 py-3">
                <NovaFace reaction="blink" size={44} />
                <div className="flex-1 min-w-0">
                  <p className="font-display text-base font-extrabold leading-tight text-slate-900 dark:text-white wrap-anywhere">{t('advisor.title')}</p>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 wrap-anywhere">{t('advisor.subtitle')}</p>
                </div>
                {!empty && (
                  <button
                    onClick={startFresh}
                    aria-label={t('advisor.newChat')}
                    title={t('advisor.newChat')}
                    className="flex items-center justify-center w-11 h-11 shrink-0 rounded-full text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-indigo-500"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                )}
                <button
                  onClick={() => setOpen(false)}
                  aria-label={t('advisor.close')}
                  title={t('advisor.close')}
                  className="flex items-center justify-center w-11 h-11 shrink-0 rounded-full text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-indigo-500"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-5 space-y-5 bg-slate-50/80 dark:bg-slate-950/40" aria-live="polite">
              {empty && (
                <div className="pb-2">
                  <div className="flex items-center gap-3 rounded-3xl bg-[#f6e7c8]/40 dark:bg-[#f6e7c8]/5 p-4">
                    <NovaFace reaction="delighted" size={80} />
                    <p className="font-display text-lg leading-snug font-bold text-slate-800 dark:text-slate-100 wrap-anywhere">{t('advisor.welcome')}</p>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {CHIPS.map((k) => (
                      <button
                        key={k}
                        onClick={() => send([], t(k))}
                        className="min-h-11 max-w-full rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 px-3.5 py-2 text-[13px] font-medium text-slate-600 dark:text-slate-300 text-left wrap-anywhere hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800 dark:hover:border-emerald-700 dark:hover:bg-emerald-950 dark:hover:text-emerald-200 focus-visible:outline-2 focus-visible:outline-indigo-500 transition-colors"
                      >
                        {t(k)}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((m, i) =>
                m.role === 'user' ? (
                  <div key={i} className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl rounded-br-md bg-indigo-600 text-white px-4 py-3 text-[14px] leading-relaxed wrap-anywhere whitespace-pre-wrap shadow-sm">
                      {m.content}
                    </div>
                  </div>
                ) : (
                  <div key={i} className="flex items-start gap-2">
                    <NovaFace reaction={m.content || m.actions?.length ? 'blink' : 'sparkle'} size={32} />
                    <div className="min-w-0 max-w-[calc(100%_-_40px)] flex-1 space-y-2">
                      {(m.content || !m.actions?.length) && (
                        <div className="w-fit max-w-full rounded-2xl rounded-tl-md bg-white dark:bg-slate-800 ring-1 ring-slate-200/70 dark:ring-slate-700/70 px-4 py-3 text-[14px] leading-relaxed text-slate-700 dark:text-slate-200 wrap-anywhere shadow-sm [&_strong]:text-slate-900 dark:[&_strong]:text-white">
                          {m.content ? <Rich text={m.content} /> : <TypingDots />}
                        </div>
                      )}
                      {m.actions?.map((a) => (
                        <ActionCardView
                          key={a.id}
                          card={a}
                          locked={busy && i === messages.length - 1}
                          onConfirm={() => { if (a.status === 'pending') void runAction(a); }}
                          onCancel={() => { if (a.status === 'pending' && !startedRef.current.has(a.id)) setStatus(a.id, 'cancelled'); }}
                        />
                      ))}
                    </div>
                  </div>
                ),
              )}

              {error && (
                <div className="flex items-center gap-2 rounded-2xl bg-rose-50 dark:bg-rose-950/30 px-3 py-2">
                  <NovaFace reaction="dizzy" size={32} />
                  <p className="text-xs leading-relaxed font-medium text-rose-700 dark:text-rose-300 wrap-anywhere">{t(error)}</p>
                </div>
              )}
              <div ref={endRef} />
            </div>

            {/* Composer */}
            <div className="nf-chat-composer shrink-0 pb-safe bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800">
              <div className="p-3">
                <form
                  onSubmit={(e) => { e.preventDefault(); if (canSend) send(messages, input); }}
                  className="flex items-end gap-2 rounded-2xl bg-slate-50 dark:bg-slate-800 p-1.5 ring-1 ring-slate-200 dark:ring-slate-700 focus-within:ring-2 focus-within:ring-indigo-500/60 transition-shadow"
                >
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        if (canSend) send(messages, input);
                      }
                    }}
                    maxLength={MAX_USER_CHARS}
                    rows={1}
                    placeholder={t('advisor.placeholder')}
                    aria-label={t('advisor.placeholder')}
                    className="flex-1 min-w-0 min-h-11 resize-none rounded-xl bg-transparent px-2.5 py-2.5 text-base md:text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:outline-none max-h-32"
                  />
                  <button
                    type="submit"
                    disabled={!canSend}
                    aria-label={t('advisor.send')}
                    className={cn(
                      'shrink-0 flex items-center justify-center w-11 h-11 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 transition-colors',
                      canSend
                        ? 'bg-indigo-600 text-white shadow-sm hover:bg-indigo-700'
                        : 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400',
                    )}
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </form>
                <p className="mt-2 px-2 text-center text-[10px] leading-relaxed text-slate-500 dark:text-slate-400 wrap-anywhere">{t('advisor.disclaimer')}</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
