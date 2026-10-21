'use client';
import { useCallback, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { useTranslation } from '@/lib/i18n/context';

/**
 * Pull-to-refresh gesture + its floating pill, shared by every page (it was
 * copy-pasted into five pages, two with hard-coded English). Without `onRefresh`
 * it re-renders the server page (dashboard) and spins until that finishes.
 */
export function PullToRefresh({ onRefresh }: { onRefresh?: () => Promise<void> | void }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const refresh = useCallback(
    () => (onRefresh ? onRefresh() : startTransition(() => router.refresh())),
    [onRefresh, router],
  );
  const { pullY, refreshing } = usePullToRefresh(refresh);
  const busy = refreshing || isPending;
  if (pullY <= 0 && !busy) return null;
  return (
    <div className="fixed top-0 left-0 right-0 z-50 flex justify-center pt-safe" role="status" aria-live="polite">
      <div className="flex items-center gap-2 bg-indigo-600 text-white text-xs font-bold px-4 py-2 rounded-full shadow-lg mt-2">
        <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} style={!busy ? { transform: `rotate(${pullY * 180}deg)` } : undefined} />
        {busy ? t('common.refreshing') : pullY >= 1 ? t('common.releaseToRefresh') : t('common.pullToRefresh')}
      </div>
    </div>
  );
}
