'use client';
import { SessionProvider as NextAuthSessionProvider } from 'next-auth/react';
import { ToastProvider } from '@/lib/toast';
import { LanguageProvider } from '@/lib/i18n/context';
import type { Language } from '@/types';

export function SessionProvider({
  children,
  initialLang = 'en',
}: {
  children: React.ReactNode;
  initialLang?: Language;
}) {
  return (
    <NextAuthSessionProvider>
      <LanguageProvider initialLang={initialLang}>
        <ToastProvider>{children}</ToastProvider>
      </LanguageProvider>
    </NextAuthSessionProvider>
  );
}
