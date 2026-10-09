/**
 * Догрузка всех страниц списка (G2, P1-15).
 *
 * Балансы, итог события, экспорт и «Расчёт» считались по первой странице
 * расходов (50 шт.): в событии со 120 расходами 70 молча выпадали из денег.
 * Теперь группа грузится со всеми расходами, страницами, через эту функцию.
 *
 * Свойства:
 *   - страницы запрашиваются последовательно, пока источник говорит hasMore;
 *   - дубли по id отбрасываются (между запросами страниц мог появиться новый
 *     расход и сдвинуть смещение — тогда последний элемент страницы придёт ещё раз);
 *   - любая ошибка страницы — ошибка целиком: частичный список для денег хуже
 *     честного «не удалось загрузить»;
 *   - предохранитель maxItems: вместо бесконечного цикла при сбое источника —
 *     явный отказ (overflow), текст ошибки подставляет вызывающий.
 *
 * Известное ограничение: если расход удалят между запросами страниц, смещение
 * сдвинется и один ещё не прочитанный расход может не попасть в этот снимок.
 * Окно — миллисекунды; снимок исправит следующее перечитывание группы
 * (SWR перечитывает при возврате на экран).
 */

export interface PageResult<T> {
  data: { items: T[]; hasMore: boolean } | null;
  error: string | null;
}

export async function fetchAllPages<T extends { id: string }>(
  fetchPage: (offset: number, limit: number) => Promise<PageResult<T>>,
  { pageSize = 100, maxItems = 20_000 }: { pageSize?: number; maxItems?: number } = {},
): Promise<{ data: T[] | null; error: string | null; overflow?: true }> {
  const seen = new Set<string>();
  const all: T[] = [];
  let offset = 0;

  for (;;) {
    const page = await fetchPage(offset, pageSize);
    if (page.error || !page.data) return { data: null, error: page.error };

    for (const item of page.data.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      all.push(item);
    }

    if (!page.data.hasMore || page.data.items.length === 0) return { data: all, error: null };
    offset += page.data.items.length;
    if (offset >= maxItems) return { data: null, error: null, overflow: true };
  }
}
