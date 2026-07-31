import type { Metadata } from 'next';
import './globals.css';
import Link from 'next/link';
import { PlusCircle } from 'lucide-react';
import BottomNav from '@/components/BottomNav';

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
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </head>
      <body className="min-h-screen flex flex-col bg-[#f8f9ff] dark:bg-[#0b0f19] text-[#0b1c30] dark:text-[#f8fafc] font-sans antialiased">
        {/* Top Navbar with Responsive Mobile Safe Area Support */}
        <header className="sticky top-0 z-40 w-full glass-panel border-b border-slate-200/80 dark:border-slate-800/80 px-4 pt-3 sm:pt-4 pb-3">
          <div className="max-w-md mx-auto flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2 group">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white font-bold text-lg shadow-md group-hover:scale-105 transition-transform">
                S
              </div>
              <div>
                <span className="font-extrabold text-xl tracking-tight text-slate-900 dark:text-white">
                  Split<span className="text-blue-600 dark:text-blue-400">It</span>
                </span>
                <span className="block text-[10px] uppercase font-semibold tracking-wider text-slate-400 dark:text-slate-400 -mt-1">
                  Сплит-Чек 2.4-OTA
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

        {/* Main Content Container with Fixed Width Guard */}
        <main className="flex-1 max-w-md w-full mx-auto p-4 pb-24 space-y-4">
          {children}
        </main>

        {/* Bottom Navigation Bar */}
        <BottomNav />
      </body>
    </html>
  );
}
