import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import './tsResolve.ts';
import type { StudyCard } from '../src/notes/model.ts';

const { schedule, nextInterval, dueCards, newCard, parseCards, intervalLabel, addDays, buildCardsPrompt, CARDS_SYSTEM } = await import('../src/notes/cardsCore.ts');
const { insertIntoSection, journalLine, dailyBlocks, DAILY_SECTIONS } = await import('../src/notes/dailyCore.ts');
const { sharedBlocks, sharedTitle, sharedNoteBlocks } = await import('../src/native/shareCore.ts');
const { parseVoice, parseJournal } = await import('../src/voice/intent.ts');
const { newBlock } = await import('../src/notes/model.ts');

const T = '2026-10-15';
const card = (p: Partial<StudyCard> = {}): StudyCard => ({ ...newCard({ id: 'c', noteId: 'n', q: 'Вопрос?', a: 'Ответ', by: 'ai' }, T, 1), ...p });

describe('интервальное повторение', () => {
  test('новая карточка: «хорошо» — завтра, потом 3 дня, потом растёт', () => {
    let c = schedule(card(), 2, T);
    assert.deepEqual([c.interval, c.due, c.reps], [1, '2026-10-16', 1]);
    c = schedule(c, 2, c.due);
    assert.deepEqual([c.interval, c.due], [3, '2026-10-19']);
    c = schedule(c, 2, c.due);
    assert.equal(c.interval, Math.round(3 * 2.5));
    const before = c.interval;
    c = schedule(c, 2, c.due);
    assert.ok(c.interval > before);
  });

  test('«снова» — сегодня же, повторы с нуля, забываний +1, лёгкость падает (не ниже 1.3)', () => {
    let c = schedule(schedule(card(), 2, T), 2, T);
    c = schedule(c, 0, T);
    assert.deepEqual([c.interval, c.due, c.reps, c.lapses], [0, T, 0, 1]);
    assert.equal(c.ease, 2.3);
    for (let i = 0; i < 20; i++) c = schedule(c, 0, T);
    assert.equal(c.ease, 1.3);
    // новая карточка, которую не вспомнили, — не «забыта» (её ещё не знали)
    assert.equal(schedule(card(), 0, T).lapses, 0);
  });

  test('«легко» дальше «хорошо», «трудно» ближе; потолок — год', () => {
    const c = schedule(schedule(card(), 2, T), 2, T);
    assert.ok(nextInterval(c, 3) > nextInterval(c, 2));
    assert.ok(nextInterval(c, 1) < nextInterval(c, 2));
    assert.ok(nextInterval(c, 1) >= 1);
    assert.equal(nextInterval({ interval: 300, ease: 3, reps: 9 }, 3), 365);
    assert.equal(schedule(card({ ease: 3 }), 3, T).ease, 3);
  });

  test('«хорошо» всегда дальше прежнего интервала, даже при низкой лёгкости', () => {
    const c = card({ interval: 10, ease: 1.3, reps: 5 });
    assert.ok(nextInterval(c, 2) > 10);
  });

  test('на сегодня: сначала давние повторы, потом новые (не больше лимита); будущие — нет', () => {
    const list = [
      card({ id: 'new1', createdAt: 1 }),
      card({ id: 'new2', createdAt: 2 }),
      card({ id: 'old', due: '2026-10-01', reps: 3, interval: 5 }),
      card({ id: 'mid', due: '2026-10-10', reps: 2, interval: 3 }),
      card({ id: 'future', due: '2026-10-20', reps: 1, interval: 5 }),
    ];
    assert.deepEqual(
      dueCards(list, T).map((c) => c.id),
      ['old', 'mid', 'new1', 'new2'],
    );
    assert.deepEqual(
      dueCards(list, T, 1).map((c) => c.id),
      ['old', 'mid', 'new1'],
    );
  });

  test('подписи интервалов и даты', () => {
    assert.deepEqual([0, 1, 13, 21, 90, 400].map(intervalLabel), ['сейчас', '1 д', '13 д', '3 нед', '3 мес', '1 г']);
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  });
});

describe('карточки от ИИ', () => {
  test('JSON в ```, вопрос/ответ под разными именами, без пустых и повторов', () => {
    const r = parseCards('Вот:\n```json\n[{"q":"Сколько откладывать?","a":"20% дохода"},{"question":"Где подушка?","answer":"На накопительном счёте"},{"q":"","a":"x"},{"q":"сколько  откладывать","a":"повтор"}]\n```');
    assert.deepEqual(r, [
      { q: 'Сколько откладывать?', a: '20% дохода' },
      { q: 'Где подушка?', a: 'На накопительном счёте' },
    ]);
  });

  test('уже есть — не повторяются; мусор — пусто; лимит', () => {
    assert.deepEqual(parseCards('[{"q":"Сколько откладывать?","a":"20%"}]', ['сколько откладывать']), []);
    assert.deepEqual(parseCards('не JSON'), []);
    assert.deepEqual(parseCards('{"q":"a","a":"b"}'), []);
    const many = JSON.stringify(Array.from({ length: 20 }, (_, i) => ({ q: 'Вопрос ' + i, a: 'Ответ' })));
    assert.equal(parseCards(many).length, 8);
  });

  test('запрос: заметка и список «Уже есть»', () => {
    const p = buildCardsPrompt('Бюджет', 'Откладываю 20%', ['Сколько откладывать?']);
    assert.ok(p.startsWith('Заметка «Бюджет»:'));
    assert.ok(p.includes('Уже есть:\n- Сколько откладывать?'));
    assert.ok(CARDS_SYSTEM.includes('JSON'));
  });
});

describe('запись в раздел заметки дня', () => {
  const day = () => dailyBlocks({ ymd: T, tasks: ['Купить хлеб'] });
  const types = (bs: { type: string; text?: string }[]) => bs.map((b) => `${b.type}:${b.text ?? ''}`);

  test('в «Мысли»: пустая заглушка заменяется, следующий раздел не трогается', () => {
    const out = insertIntoSection(day(), DAILY_SECTIONS.thoughts, [newBlock('p', { text: 'идея' })]);
    const t = types(out);
    const i = t.indexOf('h2:Мысли');
    assert.deepEqual(t.slice(i, i + 3), ['h2:Мысли', 'p:идея', 'h2:Итоги дня']);
    // вторая запись — после первой
    const out2 = insertIntoSection(out, 'мысли', [newBlock('p', { text: 'ещё' })]);
    assert.deepEqual(types(out2).slice(i, i + 4), ['h2:Мысли', 'p:идея', 'p:ещё', 'h2:Итоги дня']);
  });

  test('в последний раздел и без раздела — в конец', () => {
    const out = insertIntoSection(day(), DAILY_SECTIONS.results, [newBlock('p', { text: 'итог' })]);
    assert.equal(types(out).at(-1), 'p:итог');
    assert.equal(types(out).at(-2), 'h2:Итоги дня');
    const plain = insertIntoSection([newBlock('p', { text: 'а' }), newBlock('p', { text: '' })], 'Нет такого', [newBlock('p', { text: 'б' })]);
    assert.deepEqual(types(plain), ['p:а', 'p:б']);
  });

  test('подзаголовок внутри раздела — часть раздела', () => {
    const bs = [newBlock('h2', { text: 'Мысли' }), newBlock('h3', { text: 'Работа' }), newBlock('p', { text: 'x' }), newBlock('h2', { text: 'Итоги дня' })];
    assert.deepEqual(types(insertIntoSection(bs, 'Мысли', [newBlock('p', { text: 'new' })])), ['h2:Мысли', 'h3:Работа', 'p:x', 'p:new', 'h2:Итоги дня']);
  });

  test('время записи', () => {
    assert.equal(journalLine('  мысль ', new Date(2026, 9, 15, 9, 5)), '09:05 · мысль');
  });
});

describe('«Поделиться»', () => {
  test('название: первая строка, ссылка — нет (тогда заголовок страницы), фото', () => {
    assert.equal(sharedTitle('Идея для поста\nподробности'), 'Идея для поста');
    assert.equal(sharedTitle('https://x.ru/a', 'Статья про бег'), 'Статья про бег');
    assert.equal(sharedTitle('', undefined, 3), 'Фото (3)');
    assert.equal(sharedTitle('', undefined, 1), 'Фото');
    assert.equal(sharedTitle('а'.repeat(100)).length, 80);
  });

  test('блоки: абзацы без пустых строк, затем картинки; название не повторяется', () => {
    const b = sharedBlocks('Строка 1\n\n  Строка 2 ', ['data:image/png;base64,AA']);
    assert.deepEqual(
      b.map((x) => [x.type, x.text ?? x.src]),
      [
        ['p', 'Строка 1'],
        ['p', 'Строка 2'],
        ['image', 'data:image/png;base64,AA'],
      ],
    );
    assert.deepEqual(
      sharedNoteBlocks('Идея\nдетали', 'Идея').map((x) => x.text),
      ['детали'],
    );
    assert.deepEqual(
      sharedNoteBlocks('https://x.ru', 'Статья').map((x) => x.text),
      ['https://x.ru'],
    );
  });
});

describe('голосом в дневник', () => {
  const j = (s: string) => {
    const a = parseVoice(s).actions[0];
    return a?.type === 'add_journal' ? [a.section, a.text] : a?.type;
  };

  test('разные формы команды', () => {
    assert.deepEqual(j('Запиши в дневник: сегодня пробежал 10 км'), ['thoughts', 'Сегодня пробежал 10 км']);
    assert.deepEqual(j('Дневник: устал'), ['thoughts', 'Устал']);
    assert.deepEqual(j('в дневник поругался с братом'), ['thoughts', 'Поругался с братом']);
    assert.deepEqual(j('Записать в журнал встреча прошла'), ['thoughts', 'Встреча прошла']);
    assert.deepEqual(j('добавь в заметку дня позвонил врачу'), ['thoughts', 'Позвонил врачу']);
  });

  test('итоги дня — в свой раздел', () => {
    assert.deepEqual(j('Итоги дня: закрыл проект'), ['results', 'Закрыл проект']);
    assert.deepEqual(j('Запиши в дневник итоги дня — всё хорошо'), ['results', 'Всё хорошо']);
    assert.deepEqual(j('итог за день: выспался'), ['results', 'Выспался']);
  });

  test('не дневник: задачи и заметки — как раньше; пустая запись — нет', () => {
    assert.equal(j('купить дневник завтра'), 'add_task');
    assert.equal(j('запиши заметку купить молоко'), 'add_note');
    assert.equal(parseJournal('запиши в дневник'), null);
    assert.equal(parseJournal('итоги дня'), null);
  });
});
