/** Ссылка на карту: адрес и разбор (модуль чистый — тесты гоняют его в Node) */
/** Адрес веб-версии: по ссылке карту открывают в браузере, а в приложении — вставив ссылку */
export const SHARE_BASE = 'https://supermind.kz/app/';

export const shareUrl = (token: string) => `${SHARE_BASE}#map=${token}`;

const TOKEN = /^[A-Za-z0-9_-]{10,64}$/;

/** Ссылка (или сам код из неё) → код ссылки; не ссылка на карту — null */
export function parseShareToken(text: string): string | null {
  const s = text.trim();
  if (TOKEN.test(s)) return s;
  const m = /[#?&]map=([A-Za-z0-9_-]{10,64})/.exec(s);
  return m ? m[1] : null;
}
