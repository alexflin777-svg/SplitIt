'use client';

/** «Что создаём?» — две плитки «Событие / Проект» (макеты h1-new, h4-new-event). */

import Link from 'next/link';
import { Check } from 'lucide-react';
import { routes } from '@/lib/routes';
import { useI18n } from '@/lib/i18n/provider';
import { cx } from './ui';

export default function KindPicker({ value }: { value: 'event' | 'project' }) {
  const { t } = useI18n();
  const tiles = [
    { kind: 'event' as const, href: routes.eventNew(), title: t('create.event'), sub: t('create.eventSub'), img: '/v1/trip.png', on: 'bg-v1-trip' },
    { kind: 'project' as const, href: routes.projectNew(), title: t('create.project'), sub: t('create.projectSub'), img: '/v1/receipts.png', on: 'bg-v1-lav' },
  ];
  return (
    <div className="font-v1 text-v1-ink">
      <h1 className="pt-1 pb-4 text-[30px] leading-[1.08] font-extrabold tracking-[-0.02em]">{t('create.title')}</h1>
      <div className="grid grid-cols-2 gap-2">
        {tiles.map((x) => {
          const on = x.kind === value;
          return (
            <Link
              key={x.kind}
              href={x.href}
              replace
              aria-current={on ? 'page' : undefined}
              data-testid={`kind-${x.kind}`}
              className={cx(
                'relative overflow-hidden isolate h-[132px] px-4 py-3.5 rounded-card flex flex-col text-left',
                on ? `${x.on} shadow-[inset_0_0_0_3px_var(--v1-accent)]` : 'bg-v1-card',
              )}
            >
              <b className="text-[21px] leading-[1.1] font-extrabold tracking-[-0.015em]">{x.title}</b>
              <span className="mt-1 text-[15px] text-v1-ink2 relative z-[1]">{x.sub}</span>
              <img src={x.img} alt="" className={cx('absolute w-[76px] -right-1 -bottom-3.5 pointer-events-none', !on && 'opacity-55')} />
              {on && (
                <span className="absolute top-3 right-3 w-7 h-7 rounded-full bg-v1-accent text-white grid place-items-center">
                  <Check className="w-[18px] h-[18px]" aria-hidden="true" />
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
