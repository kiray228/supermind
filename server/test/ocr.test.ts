/** «Текст с фото»: POST /ai/ocr — вход, лимит, проверка снимка, запрос к модели, разбор ответа */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.ts';
import { PgliteSql } from './pglite.ts';
import { OCR_MAX_BYTES, OCR_NONE, geminiVisionBody, groqVisionBody, ocrPrompt, parseOcrText, readOcrImage, type OcrImage } from '../src/ai.ts';

const sql = new PgliteSql();
// 1×1 JPEG не нужен: модель — заглушка, проверяется только base64
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('ocr: без входа — 401, без модели — 503, лимит в день, текст из ответа модели', async () => {
  const seen: { prompt: string; image: OcrImage }[] = [];
  let reply = '```\nСписок покупок\n- Нан\n- Сүт\n```';
  const app = createApp({
    sql,
    mail: null,
    ai: null,
    aiDailyLimit: 2,
    vision: async (prompt, image) => {
      seen.push({ prompt, image });
      return reply;
    },
  });
  const req = (b: unknown, token?: string, a = app) =>
    a.fetch(new Request('http://x/ai/ocr', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(b) }));
  const reg = await app.fetch(new Request('http://x/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'ocr@b.cd', password: '12345678' }) }));
  const t = ((await reg.json()) as { token: string }).token;

  assert.equal((await req({ image: PNG, mime: 'image/png' })).status, 401);
  assert.equal((await req({}, t)).status, 400);
  assert.equal((await req({ image: PNG, mime: 'image/gif' }, t)).status, 400);
  assert.equal((await req({ image: 'не base64!', mime: 'image/png' }, t)).status, 400);
  assert.equal(seen.length, 0, 'плохой снимок не тратит лимит и не уходит модели');

  const r = await req({ image: `data:image/png;base64,${PNG}`, lang: 'kk' }, t);
  assert.equal(r.status, 200);
  assert.equal(((await r.json()) as { text: string }).text, 'Список покупок\n- Нан\n- Сүт');
  assert.deepEqual(seen[0].image, { mime: 'image/png', data: PNG });
  assert.match(seen[0].prompt, /казахск/);

  reply = OCR_NONE;
  const empty = await req({ image: PNG, mime: 'image/png' }, t);
  assert.equal(((await empty.json()) as { text: string }).text, '');
  assert.equal((await req({ image: PNG, mime: 'image/png' }, t)).status, 429, 'общий дневной лимит ИИ');

  const off = createApp({ sql, mail: null, ai: null, vision: null });
  assert.equal((await req({ image: PNG, mime: 'image/png' }, t, off)).status, 503);

  const broken = createApp({ sql, mail: null, ai: null, aiDailyLimit: 100, vision: async () => Promise.reject(new Error('Gemini 400')) });
  const reg2 = await broken.fetch(new Request('http://x/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'ocr2@b.cd', password: '12345678' }) }));
  const t2 = ((await reg2.json()) as { token: string }).token;
  assert.equal((await req({ image: PNG, mime: 'image/png' }, t2, broken)).status, 502);
});

test('ocr: проверка снимка — размер, формат, data URL', () => {
  assert.deepEqual(readOcrImage(PNG, 'image/png'), { mime: 'image/png', data: PNG });
  assert.deepEqual(readOcrImage(`data:image/jpg;base64,${PNG}`, undefined), { mime: 'image/jpeg', data: PNG });
  assert.deepEqual(readOcrImage(PNG, undefined), { mime: 'image/jpeg', data: PNG });
  assert.equal((readOcrImage(123, 'image/png') as { status: number }).status, 400);
  assert.equal((readOcrImage(PNG, 'application/pdf') as { status: number }).status, 400);
  assert.equal((readOcrImage(PNG.slice(1), 'image/png') as { status: number }).status, 400);
  const big = 'A'.repeat(Math.ceil((OCR_MAX_BYTES + 10) / 3) * 4);
  assert.equal((readOcrImage(big, 'image/jpeg') as { status: number }).status, 413);
  const ok = 'A'.repeat(Math.floor(OCR_MAX_BYTES / 3) * 4);
  assert.ok(!('error' in readOcrImage(ok, 'image/jpeg')));
});

test('ocr: запрос к Gemini и Groq — картинка внутри сообщения', () => {
  const img = { mime: 'image/jpeg', data: 'QUJD' };
  const g = geminiVisionBody('prompt', img);
  assert.deepEqual(g.contents[0].parts[0], { inline_data: { mime_type: 'image/jpeg', data: 'QUJD' } });
  assert.deepEqual(g.contents[0].parts[1], { text: 'prompt' });
  assert.equal(g.generationConfig.temperature, 0);
  const q = groqVisionBody('m', 'prompt', img);
  assert.equal(q.messages[0].content[1].image_url!.url, 'data:image/jpeg;base64,QUJD');
  assert.match(ocrPrompt(), /не переводи/);
  assert.match(ocrPrompt(), /ә ғ қ/);
  assert.match(ocrPrompt('en'), /английский/);
});

test('ocr: разбор ответа модели', () => {
  assert.equal(parseOcrText('  Привет\r\nмир  '), 'Привет\nмир');
  assert.equal(parseOcrText('```text\nHello\n\n\n\nworld\n```'), 'Hello\n\nworld');
  assert.equal(parseOcrText(OCR_NONE), '');
  assert.equal(parseOcrText(` ${OCR_NONE}. `), '');
  assert.equal(parseOcrText(''), '');
  // маркер внутри настоящего текста — текст остаётся
  assert.equal(parseOcrText(`Чек №5\nИтого 300 ${OCR_NONE}`), `Чек №5\nИтого 300 ${OCR_NONE}`);
});
