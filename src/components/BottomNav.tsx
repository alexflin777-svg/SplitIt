'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Users, User, LogOut } from 'lucide-react';

export default function BottomNav() {
  const pathname = usePathname();

  const navItems = [
    { href: '/', label: 'События', icon: Home },
    { href: '/friends', label: 'Друзья', icon: Users },
    { href: '/profile', label: 'Профиль', icon: User },
    { href: '/auth', label: 'Выход', icon: LogOut },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 p-3 pointer-events-none">
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
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
