'use client';
import { useEffect, useRef, useState, useCallback } from 'react';

const PULL_THRESHOLD = 72; // px to trigger refresh

export function usePullToRefresh(onRefresh: () => Promise<void> | void) {
  const startY = useRef(0);
  const [pullY, setPullY] = useState(0); // 0–1 progress
  const [refreshing, setRefreshing] = useState(false);
  const active = useRef(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setPullY(0);
    try { await onRefresh(); } finally { setRefreshing(false); }
  }, [onRefresh]);

  useEffect(() => {
    const onTouchStart = (e: TouchEvent) => {
      if (window.scrollY === 0) {
        startY.current = e.touches[0].clientY;
        active.current = true;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!active.current) return;
      const dy = e.touches[0].clientY - startY.current;
      if (dy > 0) setPullY(Math.min(dy / PULL_THRESHOLD, 1));
    };

    const onTouchEnd = async () => {
      if (!active.current) return;
      active.current = false;
      if (pullY >= 1 && !refreshing) {
        await refresh();
      } else {
        setPullY(0);
      }
    };

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd);
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, [pullY, refreshing, refresh]);

  return { pullY, refreshing };
}
