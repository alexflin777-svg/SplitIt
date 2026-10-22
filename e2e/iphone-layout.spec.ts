import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Вёрстка ленты расходов и профиля на iPhone (2026-10-21, скриншоты владельца).
 *
 * 1. Поверх имени, суммы и кнопок карточки расхода ехала синяя base64-строка:
 *    фото участника (avatar = data:image/…) выводилось как текст.
 * 2. Знак валюты переносился под сумму, рядом — «1 участников».
 * 3. При прокрутке шапка уезжала, лента и профиль проезжали под часами iOS.
 * 4. Нижняя панель перекрывала поле подтверждения удаления при открытой
 *    клавиатуре.
 *
 * Данные синтетические. Геометрия здесь — браузерная (Chromium/WebKit в
 * Playwright), а не WKWebView на устройстве: env(safe-area-inset-*) браузер
 * отдаёт нулём, его проверяет только сборка на iPhone.
 */

// Настоящий PNG 1×1: как фото из профиля, только маленький.
const PHOTO =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

const M = (n: number) => `b0000000-0000-4000-8000-00000000000${n}`;
const LONG_NAME = 'Синтетическая Участница Константинопольская-Длиннофамильная';
const LONG_TITLE = 'Аренда апартаментов на побережье с видом на море и парковкой';

const GROUP = {
  id: 'c0000000-0000-4000-8000-000000000001',
  name: 'Проверка вёрстки',
  category: 'trip',
  currency: 'USD',
  status: 'active',
  createdBy: M(1),
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
  members: [
    { id: M(1), name: LONG_NAME, avatar: PHOTO, role: 'owner', email: 'owner@example.test' },
    { id: M(2), name: 'Борис', avatar: '🦊', role: 'member', email: 'b@example.test' },
    { id: M(3), name: 'Вера', avatar: '👤', role: 'member', email: 'v@example.test' },
    { id: M(4), name: 'Глеб', avatar: 'https://example.test/a.png', role: 'member', email: 'g@example.test' },
    // Битое фото: префикс верный, картинка не декодируется.
    { id: M(5), name: 'Дина', avatar: 'data:image/png;base64,AAAA', role: 'member', email: 'd@example.test' },
  ],
  expenses: [
    {
      id: 'e1', title: LONG_TITLE, amount: 1234567.89, currency: 'USD', amountInGroupCurrency: 1234567.89,
      category: 'housing', paidById: M(1), splits: [{ userId: M(1), amountOwed: 1234567.89 }],
      createdAt: '2026-10-03T10:00:00.000Z',
    },
    {
      id: 'e2', title: 'Ужин', amount: 58, currency: 'USD', amountInGroupCurrency: 58,
      category: 'food', paidById: 'b0000000-0000-4000-8000-0000000000ff',
      splits: [{ userId: M(1), amountOwed: 29 }, { userId: M(2), amountOwed: 29 }],
      createdAt: '2026-10-02T10:00:00.000Z',
    },
    {
      id: 'e3', title: 'Трансфер', amount: 100, currency: 'USD', amountInGroupCurrency: 100,
      category: 'transport', paidById: M(4),
      splits: [1, 2, 3, 4, 5].map((n) => ({ userId: M(n), amountOwed: 20 })),
      createdAt: '2026-10-01T10:00:00.000Z',
    },
    {
      id: 'e4', title: 'Кофе', amount: 5, currency: 'USD', amountInGroupCurrency: 5,
      category: 'food', paidById: M(5), splits: [{ userId: M(5), amountOwed: 5 }],
      createdAt: '2026-09-30T10:00:00.000Z',
    },
  ],
  settlements: [],
};

async function seed(page: Page, session: Record<string, unknown> = {}) {
  await page.goto('/');
  await page.evaluate(
    ([g, s]) => {
      window.localStorage.clear();
      window.localStorage.setItem(
        'splitit_local_user_session',
        JSON.stringify({
          id: (g as any).members[0].id,
          email: 'owner@example.test',
          full_name: (g as any).members[0].name,
          avatar_url: '👤',
          has_completed_onboarding: true,
          ...(s as object),
        }),
      );
      window.localStorage.setItem('splitit_local_groups_data', JSON.stringify([g]));
    },
    [GROUP, session] as const,
  );
}

/**
 * CSS, который WebKit на iPhone применяет внутри @supports (-webkit-touch-callout: none).
 * Ни Chromium, ни WebKit под Linux этот блок не включают, поэтому вкалываем его
 * содержимое как есть — иначе тест не видит iOS-правила вовсе.
 */
function iosOnlyCss(): string {
  const css = readFileSync(path.join(__dirname, '../src/app/globals.css'), 'utf8');
  const start = css.indexOf('@supports (-webkit-touch-callout: none)');
  if (start < 0) throw new Error('iOS-блок в globals.css не найден');
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error('iOS-блок в globals.css не закрыт');
}

test.describe('Карточка расхода: аватар, сумма, подписи', () => {
  test('фото участника — картинка, а не base64-текст поверх карточки', async ({ page }) => {
    await seed(page);
    await page.goto(`/events/detail?id=${GROUP.id}`);
    const cards = page.getByTestId('expense-card');
    await expect(cards).toHaveCount(4);

    const allText = await page.locator('main').innerText();
    expect(allText).not.toContain('base64');
    expect(allText).not.toContain('iVBOR');
    expect(allText).not.toContain('https://example.test');

    await expect(cards.nth(0).getByTestId('expense-payer-avatar').locator('img')).toBeVisible();
    // URL вместо эмодзи (Глеб) — нейтральный значок.
    await expect(cards.nth(2).getByTestId('expense-payer-avatar')).toHaveText('👤');
    // Битое фото (Дина) — тоже значок, а не иконка сломанной картинки.
    await expect(cards.nth(3).getByTestId('expense-payer-avatar')).toHaveText('👤');
    await expect(cards.nth(3).getByTestId('expense-payer-avatar').locator('img')).toHaveCount(0);
  });

  test('ничего не вылезает за карточку и не налезает на сумму и кнопки', async ({ page }) => {
    await seed(page);
    await page.goto(`/events/detail?id=${GROUP.id}`);
    const cards = page.getByTestId('expense-card');
    await expect(cards).toHaveCount(4);

    const problems = await cards.evaluateAll((els) => {
      const out: string[] = [];
      for (const [i, card] of els.entries()) {
        card.scrollIntoView({ block: 'center' });
        const c = card.getBoundingClientRect();
        const amount = card.querySelector('[data-testid="expense-amount"]') as HTMLElement;
        const a = amount.getBoundingClientRect();
        const lineHeight = parseFloat(getComputedStyle(amount).lineHeight);
        if (a.height > lineHeight * 1.5) out.push(`#${i}: сумма «${amount.innerText}» в ${Math.round(a.height / lineHeight)} строки`);

        const title = card.querySelector('h5')!.getBoundingClientRect();
        const payer = card.querySelector('h5 + p')!.getBoundingClientRect();
        for (const [name, r] of [['название', title], ['плательщик', payer]] as const) {
          if (r.right > a.left + 0.5) out.push(`#${i}: ${name} заходит на сумму (${Math.round(r.right)} > ${Math.round(a.left)})`);
        }
        // Любой потомок в границах карточки — с учётом обрезки предками
        // (truncate/overflow-hidden): обрезанный хвост не виден и не мешает.
        for (const el of Array.from(card.querySelectorAll('*'))) {
          const r = el.getBoundingClientRect();
          if (r.width === 0) continue;
          let left = r.left;
          let right = r.right;
          for (let p = el.parentElement; p && p !== card; p = p.parentElement) {
            if (getComputedStyle(p).overflowX === 'visible') continue;
            const pr = p.getBoundingClientRect();
            left = Math.max(left, pr.left);
            right = Math.min(right, pr.right);
          }
          if (left < c.left - 0.5 || right > c.right + 0.5) {
            out.push(`#${i}: <${el.tagName.toLowerCase()}> «${(el.textContent ?? '').slice(0, 30)}» вне карточки`);
            break;
          }
        }
        // Кнопки правки и удаления не перекрыты.
        for (const btn of Array.from(card.querySelectorAll('a[href*="expense/edit"], button'))) {
          const r = btn.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          if (!hit || !btn.contains(hit)) out.push(`#${i}: кнопка перекрыта <${hit?.tagName}>`);
        }
      }
      return out;
    });
    expect(problems).toEqual([]);
  });

  test('число участников склоняется, неизвестный плательщик подписан «Участник»', async ({ page }) => {
    await seed(page);
    await page.goto(`/events/detail?id=${GROUP.id}`);
    const cards = page.getByTestId('expense-card');
    await expect(cards.nth(0).getByTestId('expense-members-count')).toHaveText('• 1 участник');
    await expect(cards.nth(1).getByTestId('expense-members-count')).toHaveText('• 2 участника');
    await expect(cards.nth(2).getByTestId('expense-members-count')).toHaveText('• 5 участников');

    // Плательщика ужина нет среди участников: раньше расход приписывался первому.
    await expect(cards.nth(1).locator('h5 + p')).toHaveText('Оплатил(а) Участник');
    await expect(cards.nth(1).getByTestId('expense-payer-avatar')).toHaveText('👤');
  });
});

test.describe('Шапка и безопасная зона iOS', () => {
  test('в HTML один viewport-тег, и в нём viewport-fit=cover', async ({ page }) => {
    await page.goto('/');
    const tags = await page
      .locator('meta[name="viewport"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('content')));
    expect(tags).toHaveLength(1);
    expect(tags[0]).toContain('viewport-fit=cover');
  });

  for (const screen of ['/events/detail', '/profile'] as const) {
    test(`с iOS-стилями шапка остаётся наверху при прокрутке: ${screen}`, async ({ page }) => {
      await seed(page);
      await page.goto(screen === '/profile' ? screen : `${screen}?id=${GROUP.id}`);
      await page.waitForLoadState('networkidle');
      await page.addStyleTag({ content: iosOnlyCss() });

      await page.evaluate(() => window.scrollTo(0, 600));
      await page.waitForTimeout(100);
      expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(100);

      const top = await page.locator('header.app-header').evaluate((h) => h.getBoundingClientRect().top);
      expect(Math.abs(top)).toBeLessThan(1);
      // Горизонтальной прокрутки по-прежнему нет.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }
});

test.describe('Профиль: нижние кнопки доступны', () => {
  const LONG_EMAIL = 'very.long.synthetic.address.for.layout.check@subdomain.example.test';

  test('длинные имя и email не раздвигают экран; «Сохранить» и «Удалить» не под панелью', async ({ page }) => {
    await seed(page, { full_name: LONG_NAME, email: LONG_EMAIL });
    await page.goto('/profile');
    await page.waitForLoadState('networkidle');
    await page.addStyleTag({ content: iosOnlyCss() });

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    const blocked = await page.evaluate(async () => {
      const bar = document.querySelector('[data-testid="bottom-nav"] > div')!.getBoundingClientRect();
      const targets = [
        document.querySelector('form button[type="submit"]'),
        document.querySelector('[data-testid="delete-account"] input'),
        document.querySelector('[data-testid="delete-account"] > button'),
        document.querySelector('[data-testid="delete-account"] > a'),
      ];
      const out: string[] = [];
      for (const el of targets) {
        if (!el) {
          out.push('элемент не найден');
          continue;
        }
        // Пользователь докручивает до элемента. У нижних элементов прокрутка
        // упирается в конец страницы — и тогда они должны оказаться выше панели.
        el.scrollIntoView({ block: 'center' });
        await new Promise((r) => setTimeout(r, 50));
        const r = el.getBoundingClientRect();
        if (r.bottom > bar.top && r.top < bar.bottom) {
          out.push(`${el.tagName} под панелью: ${Math.round(r.top)}…${Math.round(r.bottom)} / ${Math.round(bar.top)}`);
        }
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (!hit || !el.contains(hit)) out.push(`${el.tagName}: в центре лежит <${hit?.tagName}>`);
      }
      return out;
    });
    expect(blocked).toEqual([]);
  });

  // Панель при вводе не прячется (по фокусу нельзя узнать, открыта ли
  // клавиатура; спрятанная навигация при закрытой клавиатуре — ловушка).
  // Вместо этого scroll-padding: поле, к которому браузер прокручивает при
  // фокусе, встаёт выше панели и ниже шапки. Настоящую экранную клавиатуру
  // браузер не эмулирует — это проверка на устройстве.
  test('поле в фокусе прокручивается выше нижней панели и ниже шапки, панель остаётся', async ({ page }) => {
    await seed(page);
    await page.goto('/profile');
    await page.waitForLoadState('networkidle');
    await page.addStyleTag({ content: iosOnlyCss() });
    const nav = page.getByTestId('bottom-nav');

    const fields = ['[data-testid="delete-account"] input', 'form input[type="text"]'];
    for (const sel of fields) {
      for (const block of ['end', 'start'] as const) {
        const geometry = await page.evaluate(
          ([s, b]) => {
            window.scrollTo(0, b === 'end' ? 0 : document.documentElement.scrollHeight);
            const el = document.querySelector(s) as HTMLElement;
            el.scrollIntoView({ block: b as ScrollLogicalPosition });
            el.focus({ preventScroll: true });
            const r = el.getBoundingClientRect();
            return {
              top: r.top,
              bottom: r.bottom,
              barTop: document.querySelector('[data-testid="bottom-nav"] > div')!.getBoundingClientRect().top,
              headerBottom: document.querySelector('header.app-header')!.getBoundingClientRect().bottom,
              focused: document.activeElement === el,
            };
          },
          [sel, block] as const,
        );
        expect(geometry.focused).toBe(true);
        expect(geometry.bottom, `${sel} ${block}: низ поля под панелью`).toBeLessThanOrEqual(geometry.barTop);
        expect(geometry.top, `${sel} ${block}: верх поля под шапкой`).toBeGreaterThanOrEqual(geometry.headerBottom);
        await expect(nav).toBeVisible();
      }
    }
  });
});

test.describe('Шапка не просвечивает', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`фон шапки непрозрачный, текст под ней не читается: ${theme}`, async ({ page }) => {
      await seed(page);
      await page.goto(`/events/detail?id=${GROUP.id}`);
      await page.waitForLoadState('networkidle');
      await page.addStyleTag({ content: iosOnlyCss() });
      if (theme === 'dark') await page.evaluate(() => document.documentElement.classList.add('dark'));

      await page.evaluate(() => window.scrollTo(0, 600));
      await page.waitForTimeout(100);
      const header = await page.locator('header.app-header').evaluate((h) => {
        const s = getComputedStyle(h);
        const alpha = (c: string) => {
          const m = c.match(/rgba?\(([^)]+)\)/);
          const parts = m ? m[1].split(/[ ,/]+/).filter(Boolean) : [];
          return parts.length === 4 ? parseFloat(parts[3]) : 1;
        };
        const r = h.getBoundingClientRect();
        const logo = h.querySelector('a')!.getBoundingClientRect();
        const hit = document.elementFromPoint(logo.left + logo.width / 2, logo.top + logo.height / 2);
        const panel = getComputedStyle(document.querySelector('[data-testid="bottom-nav"] > div')!);
        return {
          navBg: panel.backgroundColor,
          navAlpha: alpha(panel.backgroundColor),
          bg: s.backgroundColor,
          alpha: alpha(s.backgroundColor),
          image: s.backgroundImage,
          top: r.top,
          logoOnTop: !!hit && h.contains(hit),
        };
      });
      expect(header.top).toBe(0);
      expect(header.alpha, `фон шапки ${header.bg}`).toBe(1);
      expect(header.image).toBe('none');
      expect(header.logoOnTop).toBe(true);
      expect(header.navAlpha, `фон нижней панели ${header.navBg}`).toBe(1);
    });
  }
});

test.describe('Фото участника: восстановление после ошибки и декодирование', () => {
  test('исправное фото декодируется; битое → исправное без перемонтирования', async ({ page }) => {
    await seed(page);
    await page.goto(`/events/detail?id=${GROUP.id}`);
    const cards = page.getByTestId('expense-card');
    await expect(cards).toHaveCount(4);

    // Исправное фото: не просто <img> в DOM, а реально декодированная картинка.
    const decoded = await cards.nth(0).getByTestId('member-avatar-photo').evaluate(async (img: HTMLImageElement) => {
      await img.decode();
      return { complete: img.complete, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight };
    });
    expect(decoded).toEqual({ complete: true, naturalWidth: 1, naturalHeight: 1 });

    // Битое фото у Дины → 👤. Помечаем контейнер, чтобы потом убедиться, что
    // компонент не перемонтирован.
    const box = cards.nth(3).getByTestId('expense-payer-avatar');
    await expect(box).toHaveText('👤');
    await box.evaluate((el) => ((el as any).__sameNode = true));

    // Участница исправила фото в соседней вкладке: открытый экран получает
    // событие storage (subscribeToGroup локального режима) и перечитывает группу.
    const other = await page.context().newPage();
    await other.goto('/');
    await other.evaluate(
      ([photo, memberId]) => {
        const groups = JSON.parse(localStorage.getItem('splitit_local_groups_data')!);
        groups[0].members.find((m: any) => m.id === memberId).avatar = photo;
        localStorage.setItem('splitit_local_groups_data', JSON.stringify(groups));
      },
      [PHOTO, M(5)] as const,
    );
    await other.close();

    const img = box.getByTestId('member-avatar-photo');
    await expect(img).toBeVisible();
    expect(await box.evaluate((el) => (el as any).__sameNode === true)).toBe(true);
    const recovered = await img.evaluate(async (el: HTMLImageElement) => {
      await el.decode();
      return el.naturalWidth > 0 && el.complete;
    });
    expect(recovered).toBe(true);
  });
});

test.describe('Быстрый редактор: фокус возвращается и без фокуса на кнопке', () => {
  // Safari/WebKit не фокусирует кнопку по клику: при открытии
  // document.activeElement — body, и прежний код возвращал фокус «никуда»
  // (Mac WebKit, profile-avatar.spec.ts:89). Программный click() в Chromium
  // воспроизводит то же: событие есть, фокуса нет.
  test('открытие кликом без фокуса → Escape → фокус на кнопке-аватаре', async ({ page }) => {
    await seed(page);
    await page.goto('/');
    const button = page.getByTestId('home-avatar-button');
    await expect(button).toBeVisible();
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
      (document.querySelector('[data-testid="home-avatar-button"]') as HTMLElement).click();
    });
    const editor = page.getByTestId('quick-profile-editor');
    await expect(editor).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(editor).toHaveCount(0);
    await expect(button).toBeFocused();
  });
});
