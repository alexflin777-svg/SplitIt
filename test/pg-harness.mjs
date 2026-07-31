/**
 * Настоящая проверка RLS без Docker и без облачного проекта.
 *
 * Два круга подряд политики проверялись разбором SQL текстом: это ловит форму
 * дефекта (`FOR ALL USING (true)`), но ничего не говорит о том, изолированы ли
 * данные на самом деле. Здесь поднимается настоящий PostgreSQL — PGlite, тот же
 * движок, скомпилированный в WebAssembly, — накатываются те же миграции, и
 * запросы выполняются от лица двух разных пользователей.
 *
 * Что здесь воспроизводится из окружения Supabase:
 *   - схема `auth` и функция `auth.uid()`, читающая claim из настройки сессии;
 *   - роли `anon`, `authenticated`, `service_role`;
 *   - выполнение запросов клиента под ролью `authenticated`, а не под
 *     владельцем таблиц (владелец обходит RLS, и проверка была бы пустой).
 *
 * Чего здесь нет: сетевого слоя PostgREST, GoTrue и Realtime. Проверяются
 * политики и ограничения БД, а не HTTP-обвязка.
 */

import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const MIGRATIONS_DIR = path.join(process.cwd(), 'supabase', 'migrations');

/** Слепок окружения Supabase, которого нет в чистом PostgreSQL. */
const SUPABASE_SHIM = `
CREATE SCHEMA IF NOT EXISTS auth;

-- В Supabase auth.uid() достаёт sub из JWT. Здесь тот же контракт, но claim
-- кладётся в настройку сессии — так тест может «стать» любым пользователем.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID
LANGUAGE SQL STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
END
$$;

-- Supabase выдаёт эти права при создании проекта, поэтому в миграциях их нет.
-- Без них политики, вызывающие auth.uid(), падают на «permission denied for
-- schema auth» ещё до проверки самого правила.
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
`;

export function readMigrations() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((file) => ({ file, sql: readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8') }));
}

/** Поднимает базу и накатывает миграции ровно в том виде, в каком они в репозитории. */
export async function createTestDatabase() {
  const db = await PGlite.create();
  await db.exec(SUPABASE_SHIM);

  for (const { file, sql } of readMigrations()) {
    try {
      await db.exec(sql);
    } catch (e) {
      throw new Error(`Миграция ${file} не применилась: ${e.message}`);
    }
  }

  return db;
}

/**
 * Выполняет запросы от лица конкретного пользователя: под ролью authenticated
 * и с его claim. Роль сбрасывается в finally, иначе утечка контекста между
 * проверками сделает результаты бессмысленными.
 *
 * Здесь именно `SET ROLE`, а не `SET LOCAL ROLE`: вне явной транзакции LOCAL
 * не действует, запросы молча уходят под владельцем схемы, а владелец обходит
 * RLS. Такой харнесс зеленеет на полностью открытой базе — ровно та ошибка,
 * из-за которой первая версия этого файла ничего не проверяла.
 */
export async function asUser(db, userId, fn) {
  await db.exec('SET ROLE authenticated;');
  await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [userId]);

  // Страховка от бесшумного возврата к владельцу: без неё проверка изоляции
  // может пройти на базе, где RLS вообще не применяется.
  const who = await db.query('SELECT current_user AS role, auth.uid()::text AS uid');
  if (who.rows[0].role !== 'authenticated') {
    throw new Error(`Роль не переключилась: current_user = ${who.rows[0].role}`);
  }
  if (who.rows[0].uid !== userId) {
    throw new Error(`auth.uid() = ${who.rows[0].uid}, ожидался ${userId}`);
  }

  try {
    return await fn();
  } finally {
    await db.exec('RESET ROLE;');
    await db.query(`SELECT set_config('request.jwt.claim.sub', '', false)`);
  }
}

/**
 * Оборачивает попытку запроса: RLS отклоняет операции двумя разными способами —
 * ошибкой прав (INSERT/UPDATE с WITH CHECK) и пустой выборкой (SELECT/DELETE).
 * Тестам нужно различать эти случаи.
 */
export async function attempt(db, sql, params = []) {
  try {
    const res = await db.query(sql, params);
    return { ok: true, rows: res.rows, error: null };
  } catch (e) {
    return { ok: false, rows: [], error: e.message };
  }
}
