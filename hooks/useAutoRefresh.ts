import { useEffect, useRef } from 'react';
import { DATA_CHANGED_EVENT } from '@/lib/client/store';

// Keeps a view in sync with the shared data:
//  - immediately (debounced) after ANY successful write anywhere in the app —
//    the global fetch guard in lib/client/store.ts fires DATA_CHANGED_EVENT, so
//    adding a transaction from the nav "+" updates the Bills page, Home, the
//    badges and the bell without a manual reload;
//  - when the tab becomes visible again (edits made on another device/tab);
//  - every `intervalMs` while the tab is visible (background re-sync).
// `load` is read through a ref: callers pass inline arrows (`() => load(true)`),
// and depending on that identity used to tear down and restart the interval on
// every render, so on an active page the background refresh could never fire.
// `enabled` lets a view (e.g. a closed modal) opt out without breaking hook order.
export function useAutoRefresh(load: () => void, intervalMs = 60_000, enabled = true) {
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; });

  useEffect(() => {
    if (!enabled) return;
    const run = () => loadRef.current();
    let debounce: ReturnType<typeof setTimeout> | undefined;
    // A single user action can issue several writes (e.g. a split + its
    // transactions); collapse them into one refresh.
    const onDataChanged = () => {
      clearTimeout(debounce);
      debounce = setTimeout(run, 250);
    };
    const onVisible = () => { if (document.visibilityState === 'visible') run(); };
    // Skip background polls while hidden — saves Sheets quota; the visibility
    // listener catches up the moment the tab returns.
    const interval = setInterval(() => { if (document.visibilityState === 'visible') run(); }, intervalMs);
    window.addEventListener(DATA_CHANGED_EVENT, onDataChanged);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(debounce);
      clearInterval(interval);
      window.removeEventListener(DATA_CHANGED_EVENT, onDataChanged);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [intervalMs, enabled]);
}
