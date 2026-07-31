/**
 * Публичный адрес приложения.
 *
 * `NEXT_PUBLIC_APP_URL` нужен для ссылок, покидающих приложение: в Capacitor
 * `window.location.origin` указывает на локальный WebView и для приглашений
 * непригоден. Но задать его руками до первого деплоя нельзя — адрес выдаёт
 * хостинг. Получается «нужен URL, чтобы получить URL».
 *
 * На Vercel это решается системной переменной `VERCEL_PROJECT_PRODUCTION_URL`:
 * она доступна при сборке, содержит стабильный production-домен (кратчайший
 * кастомный, иначе *.vercel.app) и выставлена даже в preview-деплоях, поэтому
 * ссылки из preview ведут на production, а не на временный адрес. Схемы в
 * значении нет, добавляем сами.
 *
 * Требует включённого «Enable access to System Environment Variables» в
 * настройках проекта Vercel. Явно заданный NEXT_PUBLIC_APP_URL всегда
 * приоритетнее — так подключается собственный домен.
 */
function resolvePublicAppUrl() {
  const explicit = (process.env.NEXT_PUBLIC_APP_URL ?? '').trim().replace(/\/+$/, '');

  // Непригодное значение считается незаданным, иначе `localhost` из локального
  // .env.local молча заблокировал бы автоопределение на Vercel. Требования те
  // же, что в src/lib/env.ts: только https и не локальный хост.
  const usable =
    /^https:\/\/[^\s]+$/i.test(explicit) && !/^https:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(explicit);
  if (usable) return explicit;

  const vercelDomain = (process.env.VERCEL_PROJECT_PRODUCTION_URL ?? '').trim();
  return vercelDomain ? `https://${vercelDomain}` : '';
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  images: {
    unoptimized: true,
  },
  env: {
    NEXT_PUBLIC_APP_URL: resolvePublicAppUrl(),
  },
};

export default nextConfig;
