'use client';
import { useEffect, useRef } from 'react';
import { fireConfetti } from '@/lib/confetti';
import { Haptics } from '@/lib/haptics';
import { useToast } from '@/lib/toast';
import { useTranslation } from '@/lib/i18n/context';

const STORE_KEY = 'nf_milestones_v1';

type Stored = { savingsRateHit: boolean; grade: string; goals: string[] };

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
}: {
  savingsRate: number;
  healthScore: number;
  achievedGoals: { id: string; name: string }[];
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
    const current: Stored = { savingsRateHit, grade, goals: goalIds };

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

    if (messages.length > 0) {
      fireConfetti();
      Haptics.success();
      // Slight stagger so multiple toasts don't stack instantly.
      messages.forEach((m, i) => setTimeout(() => toast(m, 'success'), i * 350));
    }
    persist();
  }, [savingsRate, healthScore, achievedGoals, t, toast]);

  return null;
}
