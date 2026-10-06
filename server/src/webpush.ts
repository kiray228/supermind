/**
 * Web Push без зависимостей: подпись VAPID (RFC 8292) и шифрование aes128gcm (RFC 8291).
 * Работает с Apple (Safari / iPhone с экрана «Домой»), Google (Chrome, Android) и Mozilla.
 */
import {
  createCipheriv,
  createECDH,
  createPrivateKey,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  sign,
  type JsonWebKey,
} from 'node:crypto';

export interface VapidKeys {
  /** Публичный ключ: несжатая точка P-256 (65 байт) в base64url — его получает браузер. */
  publicKey: string;
  privateJwk: JsonWebKey;
}

export interface PushSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export function generateVapidKeys(): VapidKeys {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  const publicKey = Buffer.concat([
    Buffer.from([4]),
    Buffer.from(jwk.x!, 'base64url'),
    Buffer.from(jwk.y!, 'base64url'),
  ]).toString('base64url');
  return { publicKey, privateJwk: jwk };
}

/** JWT ES256 для заголовка Authorization: vapid t=…, k=… */
export function vapidAuthorization(endpoint: string, keys: VapidKeys, subject: string, now = Date.now()): string {
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const header = enc({ typ: 'JWT', alg: 'ES256' });
  const payload = enc({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now / 1000) + 12 * 3600,
    sub: subject,
  });
  const data = `${header}.${payload}`;
  const key = createPrivateKey({ key: keys.privateJwk, format: 'jwk' });
  const signature = sign('sha256', Buffer.from(data), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return `vapid t=${data}.${signature}, k=${keys.publicKey}`;
}

/** Шифрует сообщение для подписки браузера (одна запись aes128gcm). */
export function encryptPayload(
  sub: Pick<PushSubscription, 'p256dh' | 'auth'>,
  plaintext: Buffer,
  // для тестов: фиксированные соль и ключ сервера
  fixed?: { salt: Buffer; ecdhPrivate: Buffer },
): Buffer {
  const uaPublic = Buffer.from(sub.p256dh, 'base64url');
  const authSecret = Buffer.from(sub.auth, 'base64url');
  const ecdh = createECDH('prime256v1');
  if (fixed) ecdh.setPrivateKey(fixed.ecdhPrivate);
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);

  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, authSecret, keyInfo, 32));
  const salt = fixed?.salt ?? randomBytes(16);
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));

  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  // 0x02 — разделитель последней записи
  const body = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);

  const header = Buffer.alloc(16 + 4 + 1);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, body]);
}

export interface PushResult {
  status: number;
  /** Подписка больше не действует (приложение удалено, разрешение отозвано) — её надо удалить. */
  gone: boolean;
}

export async function sendPush(
  sub: PushSubscription,
  payload: object,
  keys: VapidKeys,
  subject: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PushResult> {
  const body = encryptPayload(sub, Buffer.from(JSON.stringify(payload)));
  const res = await fetchImpl(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: vapidAuthorization(sub.endpoint, keys, subject),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(6 * 3600),
      Urgency: 'high',
    },
    body,
  });
  await res.arrayBuffer().catch(() => undefined);
  return { status: res.status, gone: res.status === 404 || res.status === 410 };
}
