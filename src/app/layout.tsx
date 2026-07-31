import type { Metadata } from 'next';
import './globals.css';
import Link from 'next/link';
import { Home, Users, User, PlusCircle, LogOut } from 'lucide-react';

export const metadata: Metadata = {
  title: 'SplitIt — Совместные расходы и сплит-чеки',
  description: 'Удобное приложение для разделения чеков, отслеживания совместных расходов и оптимизации долгов в поездках и компаниях.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru" className="light">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen flex flex-col bg-[#f8f9ff] text-[#0b1c30] font-sans antialiased">
        {/* Top Navbar */}
        <header className="sticky top-0 z-40 w-full glass-panel border-b border-slate-200/80 px-4 py-3">
          <div className="max-w-md mx-auto flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2 group">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white font-bold text-lg shadow-md group-hover:scale-105 transition-transform">
                S
              </div>
              <div>
                <span className="font-extrabold text-xl tracking-tight text-slate-900">
                  Split<span className="text-blue-600">It</span>
                </span>
                <span className="block text-[10px] uppercase font-semibold tracking-wider text-slate-400 -mt-1">
                  Сплит-Чек 2.0
                </span>
              </div>
            </Link>

            <div className="flex items-center gap-2">
              <Link
                href="/events/new"
                className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-all active:scale-95"
              >
                <PlusCircle className="w-4 h-4" />
                <span>Событие</span>
              </Link>
            </div>
          </div>
        </header>

        {/* Main Content Container */}
        <main className="flex-1 max-w-md w-full mx-auto p-4 pb-24">
          {children}
        </main>

        {/* Bottom Navigation Bar */}
        <nav className="fixed bottom-0 left-0 right-0 z-50 p-3 pointer-events-none">
          <div className="max-w-md mx-auto glass-panel rounded-2xl border border-slate-200/90 shadow-xl p-1.5 flex items-center justify-around pointer-events-auto">
            <Link
              href="/"
              className="flex flex-col items-center gap-1 py-1.5 px-3.5 rounded-xl text-slate-600 hover:text-blue-600 hover:bg-blue-50/80 transition-all font-medium text-xs"
            >
              <Home className="w-5 h-5" />
              <span>События</span>
            </Link>

            <Link
              href="/friends"
              className="flex flex-col items-center gap-1 py-1.5 px-3.5 rounded-xl text-slate-600 hover:text-blue-600 hover:bg-blue-50/80 transition-all font-medium text-xs"
            >
              <Users className="w-5 h-5" />
              <span>Друзья</span>
            </Link>

            <Link
              href="/profile"
              className="flex flex-col items-center gap-1 py-1.5 px-3.5 rounded-xl text-slate-600 hover:text-blue-600 hover:bg-blue-50/80 transition-all font-medium text-xs"
            >
              <User className="w-5 h-5" />
              <span>Профиль</span>
            </Link>

            <Link
              href="/auth"
              className="flex flex-col items-center gap-1 py-1.5 px-3.5 rounded-xl text-slate-600 hover:text-red-600 hover:bg-red-50/80 transition-all font-medium text-xs"
              title="Вход / Выход из аккаунта"
            >
              <LogOut className="w-5 h-5" />
              <span>Выход</span>
            </Link>
          </div>
        </nav>
      </body>
    </html>
  );
}
