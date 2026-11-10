import { test, expect, Page } from '@playwright/test';

/**
 * 1.1.1, круг 6: на первом экране без входа «Войти в свой профиль» наезжала на
 * «Записаться в лист ожидания» (скриншот Android 1.1.1, дефект был и в 1.0.4).
 * Прямоугольники поля и кнопок синего блока не пересекаются, между ними ≥ 8 px,
 * все целиком внутри блока.
 */

type Box = { top: number; bottom: number; left: number; right: number };

async function open(page: Page, locale: 'ru' | 'en') {
  await page.goto('/auth?mode=login');
  await page.evaluate((l) => {
    window.localStorage.clear();
    if (l === 'en') {
      window.localStorage.setItem('splitit_locale', 'en');
      window.localStorage.setItem('splitit_locale_manual', '1');
    }
  }, locale);
  await page.goto('/');
}

const LABELS = {
  ru: { waitlist: 'Записаться в лист ожидания', signIn: 'Войти в свой профиль' },
  en: { waitlist: 'Join the waitlist', signIn: 'Sign in to your profile' },
};

for (const size of [{ width: 375, height: 812 }, { width: 360, height: 640 }]) {
  for (const locale of ['ru', 'en'] as const) {
    test(`синий блок ${size.width}×${size.height} ${locale}: кнопки не наезжают, зазор ≥ 8 px, внутри блока`, async ({ page }) => {
      await page.setViewportSize(size);
      await open(page, locale);
      const card = page.getByRole('main').locator('h1').locator('xpath=ancestor::div[contains(@class,"stitch-card")][1]');
      const input = card.locator('input[type="email"]');
      const waitlist = card.getByRole('button', { name: LABELS[locale].waitlist });
      const signIn = card.getByRole('link', { name: LABELS[locale].signIn });
      await expect(waitlist).toBeVisible();
      await expect(signIn).toBeVisible();

      // Все прямоугольники — одним снимком: страница может сдвинуться целиком
      // (сверху догружается полоса), и раздельные замеры сравнивали бы разные кадры.
      const [cardH, inputH, waitlistH, signInH] = await Promise.all([card, input, waitlist, signIn].map((l) => l.elementHandle()));
      const [block, ...rects] = await page.evaluate(async (els) => {
        await document.fonts.ready;
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return els.map((el) => {
          const r = el!.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
        });
      }, [cardH, inputH, waitlistH, signInH]);
      const items: [string, Box][] = [
        ['email', rects[0]],
        ['waitlist', rects[1]],
        ['signIn', rects[2]],
      ];

      for (const [name, b] of items) {
        expect.soft(b.top >= block.top && b.bottom <= block.bottom && b.left >= block.left && b.right <= block.right,
          `${name} ${JSON.stringify(b)} внутри блока ${JSON.stringify(block)}`).toBe(true);
      }
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const [na, a] = items[i];
          const [nb, b] = items[j];
          // Зазор по той оси, по которой элементы разведены; отрицательный — пересечение.
          const gap = Math.max(b.top - a.bottom, a.top - b.bottom, b.left - a.right, a.left - b.right);
          expect.soft(gap, `зазор ${na}↔${nb}: ${JSON.stringify(a)} / ${JSON.stringify(b)}`).toBeGreaterThanOrEqual(8);
        }
      }
    });
  }
}
