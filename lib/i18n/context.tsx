'use client';
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { Language } from '@/types';
import en from '@/locales/en.json';
import vi from '@/locales/vi.json';

type Dict = typeof en;
const dicts: Record<Language, Dict> = { en, vi };

interface I18nCtxValue {
  lang: Language;
  setLang: (lang: Language) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const I18nCtx = createContext<I18nCtxValue | null>(null);

export function LanguageProvider({
  children,
  initialLang = 'en',
}: {
  children: React.ReactNode;
  initialLang?: Language;
}) {
  const [lang, setLangState] = useState<Language>(initialLang);

  useEffect(() => {
    const stored = localStorage.getItem('nf_lang') as Language | null;
    if (stored === 'en' || stored === 'vi') {
      setLangState(stored);
    }
  }, []);

  const setLang = useCallback((newLang: Language) => {
    setLangState(newLang);
    localStorage.setItem('nf_lang', newLang);
    document.cookie = `nf_lang=${newLang};path=/;max-age=31536000;SameSite=Lax`;
  }, []);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>) => {
      const dict = dicts[lang] ?? dicts.en;
      const parts = key.split('.');
      let val: unknown = dict;
      for (const part of parts) {
        if (typeof val !== 'object' || val === null) return key;
        val = (val as Record<string, unknown>)[part];
      }
      if (typeof val !== 'string') return key;
      if (!params) return val;
      return val.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? `{${k}}`));
    },
    [lang]
  );

  return <I18nCtx.Provider value={{ lang, setLang, t }}>{children}</I18nCtx.Provider>;
}

export function useTranslation() {
  const ctx = useContext(I18nCtx);
  if (!ctx) throw new Error('useTranslation must be used within LanguageProvider');
  return ctx;
}
