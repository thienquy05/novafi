'use client';
import { SessionProvider as NextAuthSessionProvider } from 'next-auth/react';
import { ToastProvider } from '@/lib/toast';

export function SessionProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextAuthSessionProvider>
      <ToastProvider>{children}</ToastProvider>
    </NextAuthSessionProvider>
  );
}
