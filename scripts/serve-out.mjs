/**
 * Статический сервер для каталога out/.
 *
 * Эмулирует поведение статического хостинга и WebView Capacitor: отдаёт файл,
 * если он есть, и 404.html, если нет. Никаких fallback на index.html — иначе
 * дефекты вида «маршрут отсутствует в сборке» становятся невидимыми, а именно
 * такой дефект (S0-2) уехал в выпущенные APK и IPA.
 *
 * Зависимостей нет намеренно: обвязка тестов не должна падать из-за npx.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync as fsReadFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'out');
const PORT = Number(process.env.PORT || 4173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

async function resolveFile(urlPath) {
  // Кандидаты в том же порядке, в каком их пробует типичный статический хостинг.
  const clean = urlPath.replace(/\/+$/, '') || '/index';
  const candidates = [
    path.join(ROOT, clean),
    path.join(ROOT, `${clean}.html`),
    path.join(ROOT, clean, 'index.html'),
  ];

  for (const candidate of candidates) {
    // Не выпускаем за пределы out/ — защита от ../ в пути запроса.
    if (!candidate.startsWith(ROOT)) continue;
    try {
      const info = await stat(candidate);
      if (info.isFile()) return candidate;
    } catch (err) {
      if (err.code !== 'ENOENT' && err.code !== 'ENOTDIR') throw err;
    }
  }
  return null;
}

/**
 * Отпечаток собранного каталога: чтобы прогон тестов нельзя было незаметно
 * провести на сервере из соседнего запуска. Playwright ждёт именно /__ping,
 * а не корень, поэтому посторонний статический сервер границу не пройдёт.
 */
const BUILD_ID = (() => {
  try {
    return fsReadFileSync(path.join(ROOT, '_next', 'BUILD_ID'), 'utf-8').trim();
  } catch {
    return 'unknown';
  }
})();

const server = createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);

    if (urlPath === '/__ping') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ server: 'splitit-serve-out', root: ROOT, buildId: BUILD_ID, pid: process.pid }));
      return;
    }

    const file = await resolveFile(urlPath);

    if (file) {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(body);
      return;
    }

    const notFound = await resolveFile('/404');
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    res.end(notFound ? await readFile(notFound) : '404');
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`500 ${err.message}`);
  }
});

server.listen(PORT, () => {
  console.log(`serving ${ROOT} on http://localhost:${PORT}`);
});
