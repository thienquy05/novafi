import { useEffect } from 'react';

// Default 60s: a background re-sync to catch edits made elsewhere (other tabs/
// devices). Paired with the on-visibility refetch below, which covers the common
// "came back to the tab" case immediately — so the interval can be relaxed to
// halve steady-state Google Sheets load without hurting perceived freshness.
export function useAutoRefresh(load: () => void, intervalMs = 60_000) {
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    const interval = setInterval(load, intervalMs);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(interval);
    };
  }, [load, intervalMs]);
}
