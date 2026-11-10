'use client';
import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/context';
import { DATA_CHANGED_EVENT } from '@/lib/client/store';
import { NovaFace } from '@/components/NovaFace';
import { OPEN_NOVA_EVENT } from '@/components/NovaChat';
import type { SmartText, TipPage } from '@/lib/ai/shared';
import type { Language } from '@/types';

// Claude-written smart text (/api/ai/insights): one fetch per write + language,
// shared by every <NovaTip/> and the Money Flow modal. Empty = AI off/failed.

const KEY = 'nf_smarttext_v1';
// No timer: a good copy is kept until a write (DATA_CHANGED_EVENT) or a language
// change; the server then decides whether the change is material enough to regenerate.
const EMPTY_RETRY_MS = 5 * 60 * 1000; // retry a failed/disabled result

let inflight: { lang: Language; promise: Promise<SmartText> } | null = null;
// Bumped on every write so a request that started before it can't repopulate the cache.
let generation = 0;

function loadSmartText(lang: Language): Promise<SmartText> {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) {
      const c = JSON.parse(raw) as { lang: Language; ts: number; data: SmartText };
      const ok = Object.keys(c.data).length > 0 || Date.now() - c.ts < EMPTY_RETRY_MS;
      if (c.lang === lang && ok) return Promise.resolve(c.data);
    }
  } catch {
    /* sessionStorage unavailable */
  }
  if (inflight?.lang === lang) return inflight.promise;
  const gen = generation;
  const promise = fetch('/api/ai/insights')
    .then((r) => (r.ok ? (r.json() as Promise<SmartText>) : {}))
    .catch((): SmartText => ({}))
    .then((data) => {
      if (gen === generation) {
        try { sessionStorage.setItem(KEY, JSON.stringify({ lang, ts: Date.now(), data })); } catch { /* ignore */ }
      }
      return data;
    })
    .finally(() => { if (inflight?.promise === promise) inflight = null; });
  inflight = { lang, promise };
  return promise;
}

export function useSmartText(enabled = true): SmartText | null {
  const { lang } = useTranslation();
  const [data, setData] = useState<SmartText | null>(null);
  const [version, setVersion] = useState(generation);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    loadSmartText(lang).then((d) => { if (live) setData(d); });
    return () => { live = false; };
  }, [lang, enabled, version]);

  // A write changes the numbers — drop the cached copy and reload mounted consumers.
  useEffect(() => {
    const onWrite = () => {
      generation += 1;
      inflight = null;
      try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
      setVersion(generation);
    };
    window.addEventListener(DATA_CHANGED_EVENT, onWrite);
    return () => window.removeEventListener(DATA_CHANGED_EVENT, onWrite);
  }, []);

  return data;
}

export function NovaTip({ page }: { page: TipPage }) {
  const { t } = useTranslation();
  const tip = useSmartText()?.tips?.[page];
  if (!tip) return null;
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-indigo-100 dark:border-indigo-800/50 bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-900/30 dark:to-purple-900/20 px-4 py-3">
      <NovaFace reaction="blink" size={36} />
      <div className="flex-1 min-w-0">
        <p className="text-sm leading-snug text-slate-700 dark:text-slate-200">
          <span className="font-bold text-indigo-700 dark:text-indigo-300">{t('advisor.tipLabel')} · </span>
          {tip}
        </p>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event(OPEN_NOVA_EVENT))}
          className="inline-flex items-center gap-0.5 mt-1 text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline"
        >
          {t('advisor.askNova')}
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
