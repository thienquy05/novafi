'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { Bell, Check, X, AlertTriangle, CreditCard, Calendar, PiggyBank, Wallet, type LucideIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n/context';
import { NOTIFICATIONS_CACHE_KEY, NOTIFICATIONS_INVALID_EVENT } from '@/lib/client/store';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
import type { NotificationItem, NotificationType } from '@/lib/notifications';

// Read/dismissed state is intentionally device-local (localStorage) — these are
// ephemeral derived warnings, not user data worth syncing through Sheets. A
// notification's id is stable (derived from what it warns about), so marking it
// read/deleted survives reloads; when the underlying problem is resolved its id
// stops being produced and we prune it from the persisted sets.
// sessionStorage key throttles refetch; the global write-guard in
// lib/client/store clears it (and fires NOTIFICATIONS_INVALID_EVENT) after
// every successful API write so new warnings surface without a reload.
const CACHE_KEY = NOTIFICATIONS_CACHE_KEY;
const CACHE_TTL_MS = 2 * 60 * 1000;
const READ_KEY = 'nf_notif_read';
const DELETED_KEY = 'nf_notif_deleted';
const SYNC_EVENT = 'nf-notif-change'; // keeps the mobile + desktop bells in step

function readIdSet(key: string): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(key);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function writeIdSet(key: string, set: Set<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...set]));
  } catch {
    /* localStorage unavailable */
  }
}

const TYPE_ICON: Record<NotificationType, LucideIcon> = {
  overdraft: Wallet,
  bill: Calendar,
  budget: AlertTriangle,
  credit: CreditCard,
  savings: PiggyBank,
};

// Mirror the unread count onto the PWA app icon (Badging API) so the number is
// visible OUTSIDE the web app on an installed home-screen icon. No-ops where the
// API is unsupported.
function setAppBadge(count: number): void {
  if (typeof navigator === 'undefined') return;
  const nav = navigator as Navigator & {
    setAppBadge?: (n?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  try {
    if (count > 0) nav.setAppBadge?.(count).catch(() => {});
    else nav.clearAppBadge?.().catch(() => {});
  } catch {
    /* Badging API unavailable */
  }
}

export function NotificationBell({ className }: { className?: string }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [read, setRead] = useState<Set<string>>(() => readIdSet(READ_KEY));
  const [deleted, setDeleted] = useState<Set<string>>(() => readIdSet(DELETED_KEY));
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  // Track unmount so late fetch responses never set state on a dead component.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const apply = useCallback((list: NotificationItem[]) => {
    if (!mountedRef.current) return;
    setItems(list);
    // Drop persisted ids that no longer correspond to a live warning.
    const live = new Set(list.map((n) => n.id));
    setRead((prev) => {
      const next = new Set([...prev].filter((id) => live.has(id)));
      writeIdSet(READ_KEY, next);
      return next;
    });
    setDeleted((prev) => {
      const next = new Set([...prev].filter((id) => live.has(id)));
      writeIdSet(DELETED_KEY, next);
      return next;
    });
  }, []);

  const refresh = useCallback(() => {
    fetch('/api/notifications')
      .then((r) => r.json())
      .then((d: { notifications?: NotificationItem[] }) => {
        const list = d.notifications ?? [];
        apply(list);
        try {
          sessionStorage.setItem(CACHE_KEY, JSON.stringify({ data: list, ts: Date.now() }));
        } catch {
          /* ignore */
        }
      })
      .catch(() => {});
  }, [apply]);

  // Initial load: serve the sessionStorage cache when fresh, else fetch.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(CACHE_KEY);
      if (raw) {
        const { data, ts } = JSON.parse(raw) as { data: NotificationItem[]; ts: number };
        if (Date.now() - ts < CACHE_TTL_MS) {
          apply(data);
          return;
        }
      }
    } catch {
      /* sessionStorage unavailable */
    }
    refresh();
  }, [apply, refresh]);

  // Refetch when any API write lands (global guard event) and in the background
  // (60s interval + tab-focus) — warnings update without a page reload.
  useEffect(() => {
    window.addEventListener(NOTIFICATIONS_INVALID_EVENT, refresh);
    return () => window.removeEventListener(NOTIFICATIONS_INVALID_EVENT, refresh);
  }, [refresh]);
  useAutoRefresh(refresh);

  // Sync read/deleted across bell instances (mobile header + desktop sidebar both
  // mount) and across tabs.
  useEffect(() => {
    const sync = () => {
      setRead(readIdSet(READ_KEY));
      setDeleted(readIdSet(DELETED_KEY));
    };
    window.addEventListener(SYNC_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(SYNC_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  // Close on outside click / tap.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || btnRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [open]);

  const visible = items.filter((n) => !deleted.has(n.id));
  const unread = visible.filter((n) => !read.has(n.id)).length;

  // Keep the PWA app-icon badge in step with the unread count.
  useEffect(() => { setAppBadge(unread); }, [unread]);

  const markRead = useCallback((id: string) => {
    setRead((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev).add(id);
      writeIdSet(READ_KEY, next);
      window.dispatchEvent(new Event(SYNC_EVENT));
      return next;
    });
  }, []);

  const markAllRead = useCallback(() => {
    setRead((prev) => {
      const next = new Set(prev);
      for (const n of visible) next.add(n.id);
      writeIdSet(READ_KEY, next);
      window.dispatchEvent(new Event(SYNC_EVENT));
      return next;
    });
  }, [visible]);

  const removeOne = useCallback((id: string) => {
    setDeleted((prev) => {
      const next = new Set(prev).add(id);
      writeIdSet(DELETED_KEY, next);
      window.dispatchEvent(new Event(SYNC_EVENT));
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    setDeleted((prev) => {
      const next = new Set(prev);
      for (const n of visible) next.add(n.id);
      writeIdSet(DELETED_KEY, next);
      window.dispatchEvent(new Event(SYNC_EVENT));
      return next;
    });
  }, [visible]);

  return (
    <div className={cn('relative', className)}>
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        aria-label={t('notifications.title')}
        className="relative flex items-center justify-center w-9 h-9 rounded-xl text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors tap-highlight-none select-none"
      >
        <Bell className="w-5 h-5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-rose-500 text-white text-[9px] font-extrabold rounded-full min-w-[16px] h-[16px] flex items-center justify-center px-1 leading-none">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          // Positioning lives on this wrapper so framer-motion's transform
          // animation (below) doesn't clobber the mobile -translate-x centering.
          // Mobile: fixed + horizontally centered under the header so the panel
          // never clips the viewport edge. Desktop: anchored to the bell, opening
          // down and to the right (the bell sits near the sidebar's right edge,
          // so opening rightward keeps it fully on-screen).
          <div
            ref={panelRef}
            className="fixed left-1/2 -translate-x-1/2 top-[76px] w-[92vw] max-w-[380px] z-[60] md:absolute md:left-0 md:right-auto md:translate-x-0 md:top-full md:mt-2 md:w-[380px]"
          >
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.16 }}
            className="max-h-[70vh] flex flex-col bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl shadow-slate-400/20 dark:shadow-black/40 overflow-hidden"
          >
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-slate-100 dark:border-slate-700/60">
              <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
                {t('notifications.title')}
                {unread > 0 && <span className="ml-1.5 text-rose-500">{unread}</span>}
              </p>
              {visible.length > 0 && (
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={markAllRead}
                    disabled={unread === 0}
                    className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-40 disabled:no-underline tap-highlight-none"
                  >
                    {t('notifications.markAllRead')}
                  </button>
                  <button
                    onClick={clearAll}
                    className="text-xs font-semibold text-slate-400 dark:text-slate-500 hover:text-rose-500 dark:hover:text-rose-400 tap-highlight-none"
                  >
                    {t('notifications.clearAll')}
                  </button>
                </div>
              )}
            </div>

            <div className="overflow-y-auto">
              {visible.length === 0 ? (
                <div className="px-4 py-10 flex flex-col items-center text-center gap-2">
                  <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-700/40">
                    <Bell className="w-6 h-6 text-slate-300 dark:text-slate-500" />
                  </div>
                  <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">{t('notifications.empty')}</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500">{t('notifications.emptyHint')}</p>
                </div>
              ) : (
                visible.map((n) => {
                  const Icon = TYPE_ICON[n.type];
                  const isRead = read.has(n.id);
                  return (
                    <div
                      key={n.id}
                      className={cn(
                        'group flex items-start gap-3 px-4 py-3 border-b last:border-b-0 border-slate-50 dark:border-slate-700/40 transition-colors',
                        !isRead && 'bg-indigo-50/40 dark:bg-indigo-900/10',
                      )}
                    >
                      <div
                        className={cn(
                          'mt-0.5 p-1.5 rounded-lg shrink-0',
                          n.severity === 'critical'
                            ? 'bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-300'
                            : n.severity === 'warning'
                              ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-300'
                              : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300',
                        )}
                      >
                        <Icon className="w-4 h-4" />
                      </div>
                      <Link
                        href={n.href}
                        onClick={() => { markRead(n.id); setOpen(false); }}
                        className="flex-1 min-w-0"
                      >
                        <p className={cn('text-sm font-bold truncate', isRead ? 'text-slate-500 dark:text-slate-400' : 'text-slate-900 dark:text-slate-100')}>
                          {n.title}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">{n.body}</p>
                      </Link>
                      <div className="flex items-center gap-0.5 shrink-0">
                        {!isRead && (
                          <button
                            onClick={() => markRead(n.id)}
                            aria-label={t('notifications.markRead')}
                            title={t('notifications.markRead')}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-slate-100 dark:hover:bg-slate-700 tap-highlight-none"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => removeOne(n.id)}
                          aria-label={t('notifications.delete')}
                          title={t('notifications.delete')}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-slate-100 dark:hover:bg-slate-700 tap-highlight-none"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
