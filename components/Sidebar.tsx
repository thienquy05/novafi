'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
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
} from 'lucide-react';
import { signOut } from 'next-auth/react';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { LogoMark } from './LogoMark';

type BadgeCounts = { overdueBills: number; overBudget: number };

const BADGES_CACHE_KEY = 'nf_badges_cache';
const BADGES_TTL_MS = 2 * 60 * 1000; // 2 minutes

function useBadges(): BadgeCounts {
  const [badges, setBadges] = useState<BadgeCounts>({ overdueBills: 0, overBudget: 0 });
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

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, badgeKey: null as keyof BadgeCounts | null },
  { href: '/accounts', label: 'Accounts', icon: Landmark, badgeKey: null },
  { href: '/paychecks', label: 'Paychecks', icon: DollarSign, badgeKey: null },
  { href: '/transactions', label: 'Transactions', icon: ArrowLeftRight, badgeKey: null },
  { href: '/savings', label: 'Savings', icon: PiggyBank, badgeKey: null },
  { href: '/bills', label: 'Bills', icon: Calendar, badgeKey: 'overdueBills' as keyof BadgeCounts },
  { href: '/planning', label: 'Planning', icon: BarChart3, badgeKey: 'overBudget' as keyof BadgeCounts },
  { href: '/settings', label: 'Settings', icon: Settings, badgeKey: null },
];

export function Sidebar() {
  const path = usePathname();
  const badges = useBadges();

  return (
    <aside className="hidden md:flex flex-col w-64 min-h-screen bg-white/80 backdrop-blur-xl border-r border-slate-200 px-4 py-8 shrink-0 relative z-50">
      {/* Logo */}
      <div className="flex items-center gap-3 px-2 mb-10">
        <div className="relative">
          <div className="absolute inset-0 bg-indigo-500 rounded-xl blur opacity-30" />
          <LogoMark className="relative w-10 h-10 rounded-xl shadow-lg" />
        </div>
        <div>
          <p className="text-slate-900 font-bold text-lg tracking-tight leading-none">Nova<span className="text-gradient">Fi</span></p>
          <p className="text-slate-500 text-xs font-medium mt-1">Wealth Management</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex flex-col gap-1.5 flex-1">
        {NAV.map(({ href, label, icon: Icon, badgeKey }) => {
          const active = path === href || path.startsWith(href + '/');
          const badgeCount = badgeKey ? badges[badgeKey] : 0;
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'relative flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-semibold transition-colors duration-150 group overflow-hidden tap-highlight-none select-none',
                active
                  ? 'text-indigo-600'
                  : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
              )}
            >
              {active && (
                <motion.div
                  layoutId="sidebar-active"
                  className="absolute inset-0 bg-indigo-50 border border-indigo-100 rounded-xl"
                  initial={false}
                  transition={{ type: 'spring', bounce: 0.15, duration: 0.35 }}
                />
              )}
              <Icon className={cn('w-5 h-5 shrink-0 relative z-10 transition-colors duration-150', active ? 'text-indigo-600' : 'group-hover:text-slate-900')} />
              <span className="relative z-10 flex-1">{label}</span>
              {badgeCount > 0 && (
                <NavBadge
                  count={badgeCount}
                  tone={badgeKey === 'overdueBills' ? 'red' : 'amber'}
                />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Sign out */}
      <button
        onClick={() => signOut({ callbackUrl: '/' })}
        className="group flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-semibold text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition-colors duration-150 mt-auto tap-highlight-none select-none"
      >
        <LogOut className="w-5 h-5 shrink-0 group-hover:scale-110 transition-transform duration-150" />
        Sign Out
      </button>
    </aside>
  );
}

export function MobileHeader() {
  return (
    <header className="md:hidden flex items-center justify-between px-4 py-4 bg-white/90 backdrop-blur-xl border-b border-slate-200 sticky top-0 z-40">
      <div className="flex items-center gap-3">
        <LogoMark className="w-9 h-9 rounded-xl shadow-md" />
        <p className="text-slate-900 font-bold text-xl tracking-tight leading-none">Nova<span className="text-gradient">Fi</span></p>
      </div>
      <button
        onClick={() => signOut({ callbackUrl: '/' })}
        className="p-2.5 text-slate-500 hover:text-rose-600 bg-slate-50 hover:bg-rose-50 rounded-full transition-colors duration-150 tap-highlight-none"
      >
        <LogOut className="w-5 h-5" />
      </button>
    </header>
  );
}

// Mobile nav shows the 5 most important pages
const MOBILE_NAV = [
  { href: '/dashboard', label: 'Home', icon: LayoutDashboard, badgeKey: null as keyof BadgeCounts | null },
  { href: '/accounts', label: 'Accounts', icon: Landmark, badgeKey: null },
  { href: '/transactions', label: 'Spending', icon: ArrowLeftRight, badgeKey: null },
  { href: '/bills', label: 'Bills', icon: Calendar, badgeKey: 'overdueBills' as keyof BadgeCounts },
  { href: '/planning', label: 'Planning', icon: BarChart3, badgeKey: 'overBudget' as keyof BadgeCounts },
];

export function MobileNav() {
  const path = usePathname();
  const badges = useBadges();

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-xl border-t border-slate-200 px-2 py-2 flex items-center justify-around z-50 pb-safe shadow-[0_-10px_40px_rgba(0,0,0,0.05)]">
      {MOBILE_NAV.map(({ href, label, icon: Icon, badgeKey }) => {
        const active = path === href || path.startsWith(href + '/');
        const badgeCount = badgeKey ? badges[badgeKey] : 0;
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              'relative flex flex-col items-center gap-1 p-2 rounded-xl transition-colors duration-150 min-w-[60px] min-h-[52px] justify-center tap-highlight-none select-none',
              active ? 'text-indigo-600' : 'text-slate-400'
            )}
          >
            {active && (
              <motion.div
                layoutId="mobile-nav-active"
                className="absolute inset-0 bg-indigo-50 rounded-xl"
                initial={false}
                transition={{ type: 'spring', bounce: 0.15, duration: 0.35 }}
              />
            )}
            <div className="relative">
              <Icon className={cn('w-5 h-5 relative z-10', active && 'drop-shadow-[0_0_8px_rgba(79,70,229,0.3)]')} />
              {badgeCount > 0 && (
                <span className={cn(
                  'absolute -top-1.5 -right-1.5 text-white text-[9px] font-extrabold rounded-full min-w-[14px] h-[14px] flex items-center justify-center px-0.5',
                  badgeKey === 'overdueBills' ? 'bg-rose-500' : 'bg-amber-500'
                )}>
                  {badgeCount > 9 ? '9+' : badgeCount}
                </span>
              )}
            </div>
            <span className="text-[10px] font-semibold relative z-10 leading-tight">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
