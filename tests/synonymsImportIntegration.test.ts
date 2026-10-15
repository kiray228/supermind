/**
 * Синонимы и импорт из Obsidian поверх настоящих хранилищ (fake-indexeddb, ИИ — заглушка).
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import './fixtures/appHooks.ts';
import JSZip from 'jszip';

// FileReader — только то, что нужно для картинок svg
(globalThis as Record<string, unknown>).FileReader ??= class {
  result: string | null = null;
  error: unknown = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readAsDataURL(b: Blob) {
    void b.arrayBuffer().then((buf) => {
      this.result = `data:${b.type};base64,` + Buffer.from(buf).toString('base64');
      this.onload?.();
    });
  }
};

const notes = await import('../src/notes/store.ts');
const model = await import('../src/notes/model.ts');
const rel = await import('../src/notes/related.ts');
const links = await import('../src/notes/links.ts');
const syn = await import('../src/notes/synonyms.ts');
const imp = await import('../src/notes/obsidianImportRun.ts');
const ai = await import('./fixtures/aiStub.ts');

const ids: Record<string, string> = {};
async function note(title: string, text: string) {
  const m = notes.createNote({ title, blocks: model.markdownToBlocks(text) })!;
  await notes.flushNotes();
  return m.id;
}
const data = () => notes.useNotes.getState().data!;
const related = async (id: string) => links.relatedTo(await rel.ensureLinkIndex(), id).map((r) => r.id);

before(async () => {
  await notes.ensureNotes();
  ids.morning = await note('Утро', 'Бег по утрам в парке. Бег медленный, бег для здоровья, полчаса по парку.');
  ids.evening = await note('Вечер', 'Пробежка вечером в парке. Пробежка лёгкая, пробежка перед сном, круг по парку.');
  ids.pie = await note('Пирог', 'Пирог с яблоками: мука, сахар, яйца, корица. Печь сорок минут.');
  ids.shop = await note('Покупки', 'Купить муку, сахар, яйца и яблоки для пирога к выходным.');
  ids.car = await note('Машина', 'Машина в сервисе: замена масла, шины, тормоза. Машина нужна к пятнице.');
  ids.auto = await note('Автомобиль', 'Автомобиль после ремонта: проверить тормоза, давление в шинах.');
  for (let i = 0; i < 6; i++) await note('Разное ' + i, `Заметка номер ${i}: книги, кино, музыка, путешествия, работа, отдых ${i}.`);
  await rel.ensureLinkIndex();
});

describe('синонимы в приложении', () => {
  test('ИИ получает словарь записей, группы сохраняются, связи появляются', async () => {
    assert.ok(!(await related(ids.morning)).includes(ids.evening));
    ai.aiAnswers.push('```json\n[["бег","пробежка","спорт"],["машина","автомобиль"],["пирог"]]\n```');
    const n = await syn.findSynonyms();
    const req = ai.aiRequests.at(-1)!;
    assert.ok(req.system.includes('СИНОНИМ'));
    assert.ok(/Словарь:\n.*бег/.test(req.messages[0].content), req.messages[0].content.slice(0, 200));
    assert.equal(n, 4, 'слова не из словаря («спорт») и группы из одного слова — не добавляются');
    const g = data().synonyms!;
    assert.equal(g.length, 2);
    assert.ok(g.every((x) => x.by === 'ai'));
    assert.ok((await related(ids.morning)).includes(ids.evening));
    // поиск: «бег» находит «пробежку»
    const hits = links.searchIndex(await rel.ensureLinkIndex(), 'бег').map((h) => h.id);
    assert.ok(hits.includes(ids.evening), hits.join(', '));
  });

  test('повторный поиск: те же группы не дублируются', async () => {
    ai.aiAnswers.push('[["бег","пробежка"],["автомобиль","машина"]]');
    assert.equal(await syn.findSynonyms(), 0);
    assert.equal(data().synonyms!.length, 2);
  });

  test('убрать слово — связь пропадает, ИИ его больше не вернёт', async () => {
    const g = data().synonyms!.find((x) => x.words.includes('бег'))!;
    syn.removeSynonymWord(g.id, 'пробежка');
    assert.equal(data().synonyms!.some((x) => x.id === g.id), false, 'группа из одного слова удаляется');
    assert.ok(data().gone![`synonym:${g.id}`]);
    assert.equal(data().synNo!.length, 1);
    assert.ok(!(await related(ids.morning)).includes(ids.evening));
    ai.aiAnswers.push('[["бег","пробежка"]]');
    assert.equal(await syn.findSynonyms(), 0);
  });

  test('своя группа снимает запрет и сливает группы', async () => {
    const w = syn.addSynonymGroup('бег = пробежка, джоггинг');
    assert.deepEqual(w, ['бег', 'пробежка', 'джоггинг']);
    assert.equal(data().synNo!.length, 0);
    const mine = data().synonyms!.find((x) => x.by === 'user')!;
    assert.ok(mine);
    assert.ok((await related(ids.morning)).includes(ids.evening));
    assert.equal(syn.addSynonymGroup('бег'), null);
    // слово из группы ИИ — сливает
    const car = data().synonyms!.find((x) => x.words.includes('машина'))!;
    syn.addSynonymGroup('авто, машина');
    const merged = data().synonyms!.find((x) => x.id === car.id)!;
    assert.deepEqual(merged.words.sort(), ['авто', 'автомобиль', 'машина']);
    assert.equal(merged.by, 'user');
  });

  test('удалить группу целиком — все её пары запоминаются', async () => {
    const g = data().synonyms!.find((x) => x.words.includes('бег'))!;
    syn.removeSynonymGroup(g.id);
    assert.equal(data().synNo!.length, 3);
    assert.ok(!(await related(ids.morning)).includes(ids.evening));
  });

  test('мало слов и ошибка ИИ — понятные ошибки, данные не меняются', async () => {
    const before = JSON.stringify(data().synonyms);
    ai.aiAnswers.push(new ai.AIError('Нет сети'));
    await assert.rejects(syn.findSynonyms(), /Нет сети/);
    ai.aiAnswers.push('не JSON');
    assert.equal(await syn.findSynonyms(), 0);
    assert.equal(JSON.stringify(data().synonyms), before);
  });

  test('синонимы переживают нормализацию (как после синхронизации)', async () => {
    await notes.flushNotes();
    const d = data();
    assert.ok(Array.isArray(d.synonyms) && Array.isArray(d.synNo));
  });
});

describe('импорт из Obsidian', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>';
  async function vault() {
    const z = new JSZip();
    z.file('Мой vault/.obsidian/app.json', '{}');
    z.file('Мой vault/Входящие.md', '---\ntitle: Входящие мысли\ncreated: 2023-03-01\ntags: [идеи]\n---\nСм. [[2023 план|план]] и ![[схема.svg]]\n> [!tip] Совет\n> записывать сразу');
    z.file('Мой vault/Работа/2023 план.md', '---\ntitle: План на год\n---\n# Цели\n- [ ] выучить TypeScript\n- [x] сменить работу');
    z.file('Мой vault/Работа/Проекты/Сайт.md', 'Сайт на React. ![[нет такой.png]]');
    z.file('Мой vault/attachments/схема.svg', svg);
    z.file('Мой vault/.trash/Старое.md', 'удалено');
    const buf = await z.generateAsync({ type: 'uint8array' });
    return new File([buf], 'vault.zip', { type: 'application/zip' });
  }
  const byTitle = (t: string) => data().notes.find((n) => n.title === t && !n.trashed);

  test('архив: заметки, папки, даты, ссылки, картинки, выноски, теги', async () => {
    const r = await imp.importObsidian([await vault()]);
    assert.deepEqual(r, { created: 3, skipped: 0, folders: 2, images: 1 });
    const inbox = byTitle('Входящие мысли')!;
    assert.equal(inbox.createdAt, new Date(2023, 2, 1).getTime());
    assert.equal(inbox.folderId, undefined);
    const body = await notes.loadNoteBody(inbox.id);
    assert.equal(body.blocks[0].text, 'См. [[План на год|план]] и');
    assert.equal(body.blocks[1].type, 'image');
    assert.ok(body.blocks[1].src!.startsWith('data:image/svg+xml;base64,'));
    assert.deepEqual([body.blocks[2].type, body.blocks[2].text], ['callout', 'Совет\nзаписывать сразу']);
    assert.equal(body.blocks.at(-1)!.text, '#идеи');
    const plan = byTitle('План на год')!;
    const site = byTitle('Сайт')!;
    const folders = new Map(data().folders.map((f) => [f.id, f.name]));
    assert.equal(folders.get(plan.folderId!), 'Работа');
    assert.equal(folders.get(site.folderId!), 'Работа / Проекты');
    const sb = await notes.loadNoteBody(site.id);
    assert.equal(sb.blocks.at(-1)!.text, '*[Изображение: нет такой.png]*');
    assert.ok(!byTitle('Старое'));
    // [[ссылка]] работает: заметки связаны явной ссылкой
    assert.ok(rel.isWikiLink(inbox.id, plan.id) || (await related(inbox.id)).includes(plan.id));
  });

  test('повторный импорт — копий нет, папки не дублируются', async () => {
    const n = data().notes.length;
    const f = data().folders.length;
    const r = await imp.importObsidian([await vault()]);
    assert.deepEqual(r, { created: 0, skipped: 3, folders: 0, images: 0 });
    assert.equal(data().notes.length, n);
    assert.equal(data().folders.length, f);
  });

  test('отдельные .md файлы и пустой выбор', async () => {
    const r = await imp.importObsidian([new File(['Просто [[Утро]] и бег'], 'Одиночка.md', { type: 'text/markdown' })]);
    assert.equal(r.created, 1);
    assert.ok(byTitle('Одиночка'));
    await assert.rejects(imp.importObsidian([new File(['x'], 'a.txt')]), /Заметок не нашлось/);
    await assert.rejects(imp.importObsidian([new File(['not zip'], 'bad.zip')]), /Не удалось открыть архив/);
  });
});
