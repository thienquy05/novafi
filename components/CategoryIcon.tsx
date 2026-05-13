'use client';
import {
  Utensils, ShoppingCart, Tv, Receipt, ShoppingBag, Car, Heart,
  ArrowLeftRight, MoreHorizontal, DollarSign, Briefcase, TrendingUp,
  Plus, ArrowUpRight, ArrowDownRight, type LucideIcon,
} from 'lucide-react';

type IconConfig = { Icon: LucideIcon; color: string; bg: string; border: string };

export const CATEGORY_ICONS: Record<string, IconConfig> = {
  Food: { Icon: Utensils, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-100' },
  Grocery: { Icon: ShoppingCart, color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-100' },
  Entertainment: { Icon: Tv, color: 'text-purple-600', bg: 'bg-purple-50', border: 'border-purple-100' },
  Bills: { Icon: Receipt, color: 'text-rose-600', bg: 'bg-rose-50', border: 'border-rose-100' },
  Shopping: { Icon: ShoppingBag, color: 'text-cyan-600', bg: 'bg-cyan-50', border: 'border-cyan-100' },
  Transportation: { Icon: Car, color: 'text-indigo-600', bg: 'bg-indigo-50', border: 'border-indigo-100' },
  Health: { Icon: Heart, color: 'text-pink-600', bg: 'bg-pink-50', border: 'border-pink-100' },
  Transfer: { Icon: ArrowLeftRight, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-100' },
  Other: { Icon: MoreHorizontal, color: 'text-slate-500', bg: 'bg-slate-100', border: 'border-slate-200' },
  Paycheck: { Icon: DollarSign, color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-100' },
  Freelance: { Icon: Briefcase, color: 'text-teal-600', bg: 'bg-teal-50', border: 'border-teal-100' },
  Investment: { Icon: TrendingUp, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-100' },
  'Other Income': { Icon: Plus, color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-100' },
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
        <div className={`flex items-center justify-center shrink-0 ${className} bg-emerald-50 border border-emerald-100`}>
          <ArrowUpRight className="w-5 h-5 text-emerald-600" />
        </div>
      );
    }
    if (type === 'transfer') {
      return (
        <div className={`flex items-center justify-center shrink-0 ${className} bg-blue-50 border border-blue-100`}>
          <ArrowLeftRight className="w-5 h-5 text-blue-600" />
        </div>
      );
    }
    return (
      <div className={`flex items-center justify-center shrink-0 ${className} bg-rose-50 border border-rose-100`}>
        <ArrowDownRight className="w-5 h-5 text-rose-600" />
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
