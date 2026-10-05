/**
 * Сохранение и выбор файлов в браузере (desktop + iPhone Safari).
 */

export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iP(hone|ad|od)/.test(ua)) return true;
  // iPadOS 13+ притворяется Mac
  return /Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1;
}

/** Безопасное имя файла (без расширения): убирает запрещённые символы, ограничивает длину */
export function safeFilename(title: string): string {
  const s = (title ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 120)
    .trim();
  if (!s || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s)) return s ? `${s}_` : 'Без названия';
  return s;
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  md: 'text/markdown',
  txt: 'text/plain',
  csv: 'text/csv',
  opml: 'text/x-opml',
  json: 'application/json',
  '2mind': 'application/json',
  xmind: 'application/vnd.xmind.workbook',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

function anchorDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Safari нужно время, чтобы забрать blob
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Скачать blob. На iOS предпочитает системное меню «Поделиться» (сохранить в Файлы и т.п.),
 * если оно поддерживает файлы; иначе — обычная ссылка с download.
 */
export async function downloadBlob(blob: Blob, filename: string): Promise<void> {
  const { isNative, nativeSaveBlob } = await import('../platform');
  if (isNative()) {
    try {
      await nativeSaveBlob(blob, filename);
    } catch (e) {
      // пользователь закрыл меню «Поделиться»
      if (!String(e).toLowerCase().includes('cancel')) throw e;
    }
    return;
  }
  if (isIOS() && typeof navigator.share === 'function' && typeof File !== 'undefined') {
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    const type = blob.type || MIME_BY_EXT[ext] || 'application/octet-stream';
    try {
      const file = new File([blob], filename, { type });
      const data: ShareData = { files: [file] };
      if (navigator.canShare?.(data)) {
        await navigator.share(data);
        return;
      }
    } catch (e) {
      // пользователь закрыл меню — ничего не делаем
      if (e instanceof DOMException && e.name === 'AbortError') return;
      // NotAllowedError (потерян жест пользователя) и пр. — запасной путь ниже
    }
  }
  anchorDownload(blob, filename);
}

export function downloadText(text: string, filename: string, mime = 'text/plain'): Promise<void> {
  const type = /charset=/i.test(mime) ? mime : `${mime};charset=utf-8`;
  return downloadBlob(new Blob([text], { type }), filename);
}

/** Расширения, которые iOS сопоставляет с известными UTI. Иначе accept блокирует выбор файла. */
const IOS_SAFE_EXT = new Set(['.json', '.txt', '.md', '.csv', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.heic', '.pdf', '.svg', '.zip']);

function acceptForPlatform(accept: string): string {
  if (!accept || !isIOS()) return accept;
  const tokens = accept.split(',').map((t) => t.trim()).filter(Boolean);
  const ok = tokens.every((t) => t.includes('/') || IOS_SAFE_EXT.has(t.toLowerCase()));
  // с «экзотическими» расширениями (.xmind, .2mind, .opml) iOS делает файлы недоступными —
  // в этом случае разрешаем любые файлы, а формат проверяется при импорте
  return ok ? accept : '';
}

/** Выбор файла через скрытый input. null — если пользователь отменил выбор. */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    const acc = acceptForPlatform(accept);
    if (acc) input.accept = acc;
    input.style.position = 'fixed';
    input.style.left = '-10000px';
    input.style.top = '0';
    input.style.opacity = '0';
    input.setAttribute('aria-hidden', 'true');
    input.tabIndex = -1;

    let done = false;
    let focusTimer: ReturnType<typeof setTimeout> | null = null;
    const finish = (f: File | null) => {
      if (done) return;
      done = true;
      if (focusTimer) clearTimeout(focusTimer);
      window.removeEventListener('focus', onFocus);
      input.remove();
      resolve(f);
    };
    const onFocus = () => {
      // фолбэк для браузеров без события cancel: окно вернуло фокус, а change так и не пришёл
      if (focusTimer) clearTimeout(focusTimer);
      focusTimer = setTimeout(() => {
        if (!input.files?.length) finish(null);
      }, 1500);
    };

    input.addEventListener('change', () => finish(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => finish(null));
    document.body.appendChild(input);
    // подписываемся на focus после открытия диалога (только если нет нативного cancel —
    // на iOS focus может прийти, пока пользователь ещё листает «Файлы»)
    if (!('oncancel' in input)) setTimeout(() => window.addEventListener('focus', onFocus), 0);
    input.click();
  });
}
