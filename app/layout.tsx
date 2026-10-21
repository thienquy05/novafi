import type { Metadata, Viewport } from 'next';
import { Inter, Plus_Jakarta_Sans } from 'next/font/google';
import { cookies } from 'next/headers';
import './globals.css';
import { SessionProvider } from '@/components/SessionProvider';
import type { Language } from '@/types';

const inter = Inter({ subsets: ['latin'], display: 'swap' });

// Display face for hero numbers & headings — geometric, friendly, modern.
// Exposed as a CSS variable so the `.font-display` utility can opt elements in
// without changing the default body font (Inter).
const display = Plus_Jakarta_Sans({
  subsets: ['latin'],
  display: 'swap',
  weight: ['600', '700', '800'],
  variable: '--font-display',
});

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

// App-like feel: no pinch / double-tap zoom and no iOS auto-zoom when a field
// is focused (maximumScale: 1). Note iOS Safari still allows pinch-zoom for
// accessibility, by design. Large text is handled by rem-based layouts (audited
// at 125% root size), not page zoom.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies();
  const langCookie = jar.get('nf_lang')?.value;
  const lang: Language = langCookie === 'vi' ? 'vi' : 'en';

  return (
    <html lang={lang} suppressHydrationWarning>
      <head>
        <meta name="theme-color" content="#4f46e5" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        {/* Apply stored dark mode class before first paint to prevent flash */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('nf_theme');if(t==='dark')document.documentElement.classList.add('dark')}catch(e){}})()`,
          }}
        />
      </head>
      <body className={`${inter.className} ${display.variable}`} suppressHydrationWarning>
        <SessionProvider initialLang={lang}>{children}</SessionProvider>
      </body>
    </html>
  );
}
