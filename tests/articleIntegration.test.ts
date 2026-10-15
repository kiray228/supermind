/**
 * Статья по ссылке (через сервер), карточки по теме и утреннее уведомление со сводкой из мозга —
 * поверх настоящих хранилищ (fake-indexeddb, ИИ и сервер — заглушки).
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import './fixtures/appHooks.ts';
import { CORPUS } from './fixtures/corpus.ts';

const notes = await import('../src/notes/store.ts');
const model = await import('../src/notes/model.ts');
const tasks = await import('../src/tasks/store.ts');
const cloud = await import('../src/store/cloud.ts');
const article = await import('../src/notes/article.ts');
const digest = await import('../src/notes/digest.ts');
const cards = await import('../src/notes/cards.ts');
const rel = await import('../src/notes/related.ts');
const sync = await import('../src/tasks/sync.ts');
const { todayYmd } = await import('../src/utils/mapTasks.ts');
const ai = await import('./fixtures/aiStub.ts');

const ids: Record<string, string> = {};
const data = () => notes.useNotes.getState().data!;
const lines = async (id: string) => (await notes.loadNoteBody(id)).blocks.map((b) => `${b.type}:${b.text ?? ''}`);

// «сервер»: /web/page отдаёт страницу в windows-1251
const cp1251 = (s: string) => {
  const map = 'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмнопрстуфхцчшщъыьэюя';
  return Uint8Array.from([...s].map((c) => (map.includes(c) ? 0xc0 + map.indexOf(c) : c === 'ё' ? 0xb8 : c === 'Ё' ? 0xa8 : c.charCodeAt(0) < 128 ? c.charCodeAt(0) : 0x3f)));
};
const ARTICLE_HTML = `<html><head><title>Интервалы для начинающих</title><meta property="og:site_name" content="Беговой журнал"></head><body><article>
<p>Интервальные тренировки помогают быстрее улучшить выносливость, если делать их раз в неделю и не чаще.</p>
<p>Начинайте с коротких отрезков по четыреста метров и полного восстановления между ними трусцой.</p>
<p>Длинная пробежка в выходные остаётся основой подготовки к полумарафону и марафону.</p>
</article></body></html>`;
const served: string[] = [];
let serverDown = false;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.endsWith('/web/page')) {
    const { url: page } = JSON.parse(String(init?.body));
    served.push(page);
    if (serverDown) return new Response(JSON.stringify({ error: 'Сайт не ответил' }), { status: 502 });
    return new Response(JSON.stringify({ url: page, contentType: 'text/html; charset=windows-1251', base64: Buffer.from(cp1251(ARTICLE_HTML)).toString('base64') }), { status: 200 });
  }
  return realFetch(input, init);
}) as typeof fetch;

before(async () => {
  await notes.ensureNotes();
  await tasks.ensureTasks();
  for (const f of CORPUS) ids[f.id] = notes.createNote({ title: f.title, blocks: model.markdownToBlocks(f.text) })!.id;
  await notes.flushNotes();
});

describe('статья по ссылке', () => {
  test('без входа в аккаунт — понятная ошибка', async () => {
    await assert.rejects(article.saveArticle('https://run.test/intervals'), /Войдите в аккаунт/);
  });

  test('страница (windows-1251) → главное от ИИ → заметка со ссылкой на источник', async () => {
    cloud.useCloud.setState({ account: { token: 't', user: { id: 'u', email: 'a@b.cd', name: 'A' } } as never });
    ai.aiAnswers.push('Статья о том, как начать интервальные тренировки.\n\n## Главные мысли\n- Интервалы — раз в неделю\n- Отрезки по 400 м');
    const stages: string[] = [];
    const r = await article.saveArticle('https://run.test/intervals', { onStage: (s) => stages.push(s) });
    assert.deepEqual(stages, ['fetch', 'summary', 'save']);
    assert.ok(r.summary);
    assert.deepEqual(served, ['https://run.test/intervals']);
    const meta = data().notes.find((n) => n.id === r.id)!;
    assert.equal(meta.title, 'Интервалы для начинающих');
    assert.equal(meta.source, 'https://run.test/intervals');
    const l = await lines(r.id);
    assert.equal(l[0], 'p:Источник: [Беговой журнал](https://run.test/intervals)');
    assert.ok(l.includes('h2:Главные мысли') && l.includes('bullet:Интервалы — раз в неделю'));
    // ИИ получил текст статьи в правильной кодировке
    assert.ok(ai.aiRequests.at(-1)!.messages[0].content.includes('Интервальные тренировки помогают'));
    // статья встаёт в граф: связана с заметками о беге
    const ix = await rel.ensureLinkIndex();
    const { relatedTo } = await import('../src/notes/links.ts');
    assert.ok(
      relatedTo(ix, r.id).some((x) => CORPUS.some((f) => ids[f.id] === x.id && f.id.startsWith('run-'))),
      JSON.stringify(relatedTo(ix, r.id)),
    );
  });

  test('та же статья второй раз — находится сохранённая (с www и без, с хвостом)', () => {
    const id = article.savedArticle('https://www.run.test/intervals/?utm=1');
    assert.equal(data().notes.find((n) => n.id === id)?.title, 'Интервалы для начинающих');
    assert.equal(article.savedArticle('https://run.test/other'), undefined);
  });

  test('ИИ недоступен — сохраняется без пересказа: начало статьи', async () => {
    ai.aiAnswers.push(new ai.AIError('Нет сети'));
    const r = await article.saveArticle('https://run.test/no-ai');
    assert.equal(r.summary, false);
    const l = await lines(r.id);
    assert.ok(l.includes('h2:Начало статьи'));
    assert.ok(l.some((x) => x.includes('Интервальные тренировки помогают')));
  });

  test('сайт не открылся — ошибка с текстом сервера, заметки нет', async () => {
    serverDown = true;
    const n = data().notes.length;
    await assert.rejects(article.saveArticle('https://run.test/down'), /Сайт не ответил/);
    assert.equal(data().notes.length, n);
    serverDown = false;
  });
});

describe('карточки по теме', () => {
  test('конспект сохраняется заметкой, из него — карточки', async () => {
    const topics = await digest.brainTopics();
    const t = topics[0];
    ai.aiAnswers.push('## Главное\n- Интервалы раз в неделю [1].\n- Длинная пробежка по выходным [2]. Подушка — шесть месяцев расходов, держать на счёте.');
    digest.openDigest(t.name, t.ids);
    for (let i = 0; i < 100 && digest.useDigest.getState().state !== 'done'; i++) await new Promise((r) => setTimeout(r, 10));
    ai.aiAnswers.push('[{"q":"Как часто интервалы?","a":"Раз в неделю"},{"q":"Когда длинная пробежка?","a":"По выходным"}]');
    const r = (await digest.digestCards())!;
    assert.equal(r.added, 2);
    assert.equal(data().notes.find((n) => n.id === r.noteId)!.digest, true);
    assert.equal(cards.cardsOf(r.noteId).length, 2);
    // второй раз — та же заметка, ИИ знает про уже сделанные
    ai.aiAnswers.push('[{"q":"Как часто интервалы?","a":"повтор"}]');
    const r2 = (await digest.digestCards())!;
    assert.equal(r2.noteId, r.noteId);
    assert.equal(r2.added, 0);
    digest.closeDigest();
  });
});

describe('утреннее уведомление', () => {
  test('карточки и «перечитать» — в тексте, длина не больше 180', async () => {
    // заметки о беге давно не открывали, а сегодня — задача про кроссовки
    notes.mutateNotes((d) => {
      for (const n of d.notes) if (CORPUS.some((f) => ids[f.id] === n.id)) n.updatedAt = Date.now() - 60 * 86400000;
    });
    const t = tasks.addTask({ title: 'Купить кроссовки для длинных пробежек', date: todayYmd() })!;
    await tasks.flushTasks();
    await rel.ensureLinkIndex();
    const { brainBriefFor, briefParts } = await import('../src/notes/brainBrief.ts');
    const b = (await brainBriefFor(todayYmd(), [t.id]))!;
    assert.ok(b.cards >= 2, String(b.cards));
    assert.ok(b.reread, 'есть что перечитать');
    const msg = sync.briefingFor(tasks.useTasks.getState().data!.tasks, undefined, todayYmd(), briefParts(b));
    assert.match(msg.body, /карточек: \d+/);
    assert.match(msg.body, /Перечитать: «/);
    assert.ok(msg.body.length <= 180);
    // длинное название задачи — «перечитать» не влезает и не обрезается посередине
    const long = sync.briefingFor([{ ...t, title: 'Очень '.repeat(25) }], undefined, todayYmd(), briefParts(b));
    assert.ok(!long.body.includes('Перечитать'));
  });
});
