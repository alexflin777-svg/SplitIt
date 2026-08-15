'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Home, Users, User, LogIn, LogOut } from 'lucide-react';
import { getActiveSession, signOutUser } from '@/lib/supabase';
import { useI18n } from '@/lib/i18n/provider';

export default function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useI18n();
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    const refresh = () => {
      void getActiveSession().then((session) => setIsAuthenticated(Boolean(session)));
    };
    refresh();
    window.addEventListener('splitit_profile_changed', refresh);
    return () => window.removeEventListener('splitit_profile_changed', refresh);
  }, []);

  const navItems = [
    { href: '/', label: t('nav.home'), icon: Home },
    { href: '/friends', label: t('nav.friends'), icon: Users },
    { href: '/profile', label: t('nav.profile'), icon: User },
  ];

  const handleAuthAction = async () => {
    if (isAuthenticated) {
      if (!window.confirm(t('common.confirmSignOut'))) return;
      await signOutUser();
    }
    router.push('/auth?mode=login');
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] pointer-events-none">
      <div className="max-w-md mx-auto glass-panel rounded-2xl border border-slate-200/90 dark:border-slate-700/60 shadow-xl p-1.5 flex items-center justify-around pointer-events-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href || (item.href !== '/' && pathname?.startsWith(item.href));

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center gap-1 py-1.5 px-3.5 rounded-xl transition-all text-xs font-bold ${
                isActive
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-500/30 font-extrabold'
                  : 'text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-slate-100/80 dark:hover:bg-slate-700/60'
              }`}
            >
              <Icon className={`w-5 h-5 ${isActive ? 'text-white' : ''}`} />
              <span className="truncate max-w-xs">{item.label}</span>
            </Link>
          );
        })}

        <button
          type="button"
          onClick={handleAuthAction}
          className={`flex flex-col items-center gap-1 py-1.5 px-3.5 rounded-xl transition-all text-xs font-bold ${
            pathname === '/auth'
              ? 'bg-blue-600 text-white shadow-md shadow-blue-500/30 font-extrabold'
              : 'text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-slate-100/80 dark:hover:bg-slate-700/60'
          }`}
        >
          {isAuthenticated ? <LogOut className="w-5 h-5" /> : <LogIn className="w-5 h-5" />}
          <span>{isAuthenticated ? t('profile.signOut') : t('auth.signIn')}</span>
        </button>
      </div>
    </nav>
  );
}
