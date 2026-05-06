import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { signIn } from '@/lib/auth';
import { Sparkles, TrendingUp, Shield, Zap, Target } from 'lucide-react';

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect('/dashboard');

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center px-4 relative overflow-hidden">
      {/* Background Orbs */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-indigo-600/10 rounded-full blur-[128px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-600/10 rounded-full blur-[128px] pointer-events-none" />

      <div className="w-full max-w-md relative z-10">
        {/* Logo & Header */}
        <div className="flex flex-col items-center gap-6 mb-12">
          <div className="relative group">
            <div className="absolute inset-0 bg-indigo-500 rounded-2xl blur-xl opacity-30 group-hover:opacity-50 transition-opacity duration-500" />
            <div className="relative flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-2xl border border-white/10">
              <Sparkles className="w-10 h-10 text-white" />
            </div>
          </div>
          <div className="text-center space-y-2">
            <h1 className="text-4xl font-extrabold tracking-tight text-slate-900">
              Nova<span className="text-gradient">Fi</span>
            </h1>
            <p className="text-slate-500 text-lg font-medium">Wealth management, redefined.</p>
          </div>
        </div>

        {/* Login Card */}
        <div className="glass rounded-3xl p-8 md:p-10 shadow-2xl relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-white/50 to-transparent opacity-50 pointer-events-none" />
          
          <div className="relative z-10">
            <div className="space-y-3 mb-10">
              <h2 className="text-2xl font-bold text-slate-900 text-center tracking-tight">Welcome back</h2>
              <p className="text-slate-500 text-sm text-center leading-relaxed max-w-[280px] mx-auto font-medium">
                Securely sync your finances using your own Google Sheets.
              </p>
            </div>

            <form
              action={async () => {
                'use server';
                await signIn('google', { redirectTo: '/dashboard' });
              }}
            >
              <button
                type="submit"
                className="group w-full flex items-center justify-center gap-3 bg-white hover:bg-slate-50 border border-slate-200 text-slate-900 font-bold rounded-2xl h-14 transition-all duration-300 shadow-sm hover:shadow-md hover:-translate-y-0.5"
              >
                <div className="bg-slate-50 p-1.5 rounded-full border border-slate-100">
                  <svg viewBox="0 0 24 24" className="w-5 h-5">
                    <path
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      fill="#4285F4"
                    />
                    <path
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      fill="#34A853"
                    />
                    <path
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                      fill="#FBBC05"
                    />
                    <path
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      fill="#EA4335"
                    />
                  </svg>
                </div>
                Continue with Google
              </button>
            </form>

            <div className="mt-10 grid grid-cols-2 gap-3">
              {[
                { Icon: TrendingUp, text: 'Smart Tracking', color: 'text-indigo-500' },
                { Icon: Shield, text: '100% Private', color: 'text-emerald-500' },
                { Icon: Zap, text: 'Real-time Sync', color: 'text-amber-500' },
                { Icon: Target, text: 'Goal Setting', color: 'text-purple-500' },
              ].map(({ Icon, text, color }) => (
                <div key={text} className="flex items-center gap-2.5 text-sm text-slate-600 font-medium">
                  <div className={`shrink-0 p-1.5 rounded-lg bg-slate-50 border border-slate-100 ${color}`}>
                    <Icon className="w-3.5 h-3.5" />
                  </div>
                  <span>{text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}