/** Безопасные адреса для ссылок: только веб, почта, телефон и FTP — «javascript:» и прочие схемы не открываем */
const SAFE = /^(https?|mailto|tel|ftp):/i;

/** Адрес для открытия: без схемы — https://; опасная схема — null */
export function safeUrl(raw: string | undefined | null): string | null {
  const u = (raw ?? '').trim();
  if (!u) return null;
  if (SAFE.test(u)) return u;
  // «site.ru», «www.site.ru/путь» — без схемы; «javascript:», «data:», «file:» — нельзя
  if (/^[a-z][a-z0-9+.-]*:/i.test(u) && !/^[^:/]+:\d/.test(u)) return null;
  return 'https://' + u.replace(/^\/+/, '');
}

export const isSafeUrl = (u: string) => SAFE.test(u.trim());
