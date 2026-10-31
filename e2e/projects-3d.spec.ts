import { test, expect, Page } from '@playwright/test';
import { qrMatrix, qrPath } from '../src/lib/qr';

/**
 * Этап 3г: превью приглашения события и срок ссылки, правка и удаление записи
 * проекта, префилл конструктора отклонёнными условиями. e2e-фейк store, как
 * projects-r2.spec.ts (контракт RPC тот же, что у базы).
 */

const ACTOR = 'splitit_fake_projects_actor';

async function loginAnya(page: Page) {
  await page.goto('/');
  await page.evaluate(() => {
    window.localStorage.clear();
    window.localStorage.setItem(
      'splitit_local_user_session',
      JSON.stringify({ id: 'u-anya', email: 'anya@example.com', full_name: 'Аня', avatar_url: '👩' }),
    );
  });
}

const actAs = (page: Page, who: string | null) =>
  page.evaluate(([k, w]) => (w ? window.localStorage.setItem(k!, w) : window.localStorage.removeItem(k!)), [ACTOR, who]);
const BORYA = JSON.stringify({ id: 'u-borya', name: 'Боря' });

async function createSolo(page: Page, name: string): Promise<string> {
  await page.goto('/projects/new');
  await page.getByTestId('project-name').fill(name);
  await page.getByTestId('project-new-next').click();
  await page.getByTestId('terms-next').click();
  await page.getByTestId('terms-next').click();
  await page.getByTestId('terms-submit').click();
  await expect(page).toHaveURL(/\/projects\/invite/);
  return new URL(page.url()).searchParams.get('id')!;
}

async function addOp(page: Page, projectId: string, type: string, amount: string, title: string) {
  await page.goto(`/projects/add?id=${projectId}&type=${type}`);
  await page.getByTestId('op-amount').fill(amount);
  await page.getByTestId('op-title').fill(title);
  await page.getByTestId('op-save').click();
  await expect(page).toHaveURL(new RegExp(`/projects/detail\\?id=${projectId}`));
}

/** Событие «Поездка в Казань» Ани с гостями и ссылкой; status/updatedAt — состояние закрытия. */
async function eventWithLink(page: Page, status: string, closedDaysAgo = 0): Promise<string> {
  await loginAnya(page);
  await page.evaluate(
    ([st, days]) => {
      window.localStorage.setItem('splitit_e2e_invites', '1');
      window.localStorage.setItem(
        'splitit_local_groups_data',
        JSON.stringify([{
          id: 'g1', name: 'Поездка в Казань', category: 'trip', currency: 'RUB', status: st, createdBy: 'u-anya',
          createdAt: '2026-10-01T10:00:00.000Z', updatedAt: new Date(Date.now() - Number(days) * 86_400_000).toISOString(),
          members: [
            { id: 'u-anya', name: 'Аня', avatar: 'А', role: 'owner' },
            { id: 'p-sasha', name: 'Саша', avatar: 'С', role: 'member', isGuest: true },
            { id: 'p-dima', name: 'Дима', avatar: 'Д', role: 'member', isGuest: true },
          ],
          expenses: [], settlements: [],
        }]),
      );
      window.localStorage.setItem('splitit_e2e_invites_codes', JSON.stringify({ E2EKZN7Q2: { groupId: 'g1' } }));
    },
    [status, closedDaysAgo] as const,
  );
  return '/invite?code=E2EKZN7Q2';
}

test('превью приглашения события: название, кто зовёт, участники, «пока открыто»; без списка участников', async ({ page }) => {
  const link = await eventWithLink(page, 'active');
  await page.goto(link);
  await expect(page.getByTestId('invite-event')).toHaveText('«Поездка в Казань»');
  await expect(page.getByTestId('invite-from')).toContainText('Аня зовёт тебя');
  await expect(page.getByTestId('invite-preview')).toContainText('3 участника');
  await expect(page.getByTestId('invite-expiry')).toContainText('пока событие открыто');
  await expect(page.getByTestId('event-invite')).not.toContainText('Саша');
  await expect(page.getByTestId('invite-join')).toBeVisible();
});

test('приглашение закрытого события: «до <дата>»; через 30 дней — отказ до входа', async ({ page }) => {
  const link = await eventWithLink(page, 'completed', 10);
  await page.goto(link);
  await expect(page.getByTestId('invite-expiry')).toContainText(/работает до \d+ \S+ \d{4}/);
  await expect(page.getByTestId('invite-join')).toBeVisible();

  const late = await eventWithLink(page, 'completed', 31);
  await page.goto(late);
  await expect(page.getByTestId('invite-error')).toContainText(/недействительн|истек/i);
  await expect(page.getByTestId('invite-join')).toHaveCount(0);
});

test('шаг «Позови друзей»: срок ссылки по правилу базы, а не 14 дней клиента', async ({ page }) => {
  await eventWithLink(page, 'active');
  await page.goto('/events/detail?id=g1&invite=1');
  await expect(page.getByTestId('event-invite-step')).toContainText('пока событие открыто');
});

test('QR на «Позови друзей» и «Позови участников» кодирует показанную ссылку; без публичной ссылки — текст', async ({ page }) => {
  const qrOf = async (linkTestId: string) => {
    await expect(page.getByTestId('invite-qr')).toBeVisible();
    const link = await page.getByTestId(linkTestId).innerText();
    expect(await page.getByTestId('invite-qr').locator('path').getAttribute('d')).toBe(qrPath(qrMatrix(link)!));
  };
  await eventWithLink(page, 'active');
  await page.goto('/events/detail?id=g1&invite=1');
  await qrOf('event-invite-link');

  await createSolo(page, 'Фотостудия');
  await qrOf('invite-link');

  // Без e2e-origin у localhost нет публичной ссылки: QR не рисуется, честный текст.
  await page.evaluate(() => window.localStorage.removeItem('splitit_e2e_invites'));
  await page.reload();
  await expect(page.getByTestId('invite-qr-missing')).toContainText('QR-кода нет');
  await expect(page.getByTestId('invite-qr')).toHaveCount(0);
});

test('правка суммы меняет итог, удаление убирает запись; не-автор не видит кнопок', async ({ page }) => {
  test.setTimeout(90_000);
  await loginAnya(page);
  const pid = await createSolo(page, 'Фотостудия');
  const code = await page.getByTestId('invite-link').getAttribute('data-code');
  await addOp(page, pid, 'income', '10 000', 'Съёмка');
  await addOp(page, pid, 'income', '5 000', 'Печать');
  await expect(page.getByTestId('project-stats')).toContainText('15 000 ₽');

  // Правка: тип не меняется, сумма — да; итог пересчитан.
  await page.getByTestId('op-edit').filter({ hasText: 'Съёмка' }).click();
  await expect(page).toHaveURL(/\/projects\/add\?.*op=/);
  await expect(page.getByTestId('op-amount')).toHaveValue('10000');
  await expect(page.getByTestId('op-type-fixed')).toBeVisible();
  // Правка сохраняет запись, а не создаёт новую — и кнопка говорит об этом.
  await expect(page.getByTestId('op-save')).toHaveText('Сохранить изменения');
  await page.getByTestId('op-amount').fill('12 000');
  await page.getByTestId('op-save').click();
  await expect(page).toHaveURL(new RegExp(`/projects/detail\\?id=${pid}`));
  await expect(page.getByTestId('project-stats')).toContainText('17 000 ₽');
  await expect(page.getByTestId('project-feed')).toContainText('12 000 ₽');

  // Удаление — только после подтверждения.
  await page.getByTestId('op-edit').filter({ hasText: 'Печать' }).click();
  await expect(page).toHaveURL(/\/projects\/add\?.*op=/);
  const editUrl = page.url();
  await page.getByTestId('op-delete').click();
  await expect(page.getByTestId('op-delete-confirm')).toContainText('Печать');
  await page.getByTestId('op-delete-yes').click();
  await expect(page).toHaveURL(new RegExp(`/projects/detail\\?id=${pid}`));
  await expect(page.getByTestId('project-feed')).not.toContainText('Печать');
  await expect(page.getByTestId('project-stats')).toContainText('12 000 ₽');
  // Удалённая запись по старой ссылке — пояснение, без кнопок.
  await page.goto(editUrl);
  await expect(page.getByTestId('edit-op-unavailable')).toBeVisible();
  await expect(page.getByTestId('op-save')).toHaveCount(0);

  // Боря — участник, но не автор и не владелец: записи не открываются на правку.
  await actAs(page, BORYA);
  await page.goto(`/projects/join?code=${code}`);
  await page.getByTestId('join-confirm').click();
  await page.goto(`/projects/detail?id=${pid}`);
  await expect(page.getByTestId('project-feed')).toContainText('Съёмка');
  await expect(page.getByTestId('op-edit')).toHaveCount(0);
  const opId = await page.evaluate(
    () => JSON.parse(window.localStorage.getItem('splitit_fake_projects')!).project_operations.find((o: { title: string }) => o.title === 'Съёмка').id,
  );
  await page.goto(`/projects/add?id=${pid}&op=${opId}`);
  await expect(page.getByTestId('edit-op-unavailable')).toContainText('автор или владелец');
  await expect(page.getByTestId('op-save')).toHaveCount(0);
  await expect(page.getByTestId('op-delete')).toHaveCount(0);
});

test('«Изменить условия» после отказа открывает конструктор с отклонёнными условиями', async ({ page }) => {
  await loginAnya(page);
  const pid = await createSolo(page, 'Свадьба Ивановых');
  const code = await page.getByTestId('invite-link').getAttribute('data-code');
  await actAs(page, BORYA);
  await page.goto(`/projects/join?code=${code}`);
  await page.getByTestId('join-confirm').click();
  await actAs(page, null);

  // Аня предлагает себе ставку 1 500 ₽/ч — в действующих условиях ставки нет.
  await page.goto(`/projects/terms?id=${pid}`);
  await expect(page.getByTestId('member-row-0')).not.toContainText('1 500 ₽');
  await page.getByTestId('member-row-0').click();
  await page.getByTestId('rate-hourly').click();
  await page.getByTestId('rate-0').fill('1500');
  await page.getByTestId('member-done').click();
  await expect(page.getByTestId('member-row-0')).toContainText('1 500 ₽');
  await page.getByTestId('terms-next').click();
  await page.getByTestId('terms-submit').click();
  await expect(page).toHaveURL(new RegExp(`/projects/detail\\?id=${pid}`));

  await actAs(page, BORYA);
  await page.goto(`/projects/consent?id=${pid}`);
  await page.getByTestId('consent-decline').click();
  await actAs(page, null);

  await page.goto(`/projects/detail?id=${pid}`);
  // Владелец видит отказ и одно действие — без параллельного «Ждём согласия» по прежним условиям.
  await expect(page.getByTestId('terms-declined')).toContainText('Боря не согласен');
  await expect(page.getByTestId('terms-waiting')).toHaveCount(0);
  await page.getByTestId('project-declined-change').click();
  await expect(page).toHaveURL(new RegExp(`/projects/terms\\?id=${pid}`));
  await expect(page.getByTestId('member-row-0')).toContainText('1 500 ₽');
});

/** Прокрутка до конца: последний элемент ленты целиком выше закреплённой зоны; у зоны и навигации непрозрачный фон. */
async function expectLastAboveDock(page: Page, dockId: string) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(200);
  const r = await page.evaluate((id) => {
    const dock = document.querySelector(`[data-testid="${id}"]`)!;
    // У V1Screen перед зоной — распорка (aria-hidden), у главной — нет.
    let last = dock.previousElementSibling!;
    if (last.getAttribute('aria-hidden') === 'true') last = last.previousElementSibling!;
    const nav = document.querySelector('[data-testid="bottom-nav"]');
    const opaque = (el: Element | null) => !el || getComputedStyle(el).backgroundColor === 'rgb(242, 243, 245)';
    return {
      lastBottom: last.getBoundingClientRect().bottom,
      dockTop: dock.getBoundingClientRect().top,
      navTop: nav ? nav.getBoundingClientRect().top : Infinity,
      btnBottom: [...dock.querySelectorAll('a, button')].at(-1)!.getBoundingClientRect().bottom,
      opaque: opaque(dock) && opaque(nav),
    };
  }, dockId);
  expect(r.lastBottom).toBeLessThanOrEqual(r.dockTop);
  expect(r.lastBottom).toBeLessThanOrEqual(r.navTop);
  // Главная кнопка целиком над навигацией, не подрезана её фоном.
  expect(r.btnBottom).toBeLessThanOrEqual(r.navTop);
  expect(r.opaque).toBe(true);
}

test('нижняя зона: последняя карточка целиком выше кнопки и навигации (главная, событие, итог события)', async ({ page }) => {
  await loginAnya(page);
  await page.evaluate(() => {
    const members = ['u-anya', 'm-lena', 'm-sasha'].map((id, i) => ({ id, name: ['Аня', 'Лена', 'Саша'][i], avatar: 'А', role: i ? 'member' : 'owner' }));
    const expenses = Array.from({ length: 8 }, (_, i) => ({
      id: `e${i}`, title: `Расход ${i + 1}`, amount: 3000, currency: 'RUB', amountInGroupCurrency: 3000, category: 'other',
      paidById: members[i % 3].id, splits: members.map((m) => ({ userId: m.id, amountOwed: 1000 })), createdAt: `2026-10-1${i}T10:00:00Z`,
    }));
    const groups = Array.from({ length: 6 }, (_, i) => ({
      id: `g${i}`, name: `Событие ${i + 1}`, category: 'trip', currency: 'RUB', status: 'active', createdBy: 'u-anya',
      members, expenses, settlements: [],
    }));
    window.localStorage.setItem('splitit_local_groups_data', JSON.stringify(groups));
  });
  await page.goto('/');
  await expect(page.getByTestId('home-create')).toBeVisible();
  await expectLastAboveDock(page, 'home-dock');

  await page.goto('/events/detail?id=g0');
  await expect(page.getByTestId('close-event')).toBeVisible();
  await expectLastAboveDock(page, 'v1-dock');

  await page.getByTestId('close-event').click();
  await expect(page.getByTestId('settle-lock')).toBeVisible();
  await expectLastAboveDock(page, 'v1-dock');
  // Пояснение о фиксации — над кнопкой, а не под ней.
  const note = (await page.getByTestId('settle-lock-note').boundingBox())!;
  const btn = (await page.getByTestId('settle-lock').boundingBox())!;
  expect(note.y + note.height).toBeLessThanOrEqual(btn.y);

  // Закрытое событие: кнопки внизу нет, но навигация есть — последний блок всё равно над ней.
  await page.getByTestId('settle-lock').click();
  await expect(page.getByTestId('v1-nav-spacer')).toBeAttached();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(200);
  const closed = await page.evaluate(() => ({
    lastBottom: document.querySelector('[data-testid="v1-nav-spacer"]')!.previousElementSibling!.getBoundingClientRect().bottom,
    navTop: document.querySelector('[data-testid="bottom-nav"]')!.getBoundingClientRect().top,
  }));
  expect(closed.lastBottom).toBeLessThanOrEqual(closed.navTop);
});
