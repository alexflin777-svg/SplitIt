/**
 * Валидация денежных сумм.
 *
 * Раньше во всех трёх формах стояла проверка `if (!parsedAmount) return`.
 * Она отсекает ноль и NaN, но отрицательное число truthy, поэтому расход
 * на −1000 ₽ спокойно сохранялся: итог события уходил в минус, а в split
 * записывалось `amountOwed: -1000`, что переворачивает знак долга у всей
 * группы.
 *
 * Ограничение продублировано в БД (CHECK-констрейнты в миграции): клиентскую
 * проверку можно обойти, серверную — нет.
 */

/** Верхняя граница, за которой почти наверняка опечатка, а не сумма. */
const MAX_AMOUNT = 1_000_000_000;

export interface ParsedAmount {
  value: number | null;
  error: string | null;
}

export function parseAmount(raw: string | number): ParsedAmount {
  const value = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(',', '.'));

  if (!Number.isFinite(value)) return { value: null, error: 'Введите сумму числом' };
  if (value === 0) return { value: null, error: 'Сумма не может быть нулевой' };
  if (value < 0) return { value: null, error: 'Сумма не может быть отрицательной' };
  if (value > MAX_AMOUNT) return { value: null, error: 'Сумма слишком велика — проверьте, нет ли опечатки' };

  // Копейки: две значащие цифры после запятой.
  return { value: Math.round(value * 100) / 100, error: null };
}

/** Атрибуты для `<input type="number">`, чтобы браузер отсекал минус до сабмита. */
export const AMOUNT_INPUT_PROPS = {
  min: '0.01',
  step: '0.01',
  inputMode: 'decimal' as const,
};
