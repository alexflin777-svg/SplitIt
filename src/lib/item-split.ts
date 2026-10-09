/**
 * Распределение расхода по позициям чека (F6, «По позициям»).
 *
 * Каждая позиция делится поровну между отмеченными у неё участниками (в
 * копейках, через splitEvenly). Получившиеся суммы — веса: итог расхода
 * раскладывается пропорционально им методом наибольшего остатка. Так
 * нераспределённая разница (скидка, чаевые, обслуживание, налог) делится
 * пропорционально, а итог в валюте события может отличаться от суммы чека
 * (конвертация). Инварианты: сумма долей строго равна итогу в копейках,
 * доли неотрицательны и конечны.
 */

import { splitEvenly } from './money';

export interface ItemAssignment {
  /** Сумма позиции (в валюте чека). */
  total: number;
  /** Кто ел/пользовался. Пусто — делится на всех из allMemberIds. */
  memberIds: string[];
}

/**
 * @param expenseTotal итог, который нужно разложить (в валюте события).
 * @param items позиции с участниками.
 * @param allMemberIds участники для позиций без отметок и для запасного
 *   варианта «поровну», когда у позиций нет суммы.
 * @returns доли по участникам; участники с нулевой долей не включаются.
 */
export function allocateByItems(
  expenseTotal: number,
  items: ItemAssignment[],
  allMemberIds: string[] = [],
): Record<string, number> {
  const totalCents = Math.round(expenseTotal * 100);
  if (!Number.isFinite(expenseTotal) || totalCents <= 0) return {};

  const everyone = allMemberIds.length > 0 ? allMemberIds : [...new Set(items.flatMap((i) => i.memberIds))];
  const weights = new Map<string, number>();

  for (const item of items) {
    const members = item.memberIds.length > 0 ? item.memberIds : everyone;
    const itemCents = Math.round(item.total * 100);
    if (!Number.isFinite(itemCents) || itemCents <= 0 || members.length === 0) continue;
    splitEvenly(itemCents / 100, members.length).forEach((share, i) => {
      const id = members[i];
      weights.set(id, (weights.get(id) ?? 0) + Math.round(share * 100));
    });
  }

  const weightSum = [...weights.values()].reduce((s, w) => s + w, 0);
  if (weightSum <= 0) {
    // У позиций нет суммы — честный запасной вариант: поровну на всех.
    if (everyone.length === 0) return {};
    const even = splitEvenly(totalCents / 100, everyone.length);
    const result: Record<string, number> = {};
    everyone.forEach((id, i) => {
      if (even[i] > 0) result[id] = even[i];
    });
    return result;
  }

  // Наибольший остаток: floor по пропорции, затем оставшиеся копейки тем,
  // у кого дробная часть больше (при равенстве — по порядку появления).
  const shares = [...weights.entries()].map(([id, w]) => {
    const exact = (totalCents * w) / weightSum;
    return { id, exact, cents: Math.floor(exact) };
  });
  let left = totalCents - shares.reduce((s, r) => s + r.cents, 0);
  const order = shares
    .map((r, idx) => ({ idx, frac: r.exact - r.cents }))
    .sort((a, b) => b.frac - a.frac || a.idx - b.idx);
  for (const { idx } of order) {
    if (left <= 0) break;
    shares[idx].cents += 1;
    left -= 1;
  }

  const result: Record<string, number> = {};
  for (const r of shares) if (r.cents > 0) result[r.id] = r.cents / 100;
  return result;
}
