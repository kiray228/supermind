/** Страница по ссылке: защита от запросов во внутреннюю сеть (SSRF), перенаправления, лимиты, сам запрос */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkUrl, fetchPublicPage, isPublicIp, WebError } from '../src/web.ts';
import { createApp } from '../src/app.ts';
import { PgliteSql } from './pglite.ts';

const dns = (map: Record<string, string[]>) => async (h: string) => map[h] ?? [];
const status = async (p: Promise<unknown>) => {
  try {
    await p;
    return 0;
  } catch (e) {
    return e instanceof WebError ? e.status : -1;
  }
};

test('публичные и внутренние адреса', () => {
  for (const ip of ['8.8.8.8', '93.184.216.34', '2a00:1450:4001:80b::200e', '172.15.0.1', '172.32.0.1']) assert.ok(isPublicIp(ip), ip);
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.1.1', '172.16.0.1', '172.31.255.255', '169.254.169.254', '0.0.0.0', '100.64.0.1', '224.0.0.1', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', 'not-ip'])
    assert.ok(!isPublicIp(ip), ip);
});

test('ссылка: протокол, порт, логин, localhost, DNS во внутреннюю сеть', async () => {
  const r = dns({ 'example.com': ['93.184.216.34'], 'evil.test': ['127.0.0.1'], 'mixed.test': ['93.184.216.34', '10.0.0.5'] });
  assert.equal((await checkUrl('https://example.com/a?b=1', r)).hostname, 'example.com');
  assert.equal(await status(checkUrl('ftp://example.com', r)), 400);
  assert.equal(await status(checkUrl('file:///etc/passwd', r)), 400);
  assert.equal(await status(checkUrl('http://example.com:8080/', r)), 400);
  assert.equal(await status(checkUrl('http://user:pw@example.com/', r)), 400);
  assert.equal(await status(checkUrl('http://localhost/', r)), 400);
  assert.equal(await status(checkUrl('http://127.0.0.1/', r)), 400);
  assert.equal(await status(checkUrl('http://[::1]/', r)), 400);
  assert.equal(await status(checkUrl('http://169.254.169.254/latest/meta-data', r)), 400);
  assert.equal(await status(checkUrl('http://evil.test/', r)), 400);
  assert.equal(await status(checkUrl('http://mixed.test/', r)), 400, 'хотя бы один внутренний адрес — нельзя');
  assert.equal(await status(checkUrl('http://nowhere.test/', r)), 400);
  assert.equal(await status(checkUrl('не ссылка', r)), 400);
});

test('перенаправление во внутреннюю сеть — запрещено; обычное — по цепочке', async () => {
  const r = dns({ 'a.test': ['93.184.216.34'], 'b.test': ['93.184.216.35'], 'in.test': ['192.168.0.10'] });
  const pages: Record<string, Response | (() => Response)> = {
    'http://a.test/': () => new Response(null, { status: 301, headers: { location: 'http://b.test/page' } }),
    'http://b.test/page': () => new Response('<title>Ок</title>', { headers: { 'content-type': 'text/html; charset=utf-8' } }),
    'http://a.test/bad': () => new Response(null, { status: 302, headers: { location: 'http://in.test/admin' } }),
    'http://a.test/loop': () => new Response(null, { status: 302, headers: { location: '/loop' } }),
    'http://a.test/pdf': () => new Response('%PDF', { headers: { 'content-type': 'application/pdf' } }),
    'http://a.test/404': () => new Response('нет', { status: 404 }),
    'http://a.test/big': () => new Response('x'.repeat(4 * 1024 * 1024), { headers: { 'content-type': 'text/html' } }),
  };
  const fetchStub = (async (url: string) => (pages[url] as () => Response)()) as unknown as typeof fetch;
  const ok = await fetchPublicPage('http://a.test/', { fetch: fetchStub, resolve: r });
  assert.equal(ok.url, 'http://b.test/page');
  assert.equal(Buffer.from(ok.base64, 'base64').toString(), '<title>Ок</title>');
  assert.match(ok.contentType, /charset=utf-8/);
  assert.equal(await status(fetchPublicPage('http://a.test/bad', { fetch: fetchStub, resolve: r })), 400);
  assert.equal(await status(fetchPublicPage('http://a.test/loop', { fetch: fetchStub, resolve: r })), 502);
  assert.equal(await status(fetchPublicPage('http://a.test/pdf', { fetch: fetchStub, resolve: r })), 415);
  assert.equal(await status(fetchPublicPage('http://a.test/404', { fetch: fetchStub, resolve: r })), 502);
  const big = await fetchPublicPage('http://a.test/big', { fetch: fetchStub, resolve: r });
  assert.ok(Buffer.from(big.base64, 'base64').length <= 3 * 1024 * 1024, 'читается не больше 3 МБ');
});

test('POST /web/page: только со входом, ошибки — понятные, считается в дневной лимит', async () => {
  const sql = new PgliteSql();
  const asked: string[] = [];
  const app = createApp({
    sql,
    mail: null,
    aiDailyLimit: 2,
    fetchPage: async (url) => {
      asked.push(url);
      if (url.includes('bad')) throw new WebError(400, 'Адрес недоступен');
      return { url, contentType: 'text/html', base64: Buffer.from('<p>hi</p>').toString('base64') };
    },
  });
  const req = (b: unknown, token?: string) =>
    app.fetch(new Request('http://x/web/page', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(b) }));
  const reg = await app.fetch(new Request('http://x/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'web@b.cd', password: '12345678' }) }));
  const t = ((await reg.json()) as { token: string }).token;
  assert.equal((await req({ url: 'https://e.test/' })).status, 401);
  assert.equal((await req({}, t)).status, 400);
  const r = await req({ url: 'https://e.test/a' }, t);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { url: 'https://e.test/a', contentType: 'text/html', base64: Buffer.from('<p>hi</p>').toString('base64') });
  const bad = await req({ url: 'http://bad.test/' }, t);
  assert.equal(bad.status, 400);
  assert.equal(((await bad.json()) as { error: string }).error, 'Адрес недоступен');
  assert.equal((await req({ url: 'https://e.test/c' }, t)).status, 429);
  assert.deepEqual(asked, ['https://e.test/a', 'http://bad.test/']);
});
