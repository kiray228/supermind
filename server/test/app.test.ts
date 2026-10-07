/** Аккаунт, синхронизация и облачные копии — на Postgres в памяти */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.ts';
import { PgliteSql } from './pglite.ts';

const sql = new PgliteSql();
const app = createApp({ sql, push: async () => ({ status: 201, gone: false }) });

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
