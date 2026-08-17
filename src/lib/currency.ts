/**
 * Multi-Currency Engine for SplitIT
 * Provides live API exchange rate conversions, caching, and localized formatting.
 */

import { t } from './i18n/t';

export interface CurrencyInfo {
  code: string;
  symbol: string;
  name: string;
  rateToRub: number; // exchange rate relative to RUB (1 unit of currency = X RUB)
}

export const CURRENCIES: Record<string, CurrencyInfo> = {
  USD: { code: 'USD', symbol: '$', name: 'US Dollar', rateToRub: 90.0 },
  EUR: { code: 'EUR', symbol: '€', name: 'Euro', rateToRub: 98.0 },
  GBP: { code: 'GBP', symbol: '£', name: 'British Pound', rateToRub: 115.0 },
  RUB: { code: 'RUB', symbol: '₽', name: 'Russian Ruble', rateToRub: 1.0 },
  TRY: { code: 'TRY', symbol: '₺', name: 'Turkish Lira', rateToRub: 2.7 },
  KZT: { code: 'KZT', symbol: '₸', name: 'Kazakhstani Tenge', rateToRub: 0.19 },
  UZS: { code: 'UZS', symbol: 'soʻm', name: 'Uzbekistani Som', rateToRub: 0.0071 },
  AED: { code: 'AED', symbol: 'د.إ', name: 'UAE Dirham', rateToRub: 24.5 },
  CNY: { code: 'CNY', symbol: '¥', name: 'Chinese Yuan', rateToRub: 12.4 },
  JPY: { code: 'JPY', symbol: '¥', name: 'Japanese Yen', rateToRub: 0.58 },
  KRW: { code: 'KRW', symbol: '₩', name: 'South Korean Won', rateToRub: 0.065 },
  INR: { code: 'INR', symbol: '₹', name: 'Indian Rupee', rateToRub: 1.08 },
  CHF: { code: 'CHF', symbol: 'Fr', name: 'Swiss Franc', rateToRub: 101.0 },
  CAD: { code: 'CAD', symbol: '$', name: 'Canadian Dollar', rateToRub: 65.0 },
  AUD: { code: 'AUD', symbol: '$', name: 'Australian Dollar', rateToRub: 58.0 },
  PLN: { code: 'PLN', symbol: 'zł', name: 'Polish Zloty', rateToRub: 22.8 },
  SEK: { code: 'SEK', symbol: 'kr', name: 'Swedish Krona', rateToRub: 8.5 },
  NOK: { code: 'NOK', symbol: 'kr', name: 'Norwegian Krone', rateToRub: 8.4 },
  DKK: { code: 'DKK', symbol: 'kr', name: 'Danish Krone', rateToRub: 13.1 },
  CZK: { code: 'CZK', symbol: 'Kč', name: 'Czech Koruna', rateToRub: 3.8 },
};

const RATES_CACHE_KEY = 'splitit_live_exchange_rates_v1';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface LiveRateStatus {
  lastUpdated: string;
  source: 'api' | 'cache' | 'fallback';
}

let currentStatus: LiveRateStatus = {
  lastUpdated: t('common.loading'),
  source: 'fallback',
};

export function getExchangeRateStatus(): LiveRateStatus {
  return currentStatus;
}

/**
 * Текст о качестве курса для показа рядом со сконвертированной суммой.
 * Возвращает ключ локализации и параметры.
 */
export function getRateDisclosureContext(fromCurrency: string, toCurrency: string): { key: string; params?: any } | null {
  if (fromCurrency === toCurrency) return null;

  switch (currentStatus.source) {
    case 'api':
      return { key: 'currency.rateLoadedApi', params: { time: currentStatus.lastUpdated } };
    case 'cache':
      return { key: 'currency.rateLoadedCache', params: { time: currentStatus.lastUpdated } };
    case 'fallback':
    default:
      return { key: 'currency.rateFallback' };
  }
}

/** Нужен ли пользователю предупреждающий вид: курс не настоящий. */
export function isRateStale(): boolean {
  return currentStatus.source === 'fallback';
}

/**
 * Fetches live exchange rates from free open API with offline local storage caching
 */
export async function fetchLiveExchangeRates(): Promise<Record<string, number>> {
  if (typeof window === 'undefined') {
    return getRatesObject();
  }

  // 1. Try reading valid cache first
  try {
    const cachedData = localStorage.getItem(RATES_CACHE_KEY);
    if (cachedData) {
      const parsed = JSON.parse(cachedData);
      if (parsed.timestamp && Date.now() - parsed.timestamp < CACHE_TTL_MS && parsed.rates) {
        applyRatesToCurrencies(parsed.rates);
        currentStatus = {
          lastUpdated: new Date(parsed.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
          source: 'cache',
        };
        return parsed.rates;
      }
    }
  } catch (e) {
    console.warn('Error reading exchange rates cache', e);
  }

  // 2. Fetch from Open ExchangeRate API (Free Endpoint relative to RUB)
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/RUB');
    if (res.ok) {
      const data = await res.json();
      if (data.rates) {
        // data.rates gives RUB -> target. Reverse for rateToRub (target -> RUB)
        const newRates: Record<string, number> = { RUB: 1.0 };
        for (const [code, rateFromRub] of Object.entries(data.rates)) {
          if (typeof rateFromRub === 'number' && rateFromRub > 0) {
            newRates[code] = 1 / rateFromRub;
          }
        }

        applyRatesToCurrencies(newRates);
        const now = Date.now();
        localStorage.setItem(RATES_CACHE_KEY, JSON.stringify({ timestamp: now, rates: newRates }));
        currentStatus = {
          lastUpdated: new Date(now).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
          source: 'api',
        };
        return newRates;
      }
    }
  } catch (err) {
    console.warn('Failed to fetch rates from open.er-api.com, trying backup CBR API...', err);
  }

  // 3. Backup CBR API (Central Bank of Russia Daily JSON)
  try {
    const cbrRes = await fetch('https://www.cbr-xml-daily.ru/daily_json.js');
    if (cbrRes.ok) {
      const cbrData = await cbrRes.json();
      if (cbrData.Valute) {
        const newRates: Record<string, number> = { RUB: 1.0 };
        for (const [code, valObj] of Object.entries<any>(cbrData.Valute)) {
          if (valObj.Value && valObj.Nominal) {
            newRates[code] = valObj.Value / valObj.Nominal;
          }
        }
        applyRatesToCurrencies(newRates);
        const now = Date.now();
        localStorage.setItem(RATES_CACHE_KEY, JSON.stringify({ timestamp: now, rates: newRates }));
        currentStatus = {
          lastUpdated: new Date(now).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
          source: 'api',
        };
        return newRates;
      }
    }
  } catch (err) {
    console.warn('Failed to fetch rates from CBR backup', err);
  }

  currentStatus = { lastUpdated: t('currency.fallbackRatesLabel'), source: 'fallback' };
  return getRatesObject();
}

/**
 * Курс сохраняется как есть, без округления до копеек.
 *
 * Раньше здесь стояло `Math.round(rateToRub * 100) / 100`. Округляли не ту
 * величину: до копеек имеет смысл округлять итоговую сумму, а не курс, по
 * которому её считают. Последствия было два, и оба тихие.
 *
 * Потеря точности. Тенге ходит около 0.166 ₽; после округления до 0.17 каждый
 * расход в тенге считался с ошибкой 2.4%, и она уезжала прямо в баланс.
 *
 * Деление на ноль. Курс мельче 0.005 округлялся в 0, и `convertCurrency`
 * возвращал `Infinity`. В списке валют сейчас таких нет, но добавление рупии,
 * донга или сума сломало бы расчёт долгов у всей группы без единого сообщения
 * об ошибке.
 *
 * Некорректные значения отбрасываются: лучше остаться на прежнем курсе, чем
 * принять ноль или NaN из ответа API.
 */
export function applyRatesToCurrencies(rates: Record<string, number>) {
  for (const [code, rateToRub] of Object.entries(rates)) {
    if (!CURRENCIES[code]) continue;
    if (!Number.isFinite(rateToRub) || rateToRub <= 0) {
      console.warn(`[SplitIT] Курс ${code} пришёл некорректным (${rateToRub}), оставляю прежний`);
      continue;
    }
    CURRENCIES[code].rateToRub = rateToRub;
  }
}

function getRatesObject(): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [code, info] of Object.entries(CURRENCIES)) {
    result[code] = info.rateToRub;
  }
  return result;
}

export function convertCurrency(
  amount: number,
  fromCurrency: string,
  toCurrency: string
): { convertedAmount: number; rate: number } {
  const fromInfo = CURRENCIES[fromCurrency] || CURRENCIES['RUB'];
  const toInfo = CURRENCIES[toCurrency] || CURRENCIES['RUB'];

  if (fromCurrency === toCurrency) {
    return { convertedAmount: amount, rate: 1.0 };
  }

  // Convert to RUB first, then to target currency
  const amountInRub = amount * fromInfo.rateToRub;
  const convertedAmount = amountInRub / toInfo.rateToRub;
  const effectiveRate = fromInfo.rateToRub / toInfo.rateToRub;

  return {
    convertedAmount: Math.round(convertedAmount * 100) / 100,
    rate: Math.round(effectiveRate * 10000) / 10000,
  };
}

export function formatMoney(amount: number, currency: string = 'RUB'): string {
  const info = CURRENCIES[currency] || { symbol: currency };
  const formattedNum = new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);

  return `${formattedNum} ${info.symbol}`;
}
