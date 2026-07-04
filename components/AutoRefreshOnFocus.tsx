'use client';
import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';

/**
 * Invisible companion for server-rendered pages (the dashboard): re-runs the
 * RSC render on the same cadence client pages use (60s interval + tab-focus via
 * useAutoRefresh), so a dashboard left open keeps its numbers moving instead of
 * freezing until the next navigation. Server-side the dashboard payload is
 * cached (~45s TTL), so these refreshes are cheap and Sheets-quota-safe.
 */
export function AutoRefreshOnFocus({ intervalMs }: { intervalMs?: number }) {
  const router = useRouter();
  const refresh = useCallback(() => router.refresh(), [router]);
  useAutoRefresh(refresh, intervalMs);
  return null;
}
