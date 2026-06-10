'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';
import {
  LayoutDashboard,
  DollarSign,
  ArrowLeftRight,
  Settings,
  LogOut,
  Landmark,
  PiggyBank,
  Calendar,
  BarChart3,
  CreditCard,
  FileText,
  MoreHorizontal,
  X,
  ChevronUp,
  ChevronDown,
  Sliders,
  HandCoins,
  type LucideIcon,
} from 'lucide-react';
import { signOut } from 'next-auth/react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { LogoMark } from './LogoMark';
import { ThemeToggle } from './ui/ThemeToggle';
import { QuickAddTransaction } from '@/app/(app)/dashboard/QuickAddTransaction';
import { useTranslation } from '@/lib/i18n/context';

type BadgeCounts = { overdueBills: number; overBudget: number; creditAlerts: number };

// Bumped to v2 when creditAlerts was added — invalidates older cached payloads
// that lack the field so the new badge appears without waiting out the TTL.
const BADGES_CACHE_KEY = 'nf_badges_cache_v2';
const BADGES_TTL_MS = 2 * 60 * 1000;

function useBadges(): BadgeCounts {
  const [badges, setBadges] = useState<BadgeCounts>({ overdueBills: 0, overBudget: 0, creditAlerts: 0 });
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(BADGES_CACHE_KEY);
      if (raw) {
        const { data, ts } = JSON.parse(raw) as { data: BadgeCounts; ts: number };
        if (Date.now() - ts < BADGES_TTL_MS) {
          setBadges(data);
          return;
        }
      }
    } catch { /* sessionStorage unavailable */ }

    fetch('/api/badges')
      .then((r) => r.json())
      .then((data: BadgeCounts) => {
        setBadges(data);
        try {
          sessionStorage.setItem(BADGES_CACHE_KEY, JSON.stringify({ data, ts: Date.now() }));
        } catch { /* ignore */ }
      })
      .catch(() => {});
  }, []);
  return badges;
}

function NavBadge({ count, tone = 'red' }: { count: number; tone?: 'red' | 'amber' }) {
  if (count === 0) return null;
  return (
    <span
      className={cn(
        'ml-auto text-white text-[10px] font-extrabold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 leading-none',
        tone === 'red' ? 'bg-rose-500' : 'bg-amber-500'
      )}
    >
      {count > 9 ? '9+' : count}
    </span>
  );
}

type NavItem = { href: string; labelKey: string; icon: LucideIcon; badgeKey: keyof BadgeCounts | null };

// Desktop sidebar: items grouped under subtle section labels (Settings is pinned
// separately at the bottom). 1 click to anything — these are visual dividers, not
// collapsible accordions.
const NAV_GROUPS: { labelKey: string; items: NavItem[] }[] = [
  {
    labelKey: 'nav.groupOverview',
    items: [
      { href: '/dashboard', labelKey: 'nav.dashboard', icon: LayoutDashboard, badgeKey: null },
      { href: '/reports',   labelKey: 'nav.reports',   icon: FileText,        badgeKey: null },
    ],
  },
  {
    labelKey: 'nav.groupMoney',
    items: [
      { href: '/accounts',     labelKey: 'nav.accounts',     icon: Landmark,       badgeKey: null },
      { href: '/transactions', labelKey: 'nav.transactions', icon: ArrowLeftRight, badgeKey: null },
      { href: '/credit',       labelKey: 'nav.credit',       icon: CreditCard,     badgeKey: 'creditAlerts' },
      { href: '/funding',      labelKey: 'nav.funding',      icon: HandCoins,      badgeKey: null },
      { href: '/paychecks',    labelKey: 'nav.paychecks',    icon: DollarSign,     badgeKey: null },
    ],
  },
  {
    labelKey: 'nav.groupPlan',
    items: [
      { href: '/savings',  labelKey: 'nav.savings',  icon: PiggyBank, badgeKey: null },
      { href: '/bills',    labelKey: 'nav.bills',    icon: Calendar,  badgeKey: 'overdueBills' },
      { href: '/planning', labelKey: 'nav.planning', icon: BarChart3, badgeKey: 'overBudget' },
    ],
  },
];

const SETTINGS_ITEM: NavItem = { href: '/settings', labelKey: 'nav.settings', icon: Settings, badgeKey: null };

// Which group each route belongs to — used to label items in the mobile "More" sheet.
type GroupKey = 'overview' | 'money' | 'plan' | 'system';
const NAV_GROUP_OF: Record<string, GroupKey> = {
  '/dashboard': 'overview', '/reports': 'overview',
  '/accounts': 'money', '/transactions': 'money', '/credit': 'money', '/funding': 'money', '/paychecks': 'money',
  '/savings': 'plan', '/bills': 'plan', '/planning': 'plan',
  '/settings': 'system',
};
const MORE_GROUPS: { key: GroupKey; labelKey: string }[] = [
  { key: 'overview', labelKey: 'nav.groupOverview' },
  { key: 'money', labelKey: 'nav.groupMoney' },
  { key: 'plan', labelKey: 'nav.groupPlan' },
  { key: 'system', labelKey: 'nav.groupSystem' },
];

export function Sidebar() {
  const path = usePathname();
  const badges = useBadges();
  const { t } = useTranslation();
  const [hovered, setHovered] = useState<string | null>(null);

  const renderLink = ({ href, labelKey, icon: Icon, badgeKey }: NavItem) => {
    const active = path === href || path.startsWith(href + '/');
    const badgeCount = badgeKey ? badges[badgeKey] : 0;
    return (
      <Link
        key={href}
        href={href}
        onMouseEnter={() => setHovered(href)}
        className={cn(
          'relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors duration-150 group overflow-hidden tap-highlight-none select-none',
          active
            ? 'text-indigo-600 dark:text-indigo-400'
            : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
        )}
      >
        {/* Gliding hover pill — floats to whichever non-active item the pointer
            is over, sitting under the active indigo pill. */}
        {hovered === href && !active && (
          <motion.div
            layoutId="sidebar-hover"
            className="absolute inset-0 bg-slate-100 dark:bg-slate-800/70 rounded-xl"
            initial={false}
            transition={{ type: 'spring', bounce: 0.2, duration: 0.4 }}
          />
        )}
        {active && (
          <motion.div
            layoutId="sidebar-active"
            className="absolute inset-0 bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-100 dark:border-indigo-800/50 rounded-xl"
            initial={false}
            transition={{ type: 'spring', bounce: 0.15, duration: 0.35 }}
          />
        )}
        <Icon className={cn('w-5 h-5 shrink-0 relative z-10 transition-colors duration-150', active ? 'text-indigo-600 dark:text-indigo-400' : 'group-hover:text-slate-900 dark:group-hover:text-slate-100')} />
        <span className="relative z-10 flex-1">{t(labelKey)}</span>
        {badgeCount > 0 && (
          <NavBadge count={badgeCount} tone={badgeKey === 'overdueBills' ? 'red' : 'amber'} />
        )}
      </Link>
    );
  };

  return (
    <aside className="hidden md:flex flex-col w-64 h-[calc(100vh-1.5rem)] sticky top-3 m-3 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border border-slate-200/80 dark:border-slate-700/50 rounded-3xl shadow-xl shadow-slate-300/30 dark:shadow-black/40 px-4 py-6 shrink-0 z-50">
      {/* Logo */}
      <div className="flex items-center gap-3 px-2 mb-5">
        <div className="relative">
          <div className="absolute inset-0 bg-indigo-500 rounded-xl blur opacity-30" />
          <LogoMark className="relative w-10 h-10 rounded-xl shadow-lg" />
        </div>
        <div className="min-w-0">
          <p className="text-slate-900 dark:text-white font-bold text-lg tracking-tight leading-none">Nova<span className="text-gradient">Fi</span></p>
          <p className="text-slate-500 dark:text-slate-400 text-xs font-medium mt-1">{t('nav.wealthManagement')}</p>
        </div>
        <ThemeToggle className="ml-auto shrink-0 w-9 h-9" />
      </div>

      {/* Primary action */}
      <div className="mb-4">
        <QuickAddTransaction variant="sidebar" />
      </div>

      {/* Grouped nav — scrolls only if the viewport is too short to fit everything */}
      <nav className="flex flex-col flex-1 overflow-y-auto hide-scrollbar -mx-1 px-1" onMouseLeave={() => setHovered(null)}>
        {NAV_GROUPS.map((group) => (
          <div key={group.labelKey} className="mb-2">
            <p className="px-3 pt-2 pb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">{t(group.labelKey)}</p>
            <div className="flex flex-col gap-1">
              {group.items.map(renderLink)}
            </div>
          </div>
        ))}
      </nav>

      {/* Settings + Sign out (pinned to the bottom) */}
      <div className="pt-3 mt-2 border-t border-slate-100 dark:border-slate-700/50 flex flex-col gap-1">
        {renderLink(SETTINGS_ITEM)}
        <button
          onClick={() => signOut({ callbackUrl: '/' })}
          className="group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors duration-150 tap-highlight-none select-none"
        >
          <LogOut className="w-5 h-5 shrink-0 group-hover:scale-110 transition-transform duration-150" />
          {t('nav.signOut')}
        </button>
      </div>
    </aside>
  );
}

export function MobileHeader() {
  return (
    <header className="md:hidden flex items-center justify-between px-4 py-3 bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl border border-slate-200 dark:border-slate-700/50 rounded-2xl shadow-lg shadow-slate-300/30 dark:shadow-black/30 mx-3 mt-3 sticky top-3 z-40">
      <div className="flex items-center gap-3">
        <LogoMark className="w-9 h-9 rounded-xl shadow-md" />
        <p className="text-slate-900 dark:text-white font-bold text-xl tracking-tight leading-none">Nova<span className="text-gradient">Fi</span></p>
      </div>
      <ThemeToggle className="shrink-0 w-9 h-9" />
    </header>
  );
}

const MOBILE_NAV_ORDER_KEY = 'novafi_mobile_nav_order';

const ALL_MOBILE_NAV: NavItem[] = [
  { href: '/dashboard',    labelKey: 'nav.home',         icon: LayoutDashboard, badgeKey: null },
  { href: '/transactions', labelKey: 'nav.spending',     icon: ArrowLeftRight,  badgeKey: null },
  { href: '/bills',        labelKey: 'nav.bills',        icon: Calendar,        badgeKey: 'overdueBills' },
  { href: '/planning',     labelKey: 'nav.planning',     icon: BarChart3,       badgeKey: 'overBudget' },
  { href: '/accounts',     labelKey: 'nav.accounts',     icon: Landmark,        badgeKey: null },
  { href: '/credit',       labelKey: 'nav.credit',       icon: CreditCard,      badgeKey: 'creditAlerts' },
  { href: '/funding',      labelKey: 'nav.funding',      icon: HandCoins,       badgeKey: null },
  { href: '/savings',      labelKey: 'nav.savings',      icon: PiggyBank,       badgeKey: null },
  { href: '/paychecks',    labelKey: 'nav.paychecks',    icon: DollarSign,      badgeKey: null },
  { href: '/reports',      labelKey: 'nav.reports',      icon: FileText,        badgeKey: null },
  { href: '/settings',     labelKey: 'nav.settings',     icon: Settings,        badgeKey: null },
];

function getMobileNavOrder(): NavItem[] {
  if (typeof window === 'undefined') return ALL_MOBILE_NAV;
  try {
    const raw = localStorage.getItem(MOBILE_NAV_ORDER_KEY);
    if (!raw) return ALL_MOBILE_NAV;
    const order: string[] = JSON.parse(raw);
    const sorted = order.map((href) => ALL_MOBILE_NAV.find((n) => n.href === href)).filter(Boolean) as NavItem[];
    const missing = ALL_MOBILE_NAV.filter((n) => !order.includes(n.href));
    return [...sorted, ...missing];
  } catch {
    return ALL_MOBILE_NAV;
  }
}

export function MobileNav() {
  const path = usePathname();
  const badges = useBadges();
  const { t } = useTranslation();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [navOrder, setNavOrder] = useState(ALL_MOBILE_NAV);
  const sheetRef = useRef<HTMLDivElement>(null);
  const customizeRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setNavOrder(getMobileNavOrder()); }, []);

  useEffect(() => { setSheetOpen(false); setCustomizeOpen(false); }, [path]);

  useEffect(() => {
    if (!sheetOpen && !customizeOpen) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (customizeOpen) {
        if (customizeRef.current && !customizeRef.current.contains(target)) setCustomizeOpen(false);
        return;
      }
      if (sheetRef.current && !sheetRef.current.contains(target)) setSheetOpen(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [sheetOpen, customizeOpen]);

  // 3 primary slots flank a raised center "+"; the rest live in the More sheet.
  const primaryNav = navOrder.slice(0, 3);
  const moreNav = navOrder.slice(3);
  const moreActive = moreNav.some(({ href }) => path === href || path.startsWith(href + '/'));

  function moveItem(index: number, direction: 'up' | 'down') {
    const next = [...navOrder];
    const swapIdx = direction === 'up' ? index - 1 : index + 1;
    if (swapIdx < 0 || swapIdx >= next.length) return;
    [next[index], next[swapIdx]] = [next[swapIdx], next[index]];
    setNavOrder(next);
    try { localStorage.setItem(MOBILE_NAV_ORDER_KEY, JSON.stringify(next.map((n) => n.href))); } catch { /* ignore */ }
  }

  function resetOrder() {
    setNavOrder(ALL_MOBILE_NAV);
    try { localStorage.removeItem(MOBILE_NAV_ORDER_KEY); } catch { /* ignore */ }
  }

  // Bottom-bar tile (icon + label, with active pill).
  const renderBottomItem = ({ href, labelKey, icon: Icon, badgeKey }: NavItem) => {
    const active = path === href || path.startsWith(href + '/');
    const badgeCount = badgeKey ? badges[badgeKey] : 0;
    return (
      <Link
        key={href}
        href={href}
        className={cn(
          'relative flex flex-col items-center gap-1 p-2 rounded-xl transition-colors duration-150 min-w-[56px] min-h-[52px] justify-center tap-highlight-none select-none',
          active ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400 dark:text-slate-500'
        )}
      >
        <AnimatePresence>
          {active && (
            <motion.div
              layoutId="mobile-nav-active"
              className="absolute inset-0 bg-indigo-50 dark:bg-indigo-900/30 rounded-xl"
              initial={false}
              exit={{ opacity: 0 }}
              transition={{ type: 'spring', bounce: 0.15, duration: 0.35 }}
            />
          )}
        </AnimatePresence>
        <div className="relative">
          <Icon className={cn('w-5 h-5 relative z-10', active && 'drop-shadow-[0_0_8px_rgba(79,70,229,0.3)]')} />
          {badgeCount > 0 && (
            <span className={cn(
              'absolute -top-1.5 -right-1.5 z-20 text-white text-[9px] font-extrabold rounded-full min-w-[14px] h-[14px] flex items-center justify-center px-0.5',
              badgeKey === 'overdueBills' ? 'bg-rose-500' : 'bg-amber-500'
            )}>
              {badgeCount > 9 ? '9+' : badgeCount}
            </span>
          )}
        </div>
        <span className="text-[10px] font-semibold relative z-10 leading-tight">{t(labelKey)}</span>
      </Link>
    );
  };

  // Tile inside the More sheet grid.
  const renderMoreItem = ({ href, labelKey, icon: Icon, badgeKey }: NavItem) => {
    const active = path === href || path.startsWith(href + '/');
    const badgeCount = badgeKey ? badges[badgeKey] : 0;
    return (
      <Link
        key={href}
        href={href}
        className={cn(
          'flex flex-col items-center gap-1.5 py-3 px-1 rounded-2xl transition-colors duration-150 tap-highlight-none select-none',
          active ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-400 active:bg-slate-50 dark:active:bg-slate-700'
        )}
      >
        <div className="relative">
          <Icon className="w-6 h-6" />
          {badgeCount > 0 && (
            <span className={cn(
              'absolute -top-1.5 -right-1.5 z-20 text-white text-[9px] font-extrabold rounded-full min-w-[14px] h-[14px] flex items-center justify-center px-0.5',
              badgeKey === 'overdueBills' ? 'bg-rose-500' : 'bg-amber-500'
            )}>
              {badgeCount > 9 ? '9+' : badgeCount}
            </span>
          )}
        </div>
        <span className="text-[10px] font-semibold leading-tight text-center">{t(labelKey)}</span>
      </Link>
    );
  };

  return (
    <>
      {/* Backdrop */}
      <AnimatePresence>
        {(sheetOpen || customizeOpen) && (
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="md:hidden fixed inset-0 bg-black/30 backdrop-blur-sm z-40"
          />
        )}
      </AnimatePresence>

      {/* Customize sheet */}
      <AnimatePresence>
        {customizeOpen && (
          <motion.div
            key="customize"
            ref={customizeRef}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', bounce: 0.1, duration: 0.38 }}
            className="md:hidden fixed bottom-[96px] left-0 right-0 z-50 bg-white dark:bg-slate-800 rounded-t-3xl border-t border-slate-200 dark:border-slate-700 shadow-[0_-20px_60px_rgba(0,0,0,0.12)] px-4 pt-5 pb-6 max-h-[80vh] overflow-y-auto"
          >
            <div className="w-10 h-1 bg-slate-200 dark:bg-slate-600 rounded-full mx-auto mb-4" />
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">{t('nav.navigationOrder')}</h2>
              <button
                onClick={() => setCustomizeOpen(false)}
                className="text-sm font-semibold text-indigo-600 dark:text-indigo-400 tap-highlight-none px-1"
              >
                {t('nav.done')}
              </button>
            </div>

            <p className="text-xs text-slate-400 dark:text-slate-500 mb-3">{t('nav.firstThreeItems')}</p>

            <div className="space-y-0.5">
              {navOrder.map(({ href, labelKey, icon: Icon }, index) => (
                <div key={href}>
                  {index === 3 && (
                    <div className="flex items-center gap-2 my-3">
                      <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
                      <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">{t('nav.more')}</span>
                      <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
                    </div>
                  )}
                  <div className="flex items-center gap-3 py-2.5 px-2 rounded-xl">
                    <span className="w-5 h-5 flex items-center justify-center text-[11px] font-bold text-slate-300 dark:text-slate-600 shrink-0">{index + 1}</span>
                    <Icon className="w-5 h-5 text-slate-500 dark:text-slate-400 shrink-0" />
                    <span className="flex-1 text-sm font-semibold text-slate-700 dark:text-slate-300">{t(labelKey)}</span>
                    <div className="flex items-center gap-0.5">
                      <button
                        onClick={() => moveItem(index, 'up')}
                        disabled={index === 0}
                        className="p-1.5 rounded-lg text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-25 tap-highlight-none"
                      >
                        <ChevronUp className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => moveItem(index, 'down')}
                        disabled={index === navOrder.length - 1}
                        className="p-1.5 rounded-lg text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-25 tap-highlight-none"
                      >
                        <ChevronDown className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={resetOrder}
              className="mt-4 w-full py-2.5 text-sm font-semibold text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 tap-highlight-none"
            >
              {t('nav.resetToDefault')}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Slide-up "More" sheet — overflow items grouped by section */}
      <AnimatePresence>
        {sheetOpen && !customizeOpen && (
          <motion.div
            key="sheet"
            ref={sheetRef}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', bounce: 0.1, duration: 0.38 }}
            className="md:hidden fixed bottom-[96px] left-0 right-0 z-50 bg-white dark:bg-slate-800 rounded-t-3xl border-t border-slate-200 dark:border-slate-700 shadow-[0_-20px_60px_rgba(0,0,0,0.12)] px-4 pt-5 pb-6 max-h-[70vh] overflow-y-auto"
          >
            <div className="w-10 h-1 bg-slate-200 dark:bg-slate-600 rounded-full mx-auto mb-5" />

            <div className="space-y-4">
              {MORE_GROUPS.map((g) => {
                const items = moreNav.filter((n) => NAV_GROUP_OF[n.href] === g.key);
                if (items.length === 0) return null;
                return (
                  <div key={g.key}>
                    <p className="px-1 mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">{t(g.labelKey)}</p>
                    <div className="grid grid-cols-4 gap-2">
                      {items.map(renderMoreItem)}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-4">
              <button
                onClick={() => { setSheetOpen(false); setCustomizeOpen(true); }}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-semibold text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors duration-150 border border-slate-100 dark:border-slate-700 tap-highlight-none select-none"
              >
                <Sliders className="w-4 h-4" />
                {t('nav.customize')}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom bar: 2 nav · raised "+" · 1 nav · More */}
      <nav className="md:hidden fixed bottom-4 left-4 right-4 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border border-slate-200 dark:border-slate-700/50 rounded-3xl px-2 py-2 flex items-center justify-around z-50 shadow-[0_12px_40px_rgba(0,0,0,0.16)] dark:shadow-[0_12px_40px_rgba(0,0,0,0.5)]">
        {primaryNav.slice(0, 2).map(renderBottomItem)}

        <QuickAddTransaction variant="navFab" />

        {primaryNav.slice(2, 3).map(renderBottomItem)}

        {/* More button */}
        <button
          onClick={() => setSheetOpen((v) => !v)}
          className={cn(
            'relative flex flex-col items-center gap-1 p-2 rounded-xl transition-colors duration-150 min-w-[56px] min-h-[52px] justify-center tap-highlight-none select-none',
            (moreActive || sheetOpen) ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400 dark:text-slate-500'
          )}
        >
          <AnimatePresence>
            {moreActive && !sheetOpen && (
              <motion.div
                layoutId="mobile-nav-active"
                className="absolute inset-0 bg-indigo-50 dark:bg-indigo-900/30 rounded-xl"
                initial={false}
                exit={{ opacity: 0 }}
                transition={{ type: 'spring', bounce: 0.15, duration: 0.35 }}
              />
            )}
          </AnimatePresence>
          {sheetOpen
            ? <X className="w-5 h-5 relative z-10" />
            : <MoreHorizontal className={cn('w-5 h-5 relative z-10', (moreActive || sheetOpen) && 'drop-shadow-[0_0_8px_rgba(79,70,229,0.3)]')} />
          }
          <span className="text-[10px] font-semibold relative z-10 leading-tight">{t('nav.more')}</span>
        </button>
      </nav>
    </>
  );
}
