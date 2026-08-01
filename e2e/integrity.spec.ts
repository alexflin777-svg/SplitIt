import { test, expect, Page } from '@playwright/test';

/**
 * Регрессии на круг 3: подмена данных, отрицательные суммы, ложные обещания.
 * Общая черта всех четырёх дефектов — приложение сообщало об успехе там, где
 * его не было.
 */

const SESSION = { id: 'guest-1', email: 'guest@splitit.app', full_name: 'Демо Аккаунт', avatar_url: '👤' };

async function seed(page: Page, groups: unknown[] = []) {
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

function group(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: 'Тестовое событие',
    category: 'trip',
    currency: 'RUB',
    status: 'active',
    members: [
      { id: 'm-1', name: 'Алексей', avatar: '👑', role: 'owner' },
      { id: 'm-2', name: 'Мария', avatar: '👤', role: 'member' },
    ],
    expenses: [],
    settlements: [],
    ...overrides,
  };
}

test.describe('Приглашение (регрессия S1-1)', () => {
  test('чужая ссылка не подменяет событие выдуманным', async ({ page }) => {
    // До починки loadGroup сочинял «Совместную поездку» с Максимом и сохранял
    // её под настоящим id: человек видел пустышку вместо группы владельца, а
    // id оказывался занят, и настоящая группа уже не могла подгрузиться.
    await seed(page, []);

    const foreignId = 'group-1785524238441';
    await page.goto(`/events/detail?id=${foreignId}&join=true`);

    await expect(page.getByText('Событие недоступно')).toBeVisible();
    await expect(page.getByText('Совместная поездка')).toHaveCount(0);

    // Главное: в хранилище ничего не появилось.
    const stored = await page.evaluate(() =>
      JSON.parse(window.localStorage.getItem('splitit_local_groups_data') || '[]'),
    );
    expect(stored).toEqual([]);
  });

  test('открытие события никого не дописывает в участники', async ({ page }) => {
    // Раньше добавление происходило само при открытии любой ссылки на событие.
    const id = 'group-invite-flow';
    await seed(page, [group(id, { name: 'Событие владельца' })]);

    const membersOf = () =>
      page.evaluate(
        (gid) =>
          JSON.parse(window.localStorage.getItem('splitit_local_groups_data') || '[]').find(
            (g: any) => g.id === gid,
          ).members.length,
        id,
      );

    expect(await membersOf()).toBe(2);

    await page.goto(`/events/detail?id=${id}`);
    await expect(page.getByRole('heading', { name: 'Событие владельца' })).toBeVisible();

    expect(await membersOf(), 'состав изменился от одного открытия экрана').toBe(2);
  });

  test('вступление живёт на отдельном экране и требует кода', async ({ page }) => {
    // Ссылка-приглашение несёт одноразовый код, а не id группы: по id вступить
    // нельзя, политика на group_members разрешает прямую запись только владельцу.
    await seed(page, []);

    await page.goto('/invite');
    await expect(page.getByTestId('invite-error')).toContainText(/нет кода приглашения/);
  });

  test('без бэкенда приглашение честно сообщает, что не работает', async ({ page }) => {
    await seed(page, []);

    await page.goto('/invite?code=SOMECODE');
    await expect(page.getByTestId('invite-error')).toContainText(/подключённым бэкендом/);
  });
});

test.describe('Денежные суммы (регрессия S2-1)', () => {
  test('отрицательный расход отклоняется браузером и не сохраняется', async ({ page }) => {
    // Первый слой защиты: min="0.01" на поле. Браузер не пропускает сабмит.
    const id = 'group-negative';
    await seed(page, [group(id)]);

    await page.goto(`/events/expense/new?id=${id}`);
    await page.getByPlaceholder(/Например|Ужин|Название/i).first().fill('Отрицательный расход');
    await page.getByPlaceholder('0.00').fill('-1000');
    await page.getByRole('button', { name: /Сохранить|Добавить расход/ }).first().click();

    const rangeUnderflow = await page
      .getByPlaceholder('0.00')
      .evaluate((el) => (el as HTMLInputElement).validity.rangeUnderflow);
    expect(rangeUnderflow, 'браузер не считает отрицательную сумму невалидной').toBe(true);

    const expenses = await page.evaluate(
      (gid) =>
        JSON.parse(window.localStorage.getItem('splitit_local_groups_data') || '[]').find(
          (g: any) => g.id === gid,
        ).expenses,
      id,
    );
    expect(expenses, 'отрицательный расход попал в хранилище').toEqual([]);
  });

  test('отрицательный расход отклоняется и в обход нативной валидации', async ({ page }) => {
    // Второй слой: сама проверка в handleSave. Нативную валидацию обходят
    // мобильные браузеры и программная отправка, поэтому именно этот слой —
    // настоящая защита. Здесь submit отправляется напрямую, минуя проверку
    // ограничений формы: ровно так дефект и выглядел до починки.
    const id = 'group-negative-bypass';
    await seed(page, [group(id)]);

    await page.goto(`/events/expense/new?id=${id}`);
    await page.getByPlaceholder(/Например|Ужин|Название/i).first().fill('Обход валидации');
    await page.getByPlaceholder('0.00').fill('-1000');

    await page.evaluate(() => {
      const form = document.querySelector('form');
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    await expect(page.getByTestId('amount-error')).toBeVisible();
    await expect(page.getByTestId('amount-error')).toContainText('отрицательной');

    const expenses = await page.evaluate(
      (gid) =>
        JSON.parse(window.localStorage.getItem('splitit_local_groups_data') || '[]').find(
          (g: any) => g.id === gid,
        ).expenses,
      id,
    );
    expect(expenses).toEqual([]);
  });

  test('нулевой расход отклоняется', async ({ page }) => {
    const id = 'group-zero';
    await seed(page, [group(id)]);

    await page.goto(`/events/expense/new?id=${id}`);
    await page.getByPlaceholder(/Например|Ужин|Название/i).first().fill('Нулевой расход');
    await page.getByPlaceholder('0.00').fill('0');

    await page.evaluate(() => {
      const form = document.querySelector('form');
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    await expect(page.getByTestId('amount-error')).toContainText('нулевой');
  });

  test('поле суммы не принимает минус на уровне разметки', async ({ page }) => {
    const id = 'group-input-attrs';
    await seed(page, [group(id)]);

    await page.goto(`/events/expense/new?id=${id}`);
    const input = page.getByPlaceholder('0.00');
    await expect(input).toHaveAttribute('min', '0.01');
    await expect(input).toHaveAttribute('step', '0.01');
  });
});

test.describe('Обновления приложения (регрессия S1-2)', () => {
  test('без настроенного канала обновлений не обещают установку', async ({ page }) => {
    // Раньше проверка возвращала зашитую v2.4.0-OTA, кнопка крутила прогресс
    // на таймерах и рапортовала «Приложение успешно обновлено», не скачав
    // ни байта.
    await seed(page, []);
    await page.goto('/profile');

    await page.getByRole('button', { name: /Проверить обновления/ }).click();

    await expect(page.getByText(/Канал обновлений не настроен/)).toBeVisible();
    await expect(page.getByText('v2.4.0-OTA')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Обновить прямо сейчас/ })).toHaveCount(0);
    await expect(page.getByText(/успешно обновлено/)).toHaveCount(0);
  });
});

test.describe('Профиль без сессии (инвариант И-14)', () => {
  test('не показывает и не сохраняет выдуманного пользователя', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => window.localStorage.clear());
    await page.goto('/profile');

    await expect(page.getByRole('heading', { name: 'Профиль недоступен' })).toBeVisible();
    await expect(page.getByText('user@example.com')).toHaveCount(0);
    expect(await page.evaluate(() => window.localStorage.getItem('splitit_local_user_session'))).toBeNull();
  });
});

test.describe('Локальные контакты (инварианты И-14 и И-15)', () => {
  test('пустой список не заполняется выдуманными друзьями и ссылками', async ({ page }) => {
    await seed(page, []);
    await page.goto('/friends');

    await expect(page.getByText('Друзья не найдены')).toBeVisible();
    await expect(page.getByText(/Контакты хранятся только на этом устройстве/)).toBeVisible();
    await expect(page.getByText(/Максим Громов|Елена Воронова|Анастасия Ким/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Скопировать рабочую ссылку/ })).toHaveCount(0);
    expect(await page.evaluate(() => window.localStorage.getItem('splitit_saved_friends_list'))).toBeNull();
  });

  test('ручной контакт без телефона не получает выдуманные phone и email', async ({ page }) => {
    await seed(page, []);
    await page.goto('/friends');

    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    await page.getByPlaceholder('Имя и фамилия').fill('Иван Петров');
    await page.getByRole('button', { name: 'Сохранить друга' }).click();

    await expect(page.getByText('Иван Петров')).toBeVisible();
    await expect(page.getByText('Телефон не указан')).toBeVisible();
    const stored = await page.evaluate(() =>
      JSON.parse(window.localStorage.getItem('splitit_saved_friends_list') || '[]'),
    );
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ name: 'Иван Петров', role: 'member' });
    expect(stored[0]).not.toHaveProperty('phone');
    expect(stored[0]).not.toHaveProperty('email');
  });

  test('старый демо-набор удаляется, а пользовательский контакт сохраняется', async ({ page }) => {
    await seed(page, []);
    await page.evaluate(() => {
      window.localStorage.setItem(
        'splitit_saved_friends_list',
        JSON.stringify([
          { id: 'user-2', name: 'Максим Громов', email: 'maksim@example.com' },
          { id: 'real-1', name: 'Реальный контакт', phone: '+90 555 000 00 00' },
        ]),
      );
    });
    await page.goto('/friends');

    await expect(page.getByText('Максим Громов')).toHaveCount(0);
    await expect(page.getByText('Реальный контакт')).toBeVisible();
    const stored = await page.evaluate(() =>
      JSON.parse(window.localStorage.getItem('splitit_saved_friends_list') || '[]'),
    );
    expect(stored).toEqual([{ id: 'real-1', name: 'Реальный контакт', phone: '+90 555 000 00 00' }]);
  });
});

test.describe('Режим авторизации из ссылки (регрессия S3-1)', () => {
  test('/auth?mode=login открывает форму входа', async ({ page }) => {
    await page.goto('/auth?mode=login');
    await expect(page.getByRole('heading', { name: 'Вход в ваш профиль' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Войти в аккаунт/ })).toBeVisible();
  });

  test('/auth без параметра по-прежнему открывает регистрацию', async ({ page }) => {
    await page.goto('/auth');
    await expect(page.getByRole('heading', { name: 'Регистрация аккаунта' })).toBeVisible();
  });

  test('мусор в параметре не ломает экран', async ({ page }) => {
    await page.goto('/auth?mode=%D0%BC%D1%83%D1%81%D0%BE%D1%80');
    await expect(page.getByRole('heading', { name: 'Регистрация аккаунта' })).toBeVisible();
  });
});
