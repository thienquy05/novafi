import Link from 'next/link';
import {
  ArrowDownLeft, ArrowUpRight, PiggyBank, ArrowLeftRight, Flame, AlertTriangle,
  Sparkles, RefreshCw, CreditCard, Target, Trophy, ChevronRight, Leaf,
  type LucideIcon,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardIcon } from '@/components/ui/Card';
import { FitText } from '@/components/ui/FitText';
import { formatCurrency } from '@/lib/utils';
import { t } from '@/lib/i18n';
import type { Insight, InsightKind, InsightTone, MoneyFlowSummary } from '@/lib/insights';
import type { Language } from '@/types';

// Server-rendered "Money Flow" guidance widget: an in/out/kept strip plus the
// top few insights from lib/insights.ts — the app reading your money flow back
// to you in plain language, each card deep-linking to where you can act.

const KIND_ICON: Record<InsightKind, LucideIcon> = {
  cashflow: ArrowLeftRight,
  spike: Flame,
  crunch: AlertTriangle,
  opportunity: Sparkles,
  subscriptions: RefreshCw,
  credit: CreditCard,
  goal: Target,
  win: Trophy,
};

// Literal Tailwind classes per tone (v4 requires literals, no templating).
const TONE_STYLE: Record<InsightTone, { chip: string; icon: string; ring: string }> = {
  emerald: { chip: 'bg-emerald-50 dark:bg-emerald-900/30 border-emerald-100 dark:border-emerald-800/50', icon: 'text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-900/40', ring: 'hover:border-emerald-200 dark:hover:border-emerald-700/60' },
  indigo:  { chip: 'bg-indigo-50 dark:bg-indigo-900/30 border-indigo-100 dark:border-indigo-800/50',    icon: 'text-indigo-600 dark:text-indigo-400 bg-indigo-100 dark:bg-indigo-900/40',    ring: 'hover:border-indigo-200 dark:hover:border-indigo-700/60' },
  amber:   { chip: 'bg-amber-50 dark:bg-amber-900/30 border-amber-100 dark:border-amber-800/50',        icon: 'text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/40',        ring: 'hover:border-amber-200 dark:hover:border-amber-700/60' },
  rose:    { chip: 'bg-rose-50 dark:bg-rose-900/30 border-rose-100 dark:border-rose-800/50',            icon: 'text-rose-600 dark:text-rose-400 bg-rose-100 dark:bg-rose-900/40',            ring: 'hover:border-rose-200 dark:hover:border-rose-700/60' },
  purple:  { chip: 'bg-purple-50 dark:bg-purple-900/30 border-purple-100 dark:border-purple-800/50',    icon: 'text-purple-600 dark:text-purple-400 bg-purple-100 dark:bg-purple-900/40',    ring: 'hover:border-purple-200 dark:hover:border-purple-700/60' },
};

function FlowStat({ label, value, tone }: { label: string; value: string; tone: 'emerald' | 'rose' | 'indigo' }) {
  const Icon = tone === 'emerald' ? ArrowDownLeft : tone === 'rose' ? ArrowUpRight : PiggyBank;
  const text =
    tone === 'emerald' ? 'text-emerald-600 dark:text-emerald-400'
    : tone === 'rose' ? 'text-rose-600 dark:text-rose-400'
    : 'text-indigo-600 dark:text-indigo-400';
  return (
    <div className="flex-1 min-w-0 rounded-2xl bg-slate-50 dark:bg-slate-700/40 border border-slate-100 dark:border-slate-700/60 px-3 py-2.5">
      <p className="flex items-center gap-1 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
        <Icon className={`w-3 h-3 ${text}`} />
        {label}
      </p>
      <FitText maxSize={18} minSize={11} className={`font-display font-extrabold mt-0.5 ${text}`}>{value}</FitText>
    </div>
  );
}

export function MoneyFlowInsights({ flow, insights, lang }: { flow: MoneyFlowSummary; insights: Insight[]; lang: Language }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <CardIcon tone="indigo"><ArrowLeftRight className="w-4 h-4" /></CardIcon>
          <div>
            <CardTitle>{t('insights.flowTitle', lang)}</CardTitle>
            <p className="text-xs font-medium text-slate-400 dark:text-slate-500 mt-0.5">{t('insights.flowSubtitle', lang)}</p>
          </div>
        </div>
      </CardHeader>

      {/* In / Out / Kept strip — sign always travels with its number. */}
      <div className="flex items-stretch gap-2 mb-4">
        <FlowStat label={t('insights.in', lang)} value={`+${formatCurrency(flow.income)}`} tone="emerald" />
        <FlowStat label={t('insights.out', lang)} value={`-${formatCurrency(flow.spending)}`} tone="rose" />
        <FlowStat label={t('insights.kept', lang)} value={`${flow.kept < 0 ? '-' : ''}${formatCurrency(Math.abs(flow.kept))}`} tone={flow.kept < 0 ? 'rose' : 'indigo'} />
      </div>

      {insights.length === 0 ? (
        <div className="flex items-center gap-3 rounded-2xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800/40 px-4 py-3.5">
          <Leaf className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-bold text-emerald-800 dark:text-emerald-300">{t('insights.allQuiet', lang)}</p>
            <p className="text-xs font-medium text-emerald-700/70 dark:text-emerald-400/70 mt-0.5">{t('insights.allQuietHint', lang)}</p>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {insights.map((ins) => {
            const Icon = KIND_ICON[ins.kind];
            const style = TONE_STYLE[ins.tone];
            return (
              <Link
                key={ins.id}
                href={ins.href}
                className={`group flex items-start gap-3 rounded-2xl border px-3.5 py-3 transition-colors ${style.chip} ${style.ring}`}
              >
                <span className={`mt-0.5 p-1.5 rounded-lg shrink-0 ${style.icon}`}>
                  <Icon className="w-4 h-4" />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-bold text-slate-900 dark:text-slate-100">{ins.title}</span>
                  <span className="block text-xs font-medium text-slate-600 dark:text-slate-300 mt-0.5 leading-snug">{ins.body}</span>
                </span>
                <ChevronRight className="w-4 h-4 text-slate-300 dark:text-slate-600 shrink-0 mt-1 transition-transform group-hover:translate-x-0.5" />
              </Link>
            );
          })}
        </div>
      )}
    </Card>
  );
}
