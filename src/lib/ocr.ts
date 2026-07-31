/**
 * Receipt OCR Scanner Module for SplitIT
 * Extracts totals, dates, and items from receipt images.
 */

export interface OcrResult {
  rawText: string;
  suggestedTotal: number | null;
  suggestedTitle: string | null;
  detectedItems: Array<{ name: string; price: number }>;
}

/** Дальше нет смысла запускать распознавание: браузер съест память и повиснет. */
const MAX_RECEIPT_BYTES = 8 * 1024 * 1024;

export interface OcrOutcome {
  /** 'ok' — что-то распознано, 'empty' — движок отработал, но данных нет. */
  status: 'ok' | 'empty' | 'error';
  result: OcrResult | null;
  /** Текст для пользователя. Заполнен всегда, кроме успешного распознавания. */
  message: string | null;
}

/**
 * Распознавание чека.
 *
 * Раньше функция глушила любую ошибку Tesseract и возвращала обычный OcrResult
 * с заголовком «Оплата по чеку». Для вызывающего это выглядело как успешное
 * распознавание: спиннер снимался, а статус «Сканирование чека…» так и висел,
 * потому что суммы не было и ветка обновления статуса не срабатывала. Сбой
 * выглядел как бесконечное сканирование.
 *
 * Теперь исход возвращается явно, а сбой не притворяется результатом.
 */
export async function parseReceiptImage(imageFile: File | Blob): Promise<OcrOutcome> {
  if (imageFile.size > MAX_RECEIPT_BYTES) {
    const mb = (imageFile.size / 1024 / 1024).toFixed(1);
    return {
      status: 'error',
      result: null,
      message: `Файл слишком большой (${mb} МБ). Распознавание работает с файлами до 8 МБ — сфотографируйте чек в меньшем разрешении или введите сумму вручную.`,
    };
  }

  if (imageFile instanceof File && !imageFile.type.startsWith('image/')) {
    return {
      status: 'error',
      result: null,
      message: 'Это не изображение. Выберите фотографию чека или введите сумму вручную.',
    };
  }

  try {
    // Dynamic import to prevent SSR issues with tesseract.js
    const Tesseract = await import('tesseract.js');
    const { data } = await Tesseract.recognize(imageFile, 'rus+eng', {
      logger: () => {},
    });

    const result = extractDataFromText(data.text);

    if (result.suggestedTotal === null && result.detectedItems.length === 0) {
      return {
        status: 'empty',
        result,
        message: 'Сумма в чеке не распозналась. Введите её вручную.',
      };
    }

    return { status: 'ok', result, message: null };
  } catch (error: any) {
    console.error('[SplitIT] Ошибка распознавания чека', error);
    return {
      status: 'error',
      result: null,
      message: `Не удалось распознать чек: ${error?.message ?? 'движок распознавания недоступен'}. Введите сумму вручную.`,
    };
  }
}

export function extractDataFromText(text: string): OcrResult {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  let suggestedTotal: number | null = null;
  let suggestedTitle: string | null = null;
  const detectedItems: Array<{ name: string; price: number }> = [];

  // Patterns for totals: "ИТОГО 1450.00", "ВСЕГО: 3200", "TOTAL 45.90"
  const totalRegex = /(?:ИТОГО|ВСЕГО|К ОПЛАТЕ|TOTAL|СУММА)[=:\s]*([0-9\s]+[.,][0-9]{2}|[0-9]+)/i;
  // Patterns for price: "Питца 650.00"
  const priceRegex = /([0-9]+[.,][0-9]{2})/g;

  for (const line of lines) {
    const totalMatch = line.match(totalRegex);
    if (totalMatch && totalMatch[1]) {
      const parsedVal = parseFloat(totalMatch[1].replace(/\s/g, '').replace(',', '.'));
      if (!isNaN(parsedVal)) {
        suggestedTotal = parsedVal;
      }
    }

    // Try finding title from header lines
    if (!suggestedTitle && line.length > 3 && !line.match(/ЧЕК|ИТОГО|СПАСИБО|ИНН|КАССА/i)) {
      suggestedTitle = line.substring(0, 30);
    }
  }

  // If no total found, find max numeric value in receipt
  if (!suggestedTotal) {
    let maxVal = 0;
    const allNumbers = text.match(priceRegex);
    if (allNumbers) {
      for (const numStr of allNumbers) {
        const val = parseFloat(numStr.replace(',', '.'));
        if (val > maxVal && val < 500000) {
          maxVal = val;
        }
      }
    }
    if (maxVal > 0) suggestedTotal = maxVal;
  }

  return {
    rawText: text,
    suggestedTotal,
    suggestedTitle: suggestedTitle || 'Покупка по чеку',
    detectedItems,
  };
}
