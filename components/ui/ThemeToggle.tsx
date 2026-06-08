'use client';
import { useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n/context';

/**
 * A compact sun/moon switch that flips the `.dark` class on <html> and persists
 * the choice to localStorage (`nf_theme`) — the same key the pre-paint script in
 * app/layout.tsx reads to avoid a flash. Lives in the page header so the toggle
 * is one tap away instead of buried in Settings; both stay in sync because they
 * read/write the same source of truth.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { t } = useTranslation();
  // Start undefined so SSR and the first client paint agree (the inline script
  // has already applied the class); we resolve the real value after mount.
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
  }, []);

  function toggle() {
    const next = !document.documentElement.classList.contains('dark');
    setDark(next);
    try {
      document.documentElement.classList.toggle('dark', next);
      localStorage.setItem('nf_theme', next ? 'dark' : 'light');
    } catch { /* localStorage unavailable */ }
  }

  const isDark = dark ?? false;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={t('nav.toggleTheme')}
      aria-pressed={isDark}
      title={t('nav.toggleTheme')}
      className={cn(
        'relative grid place-items-center w-10 h-10 rounded-xl border shadow-sm overflow-hidden transition-colors',
        'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700',
        'text-slate-500 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400',
        'hover:border-indigo-200 dark:hover:border-indigo-800/60 tap-highlight-none select-none',
        'focus:outline-none focus:ring-2 focus:ring-indigo-300 dark:focus:ring-indigo-700',
        className,
      )}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={isDark ? 'moon' : 'sun'}
          initial={{ y: 12, opacity: 0, rotate: -30 }}
          animate={{ y: 0, opacity: 1, rotate: 0 }}
          exit={{ y: -12, opacity: 0, rotate: 30 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          className="absolute inset-0 grid place-items-center"
        >
          {isDark ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}
