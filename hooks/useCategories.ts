'use client';
import { useState, useEffect } from 'react';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '@/types';

const CACHE_KEY = 'nf_categories_v2';
const TTL_MS = 5 * 60 * 1000;
const INVALIDATE_EVENT = 'nf:categories-invalidated';

// Shape returned by /api/categories. `archived*` are categories the user moved
// out of the entry dropdowns but that may still tag historical transactions, so
// they're surfaced separately for transaction-history filters.
type CategoriesPayload = {
  expenseCategories: string[];
  incomeCategories: string[];
  archivedExpenseCategories?: string[];
  archivedIncomeCategories?: string[];
};

export function useCategories() {
  const [expenseCategories, setExpenseCategories] = useState<string[]>([...EXPENSE_CATEGORIES]);
  const [incomeCategories, setIncomeCategories] = useState<string[]>([...INCOME_CATEGORIES]);
  const [archivedExpenseCategories, setArchivedExpenseCategories] = useState<string[]>([]);
  const [archivedIncomeCategories, setArchivedIncomeCategories] = useState<string[]>([]);

  function apply(data: CategoriesPayload) {
    setExpenseCategories(data.expenseCategories);
    setIncomeCategories(data.incomeCategories);
    setArchivedExpenseCategories(data.archivedExpenseCategories ?? []);
    setArchivedIncomeCategories(data.archivedIncomeCategories ?? []);
  }

  useEffect(() => {
    function load() {
      try {
        const raw = sessionStorage.getItem(CACHE_KEY);
        if (raw) {
          const { data, ts } = JSON.parse(raw) as { data: CategoriesPayload; ts: number };
          if (Date.now() - ts < TTL_MS) {
            apply(data);
            return;
          }
        }
      } catch { /* sessionStorage unavailable */ }

      fetch('/api/categories')
        .then((r) => r.json())
        .then((data: CategoriesPayload) => {
          apply(data);
          try {
            sessionStorage.setItem(CACHE_KEY, JSON.stringify({ data, ts: Date.now() }));
          } catch { /* ignore */ }
        })
        .catch(() => {});
    }
    load();
    // Persistent mounts (nav quick-add) never remount, so reload on invalidation.
    window.addEventListener(INVALIDATE_EVENT, load);
    return () => window.removeEventListener(INVALIDATE_EVENT, load);
  }, []);

  return { expenseCategories, incomeCategories, archivedExpenseCategories, archivedIncomeCategories };
}

export function invalidateCategoriesCache() {
  try { sessionStorage.removeItem(CACHE_KEY); } catch { /* ignore */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(INVALIDATE_EVENT));
}
