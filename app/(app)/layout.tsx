import { auth, signOut } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { Sidebar, MobileNav, MobileHeader } from '@/components/Sidebar';
import { AlertTriangle } from 'lucide-react';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/');

  if (!session.spreadsheetId) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 relative overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-rose-500/10 rounded-full blur-[128px] pointer-events-none" />
        <div className="max-w-md w-full bg-white border border-rose-100 rounded-3xl p-8 text-center space-y-4 relative z-10 shadow-xl">
          <div className="flex justify-center">
            <div className="bg-rose-50 p-4 rounded-2xl border border-rose-100">
              <AlertTriangle className="w-8 h-8 text-rose-500" />
            </div>
          </div>
          <h2 className="text-slate-900 text-2xl font-bold tracking-tight">Google APIs Not Enabled</h2>
          <p className="text-slate-500 text-sm font-medium leading-relaxed">
            NovaFi could not create your spreadsheet. You need to enable two APIs in Google Cloud Console for your project.
          </p>
          <ol className="text-left text-sm text-slate-600 font-medium space-y-3 bg-slate-50 rounded-xl p-5 border border-slate-100">
            <li>1. Go to <span className="text-indigo-600 font-mono font-bold text-xs">console.cloud.google.com</span></li>
            <li>2. Navigate to <strong className="text-slate-900">APIs &amp; Services → Library</strong></li>
            <li>3. Search and enable <strong className="text-slate-900">Google Sheets API</strong></li>
            <li>4. Search and enable <strong className="text-slate-900">Google Drive API</strong></li>
            <li>5. Sign out below, then sign back in</li>
          </ol>
          <form
            action={async () => {
              'use server';
              await signOut({ redirectTo: '/' });
            }}
          >
            <button
              type="submit"
              className="w-full mt-4 bg-slate-900 text-white hover:bg-slate-800 font-bold py-3.5 px-4 rounded-xl transition-all duration-300 shadow-md hover:shadow-lg"
            >
              Sign Out &amp; Try Again
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-slate-50 pb-16 md:pb-0 relative overflow-hidden">
      <MobileHeader />
      <Sidebar />
      <main className="flex-1 min-w-0 overflow-auto relative z-10">
        {children}
      </main>
      <MobileNav />
    </div>
  );
}