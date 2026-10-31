'use client';

/**
 * Кирпичи языка V1 (макеты 1.1.0, stage2/screens/v1.css + s2.css) на Tailwind:
 * светлое поле, белые карточки, смысловой цвет (мята — тебе, персик — ты),
 * синий — только у одной главной кнопки внизу.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronLeft, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useI18n } from '@/lib/i18n/provider';

export function cx(...c: Array<string | false | null | undefined>): string {
  return c.filter(Boolean).join(' ');
}

const AVATAR_BG = ['bg-v1-trip', 'bg-[#DAE8DF]', 'bg-[#FAD3E1]', 'bg-v1-sand', 'bg-v1-minus', 'bg-v1-lav'];

/** Пастель на человека по порядку в проекте/событии. */
export function avatarBg(index: number): string {
  return AVATAR_BG[((index % AVATAR_BG.length) + AVATAR_BG.length) % AVATAR_BG.length];
}

export function Avatar({ name, index = 0, size = 'm' }: { name: string; index?: number; size?: 's' | 'm' | 'l' }) {
  const s = size === 's' ? 'w-8 h-8 text-sm' : size === 'l' ? 'w-14 h-14 text-xl' : 'w-10 h-10 text-base';
  return (
    <span aria-hidden="true" className={cx('rounded-full grid place-items-center font-bold flex-none text-v1-ink', s, avatarBg(index))}>
      {(name.trim()[0] ?? '?').toUpperCase()}
    </span>
  );
}

/**
 * Экраны «Проекта» — сосредоточенные: без нижней навигации и «+ Событие» в шапке,
 * чтобы не спорить с главной кнопкой (макеты h1–h3).
 */
export function isFocusRoute(pathname: string | null): boolean {
  return !!pathname && pathname.startsWith('/projects/');
}

/** Экран V1: своё поле и шрифт; dock — главная кнопка внизу (над навигацией, если она есть). */
export function V1Screen({ children, dock, testId }: { children: ReactNode; dock?: ReactNode; testId?: string }) {
  const focus = isFocusRoute(usePathname());
  const dockRef = useRef<HTMLDivElement>(null);
  const [dockH, setDockH] = useState(0);
  const hasDock = !!dock;
  useEffect(() => {
    const el = dockRef.current;
    if (!el) return setDockH(0);
    const ro = new ResizeObserver(() => setDockH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasDock]);
  return (
    // -mb снимает нижний отступ main (layout.tsx): под экраном не видна полоса фона страницы; место под кнопкой даёт распорка.
    <div
      data-testid={testId}
      className="font-v1 text-v1-ink bg-v1-bg -mx-4 -mt-4 -mb-[calc(10rem+env(safe-area-inset-bottom,0px))] px-4 pt-3 pb-6 min-h-[calc(100vh-4rem)] tabular-nums"
    >
      {children}
      {/* Отступ прокрутки = высоте закреплённого блока: последний элемент не уходит под кнопку. */}
      {dock && <div aria-hidden="true" style={{ height: dockH }} />}
      {/* Без кнопки, но с навигацией внизу (не focus-маршрут): место под навигацию. */}
      {!dock && !focus && <div aria-hidden="true" data-testid="v1-nav-spacer" className="h-[calc(6rem+env(safe-area-inset-bottom,0px))]" />}
      {dock && (
        <div
          ref={dockRef}
          data-testid="v1-dock"
          className={cx(
            'fixed left-0 right-0 z-40 px-4 pt-3 bg-v1-bg',
            // Фон до низа экрана, под навигацией: между кнопкой и навигацией содержимое не просвечивает.
            focus ? 'bottom-0 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]' : 'bottom-0 pb-[calc(6rem+env(safe-area-inset-bottom,0px))]',
          )}
        >
          <div className="max-w-md mx-auto">{dock}</div>
        </div>
      )}
    </div>
  );
}

export function TopNav({ back, onBack, right, close }: { back?: string; onBack?: () => void; right?: ReactNode; close?: boolean }) {
  const { t } = useI18n();
  const cls = 'w-11 h-11 rounded-full bg-v1-card grid place-items-center';
  const label = close ? t('common.close') : t('common.back');
  const icon = close ? <X className="w-6 h-6" aria-hidden="true" /> : <ChevronLeft className="w-6 h-6" aria-hidden="true" />;
  return (
    <div className="h-[52px] flex items-center justify-between">
      {onBack ? (
        <button type="button" onClick={onBack} aria-label={label} className={cls} data-testid="nav-back">
          {icon}
        </button>
      ) : back ? (
        <Link href={back} aria-label={label} className={cls} data-testid="nav-back">
          {icon}
        </Link>
      ) : (
        <span />
      )}
      {right}
    </div>
  );
}

export function PillLink({ href, children, onClick, testId }: { href?: string; children: ReactNode; onClick?: () => void; testId?: string }) {
  const cls = 'h-11 px-[18px] pl-3.5 rounded-full bg-v1-card inline-flex items-center gap-2 font-semibold text-[15px]';
  return href ? (
    <Link href={href} className={cls} data-testid={testId}>
      {children}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={cls} data-testid={testId}>
      {children}
    </button>
  );
}

export function Header({ title, sub, kicker }: { title: ReactNode; sub?: ReactNode; kicker?: ReactNode }) {
  return (
    <div className="pt-1 pb-4">
      {kicker && (
        <span className="inline-flex h-[30px] items-center px-3 mb-2 rounded-full bg-v1-lav text-sm font-bold">{kicker}</span>
      )}
      <h1 className="text-[30px] leading-[1.08] font-extrabold tracking-[-0.02em] text-balance">{title}</h1>
      {sub && <p className="mt-1.5 text-base font-medium text-v1-ink2">{sub}</p>}
    </div>
  );
}

export function BlockHead({ title, right }: { title: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 mt-[22px] mb-3">
      <h2 className="text-xl leading-tight font-extrabold tracking-[-0.01em]">{title}</h2>
      {right && <span className="text-[15px] font-semibold text-v1-muted">{right}</span>}
    </div>
  );
}

type BtnProps = {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  href?: string;
  testId?: string;
  type?: 'button' | 'submit';
};

/** Главная кнопка: одна на экран. */
export function MainButton({ children, onClick, disabled, href, testId, type = 'button' }: BtnProps) {
  const cls = cx(
    'w-full h-14 rounded-full flex items-center justify-center gap-2.5 font-bold text-[17px] transition-transform active:scale-[0.97]',
    disabled ? 'bg-[#DFE2E8] text-v1-muted' : 'bg-v1-accent text-white active:bg-v1-accent-press',
  );
  if (href && !disabled) {
    return (
      <Link href={href} className={cls} data-testid={testId}>
        {children}
      </Link>
    );
  }
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={cls} data-testid={testId}>
      {children}
    </button>
  );
}

export function SecondButton({ children, onClick, disabled, href, testId }: BtnProps) {
  const cls = 'w-full h-[52px] mt-2 rounded-full bg-v1-card flex items-center justify-center gap-2.5 font-bold text-base disabled:opacity-60';
  if (href) {
    return (
      <Link href={href} className={cls} data-testid={testId}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={cls} data-testid={testId}>
      {children}
    </button>
  );
}

export function Chip({ on, onClick, children, testId }: { on?: boolean; onClick?: () => void; children: ReactNode; testId?: string }) {
  return (
    <button
      type="button"
      aria-pressed={!!on}
      onClick={onClick}
      data-testid={testId}
      className={cx(
        'h-11 inline-flex items-center gap-2 px-4 rounded-full font-semibold text-[15px] transition-transform active:scale-95',
        on ? 'bg-v1-accent-soft text-v1-accent-ink shadow-[inset_0_0_0_2px_var(--v1-accent)]' : 'bg-v1-card',
      )}
    >
      {children}
    </button>
  );
}

export function Segment<V extends string>({
  options,
  value,
  onChange,
  inCard,
}: {
  options: Array<{ value: V; label: ReactNode }>;
  value: V;
  onChange: (v: V) => void;
  inCard?: boolean;
}) {
  return (
    <div role="tablist" className={cx('flex gap-1 p-1 rounded-full mb-3', inCard ? 'bg-v1-bg' : 'bg-v1-card')}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'flex-1 rounded-full font-bold text-[15px]',
            inCard ? 'h-10' : 'h-11',
            value === o.value ? 'bg-v1-ink text-white' : 'text-v1-ink2',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ on, onChange, label, testId }: { on: boolean; onChange: (v: boolean) => void; label: string; testId?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      data-testid={testId}
      onClick={() => onChange(!on)}
      className={cx('relative w-[52px] h-8 rounded-full flex-none transition-colors', on ? 'bg-v1-ink' : 'bg-[#DFE2E8]')}
    >
      <span className={cx('absolute top-[3px] w-[26px] h-[26px] rounded-full bg-white transition-all', on ? 'left-[23px]' : 'left-[3px]')} />
    </button>
  );
}

export function Card({ children, className, testId }: { children: ReactNode; className?: string; testId?: string }) {
  return (
    <div data-testid={testId} className={cx('bg-v1-card rounded-card p-4', className)}>
      {children}
    </div>
  );
}

export function Row({
  left,
  title,
  meta,
  right,
  className,
  onClick,
  testId,
}: {
  left?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  right?: ReactNode;
  className?: string;
  onClick?: () => void;
  testId?: string;
}) {
  const body = (
    <>
      {left}
      <div className="flex-1 min-w-0 text-left">
        <div className="text-base font-semibold leading-tight">{title}</div>
        {meta && <div className="mt-0.5 text-[14px] text-v1-muted leading-snug">{meta}</div>}
      </div>
      {right && <div className="text-[17px] font-bold tracking-[-0.01em] whitespace-nowrap">{right}</div>}
    </>
  );
  const cls = cx('w-full flex items-center gap-3 min-h-16 py-3 pr-4 pl-3 bg-v1-card rounded-row', className);
  return onClick ? (
    <button type="button" onClick={onClick} className={cls} data-testid={testId}>
      {body}
    </button>
  ) : (
    <div className={cls} data-testid={testId}>
      {body}
    </div>
  );
}

/** Плашка: ok — мята, err — ошибка, info — белая, warn — песок (последствия). */
export function Plaque({ kind, children, testId }: { kind: 'ok' | 'err' | 'info' | 'warn'; children: ReactNode; testId?: string }) {
  const bg = { ok: 'bg-v1-plus', err: 'bg-v1-warn', info: 'bg-v1-card text-v1-ink2', warn: 'bg-v1-sand' }[kind];
  const Icon = kind === 'ok' ? CheckCircle2 : kind === 'info' ? Info : AlertTriangle;
  return (
    <div
      role={kind === 'err' ? 'alert' : undefined}
      data-testid={testId}
      className={cx('flex items-start gap-2.5 px-3.5 py-3 mb-2 rounded-row text-[15px] leading-snug', bg)}
    >
      <Icon className={cx('w-5 h-5 mt-px flex-none', kind === 'err' && 'text-v1-danger')} aria-hidden="true" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Карточка числа: мята — тебе, персик — ты. */
export function NumCard({ tone, label, amount, cap, testId }: { tone: 'plus' | 'minus'; label: string; amount: string; cap?: string; testId?: string }) {
  return (
    <div data-testid={testId} className={cx('rounded-card px-[18px] pt-3.5 pb-4', tone === 'plus' ? 'bg-v1-plus' : 'bg-v1-minus')}>
      <div className="text-[15px] font-semibold text-v1-ink2">{label}</div>
      <div className="mt-1.5 text-[28px] leading-none font-extrabold tracking-[-0.03em] whitespace-nowrap">{amount}</div>
      {cap && <div className="mt-2 text-sm text-v1-ink2">{cap}</div>}
    </div>
  );
}

/** Серые заглушки той же формы вместо спиннера на весь экран. */
export function Skeleton({ rows = 3, tall }: { rows?: number; tall?: boolean }) {
  return (
    <div className="space-y-2" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={cx('rounded-row bg-v1-fill animate-pulse', tall ? 'h-28' : 'h-16')} />
      ))}
    </div>
  );
}

/** Поле суммы/числа в карточке. */
export function NumInput({
  value,
  onChange,
  label,
  suffix,
  invalid,
  testId,
  wide,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  suffix?: string;
  invalid?: boolean;
  testId?: string;
  wide?: boolean;
}) {
  return (
    <label
      className={cx(
        'inline-flex items-center h-11 px-3.5 rounded-chip font-extrabold text-[17px]',
        wide && 'w-full',
        invalid ? 'bg-v1-warn shadow-[inset_0_0_0_2px_#D93A2B] text-v1-danger' : 'bg-v1-bg shadow-[inset_0_0_0_2px_#DFE2E8]',
      )}
    >
      <span className="sr-only">{label}</span>
      <input
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid={testId}
        aria-label={label}
        aria-invalid={invalid || undefined}
        placeholder="0"
        className="bg-transparent outline-none min-w-0 w-full font-extrabold"
        size={Math.max(2, value.length + 1)}
      />
      {suffix && <span className="ml-1 text-v1-ink2">{suffix}</span>}
    </label>
  );
}
