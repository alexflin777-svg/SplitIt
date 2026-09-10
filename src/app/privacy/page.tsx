/**
 * Политика конфиденциальности.
 *
 * Статическая страница без клиентской логики: юридический текст должен быть
 * доступен без JS, индексироваться и открываться из Play Console по прямой
 * ссылке. Русский — основной язык беты; английское резюме в конце.
 */
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'SplitIT — Политика конфиденциальности',
  description: 'Какие данные обрабатывает SplitIT, зачем и как их удалить.',
};

const UPDATED = '10 сентября 2026';
const CONTACT = 'info@splitit-apps.com';

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 pb-28 text-[15px] leading-relaxed text-gray-800">
      <h1 className="text-2xl font-bold text-gray-900">Политика конфиденциальности SplitIT</h1>
      <p className="mt-2 text-sm text-gray-500">Обновлено: {UPDATED}</p>

      <section className="mt-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Кто мы</h2>
        <p>
          SplitIT — приложение для учёта и деления общих расходов в поездках и группах
          (веб-версия на splitit-apps.com и приложение для Android). Оператор данных:
          владелец сервиса SplitIT; контакт для вопросов о данных: {CONTACT}.
        </p>

        <h2 className="text-lg font-semibold text-gray-900">Какие данные мы обрабатываем</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Аккаунт:</strong> адрес электронной почты и имя профиля — для входа и
            отображения вас участникам группы. При входе через Google мы получаем e-mail и имя
            из вашего Google-аккаунта.
          </li>
          <li>
            <strong>Данные групп:</strong> названия групп и расходов, суммы, валюты, участники и
            причитающиеся доли. Это содержимое, которое вы создаёте сами.
          </li>
          <li>
            <strong>Список ожидания:</strong> e-mail, если вы оставили его в форме на сайте.
          </li>
          <li>
            <strong>Контакты (только Android, по запросу):</strong> если вы явно разрешите доступ,
            приложение читает имена из адресной книги локально, чтобы подставить имя участника.
            Адресная книга не выгружается на сервер.
          </li>
        </ul>
        <p>
          Мы не собираем данные о местоположении, не показываем рекламу и не продаём данные
          третьим лицам.
        </p>

        <h2 className="text-lg font-semibold text-gray-900">Где хранятся данные</h2>
        <p>
          Данные аккаунтов и групп хранятся в базе Supabase (инфраструктура AWS). Доступ к данным
          группы имеют только её участники; на уровне базы действуют правила изоляции (RLS).
          Локальный режим приложения хранит данные только на вашем устройстве.
        </p>

        <h2 className="text-lg font-semibold text-gray-900">Как удалить данные</h2>
        <p>
          Напишите на {CONTACT} с адреса, на который зарегистрирован аккаунт, — мы удалим аккаунт
          и связанные данные в течение 30 дней и подтвердим удаление ответным письмом. Данные из
          списка ожидания удаляются по такому же запросу.
        </p>

        <h2 className="text-lg font-semibold text-gray-900">Изменения политики</h2>
        <p>
          При существенных изменениях мы обновим эту страницу и дату в её шапке. Продолжение
          использования сервиса после публикации изменений означает согласие с новой редакцией.
        </p>

        <h2 className="text-lg font-semibold text-gray-900">Privacy summary (English)</h2>
        <p className="text-gray-600">
          SplitIT processes your e-mail and profile name (sign-in), and the group/expense data you
          create. Android contact names are read locally only with your permission and never
          uploaded. No location tracking, no ads, no selling of data. Data is stored in Supabase
          with row-level security. To delete your account and data, e-mail {CONTACT} from your
          registered address; deletion is completed within 30 days.
        </p>
      </section>

      <p className="mt-8">
        <Link href="/" className="text-emerald-600 underline">← На главную</Link>
        {' · '}
        <Link href="/terms" className="text-emerald-600 underline">Условия использования</Link>
      </p>
    </main>
  );
}
