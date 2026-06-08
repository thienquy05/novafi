'use client';
import { useEffect, useRef } from 'react';
import { fireConfetti } from '@/lib/confetti';
import { Haptics } from '@/lib/haptics';
import { useToast } from '@/lib/toast';
import { useTranslation } from '@/lib/i18n/context';

const STORE_KEY = 'nf_milestones_v1';

type Stored = {
  savingsRateHit: boolean;
  grade: string;
  goals: string[];
  // Optional/added later — absent on older payloads (and when no card has a
  // limit), which baselines silently the first time credit is tracked.
  creditUnderTarget?: boolean;
  creditUnderIdeal?: boolean;
};

function gradeOf(score: number): string {
  return score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : score >= 40 ? 'D' : 'F';
}
const RANK: Record<string, number> = { F: 0, D: 1, C: 2, B: 3, A: 4 };

/**
 * Renders nothing — watches a few financial milestones and fires a confetti +
 * haptic + toast the first time each is newly crossed. Previous state lives in
 * localStorage; the very first load just records a baseline so a returning
 * user's existing wins don't all celebrate at once.
 */
export function Celebrations({
  savingsRate,
  healthScore,
  achievedGoals,
  creditUtil,
}: {
  savingsRate: number;
  healthScore: number;
  achievedGoals: { id: string; name: string }[];
  creditUtil: number | null; // overall credit utilization %, or null when no limits set
}) {
  const toast = useToast();
  const { t } = useTranslation();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // guard against StrictMode double-invoke
    ran.current = true;

    const grade = gradeOf(healthScore);
    const savingsRateHit = savingsRate >= 20;
    const goalIds = achievedGoals.map((g) => g.id);
    const hasCredit = creditUtil !== null;
    const current: Stored = {
      savingsRateHit,
      grade,
      goals: goalIds,
      // Only track credit when a limit exists; otherwise leave undefined so the
      // first time credit becomes trackable baselines instead of celebrating.
      creditUnderTarget: hasCredit ? creditUtil! <= 30 : undefined,
      creditUnderIdeal: hasCredit ? creditUtil! <= 10 : undefined,
    };

    let prev: Stored | null = null;
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) prev = JSON.parse(raw) as Stored;
    } catch { /* ignore */ }

    const persist = () => {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(current)); } catch { /* ignore */ }
    };

    // First ever load → set baseline silently.
    if (!prev) { persist(); return; }

    const messages: string[] = [];
    if (savingsRateHit && !prev.savingsRateHit) {
      messages.push(t('celebrate.savingsRate', { pct: Math.round(savingsRate) }));
    }
    if ((RANK[grade] ?? 0) > (RANK[prev.grade] ?? 0)) {
      messages.push(t('celebrate.health', { grade }));
    }
    const newGoal = achievedGoals.find((g) => !prev!.goals.includes(g.id));
    if (newGoal) {
      messages.push(t('celebrate.goal', { name: newGoal.name }));
    }
    // Credit utilization: celebrate the first time you cross below a threshold.
    // Skip entirely the first time credit is tracked (prev field undefined) so
    // an already-low user doesn't get a spurious pop. Ideal (<10%) supersedes
    // the 30% message in the same render.
    if (hasCredit && prev.creditUnderTarget !== undefined) {
      if (current.creditUnderIdeal && !prev.creditUnderIdeal) {
        messages.push(t('celebrate.creditIdeal'));
      } else if (current.creditUnderTarget && !prev.creditUnderTarget) {
        messages.push(t('celebrate.creditTarget'));
      }
    }

    if (messages.length > 0) {
      fireConfetti();
      Haptics.success();
      // Slight stagger so multiple toasts don't stack instantly.
      messages.forEach((m, i) => setTimeout(() => toast(m, 'success'), i * 350));
    }
    persist();
  }, [savingsRate, healthScore, achievedGoals, creditUtil, t, toast]);

  return null;
}
