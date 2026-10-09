// Нативные описания разрешений: без них iOS убивает процесс при запросе доступа
// (краш «Импорт» на вкладке Друзья, iPhone 13, 2026-10-09).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const IOS_KEYS = ['NSContactsUsageDescription', 'NSCameraUsageDescription', 'NSPhotoLibraryUsageDescription'];

test('Info.plist содержит непустые описания всех запрашиваемых разрешений', () => {
  const plist = read('ios/App/App/Info.plist');
  for (const key of IOS_KEYS) {
    const m = plist.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`));
    assert.ok(m && m[1].trim().length > 10, `нет описания ${key}`);
  }
});

test('InfoPlist.strings (en, ru) переводят те же ключи и подключены в проект Xcode', () => {
  for (const lang of ['en', 'ru']) {
    const strings = read(`ios/App/App/${lang}.lproj/InfoPlist.strings`);
    for (const key of IOS_KEYS) assert.match(strings, new RegExp(`^"${key}" = ".+";$`, 'm'), `${lang}: нет ${key}`);
  }
  const pbx = read('ios/App/App.xcodeproj/project.pbxproj');
  assert.match(pbx, /path = ru\.lproj\/InfoPlist\.strings;/);
  assert.match(pbx, /InfoPlist\.strings in Resources \*\/,/);
  assert.match(pbx, /knownRegions = \([^)]*\bru,/);
});

test('AndroidManifest запрашивает READ_CONTACTS для импорта контактов', () => {
  assert.match(read('android/app/src/main/AndroidManifest.xml'), /android\.permission\.READ_CONTACTS/);
});
