// Обычная сборка не должна нести e2e-фейк «Проекта» (src/lib/projects-e2e-fake.ts):
// ищет его ключ localStorage во всех файлах out/. Запуск после `npm run build`.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const NEEDLE = 'splitit_fake_projects';
const files = readdirSync('out', { recursive: true, withFileTypes: true })
  .filter((d) => d.isFile())
  .map((d) => join(d.parentPath, d.name));
const hits = files.filter((f) => readFileSync(f).includes(NEEDLE));
console.log(`check-no-fake: просмотрено ${files.length} файлов out/, найдено «${NEEDLE}»: ${hits.length}`);
for (const f of hits) console.log(`  ${f}`);
process.exit(hits.length ? 1 : 0);
