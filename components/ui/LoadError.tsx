'use client';
import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useTranslation } from '@/lib/i18n/context';

/**
 * Shared "couldn't load" state with a retry button — replaces the copy that was
 * hand-rolled on Funding/Reports/Transactions and is now also used by the pages
 * that previously spun forever when a read failed.
 */
export function LoadError({ title, body, onRetry }: { title?: string; body?: string; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div role="alert" className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-14 h-14 rounded-full bg-rose-50 dark:bg-rose-900/30 flex items-center justify-center mb-4">
        <AlertCircle className="w-7 h-7 text-rose-400" />
      </div>
      <p className="text-slate-700 dark:text-slate-300 font-bold text-base mb-1">{title ?? t('common.loadErrorTitle')}</p>
      {body !== '' && (
        <p className="text-slate-500 dark:text-slate-400 text-sm">{body ?? t('common.loadErrorBody')}</p>
      )}
      <Button variant="secondary" onClick={onRetry} className="mt-5">{t('common.tryAgain')}</Button>
    </div>
  );
}
