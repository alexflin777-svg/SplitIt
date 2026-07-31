/**
 * Подготовка аватара перед записью в localStorage (инвариант И-6).
 *
 * Раньше файл уходил в reader.readAsDataURL(file) без единой проверки: ни типа,
 * ни размера. Base64 занимает примерно на 37% больше исходника, так что фото с
 * телефона на 3-8 МБ гарантированно пробивало квоту localStorage (~5 МБ на всё
 * приложение). localStorage.setItem бросал QuotaExceededError прямо в
 * обработчике submit, регистрация обрывалась без объяснений.
 *
 * Теперь изображение уменьшается до 256x256 и пережимается в JPEG до записи.
 */

const MAX_SOURCE_BYTES = 12 * 1024 * 1024; // дальше нет смысла даже декодировать
const TARGET_SIZE = 256;
const JPEG_QUALITY = 0.85;
const MAX_RESULT_BYTES = 200 * 1024;

export interface AvatarResult {
  /** Готовый data:image/jpeg — либо null, если обработка не удалась. */
  dataUrl: string | null;
  /** Текст для пользователя — либо null, если всё в порядке. */
  error: string | null;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('Файл прочитан в неизвестном формате'));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Файл не является изображением'));
    img.src = dataUrl;
  });
}

/** Кадрирует по центру в квадрат и уменьшает до TARGET_SIZE. */
function downscale(img: HTMLImageElement): string {
  const canvas = document.createElement('canvas');
  canvas.width = TARGET_SIZE;
  canvas.height = TARGET_SIZE;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Браузер не поддерживает обработку изображений');

  const side = Math.min(img.width, img.height);
  const sx = (img.width - side) / 2;
  const sy = (img.height - side) / 2;
  ctx.drawImage(img, sx, sy, side, side, 0, 0, TARGET_SIZE, TARGET_SIZE);

  return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
}

export async function processAvatarFile(file: File): Promise<AvatarResult> {
  if (!file.type.startsWith('image/')) {
    return { dataUrl: null, error: 'Выберите изображение — PNG, JPEG или WebP' };
  }
  if (file.size > MAX_SOURCE_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    return { dataUrl: null, error: `Файл слишком большой (${mb} МБ). Выберите изображение до 12 МБ.` };
  }

  try {
    const original = await readAsDataUrl(file);
    const img = await loadImage(original);
    const resized = downscale(img);

    if (resized.length > MAX_RESULT_BYTES) {
      return { dataUrl: null, error: 'Не удалось сжать изображение достаточно сильно. Выберите другое фото.' };
    }
    return { dataUrl: resized, error: null };
  } catch (e: any) {
    return { dataUrl: null, error: e?.message ?? 'Не удалось обработать изображение' };
  }
}
