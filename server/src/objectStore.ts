/**
 * Маленький объект в Neon Object Storage (S3): время ближайшего неотправленного напоминания.
 * Ежеминутная проверка читает его вместо базы — база спит, пока не пора отправлять (бесплатный лимит Neon).
 * Подпись запросов — AWS Signature V4, без SDK.
 */
import { createHash, createHmac } from 'node:crypto';

const BUCKET = 'supermind';
const KEY = 'push/next-due';

const sha256 = (d: string) => createHash('sha256').update(d).digest('hex');
const hmac = (k: Buffer | string, d: string) => createHmac('sha256', k).update(d).digest();

export interface NextDueMark {
  /** число (мс) — ближайшее напоминание; null — напоминаний нет */
  next: number | null;
  /** когда записано (мс); нет — старая запись без времени */
  at?: number;
}

export interface NextDueStore {
  /** undefined — неизвестно (идём в базу) */
  get(): Promise<NextDueMark | undefined>;
  /** undefined — удалить отметку; false — записать не удалось */
  set(value: number | null | undefined, at: number): Promise<boolean>;
}

/** «<мс|none> <время записи>»; старый формат — без времени записи */
export function parseNextDue(text: string): NextDueMark | undefined {
  const [v, w] = text.trim().split(/\s+/);
  const at = w === undefined ? undefined : Number(w);
  if (at !== undefined && !(Number.isFinite(at) && at > 0)) return undefined;
  if (v === 'none') return { next: null, at };
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? { next: n, at } : undefined;
}

async function s3(method: 'GET' | 'PUT' | 'DELETE', body = ''): Promise<Response> {
  const endpoint = process.env.AWS_ENDPOINT_URL_S3!;
  const region = process.env.AWS_REGION || 'us-east-1';
  const url = new URL(`${endpoint.replace(/\/+$/, '')}/${BUCKET}/${KEY}`);
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256(body);
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonical = [
    method,
    url.pathname.split('/').map(encodeURIComponent).join('/'),
    '',
    `host:${url.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${process.env.AWS_SECRET_ACCESS_KEY}`, day), region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  return fetch(url, {
    method,
    headers: {
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      Authorization: `AWS4-HMAC-SHA256 Credential=${process.env.AWS_ACCESS_KEY_ID}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      ...(method === 'PUT' ? { 'Content-Type': 'text/plain' } : {}),
    },
    body: method === 'PUT' ? body : undefined,
    signal: AbortSignal.timeout(5000),
  });
}

/** Хранилище из переменных окружения Neon Functions; без них — null (всегда проверяем базу) */
export function s3NextDueStore(): NextDueStore | null {
  if (!process.env.AWS_ENDPOINT_URL_S3 || !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) return null;
  return {
    async get() {
      try {
        const r = await s3('GET');
        if (!r.ok) return undefined;
        return parseNextDue(await r.text());
      } catch {
        return undefined;
      }
    },
    async set(value, at) {
      const del = () => s3('DELETE').then((r) => r.ok, () => false);
      if (value === undefined) return del();
      const r = await s3('PUT', `${value === null ? 'none' : Math.round(value)} ${Math.round(at)}`).catch(() => null);
      if (r?.ok) return true;
      // не записалось — удаляем, чтобы проверка шла в базу (лучше разбудить базу, чем пропустить напоминание)
      await del();
      return false;
    },
  };
}
