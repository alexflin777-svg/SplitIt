/**
 * Сохранение неравных долей при правке расхода (G1, P1-16).
 *
 * Раньше экран «Редактировать расход» при любом сохранении делил итог поровну
 * между отмеченными — доли «по позициям» и точные суммы молча затирались.
 * Здесь две операции, которыми экран пользуется вместо этого:
 *
 *   - `sameTotal` — итог не изменился: доли сохраняются как были, без пересчёта;
 *   - `rescaleSplits` — итог изменился: доли масштабируются пропорционально
 *     в копейках методом наибольшего остатка. Сумма долей строго равна новому
 *     итогу; лишние копейки получают участники с наибольшей дробной частью,
 *     при равенстве — по возрастанию userId. Не по порядку в списке: порядок
 *     вложенных строк из PostgREST не гарантирован, а результат должен быть
 *     одинаковым на всех устройствах.
 */

import { splitEvenly } from './money';

export type SplitMode = 'equal' | 'exact' | 'items' | 'shares';

export const SPLIT_MODES: readonly SplitMode[] = ['equal', 'exact', 'items', 'shares'];

export interface Split {
  userId: string;
  amountOwed: number;
}

const toCents = (amount: number) => Math.round(amount * 100);

export function totalCents(splits: Split[]): number {
  return splits.reduce((sum, s) => sum + toCents(s.amountOwed), 0);
}

/** Итог расхода совпадает с суммой долей с точностью до копейки. */
export function sameTotal(splits: Split[], total: number): boolean {
  return Number.isFinite(total) && totalCents(splits) === toCents(total);
}

/**
 * Доли совпадают с делением поровну (в любом порядке участников). Нужна для
 * расходов, у которых тип распределения не сохранён (старые записи).
 */
export function isEvenSplit(splits: Split[]): boolean {
  if (splits.length === 0) return true;
  const expected = splitEvenly(totalCents(splits) / 100, splits.length).map(toCents).sort((a, b) => a - b);
  const actual = splits.map((s) => toCents(s.amountOwed)).sort((a, b) => a - b);
  return expected.every((c, i) => c === actual[i]);
}

/**
 * Пропорционально раскладывает новый итог по весам исходных долей.
 * Порядок и состав участников сохраняются (участник с нулевой долей остаётся
 * с нулём). Если пропорции нет (все доли нулевые) или итог не положителен —
 * возвращает null: молча делить поровну нельзя, экран показывает ошибку.
 */
export function rescaleSplits(splits: Split[], newTotal: number): Split[] | null {
  const target = toCents(newTotal);
  if (!Number.isFinite(newTotal) || target <= 0 || splits.length === 0) return null;

  const weights = splits.map((s) => Math.max(0, toCents(s.amountOwed)));
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weightSum === 0) return null;

  // Целочисленно (BigInt): target × weight до 10^22 не помещается в double без
  // потери точности, а сравнивать дробные части нужно точно.
  const sum = BigInt(weightSum);
  const rows = weights.map((w) => {
    const product = BigInt(target) * BigInt(w);
    return { cents: Number(product / sum), rest: product % sum };
  });
  let left = target - rows.reduce((s, r) => s + r.cents, 0);
  const order = rows
    .map((r, idx) => ({ idx, rest: r.rest, id: splits[idx].userId }))
    .sort((a, b) => {
      if (a.rest !== b.rest) return a.rest > b.rest ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : a.idx - b.idx;
    });
  for (const { idx } of order) {
    if (left <= 0) break;
    rows[idx].cents += 1;
    left -= 1;
  }

  return splits.map((s, i) => ({ userId: s.userId, amountOwed: rows[i].cents / 100 }));
}

/** Тип распределения расхода: сохранённый или выведенный из самих долей. */
export function resolveSplitMode(expense: { splitMode?: string | null; splitType?: string | null; splits: Split[] }): SplitMode {
  if (expense.splitMode && (SPLIT_MODES as readonly string[]).includes(expense.splitMode)) {
    return expense.splitMode as SplitMode;
  }
  // Локальные расходы F6 хранили «по позициям» как splitType: 'shares'.
  if (expense.splitType === 'shares') return 'items';
  return isEvenSplit(expense.splits) ? 'equal' : 'exact';
}
