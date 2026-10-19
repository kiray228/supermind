/** Аккаунт, синхронизация и облачные копии — на Postgres в памяти */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.ts';
import { PgliteSql } from './pglite.ts';
import { parseNextDue, type NextDueMark, type NextDueStore } from '../src/objectStore.ts';

const sql = new PgliteSql();
const mails: { to: string; subject: string; text: string }[] = [];
const app = createApp({ mail: async (m) => void mails.push(m), supportEmail: 'owner@b.cd', sql, push: async () => ({ status: 201, gone: false }), pushHostOk: () => true });

async function call<T = Record<string, unknown>>(method: string, path: string, body?: unknown, token?: string) {
  const r = await app.fetch(
    new Request('http://x' + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  return { status: r.status, data: (await r.json()) as T };
}

test('данные переживают ошибочную синхронизацию: из облачной копии можно вернуть прежнее', async () => {
  const reg = await call<{ token: string }>('POST', '/auth/register', { name: 'A', email: 'a@b.cd', password: '12345678' });
  assert.equal(reg.status, 201);
  const t = reg.data.token;

  // первая отправка: копировать ещё нечего
  let r = await call<{ results: { ok: boolean; seq: number }[] }>('POST', '/sync', { items: [{ key: 'tasks', value: { tasks: [{ id: '1' }] }, updatedAt: 1, baseSeq: 0 }] }, t);
  assert.equal(r.data.results[0].ok, true);
  const seq = r.data.results[0].seq;
  let list = await call<{ snapshots: { id: string; keys: number; reason: string }[] }>('GET', '/snapshots', undefined, t);
  assert.equal(list.data.snapshots.length, 0);

  // «плохое» изменение: перед ним сервер сам сохраняет копию
  r = await call('POST', '/sync', { items: [{ key: 'tasks', value: { tasks: [] }, updatedAt: 2, baseSeq: seq }] }, t);
  list = await call('GET', '/snapshots', undefined, t);
  assert.equal(list.data.snapshots.length, 1);
  assert.equal(list.data.snapshots[0].reason, 'auto');

  // в течение часа повторно не копирует
  const seq2 = (r.data as { results: { seq: number }[] }).results[0].seq;
  await call('POST', '/sync', { items: [{ key: 'tasks', value: { tasks: [{ id: '2' }] }, updatedAt: 3, baseSeq: seq2 }] }, t);
  list = await call('GET', '/snapshots', undefined, t);
  assert.equal((list.data.snapshots as unknown[]).length, 1);

  const snap = await call<{ data: Record<string, unknown> }>('GET', `/snapshots/${(list.data.snapshots as { id: string }[])[0].id}`, undefined, t);
  assert.deepEqual(snap.data.data.tasks, { tasks: [{ id: '1' }] });

  // ручная копия и чужой доступ
  const manual = await call<{ id: string }>('POST', '/snapshots', {}, t);
  assert.equal(manual.status, 200);
  const other = await call<{ token: string }>('POST', '/auth/register', { email: 'z@b.cd', password: '12345678' });
  assert.equal((await call('GET', `/snapshots/${manual.data.id}`, undefined, other.data.token)).status, 404);
  assert.equal((await call('GET', '/snapshots')).status, 401);
});

test('вход, которым не пользовались полгода, больше не действует; свежий — продлевается', async () => {
  const reg = await call<{ token: string; user: { id: string } }>('POST', '/auth/register', { email: 'idle@b.cd', password: '12345678' });
  const t = reg.data.token;
  assert.equal((await call('GET', '/auth/me', undefined, t)).status, 200);
  await sql.query(`UPDATE sessions SET last_used_at = now() - interval '179 days' WHERE user_id = $1`, [reg.data.user.id]);
  assert.equal((await call('GET', '/auth/me', undefined, t)).status, 200, '179 дней — ещё действует и продлевается');
  await sql.query(`UPDATE sessions SET last_used_at = now() - interval '181 days' WHERE user_id = $1`, [reg.data.user.id]);
  const r = await call<{ error: string }>('GET', '/auth/me', undefined, t);
  assert.equal(r.status, 401);
  assert.match(r.data.error, /Сессия истекла/);
  const again = await call<{ token: string }>('POST', '/auth/login', { email: 'idle@b.cd', password: '12345678' });
  assert.equal((await call('GET', '/auth/me', undefined, again.data.token)).status, 200, 'новый вход работает');
});

test('хранение копий: сутки — все, дальше — первая и последняя за день, старше 30 дней — удаляются', async () => {
  const reg = await call<{ token: string; user: { id: string } }>('POST', '/auth/register', { email: 'keep@b.cd', password: '12345678' });
  const { token: t, user } = reg.data;
  await call('POST', '/sync', { items: [{ key: 'a', value: 1, updatedAt: 1, baseSeq: 0 }] }, t);
  const add = (ago: string) => sql.query(`INSERT INTO snapshots (user_id, created_at, data) VALUES ($1, now() - $2::interval, '{}')`, [user.id, ago]);
  await add('2 hours');
  await add('3 hours');
  const dayAgo3 = (h: number) => sql.query(`INSERT INTO snapshots (user_id, created_at, data) VALUES ($1, date_trunc('day', now()) - interval '3 days' + make_interval(hours => $2), '{}')`, [user.id, h]);
  await dayAgo3(1);
  await dayAgo3(2);
  await add('40 days');
  await call('POST', '/snapshots', {}, t);
  const rows = await sql.query(`SELECT count(*) FROM snapshots WHERE user_id = $1`, [user.id]);
  // ручная + 2 за сутки + первая и последняя за тот день; 40-дневная удалена
  assert.equal(Number(rows[0][0]), 5);
  await dayAgo3(3);
  await call('POST', '/snapshots', {}, t);
  const after = await sql.query(`SELECT count(*) FROM snapshots WHERE user_id = $1 AND created_at < now() - interval '2 days'`, [user.id]);
  // из трёх копий того дня — первая и последняя
  assert.equal(Number(after[0][0]), 2);
});

test('номера изменений по пользователю растут по порядку, загрузка ничего не пропускает', async () => {
  const a = await call<{ token: string }>('POST', '/auth/register', { email: 'seq@b.cd', password: '12345678' });
  const t = a.data.token;
  const seqs: number[] = [];
  for (let i = 0; i < 5; i++) {
    const r = await call<{ results: { ok: boolean; seq: number }[] }>('POST', '/sync', { items: [{ key: 'k' + i, value: i, updatedAt: i + 1, baseSeq: 0 }] }, t);
    seqs.push(r.data.results[0].seq);
  }
  assert.deepEqual(seqs, [1, 2, 3, 4, 5]);
  // конфликт: значение не перезаписывается
  const c = await call<{ results: { ok: boolean }[] }>('POST', '/sync', { items: [{ key: 'k0', value: 9, updatedAt: 9, baseSeq: 99 }] }, t);
  assert.equal(c.data.results[0].ok, false);
  const pulled = await call<{ items: { key: string; seq: number }[] }>('GET', '/sync?since=2', undefined, t);
  assert.deepEqual(pulled.data.items.map((x) => x.key), ['k2', 'k3', 'k4']);
});

test('восстановление пароля: код на почту, новый пароль, старые сессии закрыты', async () => {
  const reg = await call<{ token: string }>('POST', '/auth/register', { name: 'Аня', email: 'reset@b.cd', password: 'oldpass11' });
  const oldToken = reg.data.token;
  // неизвестный адрес — тот же ответ, письма нет
  assert.equal((await call('POST', '/auth/forgot', { email: 'nobody@b.cd' })).status, 200);
  assert.equal(mails.length, 0);
  assert.equal((await call('POST', '/auth/forgot', { email: 'Reset@B.cd' })).status, 200);
  assert.equal(mails.length, 1);
  const code = /(\d{6})/.exec(mails[0].text)![1];
  assert.match(mails[0].subject, new RegExp(code));
  // неверный код
  assert.equal((await call('POST', '/auth/reset', { email: 'reset@b.cd', code: '000000' === code ? '111111' : '000000', password: 'newpass22' })).status, 400);
  const ok = await call<{ token: string; user: { email: string } }>('POST', '/auth/reset', { email: 'reset@b.cd', code, password: 'newpass22' });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.user.email, 'reset@b.cd');
  // код одноразовый
  assert.equal((await call('POST', '/auth/reset', { email: 'reset@b.cd', code, password: 'other333' })).status, 400);
  // старая сессия закрыта, новый пароль работает, старый — нет
  assert.equal((await call('GET', '/auth/me', undefined, oldToken)).status, 401);
  assert.equal((await call('POST', '/auth/login', { email: 'reset@b.cd', password: 'newpass22' })).status, 200);
  assert.equal((await call('POST', '/auth/login', { email: 'reset@b.cd', password: 'oldpass11' })).status, 401);
  // не больше 3 писем за 15 минут
  await call('POST', '/auth/forgot', { email: 'reset@b.cd' });
  await call('POST', '/auth/forgot', { email: 'reset@b.cd' });
  assert.equal((await call('POST', '/auth/forgot', { email: 'reset@b.cd' })).status, 429);
});

test('поддержка: обращение сохраняется, письмо владельцу с ответом пользователю', async () => {
  const reg = await call<{ token: string }>('POST', '/auth/register', { name: 'Олжас', email: 'fb@b.cd', password: '12345678' });
  const t = reg.data.token;
  assert.equal((await call('POST', '/feedback', { kind: 'idea', text: 'ок' }, t)).status, 400);
  assert.equal((await call('POST', '/feedback', { kind: 'idea', text: 'Добавьте тёмную тему для карт' })).status, 401);
  const before = mails.length;
  const r = await call<{ id: string }>('POST', '/feedback', { kind: 'problem', text: 'Не открывается карта', meta: 'v1.13 · iPhone', image: 'aGVsbG8=' }, t);
  assert.equal(r.status, 201);
  const m = mails[before] as { to: string; subject: string; replyTo?: string; attachments?: unknown[] };
  assert.equal(m.to, 'owner@b.cd');
  assert.equal(m.replyTo, 'fb@b.cd');
  assert.match(m.subject, /Проблема/);
  assert.equal(m.attachments?.length, 1);
  const list = await call<{ items: { text: string; kind: string }[] }>('GET', '/feedback', undefined, t);
  assert.equal(list.data.items[0].text, 'Не открывается карта');
});

test('входящие поддержки: владелец видит все обращения, меняет статус и отвечает', async () => {
  const pushed: { endpoint: string; payload: { title: string; data: Record<string, string> } }[] = [];
  const adminApp = createApp({
    mail: async (m) => void mails.push(m),
    supportEmail: 'owner@b.cd',
    adminEmails: ['Boss@b.cd'],
    sql,
    pushHostOk: () => true,
    push: async (sub, payload) => (pushed.push({ endpoint: sub.endpoint, payload: payload as (typeof pushed)[number]['payload'] }), { status: 201, gone: false }),
  });
  const req = async <T = Record<string, unknown>>(method: string, path: string, body?: unknown, token?: string) => {
    const r = await adminApp.fetch(
      new Request('http://x' + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    return { status: r.status, data: (await r.json()) as T };
  };
  const boss = (await req<{ token: string }>('POST', '/auth/register', { email: 'boss@b.cd', password: '12345678' })).data.token;
  const user = (await req<{ token: string }>('POST', '/auth/register', { name: 'Аня', email: 'anya@b.cd', password: '12345678' })).data.token;
  // у владельца включены уведомления — о новом обращении приходит push, открывающий «Входящие»
  await req('POST', '/devices', { subscription: { endpoint: 'https://push.example/boss', keys: { p256dh: 'p', auth: 'a' } } }, boss);
  await req('POST', '/devices', { subscription: { endpoint: 'https://push.example/anya', keys: { p256dh: 'p', auth: 'a' } } }, user);
  const id = (await req<{ id: string }>('POST', '/feedback', { kind: 'problem', text: 'Будильник без звука', image: 'aGVsbG8=' }, user)).data.id;
  assert.deepEqual(pushed.map((x) => x.endpoint), ['https://push.example/boss']);
  assert.match(pushed[0].payload.title, new RegExp(`проблема №${id}`));
  assert.equal(pushed[0].payload.data.inbox, '1');

  // не владельцу — нельзя
  assert.equal((await req('GET', '/admin/feedback', undefined, user)).status, 403);
  assert.equal((await req('PATCH', `/admin/feedback/${id}`, { status: 'done' }, user)).status, 403);
  assert.equal((await req('GET', '/auth/me', undefined, user)).data.admin, undefined);
  assert.equal((await req('GET', '/auth/me', undefined, boss)).data.admin, true);

  type Inbox = { items: { id: string; text: string; name: string; hasImage: boolean; status: string; note: string; reply: string }[]; counts: Record<string, number> };
  let inbox = await req<Inbox>('GET', '/admin/feedback', undefined, boss);
  const it = inbox.data.items.find((x) => x.id === id)!;
  assert.equal(it.text, 'Будильник без звука');
  assert.equal(it.name, 'Аня');
  assert.equal(it.hasImage, true);
  assert.equal((await req<{ image: string }>('GET', `/admin/feedback/${id}/image`, undefined, boss)).data.image, 'aGVsbG8=');

  assert.equal((await req('PATCH', `/admin/feedback/${id}`, { status: 'nope' }, boss)).status, 400);
  assert.equal((await req('PATCH', `/admin/feedback/${id}`, { status: 'planned', note: 'iOS PWA: звук пуша не задать' }, boss)).status, 200);
  inbox = await req<Inbox>('GET', '/admin/feedback', undefined, boss);
  assert.equal(inbox.data.items.find((x) => x.id === id)!.note, 'iOS PWA: звук пуша не задать');

  const before = mails.length;
  const r = await req<{ mailed: boolean }>('POST', `/admin/feedback/${id}/reply`, { text: 'Спасибо! Сделаем звук в приложении.' }, boss);
  assert.equal(r.data.mailed, true);
  const m = mails[before] as { to: string; subject: string; text: string; replyTo?: string };
  assert.equal(m.to, 'anya@b.cd');
  assert.equal(m.replyTo, 'owner@b.cd');
  assert.match(m.text, /Будильник без звука/);

  // пользователь видит ответ у себя, заметку — нет
  const mine = await req<{ items: { id: string; status: string; reply?: string; note?: string }[] }>('GET', '/feedback', undefined, user);
  const own = mine.data.items.find((x) => x.id === id)!;
  assert.equal(own.status, 'answered');
  assert.equal(own.reply, 'Спасибо! Сделаем звук в приложении.');
  assert.equal(own.note, undefined);

  // «Решено» с письмом пользователю — один раз, повторный выбор статуса письмо не дублирует
  let mailsBefore = mails.length;
  assert.equal((await req<{ mailed: boolean }>('PATCH', `/admin/feedback/${id}`, { status: 'done', notify: true }, boss)).data.mailed, true);
  assert.equal(mails.length, mailsBefore + 1);
  assert.equal(mails[mailsBefore].to, 'anya@b.cd');
  assert.match(mails[mailsBefore].subject, /исправлено/);
  mailsBefore = mails.length;
  assert.equal((await req<{ mailed: boolean }>('PATCH', `/admin/feedback/${id}`, { status: 'done', notify: true }, boss)).data.mailed, false);
  assert.equal(mails.length, mailsBefore);

  // решённые уходят из открытых, но видны во «всех»
  assert.equal((await req<Inbox>('GET', '/admin/feedback', undefined, boss)).data.items.some((x) => x.id === id), false);
  assert.equal((await req<Inbox>('GET', '/admin/feedback?status=all', undefined, boss)).data.items.some((x) => x.id === id), true);
  assert.equal((await req('PATCH', '/admin/feedback/999999', { status: 'done' }, boss)).status, 404);
});

test('голосовая команда: модель на сервере, лимит в день, без ключа — 503', async () => {
  const prompts: string[] = [];
  const aiApp = createApp({
    sql,
    mail: null,
    aiDailyLimit: 2,
    ai: async (system, user) => {
      prompts.push(system);
      return '```json\n{"actions":[{"type":"add_task","title":"' + user + '","repeat":{"freq":"daily","interval":1}}]}\n```';
    },
  });
  const req = (path: string, b: unknown, token?: string) =>
    aiApp.fetch(new Request('http://x' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(b) }));
  const reg = await call<{ token: string }>('POST', '/auth/register', { email: 'voice@b.cd', password: '12345678' });
  const t = reg.data.token;
  assert.equal((await req('/ai/command', { text: 'пить воду' })).status, 401);
  const r = await req('/ai/command', { text: 'Пить воду', today: '2026-10-08', nowMin: 600, categories: [{ name: 'Одежда', kind: 'expense' }] }, t);
  assert.equal(r.status, 200);
  const d = (await r.json()) as { actions: { type: string; title: string }[] };
  assert.equal(d.actions[0].title, 'Пить воду');
  assert.match(prompts[0], /2026-10-08 \(четверг\), сейчас 10:00/);
  assert.match(prompts[0], /Одежда/);
  assert.equal((await req('/ai/command', { text: 'ещё раз' }, t)).status, 200);
  assert.equal((await req('/ai/command', { text: 'и ещё' }, t)).status, 429);
  // без ключа модели
  assert.equal((await call('POST', '/ai/command', { text: 'тест' }, t)).status, 503);
});

test('напоминания: старые неотправленные (старше 6 часов) не мешают отправить наступившие', async () => {
  const owner = await call<{ token: string }>('POST', '/auth/register', { email: 'cron@b.cd', password: '12345678' });
  const dev = await call<{ deviceId: string }>('POST', '/devices', { subscription: { endpoint: 'https://push.example/cron', keys: { p256dh: 'p', auth: 'a' } } }, owner.data.token);
  const id = dev.data.deviceId;
  // 300+ «зависших» напоминаний (сервер не работал полдня) — раньше они занимали всю выборку
  await sql.query(
    `INSERT INTO push_queue (device_id, item_id, fire_at, payload)
     SELECT $1::uuid, 'old' || g, now() - interval '7 hours' - make_interval(secs => g), '{"title":"x"}'::jsonb FROM generate_series(1, 310) g`,
    [id],
  );
  await sql.query(`INSERT INTO push_queue (device_id, item_id, fire_at, payload) VALUES ($1::uuid, 'fresh', now() - interval '1 minute', '{"title":"y"}'::jsonb)`, [id]);
  const r = await app.fetch(
    new Request('http://x/cron', { method: 'POST', headers: { 'x-neon-trigger-invocation-id': 'inv1' }, body: JSON.stringify({ invocation_id: 'inv1' }) }),
  );
  const d = (await r.json()) as { due: number; sent: number };
  assert.equal(d.due, 1);
  assert.equal(d.sent, 1);
});

test('синхронизация: слишком большой объект — пачка не записывается частично; неверные данные входа — не 500', async () => {
  const reg = await call<{ token: string }>('POST', '/auth/register', { email: 'big@b.cd', password: '12345678' });
  const t = reg.data.token;
  const huge = 'x'.repeat(8 * 1024 * 1024 + 10);
  const r = await call('POST', '/sync', { items: [{ key: 'small', value: 1, updatedAt: 1, baseSeq: 0 }, { key: 'huge', value: huge, updatedAt: 1, baseSeq: 0 }] }, t);
  assert.equal(r.status, 413);
  const pulled = await call<{ items: unknown[] }>('GET', '/sync?since=0', undefined, t);
  assert.equal(pulled.data.items.length, 0);
  assert.equal((await call('POST', '/auth/login', { email: 'big@b.cd', password: 12345678 })).status, 401);
  assert.equal((await call('POST', '/auth/register', { email: ['x'], password: {} })).status, 400);
  assert.equal((await call('POST', '/auth/password', { oldPassword: '12345678', newPassword: 123456789 }, t)).status, 400);
});

test('бесплатный ИИ: текстовый ответ без своего ключа, проверка запроса', async () => {
  const seen: unknown[] = [];
  const aiApp = createApp({
    sql,
    mail: null,
    ai: async (system, user, opts) => {
      seen.push({ system, user, opts });
      return 'Привет! Вот план.';
    },
  });
  const req = (b: unknown, token?: string) =>
    aiApp.fetch(new Request('http://x/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(b) }));
  const reg = await call<{ token: string }>('POST', '/auth/register', { email: 'chat@b.cd', password: '12345678' });
  const t = reg.data.token;
  assert.equal((await req({ system: 's', messages: [{ role: 'user', content: 'hi' }] })).status, 401);
  assert.equal((await req({ system: 's', messages: [] }, t)).status, 400);
  const r = await req({ system: 'Ты помощник', messages: [{ role: 'user', content: 'план' }, { role: 'assistant', content: 'ок' }, { role: 'user', content: 'ещё' }] }, t);
  assert.equal(r.status, 200);
  assert.equal(((await r.json()) as { text: string }).text, 'Привет! Вот план.');
  const last = seen[seen.length - 1] as { system: string; user: { role: string }[]; opts: { json?: boolean } };
  assert.equal(last.system, 'Ты помощник');
  assert.deepEqual(last.user.map((m) => m.role), ['user', 'assistant', 'user']);
  assert.ok(!last.opts?.json);
});

test('восстановление пароля: параллельный перебор кода не превышает 5 попыток', async () => {
  await call('POST', '/auth/register', { email: 'brute@b.cd', password: 'oldpass11' });
  const before = mails.length;
  await call('POST', '/auth/forgot', { email: 'brute@b.cd' });
  const code = /(\d{6})/.exec(mails[before].text)![1];
  const wrong = (n: number) => String((Number(code) + 1 + n) % 1_000_000).padStart(6, '0');
  const rs = await Promise.all(Array.from({ length: 60 }, (_, i) => call('POST', '/auth/reset', { email: 'brute@b.cd', code: wrong(i), password: 'newpass22' })));
  assert.equal(rs.filter((r) => r.status === 400).length, 5);
  assert.equal(rs.filter((r) => r.status === 429).length, 55);
  // попытки исчерпаны — даже верный код не проходит
  assert.equal((await call('POST', '/auth/reset', { email: 'brute@b.cd', code, password: 'newpass22' })).status, 429);
  const rows = await sql.query(`SELECT attempts FROM password_resets WHERE email = 'brute@b.cd' AND code_hash <> ''`);
  assert.equal(Number(rows[0][0]), 5);
});

test('вход: параллельный перебор пароля не превышает 10 попыток за 15 минут', async () => {
  await call('POST', '/auth/register', { email: 'lock@b.cd', password: 'rightpass1' });
  const rs = await Promise.all(Array.from({ length: 40 }, (_, i) => call('POST', '/auth/login', { email: 'lock@b.cd', password: 'wrong' + i })));
  const failed = rs.filter((r) => r.status === 401).length;
  assert.ok(failed <= 10);
  assert.equal(failed + rs.filter((r) => r.status === 429).length, 40);
  // отклонённые попытки не записываются — блокировку не продлевают
  const rows = await sql.query(`SELECT count(*) FROM auth_failures WHERE email = 'lock@b.cd'`);
  assert.equal(Number(rows[0][0]), failed);
  // добираем до 10 неудачных — дальше не проходит даже верный пароль
  for (let i = failed; i < 10; i++) assert.equal((await call('POST', '/auth/login', { email: 'lock@b.cd', password: 'wrong' })).status, 401);
  assert.equal((await call('POST', '/auth/login', { email: 'lock@b.cd', password: 'wrong' })).status, 429);
  assert.equal((await call('POST', '/auth/login', { email: 'lock@b.cd', password: 'rightpass1' })).status, 429);
  // через 15 минут верный пароль проходит и сбрасывает счётчик
  await sql.query(`UPDATE auth_failures SET at = now() - interval '16 minutes' WHERE email = 'lock@b.cd'`);
  assert.equal((await call('POST', '/auth/login', { email: 'lock@b.cd', password: 'rightpass1' })).status, 200);
  const left = await sql.query(`SELECT count(*) FROM auth_failures WHERE email = 'lock@b.cd'`);
  assert.equal(Number(left[0][0]), 0);
});

test('отметка ближайшего напоминания: расписание её только понижает; свежей, старой или незаписанной проверка не верит', async () => {
  // старый формат (без времени записи) читается
  assert.deepEqual(parseNextDue('1700000000000'), { next: 1700000000000, at: undefined });
  assert.deepEqual(parseNextDue('none'), { next: null, at: undefined });
  assert.deepEqual(parseNextDue('none 1700000000000'), { next: null, at: 1700000000000 });
  assert.equal(parseNextDue('x'), undefined);

  let mark: NextDueMark | undefined;
  let fail = false;
  const store: NextDueStore = {
    get: async () => mark,
    set: async (v, at) => {
      if (fail) return false;
      mark = v === undefined ? undefined : { next: v, at };
      return true;
    },
  };
  const sent: string[] = [];
  const nApp = createApp({ sql, mail: null, nextDue: store, push: async (sub) => (sent.push(sub.endpoint), { status: 201, gone: false }), pushHostOk: () => true });
  const fetchJson = async <T>(path: string, init: RequestInit) => (await (await nApp.fetch(new Request('http://x' + path, init))).json()) as T;
  const owner = await call<{ token: string }>('POST', '/auth/register', { email: 'mark@b.cd', password: '12345678' });
  const dev = await fetchJson<{ deviceId: string; secret: string }>('/devices', {
    method: 'POST',
    headers: { Authorization: `Bearer ${owner.data.token}` },
    body: JSON.stringify({ subscription: { endpoint: 'https://push.example/mark', keys: { p256dh: 'p', auth: 'a' } } }),
  });
  const schedule = (items: { id: string; at: number; title: string }[]) =>
    fetchJson(`/devices/${dev.deviceId}/schedule`, { method: 'PUT', body: JSON.stringify({ secret: dev.secret, items }) });
  const cron = () =>
    fetchJson<{ skipped?: boolean; due?: number }>('/cron', { method: 'POST', headers: { 'x-neon-trigger-invocation-id': 'm' }, body: JSON.stringify({ invocation_id: 'm' }) });
  const t = Date.now();

  // отметка раньше нового расписания — не поднимается
  mark = { next: t + 10 * 60_000, at: t - 10 * 60_000 };
  await schedule([{ id: 'a', at: t + 60 * 60_000, title: 'A' }]);
  assert.equal(mark?.next, t + 10 * 60_000);
  // более раннее напоминание — понижает
  await schedule([{ id: 'b', at: t + 5 * 60_000, title: 'B' }]);
  assert.equal(mark?.next, t + 5 * 60_000);

  // гонка: параллельный запрос только что затёр отметку на «нет» — свежей отметке не верим, идём в базу
  await sql.query(`UPDATE push_queue SET fire_at = now() - interval '1 minute' WHERE device_id = $1 AND sent_at IS NULL`, [dev.deviceId]);
  mark = { next: null, at: Date.now() };
  const r = await cron();
  assert.equal(r.due, 1);
  assert.deepEqual(sent, ['https://push.example/mark']);
  // отстоявшейся — верим, база не нужна
  mark = { next: null, at: Date.now() - 5 * 60_000 };
  assert.equal((await cron()).skipped, true);
  // слишком старой и записанной старым кодом (без времени) — не верим
  mark = { next: null, at: Date.now() - 4 * 3600_000 };
  assert.ok(!(await cron()).skipped);
  mark = { next: null };
  assert.ok(!(await cron()).skipped);
  assert.equal(typeof mark?.at, 'number');

  // запись не удалась — пока не запишется, проверка идёт в базу, даже если в хранилище «отстоявшаяся» отметка
  fail = true;
  await schedule([{ id: 'c', at: t + 30 * 60_000, title: 'C' }]);
  mark = { next: null, at: Date.now() - 5 * 60_000 };
  assert.ok(!(await cron()).skipped);
  fail = false;
  assert.ok(!(await cron()).skipped);
  assert.equal(mark?.next, t + 30 * 60_000);
  mark = { next: mark!.next, at: Date.now() - 5 * 60_000 };
  assert.equal((await cron()).skipped, true);
});

test('устройства: только с входом, только push-сервисы, не больше 10; тест не отдаёт код ответа', async () => {
  const strict = createApp({ sql, mail: null, push: async () => ({ status: 403, gone: false }) });
  const reqS = async (path: string, b: unknown, token?: string) => {
    const r = await strict.fetch(new Request('http://x' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(b) }));
    return { status: r.status, data: (await r.json()) as Record<string, unknown> };
  };
  const sub = (endpoint: string) => ({ subscription: { endpoint, keys: { p256dh: 'p', auth: 'a' } } });
  assert.equal((await reqS('/devices', sub('https://fcm.googleapis.com/fcm/send/x1'))).status, 401, 'без входа — нельзя');
  const u = await call<{ token: string }>('POST', '/auth/register', { email: 'dev@b.cd', password: '12345678' });
  const t = u.data.token;
  for (const bad of ['https://169.254.169.254/x', 'https://evil.example/push', 'https://fcm.googleapis.com.evil.io/x', 'https://[::ffff:7f00:1]/x'])
    assert.equal((await reqS('/devices', sub(bad), t)).status, 400, bad);
  assert.equal((await reqS('/devices', { subscription: { endpoint: 'https://fcm.googleapis.com/' + 'x'.repeat(2000), keys: { p256dh: 'p', auth: 'a' } } }, t)).status, 400);
  const ok = await reqS('/devices', sub('https://fcm.googleapis.com/fcm/send/abc'), t);
  assert.equal(ok.status, 200);
  assert.equal((await reqS('/devices', sub('https://web.push.apple.com/QWE'), t)).status, 200);
  const test = await reqS(`/devices/${ok.data.deviceId}/test`, { secret: ok.data.secret }, t);
  assert.deepEqual(test.data, { ok: false }, 'код ответа сервиса наружу не уходит');
  for (let i = 0; i < 12; i++) await reqS('/devices', sub('https://fcm.googleapis.com/fcm/send/n' + i), t);
  const n = await sql.query(`SELECT count(*) FROM devices d JOIN users u ON u.id = d.user_id WHERE u.email = 'dev@b.cd'`);
  assert.equal(Number(n[0][0]), 10);
});

test('лимиты: место в облаке, ручные копии, обращения, общий ИИ', async () => {
  const small = createApp({ sql, mail: null, quotaBytes: 2000 });
  const r = async (method: string, path: string, b: unknown, token: string) => {
    const x = await small.fetch(new Request('http://x' + path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: b === undefined ? undefined : JSON.stringify(b) }));
    return { status: x.status, data: (await x.json()) as Record<string, unknown> };
  };
  const u = await call<{ token: string }>('POST', '/auth/register', { email: 'quota@b.cd', password: '12345678' });
  const t = u.data.token;
  const okPush = await r('POST', '/sync', { items: [{ key: 'notes', value: { t: 'x'.repeat(1200) }, updatedAt: 1, baseSeq: 0 }] }, t);
  assert.equal(okPush.status, 200);
  const seq = (okPush.data.results as { seq: number }[])[0].seq;
  // замена того же ключа — считается вместо старого значения
  assert.equal((await r('POST', '/sync', { items: [{ key: 'notes', value: { t: 'y'.repeat(1500) }, updatedAt: 2, baseSeq: seq }] }, t)).status, 200);
  assert.equal((await r('POST', '/sync', { items: [{ key: 'tasks', value: { t: 'z'.repeat(1500) }, updatedAt: 3, baseSeq: 0 }] }, t)).status, 413, 'сверх квоты');
  for (let i = 0; i < 5; i++) assert.equal((await r('POST', '/snapshots', {}, t)).status, 200);
  assert.equal((await r('POST', '/snapshots', {}, t)).status, 429, 'шестая ручная копия за сутки');
  for (let i = 0; i < 5; i++) assert.equal((await r('POST', '/feedback', { kind: 'idea', text: 'Идея номер ' + i }, t)).status, 201);
  assert.equal((await r('POST', '/feedback', { kind: 'idea', text: 'Ещё одна идея' }, t)).status, 429);

  const aiApp = createApp({ sql, mail: null, ai: async () => '[]', aiGlobalLimit: 2, aiDailyLimit: 100 });
  const ask = async (token: string) =>
    (await aiApp.fetch(new Request('http://x/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ messages: [{ role: 'user', content: 'привет' }] }) }))).status;
  await sql.query(`DELETE FROM ai_usage`);
  assert.equal(await ask(t), 200);
  assert.equal(await ask(t), 200);
  assert.equal(await ask(t), 429, 'общий дневной лимит');
});

test('вход и регистрация: ограничение по IP; восстановление — не больше 5 кодов в сутки, без имени в письме', async () => {
  const ipReq = (path: string, b: unknown, ip: string) =>
    app.fetch(new Request('http://x' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.9, ' + ip }, body: JSON.stringify(b) }));
  let last = 0;
  for (let i = 0; i < 42; i++) last = (await ipReq('/auth/login', { email: `spray${i}@b.cd`, password: 'wrongpass' }, '203.0.113.7')).status;
  assert.equal(last, 429, 'перебор по многим адресам с одного IP');
  assert.equal((await ipReq('/auth/login', { email: 'spray@b.cd', password: 'wrongpass' }, '203.0.113.8')).status, 401, 'другой IP — как обычно');

  await call('POST', '/auth/register', { name: 'Забери приз на evil.example', email: 'victim@b.cd', password: '12345678' });
  mails.length = 0;
  await call('POST', '/auth/forgot', { email: 'victim@b.cd' });
  assert.equal(mails.length, 1);
  assert.doesNotMatch(mails[0].text, /evil/, 'имя из регистрации в письмо не попадает');
  await sql.query(`UPDATE password_resets SET created_at = now() - interval '1 hour' WHERE email = 'victim@b.cd'`);
  await call('POST', '/auth/forgot', { email: 'victim@b.cd' });
  await call('POST', '/auth/forgot', { email: 'victim@b.cd' });
  await sql.query(`UPDATE password_resets SET created_at = now() - interval '2 hours' WHERE email = 'victim@b.cd'`);
  await call('POST', '/auth/forgot', { email: 'victim@b.cd' });
  await call('POST', '/auth/forgot', { email: 'victim@b.cd' });
  await sql.query(`UPDATE password_resets SET created_at = now() - interval '3 hours' WHERE email = 'victim@b.cd'`);
  assert.equal((await call('POST', '/auth/forgot', { email: 'victim@b.cd' })).status, 429, 'шестой код за сутки');
});
