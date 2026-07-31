import { test, expect, Page } from '@playwright/test';

/**
 * Регрессия на дефект «белый текст на белой карточке».
 *
 * В globals.css у .stitch-card стояло сокращение `background: #ffffff`.
 * Сокращение сбрасывает background-image в none, а Tailwind реализует
 * bg-gradient-* именно через background-image. Поэтому каждая карточка с
 * классами `stitch-card bg-gradient-to-br ... text-white` теряла тёмный
 * градиент, оставалась белой, и белый текст на ней исчезал.
 *
 * Пострадали шесть экранов, включая главный показатель приложения — сумму
 * расходов события. Ни типы, ни проверки текста этого не видят: текст в DOM
 * присутствует, он просто не читается. Поэтому проверка идёт по вычисленным
 * стилям.
 */

async function findInvisibleWhiteText(page: Page) {
  return page.evaluate(() => {
    function parseRgb(value: string): [number, number, number] | null {
      const m = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
    }

    // Относительная яркость по WCAG.
    function luminance([r, g, b]: [number, number, number]): number {
      const channel = (c: number) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    }

    function contrast(a: [number, number, number], b: [number, number, number]): number {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    }

    /**
     * Фон, на котором реально лежит узел: ближайший предок с непрозрачной
     * заливкой. Брать фон карточки нельзя — внутри неё бывают собственные
     * подложки, и сравнение с ними даёт ложные срабатывания.
     * Возвращает null, если на пути встретился градиент: за ним яркость
     * не посчитать надёжно.
     */
    function effectiveBackground(node: Element): [number, number, number] | null {
      let current: Element | null = node;
      while (current) {
        const cs = getComputedStyle(current);
        if (cs.backgroundImage !== 'none') return null;
        const rgb = parseRgb(cs.backgroundColor);
        const alpha = Number(cs.backgroundColor.match(/rgba?\([^)]*,\s*([\d.]+)\)/)?.[1] ?? '1');
        if (rgb && alpha > 0.5) return rgb;
        current = current.parentElement;
      }
      return [255, 255, 255];
    }

    const problems: string[] = [];

    for (const card of Array.from(document.querySelectorAll('.stitch-card'))) {
      // Карточка объявила градиент классами, но он не применился — ровно тот
      // случай, который делал сумму расходов невидимой.
      if (card.className.includes('bg-gradient-') && getComputedStyle(card).backgroundImage === 'none') {
        problems.push(`градиент не применился: ${card.className.slice(0, 80)}`);
        continue;
      }

      for (const node of Array.from(card.querySelectorAll('*'))) {
        if (node.childElementCount > 0) continue;
        const text = (node.textContent ?? '').trim();
        // Эмодзи рисуются собственными цветами и не подчиняются CSS color,
        // поэтому проверяются только строки с буквами или цифрами.
        if (!/[\p{L}\p{N}]/u.test(text)) continue;

        const fg = parseRgb(getComputedStyle(node).color);
        const bg = effectiveBackground(node);
        if (!fg || !bg) continue;

        if (contrast(fg, bg) < 1.5) {
          problems.push(`нечитаемый текст "${text.slice(0, 40)}" на rgb(${bg.join(', ')})`);
        }
      }
    }
    return problems;
  });
}

const SEED = {
  session: { id: 'guest-1', email: 'guest@splitit.app', full_name: 'Демо Аккаунт', avatar_url: '👤' },
  group: {
    id: 'group-contrast',
    name: 'Проверка контраста',
    category: 'trip',
    currency: 'RUB',
    status: 'active',
    members: [
      { id: 'm-1', name: 'Алексей', avatar: '👑', role: 'owner' },
      { id: 'm-2', name: 'Мария', avatar: '👤', role: 'member' },
    ],
    expenses: [
      {
        id: 'exp-1',
        title: 'Аренда',
        amount: 9000,
        amountInGroupCurrency: 9000,
        currency: 'RUB',
        paidById: 'm-1',
        date: '2026-07-31T00:00:00.000Z',
      },
    ],
    settlements: [],
  },
};

const SCREENS = [
  { name: 'главная', url: '/' },
  { name: 'событие', url: `/events/detail?id=${SEED.group.id}` },
  { name: 'баланс', url: `/events/balance?id=${SEED.group.id}` },
  { name: 'друзья', url: '/friends' },
  { name: 'профиль', url: '/profile' },
];

for (const screen of SCREENS) {
  test(`текст читается на экране «${screen.name}»`, async ({ page }) => {
    await page.goto('/');
    await page.evaluate((seed) => {
      window.localStorage.setItem('splitit_local_user_session', JSON.stringify(seed.session));
      window.localStorage.setItem('splitit_local_groups_data', JSON.stringify([seed.group]));
    }, SEED);

    await page.goto(screen.url);
    await page.waitForLoadState('networkidle');

    expect(await findInvisibleWhiteText(page)).toEqual([]);
  });
}
