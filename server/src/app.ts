/**
 * API SuperMind: аккаунты, синхронизация данных между устройствами и push-напоминания.
 *
 *   POST /auth/register, /auth/login, /auth/logout, /auth/password · GET /auth/me · DELETE /account
 *   GET /sync?since=N · POST /sync
 *   GET /snapshots · GET /snapshots/:id · POST /snapshots — облачные копии данных (раз в сутки — сами)
 *   GET /push/key · POST /devices · PUT /devices/:id/schedule · POST /devices/:id/test · DELETE /devices/:id
 *   POST /cron — Neon Function Trigger раз в минуту: рассылает наступившие напоминания
 */
import { hashPassword, newToken, tokenHash, verifyPassword } from './crypto.ts';
import { ensureSchema, type Row, type Sql } from './sql.ts';
import { generateVapidKeys, sendPush, type PushResult, type PushSubscription, type VapidKeys } from './webpush.ts';
import type { NextDueStore } from './objectStore.ts';

export interface Deps {
  sql: Sql;
  /** Отправка push — подменяется в тестах. */
  push?: (sub: PushSubscription, payload: object, keys: VapidKeys) => Promise<PushResult>;
  now?: () => number;
  /** Время ближайшего напоминания вне базы: проверка раз в минуту не будит базу зря */
  nextDue?: NextDueStore | null;
}

const VAPID_SUBJECT = 'https://kiray228.github.io/2mind/';
const MAX_ITEM_BYTES = 8 * 1024 * 1024;
const MAX_SCHEDULE = 500;
const PULL_LIMIT = 300;
/** Сколько облачных копий хранить на пользователя */
const KEEP_SNAPSHOTS = 14;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS } });

async function body<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, 'Некорректный запрос');
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function createApp(deps: Deps) {
  const { sql } = deps;
  const now = deps.now ?? Date.now;
  const push = deps.push ?? ((sub, payload, keys) => sendPush(sub, payload, keys, VAPID_SUBJECT));
  const nextDue = deps.nextDue ?? null;

  /** Записать время ближайшего неотправленного напоминания */
  async function refreshNextDue() {
    if (!nextDue) return;
    try {
      const r = await sql.query(
        `SELECT (extract(epoch FROM min(fire_at)) * 1000)::bigint FROM push_queue WHERE sent_at IS NULL AND fire_at > now() - interval '6 hours'`,
      );
      await nextDue.set(r[0]?.[0] ? Number(r[0][0]) : null);
    } catch {
      await nextDue.set(undefined);
    }
  }

  let ready: Promise<void> | null = null;
  const init = () =>
    (ready ??= ensureSchema(sql).catch((e) => {
      ready = null;
      throw e;
    }));

  let vapid: VapidKeys | null = null;
  async function vapidKeys(): Promise<VapidKeys> {
    if (vapid) return vapid;
    const rows = await sql.query(`SELECT value FROM meta WHERE key = 'vapid'`);
    if (rows[0]?.[0]) return (vapid = JSON.parse(rows[0][0]) as VapidKeys);
    // первый запуск: создаём ключи; при гонке двух запросов побеждает первый записанный
    await sql.query(`INSERT INTO meta (key, value) VALUES ('vapid', $1::jsonb) ON CONFLICT DO NOTHING`, [
      JSON.stringify(generateVapidKeys()),
    ]);
    const again = await sql.query(`SELECT value FROM meta WHERE key = 'vapid'`);
    return (vapid = JSON.parse(again[0][0]!) as VapidKeys);
  }

  // ---------- Аккаунты ----------

  async function createSession(userId: string, request: Request) {
    const token = newToken();
    await sql.query(`INSERT INTO sessions (token_hash, user_id, agent) VALUES ($1, $2, $3)`, [
      tokenHash(token),
      userId,
      (request.headers.get('user-agent') ?? '').slice(0, 200),
    ]);
    return token;
  }

  async function userOf(request: Request): Promise<{ id: string; email: string; name: string }> {
    const auth = request.headers.get('authorization') ?? '';
    if (!auth.toLowerCase().startsWith('bearer ')) throw new HttpError(401, 'Войдите в аккаунт');
    const rows = await sql.query(
      `UPDATE sessions s SET last_used_at = now() FROM users u
       WHERE s.token_hash = $1 AND u.id = s.user_id RETURNING u.id, u.email, u.name`,
      [tokenHash(auth.slice(7).trim())],
    );
    if (!rows[0]) throw new HttpError(401, 'Сессия истекла — войдите снова');
    const [id, email, name] = rows[0] as string[];
    return { id, email, name };
  }

  async function register(request: Request) {
    const b = await body<{ email?: string; password?: string; name?: string }>(request);
    const email = (b.email ?? '').trim().toLowerCase();
    const password = b.password ?? '';
    const name = (b.name ?? '').trim().slice(0, 80);
    if (!EMAIL.test(email) || email.length > 200) throw new HttpError(400, 'Проверьте email');
    if (password.length < 8) throw new HttpError(400, 'Пароль — минимум 8 символов');
    if (password.length > 200) throw new HttpError(400, 'Слишком длинный пароль');
    let rows: Row[];
    try {
      rows = await sql.query(`INSERT INTO users (email, name, pass_hash) VALUES ($1, $2, $3) RETURNING id`, [
        email,
        name,
        await hashPassword(password),
      ]);
    } catch (e) {
      const err = e as { code?: string; message?: string };
      if (err.code === '23505' || /duplicate key/i.test(err.message ?? '')) throw new HttpError(409, 'Этот email уже зарегистрирован — войдите');
      throw e;
    }
    const id = rows[0][0]!;
    return json({ token: await createSession(id, request), user: { id, email, name } }, 201);
  }

  async function login(request: Request) {
    const b = await body<{ email?: string; password?: string }>(request);
    const email = (b.email ?? '').trim().toLowerCase();
    const fails = await sql.query(
      `SELECT count(*) FROM auth_failures WHERE email = $1 AND at > now() - interval '15 minutes'`,
      [email],
    );
    if (Number(fails[0]?.[0] ?? 0) >= 10) throw new HttpError(429, 'Слишком много попыток — подождите 15 минут');
    const rows = await sql.query(`SELECT id, name, pass_hash FROM users WHERE email = $1`, [email]);
    const user = rows[0] as string[] | undefined;
    if (!user || !(await verifyPassword(b.password ?? '', user[2]))) {
      await sql.query(`INSERT INTO auth_failures (email) VALUES ($1)`, [email]);
      throw new HttpError(401, 'Неверный email или пароль');
    }
    await sql.query(`DELETE FROM auth_failures WHERE email = $1`, [email]);
    return json({ token: await createSession(user[0], request), user: { id: user[0], email, name: user[1] } });
  }

  async function logout(request: Request) {
    const auth = request.headers.get('authorization') ?? '';
    if (auth.toLowerCase().startsWith('bearer '))
      await sql.query(`DELETE FROM sessions WHERE token_hash = $1`, [tokenHash(auth.slice(7).trim())]);
    return json({ ok: true });
  }

  async function changePassword(request: Request) {
    const user = await userOf(request);
    const b = await body<{ oldPassword?: string; newPassword?: string }>(request);
    const rows = await sql.query(`SELECT pass_hash FROM users WHERE id = $1`, [user.id]);
    if (!(await verifyPassword(b.oldPassword ?? '', rows[0][0]!))) throw new HttpError(401, 'Текущий пароль неверный');
    if ((b.newPassword ?? '').length < 8) throw new HttpError(400, 'Новый пароль — минимум 8 символов');
    await sql.query(`UPDATE users SET pass_hash = $2 WHERE id = $1`, [user.id, await hashPassword(b.newPassword!)]);
    // остальные устройства выйдут из аккаунта
    const token = tokenHash((request.headers.get('authorization') ?? '').slice(7).trim());
    await sql.query(`DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2`, [user.id, token]);
    return json({ ok: true });
  }

  async function deleteAccount(request: Request) {
    const user = await userOf(request);
    const b = await body<{ password?: string }>(request);
    const rows = await sql.query(`SELECT pass_hash FROM users WHERE id = $1`, [user.id]);
    if (!(await verifyPassword(b.password ?? '', rows[0][0]!))) throw new HttpError(401, 'Неверный пароль');
    await sql.query(`DELETE FROM users WHERE id = $1`, [user.id]);
    return json({ ok: true });
  }

  // ---------- Синхронизация ----------

  async function pull(request: Request, url: URL) {
    const user = await userOf(request);
    const since = Math.max(0, Number(url.searchParams.get('since') ?? 0) || 0);
    const rows = await sql.query(
      `SELECT key, value, updated_at, deleted, seq FROM kv WHERE user_id = $1 AND seq > $2 ORDER BY seq LIMIT $3`,
      [user.id, since, PULL_LIMIT + 1],
    );
    const more = rows.length > PULL_LIMIT;
    const items = rows.slice(0, PULL_LIMIT).map(([key, value, updatedAt, deleted, seq]) => ({
      key,
      value: value == null ? null : JSON.parse(value),
      updatedAt: Number(updatedAt),
      deleted: deleted === 't' || deleted === 'true',
      seq: Number(seq),
    }));
    const cursor = items.length ? items[items.length - 1].seq : since;
    return json({ items, cursor, more });
  }

  /**
   * Запись с оптимистической блокировкой: изменение принимается, только если клиент видел
   * последнюю версию ключа (baseSeq). Иначе — конфликт: клиент заберёт свежую версию, сольёт и повторит.
   */
  async function pushItems(request: Request) {
    const user = await userOf(request);
    const b = await body<{ items?: { key: string; value: unknown; updatedAt: number; deleted?: boolean; baseSeq?: number }[] }>(
      request,
    );
    // перед первым за сутки изменением уже сохранённого — копия того, что было (защита от ошибочной синхронизации);
    // новые ключи ничего не затирают — для них копия не нужна
    if ((b.items ?? []).some((i) => Number(i.baseSeq) > 0)) await autoSnapshot(user.id);
    const results: { key: string; ok: boolean; seq?: number }[] = [];
    for (const item of (b.items ?? []).slice(0, 200)) {
      if (typeof item.key !== 'string' || !item.key || item.key.length > 300) continue;
      const value = item.deleted ? null : JSON.stringify(item.value ?? null);
      if (value && value.length > MAX_ITEM_BYTES) throw new HttpError(413, `Слишком большой объект: ${item.key}`);
      const base = Math.max(0, Number(item.baseSeq) || 0);
      const rows = await sql.query(
        `INSERT INTO kv (user_id, key, value, updated_at, deleted, seq)
         VALUES ($1, $2, $3::jsonb, $4, $5, nextval('kv_seq'))
         ON CONFLICT (user_id, key) DO UPDATE
           SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at, deleted = EXCLUDED.deleted, seq = EXCLUDED.seq
           WHERE kv.seq = $6
         RETURNING seq`,
        [user.id, item.key, value, Math.round(Number(item.updatedAt) || now()), !!item.deleted, base],
      );
      results.push(rows[0] ? { key: item.key, ok: true, seq: Number(rows[0][0]) } : { key: item.key, ok: false });
    }
    return json({ results });
  }

  // ---------- Облачные копии ----------

  /** Копия всех данных пользователя целиком внутри базы (без передачи по сети) */
  async function snapshot(userId: string, reason: string) {
    const rows = await sql.query(
      `INSERT INTO snapshots (user_id, reason, keys, bytes, data)
       SELECT $1, $2, count(*), coalesce(sum(length(value::text)), 0), jsonb_object_agg(key, value)
       FROM kv WHERE user_id = $1 AND NOT deleted
       HAVING count(*) > 0
       RETURNING id`,
      [userId, reason],
    );
    await sql.query(
      `DELETE FROM snapshots WHERE user_id = $1 AND id NOT IN (
         SELECT id FROM snapshots WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2)`,
      [userId, KEEP_SNAPSHOTS],
    );
    return rows[0]?.[0] ?? null;
  }

  async function autoSnapshot(userId: string) {
    const rows = await sql.query(
      `SELECT 1 FROM snapshots WHERE user_id = $1 AND reason = 'auto' AND created_at > now() - interval '20 hours' LIMIT 1`,
      [userId],
    );
    if (!rows[0]) await snapshot(userId, 'auto');
  }

  async function listSnapshots(request: Request) {
    const user = await userOf(request);
    const rows = await sql.query(
      `SELECT id, (extract(epoch FROM created_at) * 1000)::bigint, reason, keys, bytes
       FROM snapshots WHERE user_id = $1 ORDER BY created_at DESC`,
      [user.id],
    );
    return json({
      snapshots: rows.map(([id, at, reason, keys, bytes]) => ({ id, at: Number(at), reason, keys: Number(keys), bytes: Number(bytes) })),
    });
  }

  async function getSnapshot(request: Request, id: string) {
    const user = await userOf(request);
    if (!/^\d+$/.test(id)) throw new HttpError(404, 'Копия не найдена');
    const rows = await sql.query(`SELECT data, (extract(epoch FROM created_at) * 1000)::bigint FROM snapshots WHERE id = $1 AND user_id = $2`, [
      id,
      user.id,
    ]);
    if (!rows[0]) throw new HttpError(404, 'Копия не найдена');
    return json({ id, at: Number(rows[0][1]), data: JSON.parse(rows[0][0]!) });
  }

  async function manualSnapshot(request: Request) {
    const user = await userOf(request);
    const id = await snapshot(user.id, 'manual');
    if (!id) throw new HttpError(400, 'В облаке пока нет данных — дождитесь синхронизации');
    return json({ id });
  }

  // ---------- Устройства и push ----------

  async function registerDevice(request: Request) {
    const b = await body<{ subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } }; platform?: string }>(
      request,
    );
    const s = b.subscription;
    if (!s?.endpoint?.startsWith('https://') || !s.keys?.p256dh || !s.keys.auth)
      throw new HttpError(400, 'Нет подписки на уведомления');
    let userId: string | null = null;
    if (request.headers.get('authorization')) userId = (await userOf(request)).id;
    const secret = newToken();
    const rows = await sql.query(
      `INSERT INTO devices (secret_hash, user_id, endpoint, p256dh, auth, platform)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (endpoint) DO UPDATE SET secret_hash = EXCLUDED.secret_hash, user_id = EXCLUDED.user_id,
         p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, platform = EXCLUDED.platform, last_seen = now()
       RETURNING id`,
      [tokenHash(secret), userId, s.endpoint, s.keys.p256dh, s.keys.auth, (b.platform ?? '').slice(0, 40)],
    );
    return json({ deviceId: rows[0][0], secret });
  }

  async function deviceOf(id: string, secret: string | undefined) {
    if (!/^[0-9a-f-]{36}$/i.test(id) || !secret) throw new HttpError(401, 'Устройство не найдено');
    const rows = await sql.query(
      `UPDATE devices SET last_seen = now() WHERE id = $1 AND secret_hash = $2 RETURNING id, endpoint, p256dh, auth`,
      [id, tokenHash(secret)],
    );
    if (!rows[0]) throw new HttpError(401, 'Устройство не найдено — включите уведомления заново');
    const [, endpoint, p256dh, auth] = rows[0] as string[];
    return { id, endpoint, p256dh, auth };
  }

  /** Полностью заменяет будущие напоминания устройства (клиент присылает расписание на 3 недели). */
  async function schedule(request: Request, id: string) {
    const b = await body<{ secret?: string; items?: { id: string; at: number; title: string; body?: string; data?: object }[] }>(
      request,
    );
    await deviceOf(id, b.secret);
    const t = now();
    const items = (b.items ?? [])
      .filter((i) => typeof i.id === 'string' && Number.isFinite(i.at) && i.at > t - 60_000)
      .slice(0, MAX_SCHEDULE);
    await sql.query(`DELETE FROM push_queue WHERE device_id = $1 AND sent_at IS NULL`, [id]);
    if (items.length) {
      // одна вставка: расписание передаём JSON-массивом
      await sql.query(
        `INSERT INTO push_queue (device_id, item_id, fire_at, payload)
         SELECT $1::uuid, x->>'i', to_timestamp((x->>'a')::float8 / 1000), x->'p'
         FROM jsonb_array_elements($2::jsonb) AS x
         ON CONFLICT (device_id, item_id) DO NOTHING`,
        [
          id,
          JSON.stringify(
            items.map((i) => ({
              // время входит в ключ: перенесённое напоминание — новое, уже отправленное не повторится
              i: `${i.id}@${Math.round(i.at)}`,
              a: i.at,
              p: { title: String(i.title).slice(0, 200), body: String(i.body ?? '').slice(0, 500), data: i.data ?? {} },
            })),
          ),
        ],
      );
    }
    await refreshNextDue();
    return json({ scheduled: items.length });
  }

  async function testPush(request: Request, id: string) {
    const b = await body<{ secret?: string }>(request);
    const device = await deviceOf(id, b.secret);
    const result = await push(
      device,
      { title: 'SuperMind', body: 'Уведомления работают — напоминания придут, даже когда приложение закрыто', data: {} },
      await vapidKeys(),
    );
    if (result.gone) await sql.query(`DELETE FROM devices WHERE id = $1`, [id]);
    return json({ ok: result.status < 300, status: result.status });
  }

  async function removeDevice(request: Request, id: string) {
    const b = await body<{ secret?: string }>(request);
    await deviceOf(id, b.secret);
    await sql.query(`DELETE FROM devices WHERE id = $1`, [id]);
    return json({ ok: true });
  }

  /** Раз в минуту: отправить наступившие напоминания (не старше 6 часов). */
  async function cron() {
    if (nextDue) {
      const next = await nextDue.get();
      // ничего не наступило — базу не трогаем
      if (next === null || (typeof next === 'number' && next > now() + 20_000)) {
        console.log(`cron: пропуск, ближайшее ${next === null ? 'нет' : new Date(next).toISOString()}`);
        return json({ skipped: true, next });
      }
      console.log(`cron: проверка базы (ближайшее ${next === undefined ? 'неизвестно' : new Date(next).toISOString()})`);
    }
    await init();
    const keys = await vapidKeys();
    const due = await sql.query(
      `UPDATE push_queue q SET sent_at = now()
       FROM devices d
       WHERE q.device_id = d.id AND q.sent_at IS NULL AND q.fire_at <= now() AND q.fire_at > now() - interval '6 hours'
         AND (q.device_id, q.item_id) IN (
           SELECT device_id, item_id FROM push_queue
           WHERE sent_at IS NULL AND fire_at <= now() ORDER BY fire_at LIMIT 300)
       RETURNING d.id, d.endpoint, d.p256dh, d.auth, q.payload`,
    );
    let sent = 0;
    const gone = new Set<string>();
    await Promise.all(
      due.map(async ([deviceId, endpoint, p256dh, auth, payload]) => {
        if (gone.has(deviceId!)) return;
        try {
          const r = await push({ endpoint: endpoint!, p256dh: p256dh!, auth: auth! }, JSON.parse(payload!), keys);
          if (r.gone) gone.add(deviceId!);
          else if (r.status < 300) sent++;
        } catch {
          /* сеть push-сервиса — напоминание пропускаем, следующие уйдут */
        }
      }),
    );
    for (const id of gone) await sql.query(`DELETE FROM devices WHERE id = $1`, [id]);
    // уборка: старые отправленные и просроченные
    await sql.query(`DELETE FROM push_queue WHERE fire_at < now() - interval '2 days'`);
    await sql.query(`DELETE FROM auth_failures WHERE at < now() - interval '1 day'`);
    await refreshNextDue();
    console.log(`cron: наступило ${due.length}, отправлено ${sent}`);
    return json({ due: due.length, sent, removedDevices: gone.size });
  }

  async function route(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const m = request.method;
    if (m === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (m === 'GET' && path === '/') return json({ ok: true, service: 'supermind' });

    // Function Trigger: прокси Neon удаляет клиентские x-neon-*, значит заголовок — от Neon.
    // До init(): обычно проверка не трогает базу вовсе
    if (m === 'POST' && path === '/cron') {
      const id = request.headers.get('x-neon-trigger-invocation-id');
      const b = await body<{ invocation_id?: string }>(request);
      if (!id || b.invocation_id !== id) throw new HttpError(401, 'Только для расписания');
      return cron();
    }
    await init();
    if (m === 'POST' && path === '/auth/register') return register(request);
    if (m === 'POST' && path === '/auth/login') return login(request);
    if (m === 'POST' && path === '/auth/logout') return logout(request);
    if (m === 'POST' && path === '/auth/password') return changePassword(request);
    if (m === 'GET' && path === '/auth/me') return json({ user: await userOf(request) });
    if (m === 'DELETE' && path === '/account') return deleteAccount(request);
    if (m === 'GET' && path === '/sync') return pull(request, url);
    if (m === 'POST' && path === '/sync') return pushItems(request);
    if (m === 'GET' && path === '/snapshots') return listSnapshots(request);
    if (m === 'POST' && path === '/snapshots') return manualSnapshot(request);
    const snap = /^\/snapshots\/([^/]+)$/.exec(path);
    if (snap && m === 'GET') return getSnapshot(request, snap[1]);
    if (m === 'GET' && path === '/push/key') return json({ publicKey: (await vapidKeys()).publicKey });
    if (m === 'POST' && path === '/devices') return registerDevice(request);
    const dev = /^\/devices\/([^/]+)(\/schedule|\/test)?$/.exec(path);
    if (dev) {
      if (m === 'PUT' && dev[2] === '/schedule') return schedule(request, dev[1]);
      if (m === 'POST' && dev[2] === '/test') return testPush(request, dev[1]);
      if (m === 'DELETE' && !dev[2]) return removeDevice(request, dev[1]);
    }
    throw new HttpError(404, 'Не найдено');
  }

  return {
    async fetch(request: Request): Promise<Response> {
      try {
        return await route(request);
      } catch (e) {
        if (e instanceof HttpError) return json({ error: e.message }, e.status);
        console.error(e);
        return json({ error: 'Ошибка сервера — попробуйте ещё раз' }, 500);
      }
    },
  };
}
