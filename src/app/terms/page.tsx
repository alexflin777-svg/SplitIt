/**
 * Условия использования. Статическая страница — та же логика, что и /privacy.
 */
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'SplitIT — Условия использования',
  description: 'Правила использования сервиса SplitIT.',
};

const UPDATED = '10 сентября 2026';
const CONTACT = 'info@splitit-apps.com';

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 pb-28 text-[15px] leading-relaxed text-gray-800">
      <h1 className="text-2xl font-bold text-gray-900">Условия использования SplitIT</h1>
      <p className="mt-2 text-sm text-gray-500">Обновлено: {UPDATED}</p>

      <section className="mt-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Что такое SplitIT</h2>
        <p>
          SplitIT помогает записывать общие расходы группы и считать, кто кому сколько должен.
          SplitIT — калькулятор и учёт: мы <strong>не</strong> переводим деньги, не храним
          платёжные реквизиты и не являемся платёжным сервисом. Все расчёты между участниками
          происходят вне приложения.
        </p>

        <h2 className="text-lg font-semibold text-gray-900">Бета-версия</h2>
        <p>
          Сервис предоставляется «как есть» на стадии беты. Мы стараемся не терять данные и
          предупреждать об изменениях, но не гарантируем непрерывную работу. Пожалуйста, не
          используйте SplitIT как единственный источник финансово значимой информации.
        </p>

        <h2 className="text-lg font-semibold text-gray-900">Ваш аккаунт и содержимое</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Вы отвечаете за достоверность вносимых расходов и за доступ к своему аккаунту.</li>
          <li>
            Содержимое групп видно участникам этих групп. Приглашая человека, вы делитесь с ним
            расчётом группы.
          </li>
          <li>
            Запрещено использовать сервис для незаконной деятельности, спама и попыток нарушить
            работу или защиту сервиса.
          </li>
        </ul>

        <h2 className="text-lg font-semibold text-gray-900">Стоимость</h2>
        <p>
          Базовые функции беты бесплатны. Если в будущем появятся платные функции, они будут
          явно обозначены до оплаты; уже созданные вами расчёты не будут заблокированы.
        </p>

        <h2 className="text-lg font-semibold text-gray-900">Прекращение использования</h2>
        <p>
          Вы можете удалить аккаунт в любой момент (см.{' '}
          <Link href="/privacy" className="text-emerald-600 underline">Политику конфиденциальности</Link>).
          Мы можем ограничить доступ при нарушении этих условий.
        </p>

        <h2 className="text-lg font-semibold text-gray-900">Контакты</h2>
        <p>Вопросы по условиям: {CONTACT}.</p>

        <h2 className="text-lg font-semibold text-gray-900">Terms summary (English)</h2>
        <p className="text-gray-600">
          SplitIT is an expense-splitting calculator, not a payment service — no money moves
          through the app. The beta is provided “as is”. Core beta features are free. You own the
          content you create; group content is visible to group members. You may delete your
          account at any time; see the Privacy Policy for the deletion procedure.
        </p>
      </section>

      <p className="mt-8">
        <Link href="/" className="text-emerald-600 underline">← На главную</Link>
        {' · '}
        <Link href="/privacy" className="text-emerald-600 underline">Политика конфиденциальности</Link>
      </p>
    </main>
  );
}
