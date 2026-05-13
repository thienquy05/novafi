import type { Language } from '@/types';
import en from '@/locales/en.json';
import vi from '@/locales/vi.json';

type Dict = typeof en;

const dicts: Record<Language, Dict> = { en, vi };

export function t(
  key: string,
  lang: Language = 'en',
  params?: Record<string, string | number>
): string {
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
}
