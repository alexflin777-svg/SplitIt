// F4: выбранный при регистрации аватар записывается в profiles, если Supabase
// сразу выдал сессию. Сеть не используется: настоящий supabase-js ходит в
// подменённый fetch с фиктивным адресом.
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.test';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const realFetch = globalThis.fetch;
let calls = [];
let profileStatus = 201;
let withSession = true;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

let signUpUser;
before(async () => {
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const body = init.body ? JSON.parse(init.body) : null;
    const headers = new Headers(init.headers);
    calls.push({ url, method: init.method ?? 'GET', body, prefer: headers.get('prefer') ?? '' });
    if (url.includes('/auth/v1/signup')) {
      const user = { id: USER_ID, aud: 'authenticated', email: body.email, user_metadata: body.data, app_metadata: {} };
      if (!withSession) return json(user);
      const now = Math.floor(Date.now() / 1000);
      return json({ access_token: 'a.b.c', token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'r', user });
    }
    if (url.includes('/rest/v1/profiles')) {
      return profileStatus < 300 ? new Response(null, { status: profileStatus }) : json({ message: 'new row violates row-level security policy', code: '42501' }, profileStatus);
    }
    return json({});
  };
  ({ signUpUser } = await import('../src/lib/supabase.ts'));
});

after(() => {
  globalThis.fetch = realFetch;
});

beforeEach(() => {
  calls = [];
  profileStatus = 201;
  withSession = true;
});

const profileCalls = () => calls.filter((c) => c.url.includes('/rest/v1/profiles'));

test('после регистрации с сессией аватар уходит в profiles (upsert)', async () => {
  const res = await signUpUser('new@example.com', 'Str0ng-pass!', 'Алекс', '🦊');
  assert.equal(res.error, null);
  assert.equal(res.profileSyncError, undefined);
  const [call] = profileCalls();
  assert.ok(call, 'запроса к profiles не было');
  assert.equal(call.method, 'POST');
  assert.match(call.prefer, /resolution=merge-duplicates/, 'это должен быть upsert, а не insert');
  // Не трогаем настройки, которые пользователь мог уже поменять.
  assert.deepEqual(Object.keys(call.body).sort(), ['avatar_url', 'email', 'full_name', 'id', 'updated_at']);
  assert.equal(call.body.id, USER_ID);
  assert.equal(call.body.avatar_url, '🦊');
  assert.equal(call.body.full_name, 'Алекс');
});

test('сбой записи профиля не отменяет вход, но возвращается как profileSyncError', async () => {
  profileStatus = 403;
  const res = await signUpUser('new2@example.com', 'Str0ng-pass!', 'Алекс', 'data:image/jpeg;base64,AAAA');
  assert.equal(res.error, null);
  assert.equal(res.data?.id, USER_ID);
  assert.match(res.profileSyncError ?? '', /row-level security/);
});

test('фото не попадает в user_metadata (иначе раздувается JWT), но пишется в profiles', async () => {
  const photo = 'data:image/jpeg;base64,' + 'A'.repeat(1000);
  const res = await signUpUser('new4@example.com', 'Str0ng-pass!', 'Алекс', photo);
  assert.equal(res.error, null);
  const signup = calls.find((c) => c.url.includes('/auth/v1/signup'));
  assert.equal(signup.body.data.avatar_url, '👤');
  assert.equal(profileCalls()[0].body.avatar_url, photo);
});

test('без сессии (нужно подтверждение email) в profiles не пишем', async () => {
  withSession = false;
  const res = await signUpUser('new3@example.com', 'Str0ng-pass!', 'Алекс', '🦊');
  assert.equal(res.requiresEmailConfirmation, true);
  assert.equal(profileCalls().length, 0);
});
