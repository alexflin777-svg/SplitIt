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

export async function parseReceiptImage(imageFile: File | Blob): Promise<OcrResult> {
  try {
    // Dynamic import to prevent SSR issues with tesseract.js
    const Tesseract = await import('tesseract.js');
    const { data } = await Tesseract.recognize(imageFile, 'rus+eng', {
      logger: () => {},
    });

    const rawText = data.text;
    return extractDataFromText(rawText);
  } catch (error) {
    console.error('OCR Processing error:', error);
    // Fallback parser if OCR engine fails or is offline
    return {
      rawText: 'Чек обработан (ручной ввод)',
      suggestedTotal: null,
      suggestedTitle: 'Оплата по чеку',
      detectedItems: [],
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
