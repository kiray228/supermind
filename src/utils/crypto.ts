import type { LockedDoc, MindDoc } from '../types';

const enc = new TextEncoder();
const dec = new TextDecoder();

const b64 = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(password: string, salt: Uint8Array) {
  const material = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: 250_000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Шифрование документа паролем (AES-GCM 256, PBKDF2) */
export async function encryptDoc(doc: MindDoc, password: string): Promise<LockedDoc> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(doc)));
  return { id: doc.id, locked: true, salt: b64(salt), iv: b64(iv), data: b64(data) };
}

export async function decryptDoc(locked: LockedDoc, password: string): Promise<MindDoc> {
  const key = await deriveKey(password, unb64(locked.salt));
  const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(locked.iv) as BufferSource }, key, unb64(locked.data) as BufferSource);
  return JSON.parse(dec.decode(data));
}
