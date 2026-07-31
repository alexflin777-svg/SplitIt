/**
 * Multi-Currency Engine for SplitIT
 * Provides live API exchange rate conversions, caching, and localized formatting.
 */

export interface CurrencyInfo {
  code: string;
  symbol: string;
  name: string;
  rateToRub: number; // exchange rate relative to RUB (1 unit of currency = X RUB)
}

export const CURRENCIES: Record<string, CurrencyInfo> = {
  RUB: { code: 'RUB', symbol: '₽', name: 'Российский рубль', rateToRub: 1.0 },
  USD: { code: 'USD', symbol: '$', name: 'Доллар США', rateToRub: 88.5 },
  EUR: { code: 'EUR', symbol: '€', name: 'Евро', rateToRub: 96.2 },
  KZT: { code: 'KZT', symbol: '₸', name: 'Казахстанский тенге', rateToRub: 0.18 },
  GEL: { code: 'GEL', symbol: '₾', name: 'Грузинский лари', rateToRub: 32.5 },
  AED: { code: 'AED', symbol: 'د.إ', name: 'Дирхам ОАЭ', rateToRub: 24.1 },
  TRY: { code: 'TRY', symbol: '₺', name: 'Турецкая лира', rateToRub: 2.7 },
};

const RATES_CACHE_KEY = 'splitit_live_exchange_rates_v1';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface LiveRateStatus {
  lastUpdated: string;
  source: 'api' | 'cache' | 'fallback';
}

let currentStatus: LiveRateStatus = {
  lastUpdated: 'Загрузка...',
  source: 'fallback',
};

export function getExchangeRateStatus(): LiveRateStatus {
  return currentStatus;
}

/**
 * Текст о качестве курса для показа рядом со сконвертированной суммой.
 *
 * Раньше `getExchangeRateStatus()` не вызывался ни в одном файле интерфейса:
 * при недоступном API приложение молча считало по курсам, зашитым в код
 * (USD 88.5, EUR 96.2, TRY 2.7), и пользователь не мог отличить свежий
 * пересчёт от устаревшего. Возвращает null, если пересчёта нет — когда валюта
 * расхода совпадает с валютой события, сообщать не о чем.
 */
export function getRateDisclosure(fromCurrency: string, toCurrency: string): string | null {
  if (fromCurrency === toCurrency) return null;

  switch (currentStatus.source) {
    case 'api':
      return `Курс загружен сегодня в ${currentStatus.lastUpdated}`;
    case 'cache':
      return `Курс из кэша, обновлён в ${currentStatus.lastUpdated}`;
    case 'fallback':
    default:
      return 'Курс не загружен — расчёт по резервным значениям, сумма может отличаться от фактической';
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
          lastUpdated: new Date(parsed.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
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
          lastUpdated: new Date(now).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
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
          lastUpdated: new Date(now).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
          source: 'api',
        };
        return newRates;
      }
    }
  } catch (err) {
    console.warn('Failed to fetch rates from CBR backup', err);
  }

  currentStatus = { lastUpdated: 'Резервные курсы', source: 'fallback' };
  return getRatesObject();
}

function applyRatesToCurrencies(rates: Record<string, number>) {
  for (const [code, rateToRub] of Object.entries(rates)) {
    if (CURRENCIES[code]) {
      CURRENCIES[code].rateToRub = Math.round(rateToRub * 100) / 100;
    }
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
