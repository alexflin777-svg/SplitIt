import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shouldSetupPush } from '../src/lib/push-policy.ts';

for (const isNative of [false, true]) {
  for (const enabled of [false, true]) {
    test(`push: isNative=${isNative}, enabled=${enabled}`, () => {
      assert.equal(shouldSetupPush({ isNative, enabled }), isNative && enabled);
    });
  }
}

// Регрессия 23.10.2026: без google-services.json PushNotifications.register()
// роняет Android-приложение (FirebaseApp не инициализирован). Хук обязан
// проверить политику до любого вызова плагина, а флаг по умолчанию выключен.
test('хук не обращается к плагину push до проверки политики', () => {
  const src = readFileSync(new URL('../src/hooks/usePushNotifications.ts', import.meta.url), 'utf8');
  const guard = src.indexOf('shouldSetupPush(');
  assert.ok(guard > 0, 'нет вызова shouldSetupPush');
  for (const call of ['checkPermissions(', 'requestPermissions(', 'register(']) {
    const at = src.indexOf(`PushNotifications.${call}`);
    assert.ok(at > guard, `PushNotifications.${call} стоит до проверки политики`);
  }
});

test('флаг push по умолчанию выключен', () => {
  const env = readFileSync(new URL('../src/lib/env.ts', import.meta.url), 'utf8');
  assert.match(env, /PUSH_ENABLED\s*=\s*process\.env\.NEXT_PUBLIC_PUSH_ENABLED\s*===\s*'1'/);
});
