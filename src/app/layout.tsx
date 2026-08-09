import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import Link from 'next/link';
import { PlusCircle } from 'lucide-react';
import BottomNav from '@/components/BottomNav';
import { routes } from '@/lib/routes';
import { I18nProvider } from '@/lib/i18n/provider';
import HeaderNavLabel from '@/components/HeaderNavLabel';
import { PushInit } from '@/components/PushInit';

/**
 * Шрифт вшивается в сборку, а не тянется с fonts.googleapis.com.
 *
 * Приложение позиционируется как offline-first и уезжает в APK: запрос к CDN
 * там просто не проходит без сети, и вся типографика откатывалась на системный
 * шрифт. next/font кладёт файлы в out/_next/static/media на этапе сборки.
 */
const inter = Inter({
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: 'SplitIt — Split Bills & Shared Expenses',
  description: 'The easy way to split bills, track shared expenses, and settle up with friends on trips and in groups.',
  icons: {
    icon: '/icon.svg',
    shortcut: '/icon.svg',
    apple: '/icon.svg',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`light ${inter.variable}`}>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </head>
      <body className="min-h-screen flex flex-col bg-[#f8f9ff] dark:bg-[#0b0f19] text-[#0b1c30] dark:text-[#f8fafc] font-sans antialiased">
        <I18nProvider>
          <PushInit />
        {/* Top Navbar with Responsive Mobile Safe Area Support */}
        <header className="app-header sticky top-0 z-40 w-full glass-panel border-b border-slate-200/80 dark:border-slate-800/80 px-4 pt-[calc(env(safe-area-inset-top,0px)+0.75rem)] sm:pt-[calc(env(safe-area-inset-top,0px)+1rem)] pb-3">
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
                  {/* Была подпись «Сплит-Чек 2.4-OTA». Версии 2.4 не
                      существовало: её сочиняла симуляция обновлений. */}
                  Сплит-Чек
                </span>
              </div>
            </Link>

            <div className="flex items-center gap-2">
              <Link
                href={routes.eventNew()}
                className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-all active:scale-95"
              >
                <PlusCircle className="w-4 h-4" />
                <span><HeaderNavLabel /></span>
              </Link>
            </div>
          </div>
        </header>

        {/* Main Content Container with Fixed Width Guard */}
        <main className="flex-1 max-w-md w-full mx-auto p-4 pb-[calc(10rem+env(safe-area-inset-bottom,0px))] space-y-4">
          {children}
        </main>

        {/* Bottom Navigation Bar */}
        <BottomNav />
        </I18nProvider>
      </body>
    </html>
  );
}
