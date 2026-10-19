/**
 * Страница по ссылке для «Сохранить статью» (веб-версия и программа для Windows не могут читать чужие сайты
 * из-за CORS). Только публичные адреса: никаких localhost, внутренних сетей и облачных метаданных (SSRF),
 * не больше 3 МБ и 10 секунд, не больше 4 перенаправлений.
 */
import { lookup } from 'node:dns/promises';
import { lookup as lookupCb, type LookupAddress } from 'node:dns';
import { isIP } from 'node:net';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';

export interface WebPage {
  url: string;
  contentType: string;
  /** содержимое страницы в base64 (кодировку разбирает приложение) */
  base64: string;
}

export type FetchPage = (url: string) => Promise<WebPage>;

export class WebError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const MAX_BYTES = 3 * 1024 * 1024;
const TIMEOUT = 10_000;
const MAX_REDIRECTS = 4;

/** Адрес из публичного интернета (не loopback, не частные сети, не link-local, не служебные диапазоны) */
export function isPublicIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
    if (a === 169 && b === 254) return false; // link-local, метаданные облака
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 168 || b === 0)) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    return true;
  }
  if (v === 6) {
    const w = v6Words(ip);
    if (!w) return false;
    const zero = (from: number, to: number) => w.slice(from, to).every((x) => x === 0);
    const v4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
    // :: и ::1
    if (zero(0, 7) && (w[7] === 0 || w[7] === 1)) return false;
    // IPv4 внутри IPv6 в любой записи: ::ffff:a.b.c.d, ::ffff:7f00:1 (так URL переписывает адрес), ::a.b.c.d, ::ffff:0:a.b.c.d
    if (zero(0, 5) && (w[5] === 0xffff || w[5] === 0)) return isPublicIp(v4(w[6], w[7]));
    if (zero(0, 4) && w[4] === 0xffff && w[5] === 0) return isPublicIp(v4(w[6], w[7]));
    // NAT64 (64:ff9b::/96 и 64:ff9b:1::/48), 6to4 (2002::/16 — IPv4 внутри), Teredo (2001::/32), документация
    if (w[0] === 0x64 && w[1] === 0xff9b) return false;
    if (w[0] === 0x2002) return isPublicIp(v4(w[1], w[2]));
    if (w[0] === 0x2001 && (w[1] === 0 || w[1] === 0xdb8)) return false;
    // уникальные локальные (fc00::/7), link-local (fe80::/10), site-local (fec0::/10), multicast (ff00::/8)
    if ((w[0] & 0xfe00) === 0xfc00 || (w[0] & 0xffc0) === 0xfe80 || (w[0] & 0xffc0) === 0xfec0 || (w[0] & 0xff00) === 0xff00) return false;
    return true;
  }
  return false;
}

/** IPv6 → 8 слов по 16 бит (с поддержкой «::» и IPv4 в конце); null — не разобрать */
function v6Words(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/%.*$/, '');
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (tail) {
    const p = tail[1].split('.').map(Number);
    if (p.some((x) => x > 255)) return null;
    s = s.slice(0, -tail[1].length) + ((p[0] << 8) | p[1]).toString(16) + ':' + ((p[2] << 8) | p[3]).toString(16);
  }
  const [a, b] = s.split('::');
  if (s.split('::').length > 2) return null;
  const head = a ? a.split(':') : [];
  const rest = b !== undefined ? (b ? b.split(':') : []) : null;
  const words = rest ? [...head, ...Array(8 - head.length - rest.length).fill('0'), ...rest] : head;
  if (words.length !== 8) return null;
  const out = words.map((x) => parseInt(x || '0', 16));
  return out.some((x) => !(x >= 0 && x <= 0xffff)) ? null : out;
}

/** Ссылку можно открыть: http(s), стандартный порт, хост — публичный */
export async function checkUrl(raw: string, resolve: (host: string) => Promise<string[]> = defaultResolve): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new WebError(400, 'Это не ссылка');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new WebError(400, 'Нужна ссылка http или https');
  if (u.username || u.password) throw new WebError(400, 'Ссылка с логином не поддерживается');
  if (u.port && u.port !== '80' && u.port !== '443') throw new WebError(400, 'Нестандартный порт не поддерживается');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) throw new WebError(400, 'Адрес недоступен');
  const ips = isIP(host) ? [host] : await resolve(host).catch(() => []);
  if (!ips.length) throw new WebError(400, 'Сайт не найден');
  if (!ips.every(isPublicIp)) throw new WebError(400, 'Адрес недоступен');
  return u;
}

async function defaultResolve(host: string): Promise<string[]> {
  return (await lookup(host, { all: true })).map((a) => a.address);
}

/**
 * Запрос с проверкой адреса в момент подключения: сайт с «нулевым» временем жизни DNS мог бы ответить проверке
 * публичным адресом, а самому запросу — внутренним (DNS rebinding). Здесь сокет открывается только к публичному адресу.
 */
const pinnedFetch = ((input: string, init?: RequestInit): Promise<Response> =>
  new Promise((resolve, reject) => {
    const u = new URL(input);
    const lookupSafe = (host: string, opts: unknown, cb: (err: Error | null, address: string | LookupAddress[], family?: number) => void) => {
      lookupCb(host, { all: true }, (err, addrs) => {
        if (err) return cb(err, '', 0);
        const list = addrs as LookupAddress[];
        if (!list.length || !list.every((a) => isPublicIp(a.address))) return cb(new Error('blocked address'), '', 0);
        const all = !!(opts && typeof opts === 'object' && (opts as { all?: boolean }).all);
        if (all) cb(null, list);
        else cb(null, list[0].address, list[0].family);
      });
    };
    const req = (u.protocol === 'https:' ? httpsRequest : httpRequest)(
      u,
      { method: 'GET', headers: (init?.headers ?? {}) as Record<string, string>, lookup: lookupSafe as never, signal: init?.signal ?? undefined },
      (res: IncomingMessage) => {
        const headers = new Headers();
        for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : String(v));
        const status = res.statusCode ?? 502;
        const nullBody = status === 204 || status === 304 || (status >= 300 && status < 400);
        if (nullBody) res.resume();
        resolve(new Response(nullBody ? null : (Readable.toWeb(res) as ReadableStream), { status, headers }));
      },
    );
    req.on('error', reject);
    req.end();
  })) as unknown as typeof fetch;

/** Скачать страницу (с проверкой каждого перенаправления) */
export async function fetchPublicPage(raw: string, deps: { fetch?: typeof fetch; resolve?: (host: string) => Promise<string[]> } = {}): Promise<WebPage> {
  const f = deps.fetch ?? pinnedFetch;
  let url = await checkUrl(raw, deps.resolve);
  const signal = AbortSignal.timeout(TIMEOUT);
  for (let hop = 0; ; hop++) {
    let r: Response;
    try {
      r = await f(url.href, {
        redirect: 'manual',
        signal,
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; SuperMind/1.0; +https://kiray228.github.io/supermind/)', accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5', 'accept-language': 'ru,en;q=0.8' },
      });
    } catch {
      throw new WebError(502, 'Сайт не ответил');
    }
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
      if (hop >= MAX_REDIRECTS) throw new WebError(502, 'Слишком много перенаправлений');
      url = await checkUrl(new URL(r.headers.get('location')!, url).href, deps.resolve);
      continue;
    }
    if (!r.ok) throw new WebError(502, `Сайт ответил ошибкой ${r.status}`);
    const type = r.headers.get('content-type') ?? '';
    if (type && !/text\/|xhtml|xml/i.test(type)) throw new WebError(415, 'По ссылке не страница, а файл');
    const len = Number(r.headers.get('content-length'));
    if (len > MAX_BYTES) throw new WebError(413, 'Страница слишком большая');
    // читаем не больше лимита
    const reader = r.body?.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (reader)
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > MAX_BYTES) {
          await reader.cancel().catch(() => undefined);
          break;
        }
        chunks.push(value);
      }
    return { url: url.href, contentType: type, base64: Buffer.concat(chunks).toString('base64') };
  }
}
