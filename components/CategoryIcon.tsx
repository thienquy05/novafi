'use client';
import {
  Utensils, ShoppingCart, Tv, Receipt, ShoppingBag, Car, Heart,
  ArrowLeftRight, MoreHorizontal, DollarSign, Briefcase, TrendingUp,
  Plus, ArrowUpRight, ArrowDownRight, type LucideIcon,
} from 'lucide-react';

type IconConfig = { Icon: LucideIcon; color: string; bg: string; border: string };

export const CATEGORY_ICONS: Record<string, IconConfig> = {
  Food: { Icon: Utensils, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-900/30', border: 'border-amber-100 dark:border-amber-800/50' },
  Grocery: { Icon: ShoppingCart, color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-900/30', border: 'border-emerald-100 dark:border-emerald-800/50' },
  Entertainment: { Icon: Tv, color: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-50 dark:bg-purple-900/30', border: 'border-purple-100 dark:border-purple-800/50' },
  Bills: { Icon: Receipt, color: 'text-rose-600 dark:text-rose-400', bg: 'bg-rose-50 dark:bg-rose-900/30', border: 'border-rose-100 dark:border-rose-800/50' },
  Shopping: { Icon: ShoppingBag, color: 'text-cyan-600 dark:text-cyan-400', bg: 'bg-cyan-50 dark:bg-cyan-900/30', border: 'border-cyan-100 dark:border-cyan-800/50' },
  Transportation: { Icon: Car, color: 'text-indigo-600 dark:text-indigo-400', bg: 'bg-indigo-50 dark:bg-indigo-900/30', border: 'border-indigo-100 dark:border-indigo-800/50' },
  Health: { Icon: Heart, color: 'text-pink-600 dark:text-pink-400', bg: 'bg-pink-50 dark:bg-pink-900/30', border: 'border-pink-100 dark:border-pink-800/50' },
  Transfer: { Icon: ArrowLeftRight, color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-900/30', border: 'border-blue-100 dark:border-blue-800/50' },
  Other: { Icon: MoreHorizontal, color: 'text-slate-500 dark:text-slate-400', bg: 'bg-slate-100 dark:bg-slate-700', border: 'border-slate-200 dark:border-slate-600' },
  Paycheck: { Icon: DollarSign, color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-900/30', border: 'border-emerald-100 dark:border-emerald-800/50' },
  Freelance: { Icon: Briefcase, color: 'text-teal-600 dark:text-teal-400', bg: 'bg-teal-50 dark:bg-teal-900/30', border: 'border-teal-100 dark:border-teal-800/50' },
  Investment: { Icon: TrendingUp, color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-900/30', border: 'border-blue-100 dark:border-blue-800/50' },
  'Other Income': { Icon: Plus, color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-900/30', border: 'border-emerald-100 dark:border-emerald-800/50' },
};

export function CategoryIconBadge({
  category,
  type,
  className = 'w-12 h-12 rounded-2xl',
}: {
  category: string;
  type?: 'income' | 'expense' | 'transfer';
  className?: string;
}) {
  const cleanCategory = category.replace(/^categories\./, '');
  const config = CATEGORY_ICONS[cleanCategory];

  if (!config) {
    if (type === 'income') {
      return (
        <div className={`flex items-center justify-center shrink-0 ${className} bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-100 dark:border-emerald-800/50`}>
          <ArrowUpRight className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
        </div>
      );
    }
    if (type === 'transfer') {
      return (
        <div className={`flex items-center justify-center shrink-0 ${className} bg-blue-50 dark:bg-blue-900/30 border border-blue-100 dark:border-blue-800/50`}>
          <ArrowLeftRight className="w-5 h-5 text-blue-600 dark:text-blue-400" />
        </div>
      );
    }
    return (
      <div className={`flex items-center justify-center shrink-0 ${className} bg-rose-50 dark:bg-rose-900/30 border border-rose-100 dark:border-rose-800/50`}>
        <ArrowDownRight className="w-5 h-5 text-rose-600 dark:text-rose-400" />
      </div>
    );
  }

  const { Icon, color, bg, border } = config;
  return (
    <div className={`flex items-center justify-center shrink-0 ${className} ${bg} border ${border}`}>
      <Icon className={`w-5 h-5 ${color}`} />
    </div>
  );
}
