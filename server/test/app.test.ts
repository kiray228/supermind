/** Аккаунт, синхронизация и облачные копии — на Postgres в памяти */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.ts';
import { PgliteSql } from './pglite.ts';

const sql = new PgliteSql();
const mails: { to: string; subject: string; text: string }[] = [];
const app = createApp({ mail: async (m) => void mails.push(m), supportEmail: 'owner@b.cd', sql, push: async () => ({ status: 201, gone: false }) });

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
  let list = await call<{ snapshots: unknown[] }>('GET', '/snapshots', undefined, t);
  assert.equal(list.data.snapshots.length, 0);

  // «плохое» изменение: перед ним сервер сам сохраняет копию
  r = await call('POST', '/sync', { items: [{ key: 'tasks', value: { tasks: [] }, updatedAt: 2, baseSeq: seq }] }, t);
  list = await call<{ snapshots: { id: string; keys: number; reason: string }[] }>('GET', '/snapshots', undefined, t);
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
