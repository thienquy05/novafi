'use client';
import { useEffect, useState } from 'react';
import { Download, X, Share } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from '@/lib/i18n/context';

const DISMISS_KEY = 'nf_pwa_dismissed';

// Chrome/Edge fire `beforeinstallprompt`; this captures the deferred prompt so
// we can trigger it from our own button instead of relying on the browser's UI.
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

/**
 * Registers the service worker and shows a tasteful, dismissible "Install"
 * banner. On Chromium it wires up the native install flow; on iOS Safari (which
 * has no programmatic install) it shows the Share → Add to Home Screen hint.
 * Renders nothing once installed (standalone) or after the user dismisses it.
 */
export function PWA() {
  const { t } = useTranslation();
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [show, setShow] = useState(false);

  // Register the service worker (production only — avoids stale caches in dev).
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
  }, []);

  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      // iOS Safari exposes this non-standard flag when launched from home screen.
      (navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone) return;

    let dismissed = false;
    try { dismissed = localStorage.getItem(DISMISS_KEY) === '1'; } catch { /* ignore */ }
    if (dismissed) return;

    const ios = /i+(Pad|Phone|Pod)/i.test(navigator.userAgent) ||
      // iPadOS 13+ reports as Mac; detect touch to disambiguate.
      (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
    setIsIOS(ios);

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setShow(true);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);

    // iOS never fires beforeinstallprompt, so surface the hint directly.
    if (ios) setShow(true);

    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  function dismiss() {
    setShow(false);
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ }
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
    dismiss();
  }

  if (!show) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 80, opacity: 0 }}
        transition={{ type: 'spring', bounce: 0.18, duration: 0.45 }}
        // Sits above the mobile bottom nav (which is ~64px + safe area).
        className="fixed left-3 right-3 bottom-[84px] md:left-auto md:right-6 md:bottom-6 md:w-96 z-[60]"
      >
        <div className="flex items-start gap-3 rounded-2xl bg-white/95 dark:bg-slate-800/95 backdrop-blur-xl border border-slate-200 dark:border-slate-700 shadow-[0_20px_60px_rgba(15,23,42,0.18)] p-4">
          <div className="shrink-0 w-11 h-11 rounded-xl overflow-hidden shadow-sm">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon-192.png" alt="NovaFi" className="w-full h-full object-cover" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{t('pwa.installTitle')}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
              {isIOS ? (
                <span className="inline-flex items-center gap-1 flex-wrap">
                  {t('pwa.iosHint')}
                  <Share className="w-3.5 h-3.5 inline-block shrink-0" />
                </span>
              ) : (
                t('pwa.installBody')
              )}
            </p>
            {!isIOS && (
              <div className="flex gap-2 mt-3">
                <button
                  onClick={install}
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 px-3.5 py-2 rounded-xl transition-colors tap-highlight-none"
                >
                  <Download className="w-3.5 h-3.5" />
                  {t('pwa.install')}
                </button>
                <button
                  onClick={dismiss}
                  className="text-xs font-bold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 px-3 py-2 rounded-xl transition-colors tap-highlight-none"
                >
                  {t('pwa.later')}
                </button>
              </div>
            )}
          </div>
          <button
            onClick={dismiss}
            aria-label={t('pwa.later')}
            className="shrink-0 -mt-1 -mr-1 p-1.5 rounded-lg text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors tap-highlight-none"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
