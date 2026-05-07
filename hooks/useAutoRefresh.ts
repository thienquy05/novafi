import { useEffect } from 'react';

export function useAutoRefresh(load: () => void, intervalMs = 30_000) {
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
