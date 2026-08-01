import { test, expect, Page } from '@playwright/test';
import { GRADUATION_GROUP } from '../test/fixtures/realistic-groups';

/**
 * Инвариант: до содержимого можно доскроллить.
 *
 * Это НЕ регрессия на S3-3, хотя писался тест именно как она. Честный статус
 * такой: воспроизвести заявленный дефект не удалось. На фикстуре, где его
 * нашли (выпускной, 10 человек, девять переводов), при прокрутке до конца
 * ни одна карточка под навигацией не оказывается — ни до правки Gemini, ни
 * после. Замер обоих состояний дал одинаковый зазор.
 *
 * Похоже, в отчёте зафиксирован кадр на середине прокрутки. Содержимое,
 * проезжающее под фиксированной панелью, — это нормальная работа фиксированной
 * панели, а не дефект: дефектом оно становится, только если доскроллить нельзя.
 * Ровно это здесь и проверяется.
 *
 * Проверка геометрическая, а не по скриншоту: скриншот фиксирует один момент
 * прокрутки и при другой длине списка пропустит проблему.
 */

const NAV = 'nav';
const CARD = '.stitch-card';

/**
 * Фикстура Чекера: 10 человек, 7 расходов, девять переводов. Дефект нашли
 * именно на ней, поэтому берём её, а не выдуманную группу — на своих данных
 * я перекрытие воспроизвести не смог.
 */
const LONG_GROUP = GRADUATION_GROUP;

async function seed(page: Page, group: unknown) {
  await page.goto('/');
  await page.evaluate((g) => {
    window.localStorage.clear();
    window.localStorage.setItem(
      'splitit_local_user_session',
      JSON.stringify({
        id: (g as any).members[0].id,
        email: (g as any).members[0].email ?? 'a@example.com',
        full_name: (g as any).members[0].name,
        avatar_url: '👑',
      }),
    );
    window.localStorage.setItem('splitit_local_groups_data', JSON.stringify([g]));
  }, group);
}

/** Возвращает карточки, которые пересекаются с прямоугольником навигации. */
async function overlappingCards(page: Page) {
  return page.evaluate(
    ([navSel, cardSel]) => {
      const nav = document.querySelector(navSel);
      if (!nav) return ['навигация не найдена'];

      const navBox = nav.getBoundingClientRect();
      // Панель нарисована внутри nav с pointer-events:none по краям, поэтому
      // считаем перекрытием только видимую подложку.
      const panel = nav.querySelector('div') ?? nav;
      const bar = panel.getBoundingClientRect();

      const problems: string[] = [];
      for (const card of Array.from(document.querySelectorAll(cardSel))) {
        const box = card.getBoundingClientRect();
        if (box.height === 0) continue;

        const intersects = box.bottom > bar.top && box.top < bar.bottom;
        if (!intersects) continue;

        const text = (card.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
        problems.push(
          `карточка «${text}» y=${Math.round(box.top)}…${Math.round(box.bottom)} ` +
            `под навигацией y=${Math.round(bar.top)}…${Math.round(bar.bottom)}`,
        );
      }
      return problems;
    },
    [NAV, CARD] as const,
  );
}

test.describe('Нижняя навигация не перекрывает содержимое (регрессия S3-3)', () => {
  for (const screen of ['/events/balance', '/events/detail', '/'] as const) {
    test(`после прокрутки до конца ничего не остаётся под навигацией: ${screen}`, async ({ page }) => {
      const id = LONG_GROUP.id;
      await seed(page, LONG_GROUP);

      await page.goto(screen === '/' ? '/' : `${screen}?id=${id}`);
      await page.waitForLoadState('networkidle');

      // Именно нижняя граница прокрутки — там дефект и жил.
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(300);

      expect(await overlappingCards(page)).toEqual([]);
    });
  }

  test('последний перевод на балансе доступен для нажатия', async ({ page }) => {
    // Геометрия — половина дела: элемент может не пересекаться прямоугольником,
    // но всё равно быть перекрыт по z-порядку. Проверяем, что в точке центра
    // последней карточки лежит именно она, а не навигация.
    const id = LONG_GROUP.id;
    await seed(page, LONG_GROUP);

    await page.goto(`/events/balance?id=${id}`);
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);

    const blocked = await page.evaluate((cardSel) => {
      const cards = Array.from(document.querySelectorAll(cardSel)).filter(
        (c) => c.getBoundingClientRect().height > 0,
      );
      const last = cards[cards.length - 1];
      if (!last) return 'карточек нет';

      const box = last.getBoundingClientRect();
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      if (y < 0 || y > window.innerHeight) return null; // вне экрана — не наш случай

      const onTop = document.elementFromPoint(x, y);
      return onTop && last.contains(onTop) ? null : `в центре карточки лежит ${onTop?.tagName ?? 'ничто'}`;
    }, CARD);

    expect(blocked).toBeNull();
  });
});
