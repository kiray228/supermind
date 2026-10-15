import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import './tsResolve.ts';
import { CORPUS } from './fixtures/corpus.ts';
import type { SynonymGroup } from '../src/notes/model.ts';

const { buildIndex, extractFeatures, relatedTo, searchIndex, synonymMap, termKey, vocabulary, buildMentionIndex, findMentions } = await import('../src/notes/links.ts');
const { parseSynonymGroups, parseManualGroup, mergeAiGroups, withoutWord, groupPairs, addManualGroup, synPair, buildSynonymPrompt, SYN_SYSTEM } = await import('../src/notes/synonymsCore.ts');

const K = (w: string) => termKey(w)!;
const keys = (...ws: string[]) => ws.map(K);
let n = 0;
const newId = () => 'g' + ++n;

describe('карта синонимов', () => {
  test('слово группы → по алфавиту первое; группы с общим словом сливаются', () => {
    const m = synonymMap([
      ['б', 'в'],
      ['в', 'а'],
      ['д', 'г'],
    ]);
    assert.equal(m.get('б'), 'а');
    assert.equal(m.get('в'), 'а');
    assert.equal(m.has('а'), false, 'главное слово не отображается');
    assert.equal(m.get('д'), 'г');
  });

  test('не зависит от порядка групп и слов', () => {
    const a = synonymMap([['к', 'м'], ['м', 'л'], ['н', 'к']]);
    const b = synonymMap([['л', 'м'], ['к', 'н'], ['м', 'к']]);
    assert.deepEqual([...a].sort(), [...b].sort());
    assert.ok([...a.values()].every((v) => v === 'к'));
  });

  test('пустые, из одного слова и словосочетания — пропускаются', () => {
    assert.equal(synonymMap([[], ['а'], ['а', 'а'], ['а', 'б в']]).size, 0);
  });

  test('длинная цепочка — все к одному', () => {
    const groups = Array.from({ length: 200 }, (_, i) => ['w' + String(i).padStart(3, '0'), 'w' + String(i + 1).padStart(3, '0')]);
    const m = synonymMap(groups);
    assert.equal(m.size, 200);
    assert.ok([...m.values()].every((v) => v === 'w000'));
  });
});

describe('синонимы в связях и поиске', () => {
  const items = [
    { id: 'a', title: 'Утро', text: 'Бег по утрам в парке. Бег медленный, бег для здоровья, полчаса по парку.' },
    { id: 'b', title: 'Вечер', text: 'Пробежка вечером в парке. Пробежка лёгкая, пробежка перед сном, круг по парку.' },
    { id: 'c', title: 'Рецепт', text: 'Пирог с яблоками: мука, сахар, яйца, корица. Печь сорок минут.' },
    { id: 'd', title: 'Покупки', text: 'Купить муку, сахар, яйца и яблоки для пирога к выходным.' },
  ];
  const docs = items.map((f) => ({ id: f.id, f: extractFeatures(f) }));
  const plain = buildIndex(docs);
  const syn = buildIndex(docs, { synonyms: [keys('бег', 'пробежка')] });

  test('без синонимов «бег» и «пробежка» не связаны, с ними — связаны', () => {
    assert.ok(!relatedTo(plain, 'a').some((r) => r.id === 'b'));
    const r = relatedTo(syn, 'a').find((x) => x.id === 'b');
    assert.ok(r, JSON.stringify(relatedTo(syn, 'a')));
  });

  test('общее слово показывается так, как написано в заметке', () => {
    const fromA = relatedTo(syn, 'a').find((x) => x.id === 'b')!;
    const fromB = relatedTo(syn, 'b').find((x) => x.id === 'a')!;
    // у каждой заметки — её собственное слово
    assert.ok(fromA.terms.some((t) => /^бег$/i.test(t)), fromA.terms.join(', '));
    assert.ok(fromB.terms.some((t) => /^пробежка$/i.test(t)), fromB.terms.join(', '));
    assert.ok(!fromB.terms.some((t) => /^бег$/i.test(t)), fromB.terms.join(', '));
  });

  test('прочие связи не меняются', () => {
    const a = relatedTo(plain, 'c').map((r) => r.id);
    const b = relatedTo(syn, 'c').map((r) => r.id);
    assert.deepEqual(a, b);
  });

  test('поиск по «бег» находит записи с «пробежка»', () => {
    assert.deepEqual(searchIndex(plain, 'бег').map((h) => h.id), ['a']);
    assert.deepEqual(searchIndex(syn, 'бег').map((h) => h.id).sort(), ['a', 'b']);
    assert.deepEqual(searchIndex(syn, 'пробежки').map((h) => h.id).sort(), ['a', 'b']);
  });

  test('упоминания названий сравнивают буквально (canonLex — без синонимов)', () => {
    assert.equal(syn.canonLex(K('пробежка')), K('пробежка'));
    assert.notEqual(syn.canon(K('пробежка')), syn.canon(K('пирог')));
    assert.equal(syn.canon(K('пробежка')), syn.canon(K('бег')));
    const mi = buildMentionIndex([{ id: 'x', title: 'Пробежка' }], { canon: syn.canonLex, isRare: () => true });
    assert.equal(findMentions('Утренний бег у реки', mi).length, 0);
    assert.equal(findMentions('Вечерняя пробежка у реки', mi).length, 1);
  });

  test('синонимы в корпусе: «бег» как синоним «пробежки» не ломает темы', () => {
    const cdocs = CORPUS.map((f) => ({ id: f.id, f: extractFeatures(f) }));
    const ix = buildIndex(cdocs, { synonyms: [keys('бег', 'пробежка')] });
    for (const f of CORPUS) {
      const rel = relatedTo(ix, f.id);
      const same = rel.filter((r) => CORPUS.find((x) => x.id === r.id)!.topic === f.topic).length;
      assert.ok(rel.length === 0 || same / rel.length >= 0.5, f.id + ': ' + rel.map((r) => r.id).join(', '));
    }
  });
});

describe('словарь для ИИ', () => {
  const ix = buildIndex(CORPUS.map((f) => ({ id: f.id, f: extractFeatures(f) })));
  test('главные слова, в форме из записей, без словосочетаний, по убыванию веса', () => {
    const v = vocabulary(ix, 50);
    assert.equal(v.length, 50);
    assert.ok(v.every((x) => !x.key.includes(' ') && x.form && !x.form.includes(' ')), v.map((x) => x.form).join(', '));
    for (let i = 1; i < v.length; i++) assert.ok(v[i - 1].weight >= v[i].weight);
    assert.ok(v.some((x) => /пробеж/i.test(x.form)), v.map((x) => x.form).join(', '));
    assert.equal(new Set(v.map((x) => x.key)).size, v.length);
  });

  test('лимит и пустой индекс', () => {
    assert.equal(vocabulary(ix, 3).length, 3);
    assert.deepEqual(vocabulary(buildIndex([])), []);
  });

  test('запрос к ИИ: словарь через запятую, правила — в системном', () => {
    assert.equal(buildSynonymPrompt(['бег', 'пробежка']), 'Словарь:\nбег, пробежка');
    assert.ok(SYN_SYSTEM.includes('JSON'));
  });
});

describe('ответ ИИ', () => {
  const dict = ['бег', 'пробежка', 'Доход', 'заработок', 'машина', 'автомобиль', 'авто', 'кроссовки', 'пробежки'];

  test('JSON — в ```json, с текстом вокруг; написание — как в словаре', () => {
    const g = parseSynonymGroups('Вот:\n```json\n[["Бег","пробежка"],["доход","Заработок"]]\n```\nГотово', dict, termKey);
    assert.deepEqual(g, [
      ['бег', 'пробежка'],
      ['Доход', 'заработок'],
    ]);
  });

  test('слов не из словаря нет; слово — в одной группе; формы одного слова — не синонимы', () => {
    const g = parseSynonymGroups('[["бег","спорт","пробежка"],["пробежка","бег"],["пробежка","пробежки"],["машина","автомобиль","авто"]]', dict, termKey);
    assert.deepEqual(g, [
      ['бег', 'пробежка'],
      ['машина', 'автомобиль', 'авто'],
    ]);
  });

  test('мусор, пустой массив, не массив, группы из одного слова', () => {
    assert.deepEqual(parseSynonymGroups('не знаю', dict), []);
    assert.deepEqual(parseSynonymGroups('[]', dict), []);
    assert.deepEqual(parseSynonymGroups('{"a":1}', dict), []);
    assert.deepEqual(parseSynonymGroups('[["бег"], "x", [1, 2], ["кроссовки", 5]]', dict), []);
    assert.deepEqual(parseSynonymGroups('[["бег", "пробежка"', dict), []);
  });

  test('в группе не больше шести слов', () => {
    const many = Array.from({ length: 10 }, (_, i) => 'слово' + i);
    const g = parseSynonymGroups(JSON.stringify([many]), many);
    assert.equal(g[0].length, 6);
  });
});

describe('своя группа', () => {
  test('разделители: =, запятые, тире, пробелы, переносы; кавычки снимаются; повторы — нет', () => {
    assert.deepEqual(parseManualGroup('бег = пробежка, забег'), ['бег', 'пробежка', 'забег']);
    assert.deepEqual(parseManualGroup('«машина» — авто; Авто\nавтомобиль'), ['машина', 'авто', 'автомобиль']);
    assert.deepEqual(parseManualGroup('бег - пробежка'), ['бег', 'пробежка']);
    assert.deepEqual(parseManualGroup('кто-то = некто'), ['кто-то', 'некто']);
    assert.deepEqual(parseManualGroup('   '), []);
    assert.equal(parseManualGroup(Array.from({ length: 12 }, (_, i) => 'с' + i).join(' ')).length, 8);
  });
});

describe('изменение групп', () => {
  const g = (words: string[], by: 'ai' | 'user' = 'ai', id = newId()): SynonymGroup => ({ id, words, by, updatedAt: 1 });

  test('новые группы от ИИ добавляются', () => {
    const r = mergeAiGroups([], [['бег', 'пробежка'], ['доход', 'заработок']], new Set(), termKey, 5, newId);
    assert.equal(r.groups.length, 2);
    assert.equal(r.added, 4);
    assert.ok(r.groups.every((x) => x.by === 'ai' && x.updatedAt === 5));
  });

  test('общее слово с имеющейся группой — дополняет её, повторов нет', () => {
    const had = [g(['бег', 'пробежка'], 'user', 'u1')];
    const r = mergeAiGroups(had, [['пробежки', 'забег', 'бег']], new Set(), termKey, 9, newId);
    assert.equal(r.groups.length, 1);
    assert.deepEqual(r.groups[0].words, ['бег', 'пробежка', 'забег']);
    assert.equal(r.groups[0].by, 'user', 'автор группы не меняется');
    assert.equal(r.groups[0].updatedAt, 9);
    assert.equal(r.added, 1);
    assert.deepEqual(had[0].words, ['бег', 'пробежка'], 'исходный список не меняется');
  });

  test('ничего нового — группа не трогается', () => {
    const had = [g(['бег', 'пробежка'])];
    const r = mergeAiGroups(had, [['пробежка', 'бег']], new Set(), termKey, 9, newId);
    assert.equal(r.added, 0);
    assert.equal(r.groups[0].updatedAt, 1);
  });

  test('пары, убранные человеком, не возвращаются', () => {
    const no = new Set([synPair(K('бег'), K('забег'))]);
    const r = mergeAiGroups([], [['бег', 'забег', 'пробежка']], no, termKey, 1, newId);
    assert.deepEqual(r.groups[0].words, ['бег', 'пробежка']);
    const r2 = mergeAiGroups([], [['бег', 'забег']], no, termKey, 1, newId);
    assert.equal(r2.groups.length, 0);
    const r3 = mergeAiGroups([g(['бег', 'пробежка'])], [['пробежка', 'забег']], no, termKey, 1, newId);
    assert.deepEqual(r3.groups[0].words, ['бег', 'пробежка'], 'забег убран человеком из пары с «бег» — в группу с ним не попадает');
  });

  test('убрать слово: пары с остальными запоминаются; из двух слов группа исчезает', () => {
    const grp = g(['бег', 'пробежка', 'забег']);
    const r = withoutWord(grp, 'забег', termKey, 7);
    assert.deepEqual(r.group!.words, ['бег', 'пробежка']);
    assert.deepEqual(r.rejected.sort(), [synPair(K('забег'), K('бег')), synPair(K('забег'), K('пробежка'))].sort());
    const r2 = withoutWord(r.group!, 'бег', termKey, 8);
    assert.equal(r2.group, null);
    assert.deepEqual(r2.rejected, [synPair(K('бег'), K('пробежка'))]);
  });

  test('все пары группы — без повторов', () => {
    assert.equal(groupPairs(['бег', 'пробежка', 'забег'], termKey).length, 3);
    assert.equal(groupPairs(['бег', 'Бег'], termKey).length, 0);
  });

  test('своя группа: новая; со словами из других групп — сливает их в одну', () => {
    const a = g(['бег', 'пробежка'], 'ai', 'A');
    const b = g(['забег', 'кросс'], 'ai', 'B');
    const c = g(['доход', 'заработок'], 'ai', 'C');
    const r = addManualGroup([a, b, c], ['пробежки', 'забег', 'джоггинг'], termKey, 3, newId)!;
    assert.deepEqual(r.removed, ['B']);
    const m = r.groups.find((x) => x.id === 'A')!;
    assert.equal(m.by, 'user');
    assert.deepEqual(m.words.sort(), ['бег', 'джоггинг', 'забег', 'кросс', 'пробежки'].sort());
    assert.ok(r.groups.some((x) => x.id === 'C'));
    assert.equal(r.groups.length, 2);
    assert.equal(r.allowed.length, 3);
    assert.equal(addManualGroup([], ['бег', 'Бег'], termKey, 1, newId), null);
    assert.equal(addManualGroup([], ['и', 'бег'], termKey, 1, newId), null, 'служебные слова не в счёт');
    const fresh = addManualGroup([], ['машина', 'авто'], termKey, 1, () => 'NEW')!;
    assert.deepEqual(fresh.groups, [{ id: 'NEW', words: ['машина', 'авто'], by: 'user', updatedAt: 1 }]);
  });
});
