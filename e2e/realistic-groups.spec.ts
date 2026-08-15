import { expect, Page, test } from '@playwright/test';
import { GRADUATION_GROUP, ROAD_TRIP_GROUP, ScenarioGroup } from '../test/fixtures/realistic-groups';

const SESSION = {
  id: ROAD_TRIP_GROUP.members[0].id,
  email: ROAD_TRIP_GROUP.members[0].email,
  full_name: ROAD_TRIP_GROUP.members[0].name,
  avatar_url: ROAD_TRIP_GROUP.members[0].avatar,
};

async function seed(page: Page, groups: ScenarioGroup[]) {
  await page.goto('/');
  await page.evaluate(
    ([session, data]) => {
      window.localStorage.clear();
      window.localStorage.setItem('splitit_local_user_session', JSON.stringify(session));
      window.localStorage.setItem('splitit_local_groups_data', JSON.stringify(data));
    },
    [SESSION, groups] as const,
  );
}

function normalizedBody(page: Page) {
  return page.locator('body').innerText().then((text) => text.replace(/ | /g, ' '));
}

/**
 * Снимает текст страницы только после того, как экран действительно отрисовал
 * данные.
 *
 * Раньше тесты читали body сразу после goto(). Данные приходят из localStorage
 * в эффекте после монтирования, поэтому снимок мог попасть на промежуточный
 * кадр: заголовок уже есть, списка расходов ещё нет. Проверка «данные двух
 * групп не смешиваются» падала примерно один прогон из шести на строке
 * toContain('Бензин по России') — и это была гонка в тесте, а не утечка
 * данных: соседняя проверка not.toContain в тот же момент зеленела ровно
 * потому, что на странице не было ещё ничего. Тот же класс дефекта, что
 * разбирался в проверке Realtime: утверждение, проходящее по той же причине,
 * по которой падает соседнее, не проверяет ничего.
 *
 * toContainText — авторетраящееся утверждение: оно ждёт появления якоря, и
 * только после этого снимается текст для остальных проверок, включая
 * отрицательные.
 */
async function bodyAfter(page: Page, anchor: string) {
  await expect(page.locator('body')).toContainText(anchor);
  return normalizedBody(page);
}


test.describe('Реалистичные групповые испытания', () => {
  test('автопутешествие: 4 человека, 260 000 ₽ и два остаточных перевода', async ({ page }) => {
    await seed(page, [ROAD_TRIP_GROUP]);
    await page.goto(`/events/detail?id=${ROAD_TRIP_GROUP.id}`);

    await expect(page.getByRole('heading', { name: ROAD_TRIP_GROUP.name })).toBeVisible();
    const detail = await bodyAfter(page, 'Дом в Анталье на месяц');
    expect(detail).toContain('260 000 ₽');
    expect(detail).toContain('Дом в Анталье на месяц');
    expect(detail).toContain('10 000 ₺');

    await page.goto(`/events/balance?id=${ROAD_TRIP_GROUP.id}`);
    const balance = await bodyAfter(page, 'оптимальным транзакциям');
    expect(balance).toMatch(/к 2 оптимальным транзакциям/);
    expect(balance).toContain('52 200 ₽');
    expect(balance).toContain('6 800 ₽');
    for (const member of ROAD_TRIP_GROUP.members) expect(balance).toContain(member.name);
  });

  test('выпускной: 10 человек, 500 000 ₽ и девять переводов', async ({ page }) => {
    await seed(page, [GRADUATION_GROUP]);
    await page.goto(`/events/detail?id=${GRADUATION_GROUP.id}`);

    await expect(page.getByRole('heading', { name: GRADUATION_GROUP.name })).toBeVisible();
    const detail = await bodyAfter(page, 'Аренда банкетного зала');
    expect(detail).toContain('500 000 ₽');
    expect(detail).toContain('Аренда банкетного зала');
    expect(detail).toContain('Трансфер после выпускного');

    await page.goto(`/events/balance?id=${GRADUATION_GROUP.id}`);
    const balance = await bodyAfter(page, 'оптимальным транзакциям');
    expect(balance).toMatch(/к 9 оптимальным транзакциям/);
    for (const member of GRADUATION_GROUP.members) expect(balance).toContain(member.name);
  });

  test('данные двух групп не смешиваются между карточками и балансами', async ({ page }) => {
    await seed(page, [ROAD_TRIP_GROUP, GRADUATION_GROUP]);

    await page.goto(`/events/detail?id=${ROAD_TRIP_GROUP.id}`);
    const travel = await bodyAfter(page, 'Бензин по России');
    expect(travel).toContain('Бензин по России');
    expect(travel).not.toContain('Аренда банкетного зала');

    await page.goto(`/events/detail?id=${GRADUATION_GROUP.id}`);
    const graduation = await bodyAfter(page, 'Аренда банкетного зала');
    expect(graduation).toContain('Аренда банкетного зала');
    expect(graduation).not.toContain('Бензин по России');
  });
});
