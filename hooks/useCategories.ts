'use client';
import { useState, useEffect } from 'react';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '@/types';

const CACHE_KEY = 'nf_categories_v1';
const TTL_MS = 5 * 60 * 1000;

export function useCategories() {
  const [expenseCategories, setExpenseCategories] = useState<string[]>([...EXPENSE_CATEGORIES]);
  const [incomeCategories, setIncomeCategories] = useState<string[]>([...INCOME_CATEGORIES]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(CACHE_KEY);
      if (raw) {
        const { data, ts } = JSON.parse(raw) as { data: { expenseCategories: string[]; incomeCategories: string[] }; ts: number };
        if (Date.now() - ts < TTL_MS) {
          setExpenseCategories(data.expenseCategories);
          setIncomeCategories(data.incomeCategories);
          return;
        }
      }
    } catch { /* sessionStorage unavailable */ }

    fetch('/api/categories')
      .then((r) => r.json())
      .then((data: { expenseCategories: string[]; incomeCategories: string[] }) => {
        setExpenseCategories(data.expenseCategories);
        setIncomeCategories(data.incomeCategories);
        try {
          sessionStorage.setItem(CACHE_KEY, JSON.stringify({ data, ts: Date.now() }));
        } catch { /* ignore */ }
      })
      .catch(() => {});
  }, []);

  return { expenseCategories, incomeCategories };
}

export function invalidateCategoriesCache() {
  try { sessionStorage.removeItem(CACHE_KEY); } catch { /* ignore */ }
}
