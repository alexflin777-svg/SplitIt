/**
 * Блок «жизненные ситуации» на лендинге.
 *
 * Контент намеренно захардкожен по-русски: первый контент-тест идёт на RU
 * (решение владельца 2026-09-10). Перевод на остальные языки — отдельная
 * фаза вместе с мультиязычным маркет-сайтом; тогда тексты переедут в i18n.
 * Источник текстов: vault operations/marketing/outputs/
 * 2026-09-10-splitit-content-pack-ru.md (сокращённые версии).
 */
import Link from 'next/link';
import { Waves, Snowflake, PartyPopper, Trees } from 'lucide-react';

const SITUATIONS = [
  {
    icon: Waves,
    title: 'Море вчетвером',
    text:
      'Аня бронировала жильё, Миша платил за дорогу, Лена — за продукты. «Потом посчитаем» наступило в последний вечер. Вместо раскопок в чате — понятный расчёт: кто кому и сколько. Арбуз, кстати, оказался Мишин.',
    hook: 'Из отпуска привезли загар, ракушки и вопрос: «А арбуз чей был?»',
  },
  {
    icon: Snowflake,
    title: 'Горнолыжный уикенд',
    text:
      'Подъёмники, прокат, домик и глинтвейн — платили по очереди, кто был ближе к кассе. Вечером все увидели общий расчёт без установки приложения: организатор ведёт расходы, остальные просто смотрят итог.',
    hook: 'На склоне разобрались, кто за кем. После склона — кто кому.',
  },
  {
    icon: PartyPopper,
    title: 'Девичник без неловкости',
    text:
      'Праздник удался, а утром в чате не появилось длинное сообщение с расчётами. Организатор внесла общие траты, каждая увидела свою долю — и деньги перестали быть темой, о которой неудобно говорить.',
    hook: 'Пусть сюрпризом будет торт, а не сумма в чате на следующее утро.',
  },
  {
    icon: Trees,
    title: 'Дача и шашлыки',
    text:
      'Мясо, уголь, доставка и «я докупил соус по дороге». Общие покупки — в расчёт, личные угощения — нет. После ужина вопрос денег занял две минуты, и компания вернулась к настольной игре.',
    hook: 'Шашлык закончился. Хлеб остался. Кто кому должен — уже понятно.',
  },
] as const;

export function LifeSituations() {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-extrabold text-slate-900 dark:text-white">
        Знакомые ситуации?
      </h3>
      <div className="grid grid-cols-1 gap-2.5">
        {SITUATIONS.map((s) => (
          <article key={s.title} className="stitch-card space-y-2 bg-white p-4 dark:bg-slate-800">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600 dark:bg-emerald-900/50 dark:text-emerald-400">
                <s.icon className="h-5 w-5" />
              </div>
              <h4 className="min-w-0 truncate text-sm font-extrabold text-slate-900 dark:text-white">
                {s.title}
              </h4>
            </div>
            <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">{s.text}</p>
            <p className="text-[11px] font-semibold italic text-slate-400 dark:text-slate-500">
              {s.hook}
            </p>
          </article>
        ))}
      </div>
      <p className="pt-1 text-center">
        <Link
          href="/feedback"
          className="text-xs font-bold text-emerald-600 underline dark:text-emerald-400"
        >
          Расскажите свою ситуацию — мы читаем всё
        </Link>
      </p>
    </section>
  );
}
