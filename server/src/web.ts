/**
 * Страница по ссылке для «Сохранить статью» (веб-версия и программа для Windows не могут читать чужие сайты
 * из-за CORS). Только публичные адреса: никаких localhost, внутренних сетей и облачных метаданных (SSRF),
 * не больше 3 МБ и 10 секунд, не больше 4 перенаправлений.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

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
    const s = ip.toLowerCase();
    if (s === '::' || s === '::1') return false;
    // IPv4 внутри IPv6
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (mapped) return isPublicIp(mapped[1]);
    if (/^f[cd]/.test(s) || /^fe[89ab]/.test(s) || s.startsWith('ff') || s.startsWith('64:ff9b') || s.startsWith('2001:db8')) return false;
    return true;
  }
  return false;
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

/** Скачать страницу (с проверкой каждого перенаправления) */
export async function fetchPublicPage(raw: string, deps: { fetch?: typeof fetch; resolve?: (host: string) => Promise<string[]> } = {}): Promise<WebPage> {
  const f = deps.fetch ?? fetch;
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
