import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { allLinks, buildIndex, extractFeatures, isStopWord, keywordsOf, type LinkIndex, MIN_SCORE, relatedTo, stemEn, stemRu, termKey, tokenize } from '../src/notes/links.ts';
import { CORPUS } from './fixtures/corpus.ts';

const index = (docs: { id: string; title: string; text: string; headings?: string[] }[]): LinkIndex => buildIndex(docs.map((d) => ({ id: d.id, f: extractFeatures(d) })));
const ids = (ix: LinkIndex, id: string) => relatedTo(ix, id).map((r) => r.id);

describe('стемминг', () => {
  test('формы русского слова сводятся к одной основе', () => {
    const groups = [
      ['привычка', 'привычки', 'привычку', 'привычкой', 'привычками', 'привычках'],
      ['инвестиции', 'инвестиций', 'инвестициями', 'инвестиция', 'инвестицию'],
      ['нейросеть', 'нейросети', 'нейросетей', 'нейросетями'],
      ['бюджет', 'бюджета', 'бюджету', 'бюджетом', 'бюджете'],
      ['красивый', 'красивая', 'красивое', 'красивые', 'красивого', 'красивыми'],
      ['читать', 'читаю', 'читает', 'читали'],
      ['Стамбул', 'Стамбуле', 'Стамбула'],
      ['самолёт', 'самолета', 'самолетом'],
    ];
    for (const g of groups) {
      const stems = new Set(g.map(stemRu));
      assert.equal(stems.size, 1, `${g.join(', ')} → ${[...stems].join(' | ')}`);
    }
  });

  test('совпадает с эталонным Snowball на известных словах', () => {
    const cases: Record<string, string> = {
      привычка: 'привычк',
      инвестиции: 'инвестиц',
      программирование: 'программирован',
      красивый: 'красив',
      здоровье: 'здоров',
      бегать: 'бега',
      спать: 'спат',
      путешествие: 'путешеств',
      мышцы: 'мышц',
      ёлка: 'елк',
      новейший: 'нов',
      длинная: 'длин',
      одеваться: 'одева',
    };
    for (const [w, s] of Object.entries(cases)) assert.equal(stemRu(w), s, w);
  });

  test('разные слова не сливаются', () => {
    assert.notEqual(stemRu('вес'), stemRu('весна'));
    assert.notEqual(stemRu('книга'), stemRu('кино'));
    assert.notEqual(stemRu('бег'), stemRu('берег'));
  });

  test('короткие слова и слова без гласных не ломаются', () => {
    for (const w of ['я', 'ну', 'вкл', 'стр', '']) assert.equal(typeof stemRu(w), 'string');
    assert.equal(stemRu('сон'), 'сон');
  });

  test('английский: формы сводятся к одной основе', () => {
    const groups = [
      ['run', 'running', 'runs'],
      ['learn', 'learning', 'learned', 'learns'],
      ['habit', 'habits'],
      ['study', 'studies'],
      ['invest', 'investing', 'invested'],
      ['component', 'components'],
    ];
    for (const g of groups) assert.equal(new Set(g.map(stemEn)).size, 1, g.join(', '));
    assert.equal(stemEn('class'), 'class');
    assert.equal(stemEn('status'), 'status');
  });
});

describe('разбор текста', () => {
  test('служебные слова отбрасываются, важные остаются', () => {
    const keys = tokenize('Сегодня я очень хочу начать учить нейросети и это важно').filter(Boolean).map((t) => t!.form);
    assert.deepEqual(keys, ['начать', 'учить', 'нейросети']);
    assert.ok(isStopWord('Сегодня'));
    assert.ok(isStopWord('ЕЩЁ'));
    assert.ok(!isStopWord('вес'));
  });

  test('«весь» — служебное, а «вес» — нет, хотя основа почти одна', () => {
    assert.equal(termKey('весь'), null);
    assert.equal(termKey('вес'), 'вес');
  });

  test('аббревиатуры из двух букв сохраняются', () => {
    assert.equal(termKey('ИИ'), 'ии');
    assert.equal(termKey('AI'), 'ai');
    assert.equal(termKey('ETF'), 'etf');
    assert.equal(termKey('ок'), null);
    assert.equal(termKey('ab'), null);
  });

  test('ссылки, почта, числа и разметка не становятся терминами', () => {
    const forms = tokenize('Смотри **проект** https://example.com/привычки и mail@site.ru, 2024 год, [[Бюджет]] `код`')
      .filter(Boolean)
      .map((t) => t!.form);
    assert.deepEqual(forms, ['смотри', 'проект', 'Бюджет', 'код']);
  });

  test('показ: «ё» сохраняется, имена собственные посреди предложения — с заглавной', () => {
    const forms = tokenize('Лёгкий бег по набережной. Лететь в Стамбул через React').map((t) => t?.form ?? null).filter(Boolean);
    assert.deepEqual(forms, ['лёгкий', 'бег', 'набережной', 'лететь', 'Стамбул', 'React']);
    assert.equal(termKey('Лёгкий'), termKey('легкий'));
  });

  test('«ё» и «е» — одно и то же', () => {
    assert.equal(termKey('ёлка'), termKey('елка'));
    assert.equal(termKey('Самолёт'), termKey('самолет'));
  });
});

describe('признаки заметки', () => {
  test('слова заголовка весят больше', () => {
    const f = extractFeatures({ title: 'Бюджет', text: 'бюджет и расходы' });
    assert.equal(f.terms[termKey('бюджет')!], 4);
    assert.equal(f.terms[termKey('расходы')!], 1);
  });

  test('словосочетания строятся из соседних слов, но не через служебные слова и переносы строк', () => {
    const f = extractFeatures({ title: '', text: 'подушка безопасности\nплан по инвестициям\nбизнес-план' });
    const keys = Object.keys(f.terms).filter((k) => k.includes(' '));
    assert.deepEqual(keys.sort(), [`${termKey('бизнес')} ${termKey('план')}`, `${termKey('подушка')} ${termKey('безопасности')}`].sort());
  });

  test('форма для показа — самая частая в заметке', () => {
    const f = extractFeatures({ title: '', text: 'привычки, привычки, привычка' });
    assert.equal(f.forms[termKey('привычка')!], 'привычки');
  });

  test('ключ названия — для 1–2 значимых слов', () => {
    assert.equal(extractFeatures({ title: 'Атомные привычки', text: '' }).titleKey, `${termKey('атомные')} ${termKey('привычки')}`);
    assert.equal(extractFeatures({ title: 'Бюджет', text: '' }).titleKey, termKey('бюджет'));
    assert.equal(extractFeatures({ title: 'План тренировок к полумарафону', text: '' }).titleKey, undefined);
    assert.equal(extractFeatures({ title: 'Это всё', text: '' }).titleKey, undefined);
  });

  test('огромная заметка — в кэше не больше 400 терминов', () => {
    const text = Array.from({ length: 3000 }, (_, i) => 'слово' + String.fromCharCode(1072 + (i % 32)) + String.fromCharCode(1072 + Math.floor(i / 32) % 32) + 'ка').join(' ');
    assert.ok(Object.keys(extractFeatures({ title: '', text }).terms).length <= 400);
  });

  test('пустая заметка и заметка из одних служебных слов — без терминов', () => {
    assert.deepEqual(extractFeatures({ title: '', text: '' }).terms, {});
    assert.deepEqual(extractFeatures({ title: 'Это', text: 'ну да, это всё так и есть' }).terms, {});
  });
});

describe('связи на «живых» заметках', () => {
  const ix = index(CORPUS);
  const topic = new Map(CORPUS.map((f) => [f.id, f.topic]));

  test('ни одной связи между разными темами', () => {
    for (const f of CORPUS)
      for (const r of relatedTo(ix, f.id)) assert.equal(topic.get(r.id), f.topic, `${f.id} → ${r.id} (${r.score.toFixed(3)}: ${r.terms.join(', ')})`);
  });

  test('ожидаемые пары внутри тем связаны', () => {
    const pairs = [
      ['fin-budget', 'fin-cushion'],
      ['fin-etf', 'fin-broker'],
      ['fin-budget', 'fin-broker'],
      ['run-plan', 'run-log'],
      ['run-plan', 'run-shoes'],
      ['run-log', 'run-sleep'],
      ['dev-hooks', 'dev-ts'],
      ['trip-plan', 'trip-food'],
      ['trip-plan', 'trip-pack'],
      ['book-atomic', 'habit-tracker'],
    ];
    for (const [a, b] of pairs) assert.ok(ids(ix, a).includes(b), `${a} ↔ ${b}: ${JSON.stringify(relatedTo(ix, a, { min: 0 }).find((r) => r.id === b))}`);
  });

  test('у большинства заметок из тем есть связь, и самая сильная — своя тема', () => {
    const themed = CORPUS.filter((f) => !f.topic.startsWith('solo'));
    const linked = themed.filter((f) => relatedTo(ix, f.id).length > 0);
    assert.ok(linked.length / themed.length >= 0.85, `связаны ${linked.length} из ${themed.length}`);
  });

  test('одиночные и пустые заметки ни с чем не связаны', () => {
    for (const id of ['solo-shop', 'solo-gift', 'solo-empty']) assert.deepEqual(ids(ix, id), [], id);
  });

  test('связи симметричны', () => {
    for (const f of CORPUS)
      for (const r of relatedTo(ix, f.id)) {
        const back = relatedTo(ix, r.id).find((x) => x.id === f.id);
        assert.ok(back, `${f.id} → ${r.id}, но не обратно`);
        assert.ok(Math.abs(back.score - r.score) < 1e-9);
      }
  });

  test('причина связи — общие слова в форме исходной заметки', () => {
    const r = relatedTo(ix, 'habit-tracker').find((x) => x.id === 'book-atomic')!;
    assert.ok(r.mention, 'упоминание названия книги');
    assert.ok(r.terms.includes('Атомных привычек'), r.terms.join(', '));
    const back = relatedTo(ix, 'book-atomic').find((x) => x.id === 'habit-tracker')!;
    assert.ok(back.terms.includes('атомные привычки'), back.terms.join(', '));
    const trip = relatedTo(ix, 'trip-food').find((x) => x.id === 'trip-plan')!;
    assert.ok(trip.terms.includes('Стамбуле'), trip.terms.join(', '));
  });

  test('в причинах слово не повторяется отдельно, если уже есть в словосочетании', () => {
    for (const f of CORPUS)
      for (const r of relatedTo(ix, f.id)) {
        const phrases = r.terms.filter((t) => t.includes(' '));
        for (const t of r.terms.filter((x) => !x.includes(' '))) assert.ok(!phrases.some((p) => p.split(' ').includes(t)), `${f.id}: «${t}» уже в ${phrases.join(', ')}`);
      }
  });

  test('сильнее связаны те, у кого больше общего', () => {
    const r = relatedTo(ix, 'run-plan');
    assert.equal(r[0].id, 'run-log');
    for (let i = 1; i < r.length; i++) assert.ok(r[i - 1].score >= r[i].score);
    for (const x of r) assert.ok(x.score >= MIN_SCORE && x.score <= 1);
  });

  test('ключевые слова — о теме заметки', () => {
    assert.ok(keywordsOf(ix, 'run-plan').includes('полумарафону'));
    assert.ok(keywordsOf(ix, 'trip-plan').includes('Стамбул'));
    assert.ok(keywordsOf(ix, 'dev-ts').includes('TypeScript'));
    assert.deepEqual(keywordsOf(ix, 'solo-empty'), []);
    assert.ok(keywordsOf(ix, 'fin-etf', 3).length <= 3);
  });

  test('рёбра графа: без повторов, у каждой заметки не больше perNote', () => {
    const edges = allLinks(ix, 2);
    const keys = edges.map((e) => e.a + '|' + e.b);
    assert.equal(new Set(keys).size, keys.length);
    for (const e of edges) assert.ok(e.a < e.b);
    assert.ok(edges.some((e) => e.a === 'book-atomic' && e.b === 'habit-tracker'));
  });
});

describe('особые случаи', () => {
  test('беглая гласная: «тренировок» и «тренировка» — одно слово', () => {
    const ix = index([
      { id: 'a', title: 'Пять тренировок', text: 'График тренировок на неделю, растяжка после тренировок' },
      { id: 'b', title: 'Тренировка ног', text: 'Тренировка: приседания, выпады, растяжка' },
      { id: 'c', title: 'Рецепт борща', text: 'Свёкла, капуста, картофель' },
    ]);
    const r = relatedTo(ix, 'a');
    assert.deepEqual(r.map((x) => x.id), ['b']);
    assert.ok(r[0].terms.includes('тренировок'), r[0].terms.join(', '));
  });

  test('упоминание названия другой заметки связывает даже при малом общем тексте', () => {
    const ix = index([
      { id: 'proj', title: 'Проект Сатурн', text: 'Мобильное приложение для учёта воды. Дедлайн в декабре.' },
      { id: 'meet', title: 'Встреча с Аней', text: 'Обсудили проект Сатурн и бюджет на рекламу.' },
      { id: 'other', title: 'Рецепт пирога', text: 'Мука, яйца, яблоки, корица.' },
    ]);
    const r = relatedTo(ix, 'meet');
    assert.equal(r.length, 1);
    assert.equal(r[0].id, 'proj');
    assert.ok(r[0].mention);
  });

  test('общее название из одного частого слова — не упоминание', () => {
    const docs = Array.from({ length: 12 }, (_, i) => ({ id: 'n' + i, title: i === 0 ? 'Идеи' : 'Заметка ' + i, text: `Идеи на выходные номер ${i}: ` + ['кино', 'парк', 'музей', 'каток', 'театр', 'боулинг', 'квест', 'концерт', 'выставка', 'пикник', 'сауна', 'рыбалка'][i] }));
    const ix = index(docs);
    assert.ok(relatedTo(ix, 'n0').every((r) => !r.mention));
  });

  test('одинаковые заметки связаны максимально сильно', () => {
    const t = { title: 'Медитация', text: 'Дыхание, осознанность, десять минут утром в тишине' };
    const ix = index([{ id: 'a', ...t }, { id: 'b', ...t }, { id: 'c', title: 'Ремонт', text: 'Обои, плитка, краска для стен' }]);
    assert.ok(relatedTo(ix, 'a')[0].score > 0.9);
  });

  test('одно общее неважное слово — ещё не связь', () => {
    const ix = index([
      { id: 'a', title: 'Отпуск', text: 'Поехать к морю, взять палатку и удочку' },
      { id: 'b', title: 'Работа', text: 'Отчёт для клиента, презентация, взять ноутбук' },
    ]);
    assert.deepEqual(ids(ix, 'a'), []);
  });

  test('английские заметки тоже связываются', () => {
    const ix = index([
      { id: 'a', title: 'React hooks', text: 'useEffect runs after render. Custom hooks share state logic between components.' },
      { id: 'b', title: 'Component state', text: 'Lifting state up; components re-render when state changes. Hooks keep it simple.' },
      { id: 'c', title: 'Grocery list', text: 'Apples, bread, cheese, coffee beans.' },
    ]);
    assert.deepEqual(ids(ix, 'a'), ['b']);
    assert.deepEqual(ids(ix, 'c'), []);
  });

  test('пустой индекс, неизвестная заметка, повтор id, лимит', () => {
    const empty = buildIndex([]);
    assert.equal(empty.n, 0);
    assert.deepEqual(relatedTo(empty, 'x'), []);
    const ix = buildIndex([
      { id: 'a', f: extractFeatures({ title: 'Кофе', text: 'зерно обжарка помол' }) },
      { id: 'a', f: extractFeatures({ title: 'Чай', text: 'улун пуэр' }) },
      { id: 'b', f: extractFeatures({ title: '', text: '' }) },
    ]);
    assert.equal(ix.n, 1);
    assert.deepEqual(relatedTo(ix, 'b'), []);
    const big = index(CORPUS);
    assert.ok(relatedTo(big, 'run-plan', { limit: 1 }).length === 1);
  });
});

describe('скорость', () => {
  // псевдослучайный генератор — тест воспроизводим
  let seed = 42;
  const rnd = () => {
    // mulberry32
    let t = (seed = (seed + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const syll = ['ка', 'ро', 'ми', 'ла', 'то', 'не', 'су', 'да', 'ве', 'по', 'зи', 'бу', 'ре', 'го', 'ша', 'лю'];
  const vocab = Array.from({ length: 4000 }, () => Array.from({ length: 2 + Math.floor(rnd() * 3) }, () => syll[Math.floor(rnd() * syll.length)]).join('') + 'н');
  // закон Ципфа: частые слова встречаются гораздо чаще редких
  const word = () => vocab[Math.min(vocab.length - 1, Math.floor(Math.exp(rnd() * Math.log(vocab.length))))];
  const docs = Array.from({ length: 2000 }, (_, i) => ({
    id: 'n' + i,
    title: `${word()} ${word()}`,
    text: Array.from({ length: 30 + Math.floor(rnd() * 300) }, word).join(' '),
  }));

  test('2000 заметок: признаки, индекс и связи для каждой — быстро', () => {
    let t = performance.now();
    const feats = docs.map((d) => ({ id: d.id, f: extractFeatures(d) }));
    const tFeat = performance.now() - t;
    t = performance.now();
    const ix = buildIndex(feats);
    const tBuild = performance.now() - t;
    t = performance.now();
    for (let i = 0; i < 200; i++) relatedTo(ix, 'n' + i * 10, { limit: 8 });
    const tRel = (performance.now() - t) / 200;
    console.log(`  признаки: ${tFeat.toFixed(0)} мс, индекс: ${tBuild.toFixed(0)} мс, связи одной заметки: ${tRel.toFixed(2)} мс`);
    // пороги с запасом — ловят квадратичный рост, а не загрузку машины.
    // Обычно: признаки ~1–2 с (считаются один раз и кэшируются), индекс ~0,5–1 с, связи ~15 мс
    assert.ok(tFeat < 10000, `признаки ${tFeat} мс`);
    assert.ok(tBuild < 4000, `индекс ${tBuild} мс`);
    assert.ok(tRel < 60, `связи ${tRel} мс`);
  });
});
