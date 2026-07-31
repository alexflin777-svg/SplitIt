import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Статическая проверка миграций (регрессия на S0-1).
 *
 * Живого Supabase нет, поэтому политики нельзя прогнать двумя аккаунтами. Но
 * сам класс дефекта — `FOR ALL USING (true)` на финансовой таблице — ловится
 * чтением SQL, и именно эта форма записи уже один раз доехала до репозитория.
 *
 * Проверка намеренно грубая и текстовая. Она не доказывает, что политики
 * правильные; она доказывает, что в них нет дыры, которая обнуляет всё
 * остальное. Настоящая проверка изоляции данных — два аккаунта на живом
 * Supabase, и она остаётся обязательной перед релизом.
 */

const MIGRATIONS_DIR = path.join(process.cwd(), 'supabase', 'migrations');

const FINANCIAL_TABLES = [
  'groups',
  'group_members',
  'expenses',
  'expense_splits',
  'settlements',
  'group_invites',
  'profiles',
];

function readMigrations(): { file: string; sql: string }[] {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((file) => ({ file, sql: fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8') }));
}

/** Убирает комментарии, чтобы описание дефекта в шапке файла не считалось кодом. */
function stripComments(sql: string): string {
  return sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
}

test.describe('Миграции Supabase (инвариант И-9)', () => {
  test('нет permissive-политик FOR ALL USING (true)', () => {
    const offenders: string[] = [];

    for (const { file, sql } of readMigrations()) {
      const code = stripComments(sql);
      // CREATE POLICY ... FOR ALL ... USING (true)
      const pattern = /CREATE\s+POLICY[\s\S]{0,400}?FOR\s+ALL[\s\S]{0,200}?USING\s*\(\s*true\s*\)/gi;
      for (const match of code.matchAll(pattern)) {
        offenders.push(`${file}: ${match[0].replace(/\s+/g, ' ').slice(0, 100)}`);
      }
    }

    expect(offenders, 'permissive-политика обнуляет все остальные на таблице').toEqual([]);
  });

  test('RLS включён на каждой таблице со ссылкой на пользователя', () => {
    const all = readMigrations()
      .map((m) => stripComments(m.sql))
      .join('\n');

    const missing = FINANCIAL_TABLES.filter(
      (table) => !new RegExp(`ALTER\\s+TABLE\\s+public\\.${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i').test(all),
    );

    expect(missing, 'таблица без RLS доступна всем на чтение и запись').toEqual([]);
  });

  test('у каждой политики записи есть WITH CHECK', () => {
    const all = readMigrations()
      .map((m) => stripComments(m.sql))
      .join('\n');

    // Политики INSERT и UPDATE без WITH CHECK не ограничивают записываемые
    // значения: пользователь может записать строку, которую сам потом не
    // увидит, в том числе от чужого имени.
    const offenders: string[] = [];
    const pattern = /CREATE\s+POLICY\s+"([^"]+)"[\s\S]*?FOR\s+(INSERT|UPDATE)[\s\S]*?(?=;)/gi;

    for (const match of all.matchAll(pattern)) {
      if (!/WITH\s+CHECK/i.test(match[0])) {
        offenders.push(`${match[1]} (FOR ${match[2].toUpperCase()})`);
      }
    }

    expect(offenders).toEqual([]);
  });

  test('вступление в группу идёт только через redeem_group_invite', () => {
    const all = readMigrations()
      .map((m) => stripComments(m.sql))
      .join('\n');

    // Функция существует и выдана только аутентифицированным.
    expect(all).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.redeem_group_invite/i);
    expect(all).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.redeem_group_invite\(TEXT\)\s+TO\s+authenticated/i);

    // Прямой INSERT в group_members разрешён только владельцу группы.
    const insertPolicy = all.match(
      /CREATE\s+POLICY\s+"group_members_insert[^"]*"[\s\S]*?WITH\s+CHECK\s*\(([\s\S]*?)\)\s*;/i,
    );
    expect(insertPolicy, 'политика INSERT на group_members не найдена').not.toBeNull();
    expect(insertPolicy![1]).toContain('is_group_owner');
  });

  test('денежные величины ограничены на уровне БД', () => {
    const all = readMigrations()
      .map((m) => stripComments(m.sql))
      .join('\n');

    for (const constraint of [
      'expenses_amount_positive',
      'expenses_amount_in_group_currency_positive',
      'settlements_amount_positive',
      'expense_splits_amount_owed_non_negative',
    ]) {
      expect(all, `нет CHECK-ограничения ${constraint}`).toContain(constraint);
    }
  });
});
