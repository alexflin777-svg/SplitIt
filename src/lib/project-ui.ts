/**
 * Чистые функции экранов «Проекта» (этап 3в): ввод сумм и количеств, правило
 * полей часов/штук, шаблоны условий, состояние согласия. Без React и сети —
 * покрыты test/project-ui.test.mjs.
 */

import { allocate, formatRub as coreRub } from './project-calc';

/** Сумма для экрана: как formatRub ядра, но с неразрывными пробелами — «150 000 ₽» не рвётся по строкам. */
export function formatRub(cents: number): string {
  return coreRub(cents).replace(/ /g, ' ');
}

/** «октябрь» → «Октябрь» в начале фразы. */
export function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
import type { RemainderMethod, TermLine, Terms } from './project-calc';
import type { ProjectData, TermsPreset, TermsRow } from './projects-store';

type T = (key: string, vars?: Record<string, string | number>) => string;

// ---------------------------------------------------------------- ввод

/** «60 000», «1500,5», «1 500.50» → копейки; пусто, мусор или > 2 знаков → null. */
export function parseRub(input: string): number | null {
  const s = input.replace(/[\s ₽]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [int, frac = ''] = s.split('.');
  const cents = Number(int) * 100 + Number(frac.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}

/** «10», «2,5», «0.25» → сотые; null, если не число ≥ 0 с ≤ 2 знаками. */
export function parseQty(input: string): number | null {
  return parseRub(input);
}

/** Сотые → «10», «2,5». */
export function formatQty(hundredths: number): string {
  return (hundredths / 100).toString().replace('.', ',');
}

/** Копейки → строка для поля ввода: 1500000 → «15000», 150 → «1,5». */
export function centsToInput(cents: number): string {
  return cents ? formatQty(cents) : '';
}

export const MAX_HOURS = 999_900; // 9 999 ч в сотых
export const MAX_PIECES = 100_000_000; // 1 000 000 шт. в сотых

// ---------------------------------------------------------------- правило полей §3а.1

/**
 * Какие количества нужны участнику по условиям периода (то же проверяет set_quantity):
 * часы — ставка «за час» или остаток «по часам»; штуки — только ставка «за штуку».
 */
export function quantityFields(line: TermLine | undefined, method: RemainderMethod): { hours: boolean; pieces: boolean } {
  const hours = line?.rate.type === 'hourly' || (method === 'hours' && !!line?.inRemainder);
  const pieces = line?.rate.type === 'piece';
  return { hours, pieces };
}

/** Зачем часы: для ставки (живой расчёт «10 ч × 1 500 ₽») или только для доли остатка. */
export function hoursPurpose(line: TermLine | undefined): 'rate' | 'remainder' {
  return line?.rate.type === 'hourly' ? 'rate' : 'remainder';
}

/** Живой расчёт под полем: ставка × количество, половина копейки — вверх (как в ядре). */
export function rateTimes(rateCents: number, qtyHundredths: number): number {
  return Math.floor((rateCents * qtyHundredths + 50) / 100);
}

// ---------------------------------------------------------------- шаблоны §3а.3

export const PRESETS: TermsPreset[] = ['equal', 'a', 'b', 'v', 'custom'];

function line(memberId: string, patch: Partial<TermLine> = {}): TermLine {
  return {
    memberId,
    expensesBack: true,
    rate: { type: 'none', amount: 0 },
    inRemainder: true,
    shareBp: 0,
    contribNew: 0,
    contribKind: 'money',
    debtWriteOff: 0,
    ...patch,
  };
}

/** Шаблон только заполняет карточки; дальше всё правится (§3а.3). */
export function applyPreset(preset: TermsPreset, memberIds: string[]): Terms {
  const shares = allocate(10_000, memberIds.map(() => 1));
  switch (preset) {
    case 'equal':
      return { contribEnabled: false, remainderMethod: 'equal', lines: memberIds.map((id) => line(id, { expensesBack: false })) };
    case 'b':
    case 'v':
      return {
        contribEnabled: preset === 'v',
        remainderMethod: 'percent',
        lines: memberIds.map((id, i) => line(id, { rate: { type: 'period', amount: 0 }, shareBp: shares[i] })),
      };
    default:
      return { contribEnabled: false, remainderMethod: 'equal', lines: memberIds.map((id) => line(id)) };
  }
}

/** Смена способа остатка: при «по %» доли раздаются поровну участвующим, иначе обнуляются. */
export function withMethod(terms: Terms, method: RemainderMethod): Terms {
  const inRem = terms.lines.filter((l) => l.inRemainder).map((l) => l.memberId);
  const shares = allocate(10_000, inRem.map(() => 1));
  return {
    ...terms,
    remainderMethod: method,
    lines: terms.lines.map((l) => ({
      ...l,
      shareBp: method === 'percent' && l.inRemainder ? shares[inRem.indexOf(l.memberId)] : 0,
    })),
  };
}

/** Строка свёрнутой карточки: «расходы назад · 20 000 ₽ за период · 40 %». */
export function lineSummary(l: TermLine, terms: Terms, t: T): string {
  const parts = [l.expensesBack ? t('project.sum.expensesBack') : t('project.sum.ownExpenses')];
  if (terms.contribEnabled && l.contribNew > 0) {
    parts.push(
      l.contribKind === 'item'
        ? t('project.sum.contribItem', { what: l.contribNote ?? '', amount: formatRub(l.contribNew) })
        : t('project.sum.contribMoney', { amount: formatRub(l.contribNew) }),
    );
  }
  if (l.rate.type !== 'none') parts.push(t(`project.sum.rate.${l.rate.type}`, { amount: formatRub(l.rate.amount) }));
  if (!l.inRemainder) parts.push(t('project.sum.noRemainder'));
  else if (terms.remainderMethod === 'percent') parts.push(`${formatQty(l.shareBp)} %`);
  return parts.join(' · ');
}

// ---------------------------------------------------------------- согласие

export interface ConsentState {
  /** Условия, ждущие ответа (предложенные или первоначальные периода 1). */
  pending: TermsRow | null;
  /** Участники с аккаунтом, чьего согласия ещё нет. */
  waiting: string[];
  /** Мой ответ на pending. */
  answered: 'accept' | 'decline' | null;
  /** Итог можно подводить: условия периода приняты всеми. */
  canClose: boolean;
  /** Последнее отклонение (новее действующих условий): кто не согласен. */
  declinedBy: string | null;
}

/** Кто ещё не принял условия: правило close_period / project_try_activate. */
export function consentState(data: ProjectData, myUserId: string | null): ConsentState {
  const open = data.periods.find((p) => p.status === 'open');
  const users = data.members.filter((m) => m.kind === 'user' && m.status === 'active');
  const accepted = (termsId: string) =>
    new Set(data.approvals.filter((a) => a.terms_id === termsId && a.decision === 'accept').map((a) => a.user_id));
  const proposed = [...data.terms].reverse().find((x) => x.status === 'proposed') ?? null;
  const current = open ? data.terms.find((x) => x.id === open.terms_id) ?? null : null;
  // Первоначальные условия ждут и вошедших по приглашению до первого итога.
  const initialPending =
    !proposed && current && open?.seq === 1 && users.some((u) => !accepted(current.id).has(u.user_id ?? '')) ? current : null;
  const pending = proposed ?? initialPending;
  const waiting = pending ? users.filter((u) => !accepted(pending.id).has(u.user_id ?? '')).map((u) => u.display_name) : [];
  const mine = pending ? data.approvals.find((a) => a.terms_id === pending.id && a.user_id === myUserId) : undefined;
  const canClose =
    !!current && current.status === 'active' && (open?.seq !== 1 || users.every((u) => accepted(current.id).has(u.user_id ?? '')));
  const rejected = [...data.terms].reverse().find((x) => x.status === 'rejected');
  const decliner = rejected ? data.approvals.find((a) => a.terms_id === rejected.id && a.decision === 'decline') : undefined;
  const declinedBy =
    rejected && !proposed && rejected.created_at >= (current?.created_at ?? '')
      ? data.members.find((m) => m.user_id === decliner?.user_id)?.display_name ?? null
      : null;
  return { pending, waiting, answered: mine?.decision ?? null, canClose, declinedBy };
}

// ---------------------------------------------------------------- период

/** «октябрь» для периода: месяц открытия. */
export function monthName(iso: string, locale: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat(locale, { month: 'long' }).format(d);
}
