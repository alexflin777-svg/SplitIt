'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PlusCircle } from 'lucide-react';
import { routes } from '@/lib/routes';
import { isFocusRoute } from '@/components/v1/ui';
import HeaderNavLabel from './HeaderNavLabel';

/** «+ Событие» в шапке; на экранах «Проекта» скрыто — там одна главная кнопка внизу. */
export default function HeaderNewEventLink() {
  const pathname = usePathname();
  // HeaderNavLabel ещё синхронизирует <html lang> — оставляем его смонтированным.
  if (isFocusRoute(pathname)) return <span hidden><HeaderNavLabel /></span>;
  return (
    <Link
      href={routes.eventNew()}
      className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-all active:scale-95"
    >
      <PlusCircle className="w-4 h-4" />
      <span>
        <HeaderNavLabel />
      </span>
    </Link>
  );
}
