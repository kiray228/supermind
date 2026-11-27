// Ссылки на карты: адрес и разбор вставленного текста
import './tsResolve.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { parseShareToken, shareUrl } = await import('../src/share/link.ts');

test('ссылка на карту: адрес разбирается обратно, лишнее вокруг не мешает', () => {
  const token = 'AbC_def-1234567890xyz';
  assert.equal(parseShareToken(shareUrl(token)), token);
  assert.equal(parseShareToken(`Смотри мою карту: ${shareUrl(token)} `), token);
  assert.equal(parseShareToken(`https://kiray228.github.io/supermind/?x=1&map=${token}`), token);
  assert.equal(parseShareToken(token), token, 'сам код ссылки');
  assert.equal(parseShareToken('https://supermind.kz/app/'), null);
  assert.equal(parseShareToken('купить хлеб'), null);
  assert.equal(parseShareToken('#map=short'), null, 'слишком короткий код');
});
