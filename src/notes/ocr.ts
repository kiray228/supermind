/**
 * «Текст с фото»: снимок → распознанный текст.
 *   iPhone — на устройстве (Apple Vision, плагин TextScan в ios/App/App/TextScanPlugin.swift), фото никуда не уходит;
 *   Android, браузер, компьютер — свой ключ Claude напрямую или бесплатный ИИ через сервер SuperMind (POST /ai/ocr).
 * ML Kit на Android не знает кириллицы, поэтому там — сервер. Перед отправкой фото — согласие на ИИ (src/ai/consent.ts).
 */
import { Capacitor, registerPlugin } from '@capacitor/core';
import { useApp } from '../store/appStore';
import { lang, t } from '../i18n/index';
import { OCR_MAX_BYTES, OCR_PROMPT, OCR_STEPS, base64Bytes, fitWithin, layoutLines, ocrServerError, parseOcrReply, splitDataUrl, visionLanguages, type OcrLine } from './ocrCore';

export class OcrError extends Error {}

interface TextScanPlugin {
  recognize(o: { image: string; languages: string[] }): Promise<{ lines: OcrLine[] }>;
  scanDocument(o: { languages: string[] }): Promise<{ cancelled?: boolean; pages?: { lines: OcrLine[] }[]; image?: string }>;
  canScan(): Promise<{ value: boolean }>;
}
const TextScan = registerPlugin<TextScanPlugin>('TextScan');

/** Где распознаётся: на устройстве, через свой ключ Claude или через сервер */
export type OcrEngine = 'device' | 'claude' | 'server';

export function ocrEngine(): OcrEngine {
  if (Capacitor.getPlatform() === 'ios' && Capacitor.isPluginAvailable('TextScan')) return 'device';
  return useApp.getState().settings.apiKey.trim() ? 'claude' : 'server';
}

/** iPhone: сканер документов (камера сама находит страницу и выравнивает её) */
export async function canScanDocument(): Promise<boolean> {
  if (ocrEngine() !== 'device') return false;
  try {
    return (await TextScan.canScan()).value;
  } catch {
    return false;
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new OcrError(t('Не удалось открыть изображение')));
    img.src = url;
  });
}

/**
 * Снимок → JPEG data URL не больше 2000 px и 4 МБ (крупнее — сильнее сжимаем).
 * Ориентацию по EXIF браузер применяет сам при рисовании на canvas.
 */
export async function prepareImage(src: Blob | string, steps = OCR_STEPS): Promise<string> {
  const url = typeof src === 'string' ? src : URL.createObjectURL(src);
  try {
    const img = await loadImage(url);
    const w0 = img.naturalWidth || img.width;
    const h0 = img.naturalHeight || img.height;
    if (!w0 || !h0) throw new OcrError(t('Пустое изображение'));
    let out = '';
    for (const s of steps) {
      const { w, h } = fitWithin(w0, h0, s.max);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new OcrError(t('Canvas недоступен'));
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      out = canvas.toDataURL('image/jpeg', s.quality);
      if (base64Bytes(out.slice(out.indexOf(',') + 1)) <= OCR_MAX_BYTES * 0.95) return out;
    }
    throw new OcrError(t('Фото слишком большое'));
  } finally {
    if (typeof src !== 'string') URL.revokeObjectURL(url);
  }
}

async function onDevice(dataUrl: string): Promise<string> {
  const img = splitDataUrl(dataUrl);
  if (!img) throw new OcrError(t('Не удалось открыть изображение'));
  try {
    const r = await TextScan.recognize({ image: img.data, languages: visionLanguages(lang) });
    return layoutLines(r.lines ?? []);
  } catch (e) {
    throw new OcrError(e instanceof Error && e.message ? e.message : t('Не удалось распознать текст'));
  }
}

async function viaServer(dataUrl: string, signal?: AbortSignal): Promise<string> {
  const img = splitDataUrl(dataUrl);
  if (!img) throw new OcrError(t('Не удалось открыть изображение'));
  const { api } = await import('../store/cloud');
  try {
    const r = await api<{ text?: string }>('/ai/ocr', { method: 'POST', body: JSON.stringify({ image: img.data, mime: img.mime, lang }), signal });
    return r.text ?? '';
  } catch (e) {
    if (signal?.aborted) throw new OcrError(t('Остановлено'));
    const status = (e as { status?: number }).status;
    throw new OcrError(ocrServerError(status, e instanceof Error ? e.message : String(e)));
  }
}

async function viaClaude(dataUrl: string, signal?: AbortSignal): Promise<string> {
  const img = splitDataUrl(dataUrl);
  if (!img) throw new OcrError(t('Не удалось открыть изображение'));
  const { AI_MODELS } = await import('../ai/claude');
  const { apiKey, model } = useApp.getState().settings;
  let Anthropic: typeof import('@anthropic-ai/sdk').default;
  try {
    Anthropic = (await import('@anthropic-ai/sdk')).default;
  } catch {
    throw new OcrError(t('Не удалось загрузить модуль ИИ. Проверьте интернет и попробуйте ещё раз.'));
  }
  const c = new Anthropic({ apiKey: apiKey.trim(), dangerouslyAllowBrowser: true });
  try {
    const r = await c.messages.create(
      {
        model: model || AI_MODELS[0].id,
        max_tokens: 8192,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: img.mime as 'image/jpeg', data: img.data } },
              { type: 'text', text: OCR_PROMPT },
            ],
          },
        ],
      },
      { signal },
    );
    if (r.stop_reason === 'refusal') throw new OcrError(t('Claude отказался выполнять этот запрос. Попробуйте переформулировать.'));
    return parseOcrReply(r.content.map((b) => (b.type === 'text' ? b.text : '')).join(''));
  } catch (e) {
    if (e instanceof OcrError) throw e;
    if (e instanceof Anthropic.APIUserAbortError) throw new OcrError(t('Остановлено'));
    if (e instanceof Anthropic.AuthenticationError) throw new OcrError(t('Неверный API-ключ. Проверьте его в Настройках.'));
    if (e instanceof Anthropic.RateLimitError) throw new OcrError(t('Слишком много запросов или закончился баланс. Подождите немного.'));
    if (e instanceof Anthropic.APIConnectionError) throw new OcrError(t('Нет соединения с сервером Claude. Проверьте интернет.'));
    throw new OcrError(e instanceof Error ? e.message : String(e));
  }
}

/** Спросить согласие (один раз), прежде чем фото уйдёт с устройства. false — не разрешили */
export async function ocrConsent(engine: OcrEngine): Promise<boolean> {
  if (engine === 'device') return true;
  const { askAiConsent } = await import('../ai/consent');
  return askAiConsent(engine);
}

/** Распознать текст на снимке (data URL после prepareImage). Пустая строка — текста нет */
export async function recognizeText(dataUrl: string, opts: { engine?: OcrEngine; signal?: AbortSignal } = {}): Promise<string> {
  const engine = opts.engine ?? ocrEngine();
  if (engine === 'device') return onDevice(dataUrl);
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new OcrError(t('Нет интернета — распознать фото не получится'));
  if (!(await ocrConsent(engine))) throw new OcrError(t('ИИ выключен: отправка данных не разрешена. Включить — Настройки → «Искусственный интеллект» → «Отправлять данные ИИ».'));
  return engine === 'claude' ? viaClaude(dataUrl, opts.signal) : viaServer(dataUrl, opts.signal);
}

/** iPhone: отсканировать документ камерой и распознать. null — сканирование отменено */
export async function scanDocument(): Promise<{ text: string; image?: string } | null> {
  try {
    const r = await TextScan.scanDocument({ languages: visionLanguages(lang) });
    if (r.cancelled) return null;
    const text = (r.pages ?? [])
      .map((p) => layoutLines(p.lines ?? []))
      .filter(Boolean)
      .join('\n\n');
    return { text, image: r.image ? `data:image/jpeg;base64,${r.image}` : undefined };
  } catch (e) {
    throw new OcrError(e instanceof Error && e.message ? e.message : t('Не удалось открыть сканер'));
  }
}
