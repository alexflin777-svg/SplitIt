/**
 * Мультивалютность.
 *
 * Запуск: node --test test/currency.test.mjs
 *
 * До сих пор не было ни одного теста, хотя расход в чужой валюте влияет на
 * баланс всех участников события: сумма пересчитывается один раз при
 * сохранении и дальше живёт как число в валюте события. Ошибка здесь тихая —
 * долги просто оказываются не те.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  CURRENCIES,
  convertCurrency,
  formatMoney,
  applyRatesToCurrencies,
} from '../src/lib/currency.ts';

const round2 = (n) => Math.round(n * 100) / 100;

/** Справочник — модульное состояние, поэтому его надо возвращать на место. */
function withRates(rates, fn) {
  const before = Object.fromEntries(
    Object.entries(CURRENCIES).map(([code, info]) => [code, info.rateToRub]),
  );
  try {
    applyRatesToCurrencies(rates);
    return fn();
  } finally {
    for (const [code, rate] of Object.entries(before)) CURRENCIES[code].rateToRub = rate;
  }
}

describe('Конвертация', () => {
  test('одинаковая валюта не меняет сумму и даёт курс 1', () => {
    const r = convertCurrency(1234.56, 'RUB', 'RUB');
    assert.equal(r.convertedAmount, 1234.56);
    assert.equal(r.rate, 1);
  });

  test('доллары в рубли считаются по курсу валюты', () => {
    const usd = CURRENCIES.USD.rateToRub;
    const r = convertCurrency(100, 'USD', 'RUB');
    assert.equal(r.convertedAmount, round2(100 * usd));
  });

  test('рубли в доллары — обратная операция', () => {
    const usd = CURRENCIES.USD.rateToRub;
    const r = convertCurrency(usd, 'RUB', 'USD');
    assert.ok(Math.abs(r.convertedAmount - 1) < 0.01, `получилось ${r.convertedAmount}`);
  });

  test('туда-обратно возвращает исходную сумму с точностью до копеек', () => {
    // Пересчёт идёт через рубль в два деления, поэтому важно, что ошибка
    // не накапливается на обычных суммах.
    for (const code of ['USD', 'EUR', 'KZT', 'GEL', 'AED', 'TRY']) {
      const there = convertCurrency(1000, code, 'RUB').convertedAmount;
      const back = convertCurrency(there, 'RUB', code).convertedAmount;
      assert.ok(Math.abs(back - 1000) < 1, `${code}: 1000 → ${there} → ${back}`);
    }
  });

  test('конвертация между двумя не-рублёвыми валютами', () => {
    // USD → EUR идёт через рубль, отдельной пары в справочнике нет.
    const expected = round2((100 * CURRENCIES.USD.rateToRub) / CURRENCIES.EUR.rateToRub);
    assert.equal(convertCurrency(100, 'USD', 'EUR').convertedAmount, expected);
  });

  test('ноль остаётся нулём в любой валюте', () => {
    assert.equal(convertCurrency(0, 'USD', 'RUB').convertedAmount, 0);
  });

  test('неизвестная валюта не роняет расчёт', () => {
    // В сохранённых событиях может оказаться код, которого нет в справочнике.
    // Пересчёт обязан вернуть число, а не NaN: NaN уехал бы в баланс и
    // отравил бы весь расчёт долгов.
    const r = convertCurrency(100, 'XXX', 'RUB');
    assert.ok(Number.isFinite(r.convertedAmount), `получилось ${r.convertedAmount}`);
    assert.ok(Number.isFinite(r.rate));
  });

  test('результат всегда конечное число', () => {
    for (const from of Object.keys(CURRENCIES)) {
      for (const to of Object.keys(CURRENCIES)) {
        const r = convertCurrency(777.77, from, to);
        assert.ok(
          Number.isFinite(r.convertedAmount) && r.convertedAmount >= 0,
          `${from}→${to} дал ${r.convertedAmount}`,
        );
      }
    }
  });
});

describe('Справочник валют', () => {
  test('все курсы положительны', () => {
    // Ноль или отрицательное значение дало бы деление на ноль в пересчёте:
    // сумма расхода стала бы Infinity и разошлась бы по балансам.
    for (const [code, info] of Object.entries(CURRENCIES)) {
      assert.ok(info.rateToRub > 0, `${code}: курс ${info.rateToRub}`);
    }
  });

  test('рубль — опорная валюта с курсом 1', () => {
    assert.equal(CURRENCIES.RUB.rateToRub, 1);
  });

  test('у каждой валюты есть символ и название', () => {
    for (const [code, info] of Object.entries(CURRENCIES)) {
      assert.ok(info.symbol?.length, `${code}: нет символа`);
      assert.ok(info.name?.length, `${code}: нет названия`);
      assert.equal(info.code, code);
    }
  });
});

describe('Форматирование', () => {
  test('сумма выводится с символом валюты', () => {
    assert.match(formatMoney(1000, 'RUB'), /1\s?000\s?₽/u);
    assert.match(formatMoney(50, 'USD'), /50\s?\$/u);
  });

  test('копейки не теряются', () => {
    assert.match(formatMoney(1234.56, 'RUB'), /1\s?234[.,]56/u);
  });

  test('отрицательная сумма сохраняет знак', () => {
    // Баланс участника бывает отрицательным — это «должен», а не ошибка.
    assert.match(formatMoney(-500, 'RUB'), /-\s?500/u);
  });

  test('неизвестная валюта выводится своим кодом', () => {
    assert.match(formatMoney(100, 'XXX'), /XXX/);
  });
});

describe('Приём живых курсов (регрессия)', () => {
  test('курс сохраняется без округления до копеек', () => {
    // Раньше стояло Math.round(rate * 100) / 100: тенге по 0.166 превращался
    // в 0.17, и каждый расход в тенге считался с ошибкой 2.4%, которая
    // уезжала прямо в баланс участников.
    withRates({ KZT: 0.166 }, () => {
      assert.equal(CURRENCIES.KZT.rateToRub, 0.166, 'курс округлили');
    });
  });

  test('мелкий курс не обнуляется и не даёт Infinity', () => {
    // Курс мельче 0.005 округлялся в ноль, и пересчёт возвращал Infinity —
    // тихо, без ошибки, прямо в расчёт долгов всей группы.
    withRates({ KZT: 0.0012 }, () => {
      assert.ok(CURRENCIES.KZT.rateToRub > 0, 'курс обнулился');
      const r = convertCurrency(1000, 'KZT', 'RUB');
      assert.ok(Number.isFinite(r.convertedAmount), `получилось ${r.convertedAmount}`);
    });
  });

  test('точность сохраняется на пересчёте', () => {
    withRates({ KZT: 0.166 }, () => {
      // 100 000 тенге по настоящему курсу — 16 600 ₽. При округлении курса
      // до 0.17 вышло бы 17 000, то есть на 400 ₽ больше.
      assert.equal(convertCurrency(100000, 'KZT', 'RUB').convertedAmount, 16600);
    });
  });

  test('некорректный курс из API отбрасывается, прежний остаётся', () => {
    const before = CURRENCIES.USD.rateToRub;
    withRates({ USD: 0 }, () => {
      assert.equal(CURRENCIES.USD.rateToRub, before, 'ноль из API затёр рабочий курс');
    });
    withRates({ USD: Number.NaN }, () => {
      assert.equal(CURRENCIES.USD.rateToRub, before, 'NaN из API затёр рабочий курс');
    });
    withRates({ USD: -5 }, () => {
      assert.equal(CURRENCIES.USD.rateToRub, before, 'отрицательный курс принят');
    });
  });

  test('неизвестные коды из ответа API игнорируются', () => {
    withRates({ ZZZ: 1.23 }, () => {
      assert.equal(CURRENCIES.ZZZ, undefined, 'в справочник добавилась чужая валюта');
    });
  });
});
