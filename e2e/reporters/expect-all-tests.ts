/**
 * Репортер-сторож: прогон считается зелёным только если выполнились все тесты,
 * которые Playwright собрал в начале.
 *
 * Зачем. 2026-08-15 сводка Playwright несколько раз напечатала меньше тестов,
 * чем в наборе: «95 passed» вместо 96 и «12/13 passed» вместо 14 — без единого
 * failed, interrupted или flaky. Наблюдалось только при выводе в конвейер; при
 * записи в файл и с `--workers=1` расхождений нет, exit code всегда 0. То есть
 * это мог быть артефакт рендеринга list-репортера, а могла быть реальная потеря
 * тестов — по выводу эти два случая неразличимы, и в этом вся проблема:
 * проверка, чья сводка может молча уменьшиться, ничего не гарантирует.
 *
 * Этот репортер не чинит причину. Он делает её видимой: если выполнилось
 * меньше тестов, чем запланировано, процесс завершается с ненулевым кодом и
 * печатает, какие именно тесты не отчитались.
 */

import type { FullResult, Reporter, Suite, TestCase } from '@playwright/test/reporter';

export default class ExpectAllTests implements Reporter {
  private planned: TestCase[] = [];
  private reported = new Set<string>();

  onBegin(_config: unknown, suite: Suite) {
    this.planned = suite.allTests();
  }

  onTestEnd(test: TestCase) {
    this.reported.add(test.id);
  }

  async onEnd(result: FullResult) {
    const missing = this.planned.filter((test) => !this.reported.has(test.id));
    if (missing.length === 0) return;

    console.error(
      `\n✗ Не отчитались ${missing.length} тест(ов) из ${this.planned.length}. ` +
        'Прогон не может считаться зелёным.',
    );
    for (const test of missing) {
      console.error(`  — ${test.titlePath().filter(Boolean).join(' › ')}`);
    }
    console.error(
      'Воспроизводится под нагрузкой; для детерминированного прогона: npx playwright test --workers=1\n',
    );

    result.status = 'failed';
  }
}
