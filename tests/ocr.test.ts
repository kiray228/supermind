// «Текст с фото»: размер снимка, строки Apple Vision → текст, текст → заметка, ответ модели, ошибки сервера
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './tsResolve.ts';

const { fitWithin, base64Bytes, splitDataUrl, layoutLines, joinTexts, ocrTextToBlocks, ocrNoteParts, visionLanguages, parseOcrReply, ocrServerError, OCR_NONE, OCR_STEPS, OCR_MAX_BYTES } = await import('../src/notes/ocrCore.ts');

test('размер: большая сторона не больше max, маленькое фото не увеличивается', () => {
  assert.deepEqual(fitWithin(4032, 3024, 2000), { w: 2000, h: 1500 });
  assert.deepEqual(fitWithin(3024, 4032, 2000), { w: 1500, h: 2000 });
  assert.deepEqual(fitWithin(800, 600, 2000), { w: 800, h: 600 });
  assert.deepEqual(fitWithin(10000, 3, 2000), { w: 2000, h: 1 });
  assert.deepEqual(fitWithin(0, 100, 2000), { w: 0, h: 0 });
  assert.equal(OCR_STEPS[0].max, 2000);
  assert.ok(OCR_STEPS.every((s, i) => i === 0 || s.max < OCR_STEPS[i - 1].max), 'ступени — всё меньше');
  assert.equal(OCR_MAX_BYTES, 4 * 1024 * 1024);
});

test('base64: байты и data URL', () => {
  assert.equal(base64Bytes(btoa('abc')), 3);
  assert.equal(base64Bytes(btoa('abcd')), 4);
  assert.equal(base64Bytes(btoa('ab')), 2);
  assert.deepEqual(splitDataUrl('data:image/jpeg;base64,QUJD'), { mime: 'image/jpeg', data: 'QUJD' });
  assert.equal(splitDataUrl('blob:xyz'), null);
});

const L = (text: string, x: number, y: number, w = 0.8, h = 0.03) => ({ text, x, y, w, h });

test('Vision: колонки чека — в одну строку, порядок сверху вниз', () => {
  const text = layoutLines([L('300', 0.8, 0.205, 0.1), L('Хлеб', 0.1, 0.2, 0.2), L('ИТОГО', 0.1, 0.3, 0.2), L('Магазин', 0.1, 0.1, 0.4), L('Сүт', 0.1, 0.24, 0.2), L('450', 0.8, 0.24, 0.1), L('750', 0.8, 0.3, 0.1)]);
  assert.equal(text, 'Магазин\n\nХлеб 300\nСүт 450\n\nИТОГО 750');
});

test('Vision: перенос внутри абзаца склеивается, дефис убирается, новый абзац — с пустой строкой', () => {
  const text = layoutLines([
    L('Сегодня мы обсудили план на', 0.1, 0.1),
    L('неделю и распреде-', 0.1, 0.135),
    L('лили задачи.', 0.1, 0.17, 0.3),
    L('Следующая встреча в пятницу.', 0.1, 0.25, 0.6),
    L('Ответственный: Айгерім', 0.1, 0.285, 0.5),
  ]);
  assert.equal(text, 'Сегодня мы обсудили план на неделю и распределили задачи.\n\nСледующая встреча в пятницу.\nОтветственный: Айгерім');
});

test('Vision: пусто и мусор', () => {
  assert.equal(layoutLines([]), '');
  assert.equal(layoutLines([L('  ', 0, 0), L('x', 0, 0, 0, 0)]), '');
  assert.equal(joinTexts(['  a ', '', 'b']), 'a\n\nb');
});

test('текст → блоки: списки, нумерация, галочки, абзацы', () => {
  const b = ocrTextToBlocks('Покупки\n\n- Нан\n• Сүт\n1. Первое\n2) Второе\n☐ Позвонить\n✓ Купить\nПросто текст');
  assert.deepEqual(
    b.map((x) => [x.type, x.text, x.checked ?? false]),
    [
      ['p', 'Покупки', false],
      ['bullet', 'Нан', false],
      ['bullet', 'Сүт', false],
      ['number', 'Первое', false],
      ['number', 'Второе', false],
      ['todo', 'Позвонить', false],
      ['todo', 'Купить', true],
      ['p', 'Просто текст', false],
    ],
  );
  // год в начале строки — не пункт списка
  assert.equal(ocrTextToBlocks('2024. Год был трудным')[0].type, 'p');
});

test('новая заметка: короткая первая строка — название, длинная — «Текст с фото»', () => {
  const a = ocrNoteParts('\nСписок покупок:\n- Нан\n- Сүт');
  assert.equal(a.title, 'Список покупок');
  assert.deepEqual(a.blocks.map((x) => x.text), ['Нан', 'Сүт']);
  const long = 'Это очень длинный первый абзац текста со страницы книги, который явно не годится в название заметки.';
  const b = ocrNoteParts(`${long}\nВторой`);
  assert.equal(b.title, 'Текст с фото');
  assert.deepEqual(b.blocks.map((x) => x.text), [long, 'Второй']);
  assert.equal(ocrNoteParts('- пункт\n- ещё').title, 'Текст с фото');
});

test('языки Vision: язык интерфейса первым, казахский — в начале для kk', () => {
  assert.deepEqual(visionLanguages('ru'), ['ru-RU', 'en-US']);
  assert.deepEqual(visionLanguages('en'), ['en-US', 'ru-RU']);
  assert.deepEqual(visionLanguages('kk'), ['kk-KZ', 'ru-RU', 'en-US']);
});

test('ответ модели (свой ключ Claude): ограждения, «нет текста»', () => {
  assert.equal(parseOcrReply('```\nHello\n```'), 'Hello');
  assert.equal(parseOcrReply(OCR_NONE), '');
  assert.equal(parseOcrReply('a\n\n\n\nb'), 'a\n\nb');
});

test('ошибки сервера → понятный текст', () => {
  assert.match(ocrServerError(429, 'x'), /исчерпан/);
  assert.match(ocrServerError(401, 'x'), /Войдите/);
  assert.match(ocrServerError(413, 'x'), /большое/);
  assert.match(ocrServerError(0, 'x'), /интернет/i);
  assert.equal(ocrServerError(500, 'Ошибка сервера'), 'Ошибка сервера');
});

test('iPhone: плагин TextScan зарегистрирован, камера описана в Info.plist', async () => {
  const { readFileSync } = await import('node:fs');
  const read = (p: string) => readFileSync(new URL(`../ios/App/App/${p}`, import.meta.url), 'utf8');
  assert.match(read('MainViewController.swift'), /registerPluginInstance\(TextScanPlugin\(\)\)/);
  assert.match(read('TextScanPlugin.swift'), /jsName = "TextScan"/);
  assert.match(read('Info.plist'), /NSCameraUsageDescription/);
  for (const l of ['en', 'ru', 'kk']) assert.match(read(`${l}.lproj/InfoPlist.strings`), /"NSCameraUsageDescription"/);
});
