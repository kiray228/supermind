import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDecipheriv, createECDH, createPublicKey, hkdfSync, randomBytes, verify } from 'node:crypto';
import { encryptPayload, generateVapidKeys, vapidAuthorization } from '../src/webpush.ts';
import { hashPassword, verifyPassword } from '../src/crypto.ts';

/** Расшифровка так, как это делает браузер (RFC 8291) */
function decrypt(body: Buffer, uaPrivate: Buffer, uaPublic: Buffer, auth: Buffer): string {
  const salt = body.subarray(0, 16);
  const idlen = body.readUInt8(20);
  const asPublic = body.subarray(21, 21 + idlen);
  const ct = body.subarray(21 + idlen);
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(uaPrivate);
  const shared = ecdh.computeSecret(asPublic);
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, auth, info, 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2);
  return plain.subarray(0, plain.length - 1).toString();
}

test('браузер расшифровывает сообщение', () => {
  const ua = createECDH('prime256v1');
  ua.generateKeys();
  const auth = randomBytes(16);
  const msg = JSON.stringify({ title: 'Задача', body: 'Через 15 минут' });
  const body = encryptPayload({ p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') }, Buffer.from(msg));
  assert.equal(decrypt(body, ua.getPrivateKey(), ua.getPublicKey(), auth), msg);
});

test('VAPID: подпись проверяется публичным ключом, aud — origin push-сервиса', () => {
  const keys = generateVapidKeys();
  const h = vapidAuthorization('https://web.push.apple.com/abc/def', keys, 'https://example.com/');
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h)!;
  assert.ok(m);
  const payload = JSON.parse(Buffer.from(m[2], 'base64url').toString());
  assert.equal(payload.aud, 'https://web.push.apple.com');
  const pub = Buffer.from(m[4], 'base64url');
  const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') }, format: 'jwk' });
  assert.ok(verify('sha256', Buffer.from(`${m[1]}.${m[2]}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(m[3], 'base64url')));
});

test('пароли: scrypt, неверный не подходит', async () => {
  const h = await hashPassword('секрет12345');
  assert.ok(await verifyPassword('секрет12345', h));
  assert.ok(!(await verifyPassword('секрет12346', h)));
});
