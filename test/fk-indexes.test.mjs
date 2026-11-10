/**
 * 1.1.1, миграция 20261110000000_fk_indexes.sql: у каждого внешнего ключа public
 * есть индекс, начинающийся с его колонок; откат возвращает ровно 17 непокрытых
 * ключей из проверки prod (v1.1/perf/baseline-net.txt); повторный прогон безопасен.
 *
 * Запуск: npm run test:rls
 */

import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createTestDatabase } from './pg-harness.mjs';

const read = (p) => readFileSync(path.join(process.cwd(), p), 'utf-8');
const UP = read('supabase/migrations/20261110000000_fk_indexes.sql');
const DOWN = read('supabase/rollback/20261110000000_fk_indexes.down.sql');

// Внешний ключ без индекса, чьи первые колонки — колонки ключа (в любом порядке).
const UNCOVERED = `
  SELECT c.conrelid::regclass::text || '(' || string_agg(a.attname, ',' ORDER BY a.attname) || ')' AS fk
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
  WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
    AND NOT EXISTS (
      SELECT 1 FROM pg_index i
      WHERE i.indrelid = c.conrelid
        AND (SELECT array_agg(k ORDER BY k) FROM unnest((i.indkey::int2[])[0:cardinality(c.conkey) - 1]) k)
          = (SELECT array_agg(k ORDER BY k) FROM unnest(c.conkey) k)
    )
  GROUP BY c.conrelid, c.conname
  ORDER BY 1`;

const PROD_MISSING = [
  'expense_splits(group_id,participant_id)', 'expenses(group_id,paid_by_participant_id)',
  'project_contribution_ledger(period_id,project_id)', 'project_contribution_ledger(project_id,terms_id)',
  'project_operations(member_id,project_id)', 'project_operations(project_id,refund_of)', 'project_periods(project_id,terms_id)',
  'project_quantities(member_id,project_id)', 'project_quantities(period_id,project_id)', 'project_term_approvals(project_id,terms_id)',
  'project_term_lines(member_id,project_id)', 'project_term_lines(project_id,terms_id)', 'project_transfers(from_member,project_id)',
  'project_transfers(period_id,project_id)', 'project_transfers(project_id,to_member)', 'settlements(group_id,payee_participant_id)',
  'settlements(group_id,payer_participant_id)',
].sort();

describe('индексы под внешние ключи', () => {
  let db;
  const uncovered = async () => (await db.query(UNCOVERED)).rows.map((r) => r.fk);

  before(async () => {
    db = await createTestDatabase();
  });

  test('после всех миграций непокрытых внешних ключей нет', async () => {
    assert.deepEqual(await uncovered(), []);
  });

  test('откат возвращает ровно 17 ключей из проверки prod; повторное применение — без ошибок', async () => {
    await db.exec(DOWN);
    assert.deepEqual(await uncovered(), PROD_MISSING);
    await db.exec(UP);
    await db.exec(UP);
    assert.deepEqual(await uncovered(), []);
  });
});
