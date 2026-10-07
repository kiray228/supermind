/**
 * Локальный сервер SuperMind для разработки: тот же код API, база — PGlite в памяти, push — в журнал.
 *   node test/local-server.ts   →  http://127.0.0.1:8787
 */
import { createServer } from 'node:http';
import { createApp } from '../src/app.ts';
import { PgliteSql } from './pglite.ts';

const sent: { endpoint: string; payload: object }[] = [];
let next: number | null | undefined;
let dbCalls = 0;
const sql = new PgliteSql();
const counted = { query: (q: string, p?: unknown[]) => (dbCalls++, sql.query(q, p)) };
const app = createApp({
  sql: counted,
  // письма — в журнал (код восстановления виден в консоли сервера)
  mail: async (m) => void console.log('MAIL →', m.to, '|', m.subject),
  nextDue: { get: async () => next, set: async (v) => void (next = v) },
  push: async (sub, payload) => {
    sent.push({ endpoint: sub.endpoint, payload });
    console.log('PUSH →', JSON.stringify(payload));
    return { status: 201, gone: false };
  },
});

createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const request = new Request(`http://127.0.0.1:8787${req.url}`, {
    method: req.method,
    headers: req.headers as Record<string, string>,
    body: ['GET', 'HEAD'].includes(req.method ?? '') ? undefined : Buffer.concat(chunks),
  });
  // для проверки рассылки без расписания Neon
  if (req.url === '/__cron') {
    const r = await app.fetch(new Request('http://127.0.0.1:8787/cron', { method: 'POST', headers: { 'x-neon-trigger-invocation-id': 'local' }, body: JSON.stringify({ invocation_id: 'local' }) }));
    res.writeHead(r.status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ ...(await r.json()), sent: sent.length, dbCalls, next }));
    return;
  }
  const r = await app.fetch(request);
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(8787, '127.0.0.1', () => console.log('SuperMind API: http://127.0.0.1:8787'));
