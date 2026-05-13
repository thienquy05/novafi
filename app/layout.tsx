import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { cookies } from 'next/headers';
import './globals.css';
import { SessionProvider } from '@/components/SessionProvider';
import type { Language } from '@/types';

const inter = Inter({ subsets: ['latin'], display: 'swap' });

export const metadata: Metadata = {
  title: 'NovaFi — Personal Finance',
  description: 'Track income, spending, taxes, and goals',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'NovaFi',
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies();
  const langCookie = jar.get('nf_lang')?.value;
  const lang: Language = langCookie === 'vi' ? 'vi' : 'en';

  return (
    <html lang={lang}>
      <head>
        <meta name="theme-color" content="#1568a3" />
        <link rel="apple-touch-icon" href="/icon.svg" />
      </head>
      <body className={inter.className} suppressHydrationWarning>
        <SessionProvider initialLang={lang}>{children}</SessionProvider>
      </body>
    </html>
  );
}
