'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  DollarSign,
  ArrowLeftRight,
  Settings,
  LogOut,
  Sparkles,
  Landmark,
  PiggyBank,
  Calendar,
  BarChart3,
} from 'lucide-react';
import { signOut } from 'next-auth/react';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/accounts', label: 'Accounts', icon: Landmark },
  { href: '/paychecks', label: 'Paychecks', icon: DollarSign },
  { href: '/transactions', label: 'Transactions', icon: ArrowLeftRight },
  { href: '/savings', label: 'Savings', icon: PiggyBank },
  { href: '/bills', label: 'Bills', icon: Calendar },
  { href: '/planning', label: 'Planning', icon: BarChart3 },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar() {
  const path = usePathname();

  return (
    <aside className="hidden md:flex flex-col w-64 min-h-screen bg-white/80 backdrop-blur-xl border-r border-slate-200 px-4 py-8 shrink-0 relative z-50">
      {/* Logo */}
      <div className="flex items-center gap-3 px-2 mb-10">
        <div className="relative">
          <div className="absolute inset-0 bg-indigo-500 rounded-xl blur opacity-30" />
          <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg border border-white/10">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
        </div>
        <div>
          <p className="text-slate-900 font-bold text-lg tracking-tight leading-none">Nova<span className="text-gradient">Fi</span></p>
          <p className="text-slate-500 text-xs font-medium mt-1">Wealth Management</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex flex-col gap-1.5 flex-1">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = path === href || path.startsWith(href + '/');
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'relative flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-semibold transition-all duration-300 group overflow-hidden',
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
                  transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
                />
              )}
              <Icon className={cn("w-5 h-5 shrink-0 relative z-10 transition-colors duration-300", active ? "text-indigo-600" : "group-hover:text-slate-900")} />
              <span className="relative z-10">{label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Sign out */}
      <button
        onClick={() => signOut({ callbackUrl: '/' })}
        className="group flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-semibold text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition-all duration-300 mt-auto"
      >
        <LogOut className="w-5 h-5 shrink-0 group-hover:scale-110 transition-transform duration-300" />
        Sign Out
      </button>
    </aside>
  );
}

export function MobileHeader() {
  return (
    <header className="md:hidden flex items-center justify-between px-4 py-4 bg-white/90 backdrop-blur-xl border-b border-slate-200 sticky top-0 z-40">
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg border border-white/10">
          <Sparkles className="w-4 h-4 text-white" />
        </div>
        <p className="text-slate-900 font-bold text-xl tracking-tight leading-none">Nova<span className="text-gradient">Fi</span></p>
      </div>
      <button
        onClick={() => signOut({ callbackUrl: '/' })}
        className="p-2 text-slate-500 hover:text-rose-600 bg-slate-50 rounded-full transition-colors"
      >
        <LogOut className="w-5 h-5" />
      </button>
    </header>
  );
}

// Mobile nav shows the 5 most important pages
const MOBILE_NAV = [
  { href: '/dashboard', label: 'Home', icon: LayoutDashboard },
  { href: '/accounts', label: 'Accounts', icon: Landmark },
  { href: '/transactions', label: 'Spending', icon: ArrowLeftRight },
  { href: '/savings', label: 'Savings', icon: PiggyBank },
  { href: '/planning', label: 'Planning', icon: BarChart3 },
];

export function MobileNav() {
  const path = usePathname();

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-xl border-t border-slate-200 px-2 py-2 flex items-center justify-around z-50 pb-safe shadow-[0_-10px_40px_rgba(0,0,0,0.05)]">
      {MOBILE_NAV.map(({ href, label, icon: Icon }) => {
        const active = path === href || path.startsWith(href + '/');
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              'relative flex flex-col items-center gap-1.5 p-2 rounded-xl transition-all duration-300 min-w-[64px]',
              active
                ? 'text-indigo-600'
                : 'text-slate-400 hover:text-slate-900'
            )}
          >
            {active && (
              <motion.div
                layoutId="mobile-nav-active"
                className="absolute inset-0 bg-indigo-50 rounded-xl"
                initial={false}
                transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
              />
            )}
            <Icon className={cn("w-5 h-5 relative z-10", active && "drop-shadow-[0_0_8px_rgba(79,70,229,0.3)]")} />
            <span className="text-[10px] font-bold relative z-10">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}