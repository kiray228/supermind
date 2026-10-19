/** 1.39: общие настройки устройств, автокурсы валют, выбор нескольких задач, FreeMind (.mm) */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import './fixtures/appHooks.ts';

const sp = await import('../src/store/sharedPrefs.ts');
const merge = await import('../src/store/merge.ts');
const kv = await import('../src/store/kv.ts');
const { useApp } = await import('../src/store/appStore.ts');
const rates = await import('../src/finance/rates.ts');
const finStore = await import('../src/finance/store.ts');
const tasks = await import('../src/tasks/store.ts');
const bulk = await import('../src/tasks/bulk.ts');
const fm = await import('../src/io/freemind.ts');
const { todayYmd, addDaysYmd } = await import('../src/utils/mapTasks.ts');

const settle = () => new Promise((r) => setTimeout(r, 20));

describe('общие настройки устройств', () => {
  test('слияние: каждая настройка — от устройства, где её изменили позже', () => {
    const a = { v: { 'settings.theme': 'dark', 'settings.accent': 'rose' }, at: { 'settings.theme': 300, 'settings.accent': 100 } };
    const b = { v: { 'settings.theme': 'light', 'settings.accent': 'ocean', 'ls:sm-celebrate': '0' }, at: { 'settings.theme': 200, 'settings.accent': 400, 'ls:sm-celebrate': 50 } };
    const m = merge.mergeValues('ui-prefs', a, b) as { v: Record<string, unknown>; at: Record<string, number> };
    assert.equal(m.v['settings.theme'], 'dark');
    assert.equal(m.v['settings.accent'], 'ocean');
    assert.equal(m.v['ls:sm-celebrate'], '0');
    assert.equal(m.at['settings.accent'], 400);
    // симметрично
    assert.deepEqual((merge.mergeValues('ui-prefs', b, a) as typeof m).v, m.v);
  });

  test('ключ синхронизируется, а настройки с API-ключом — нет', () => {
    assert.equal(kv.isSynced(sp.PREFS_KEY), true);
    assert.equal(kv.isSynced('settings'), false);
  });

  test('изменение темы записывается в общий список, API-ключ — никогда', async () => {
    useApp.getState().setSettings({ theme: 'dark', apiKey: 'sk-test-local' });
    // запись асинхронная: под нагрузкой (весь набор тестов параллельно) 20 мс бывает мало — ждём до 2 с
    let p = sp.normalizePrefs(await kv.get(sp.PREFS_KEY));
    for (let i = 0; i < 100 && p.v['settings.theme'] !== 'dark'; i++) {
      await settle();
      p = sp.normalizePrefs(await kv.get(sp.PREFS_KEY));
    }
    assert.equal(p.v['settings.theme'], 'dark');
    assert.ok(p.at['settings.theme'] > 1000);
    assert.ok(!JSON.stringify(p).includes('sk-test-local'));
  });

  test('пришло с другого устройства — применяется к настройкам и localStorage', async () => {
    const now = Date.now() + 1000;
    const remote = { v: { 'settings.accent': 'violet', 'settings.theme': 'light', 'ls:sm-celebrate': '0', 'ls:sm-ai-privacy': '{"finance":false,"mood":true}' }, at: { 'settings.accent': now, 'settings.theme': now, 'ls:sm-celebrate': now, 'ls:sm-ai-privacy': now } };
    const merged = merge.mergeValues(sp.PREFS_KEY, await kv.get(sp.PREFS_KEY), remote);
    await kv.setFromSync(sp.PREFS_KEY, merged);
    const changed = await sp.applySharedPrefs();
    assert.ok(changed.includes('settings.accent'));
    assert.equal(useApp.getState().settings.accent, 'violet');
    assert.equal(useApp.getState().settings.theme, 'light');
    assert.equal(useApp.getState().settings.apiKey, 'sk-test-local', 'ключ этого устройства не тронут');
    assert.equal(localStorage.getItem('sm-celebrate'), '0');
    const { assistantPrivacy } = await import('../src/assistant/privacy.ts');
    assert.equal(assistantPrivacy().finance, false);
    // повторно — ничего не меняется
    assert.deepEqual(await sp.applySharedPrefs(), []);
  });

  test('сеттеры localStorage-настроек отправляют изменение', async () => {
    const { setSpeakEnabled } = await import('../src/voice/speak.ts');
    setSpeakEnabled(false);
    await settle();
    const p = sp.normalizePrefs(await kv.get(sp.PREFS_KEY));
    assert.equal(p.v['ls:sm-voice-speak'], '0');
  });

  test('«только на этом устройстве» — не отправляет и не принимает', async () => {
    sp.setPrefsShared(false);
    useApp.getState().setSettings({ glass: 'soft' });
    await settle();
    let p = sp.normalizePrefs(await kv.get(sp.PREFS_KEY));
    assert.notEqual(p.v['settings.glass'], 'soft');
    await kv.setFromSync(sp.PREFS_KEY, { ...p, v: { ...p.v, 'settings.backdrop': 'plain' }, at: { ...p.at, 'settings.backdrop': Date.now() + 5000 } });
    assert.deepEqual(await sp.applySharedPrefs(), []);
    assert.notEqual(useApp.getState().settings.backdrop, 'plain');
    // включили снова — свои настройки уходят как самые свежие
    sp.setPrefsShared(true);
    await settle();
    await settle();
    p = sp.normalizePrefs(await kv.get(sp.PREFS_KEY));
    assert.equal(p.v['settings.glass'], 'soft');
  });

  test('первый запуск: свои старые настройки — с самым старым временем, чужие свежие побеждают', async () => {
    const empty = sp.mergePrefs({}, { v: { 'settings.theme': 'dark' }, at: { 'settings.theme': 1 } });
    const other = sp.mergePrefs(empty, { v: { 'settings.theme': 'light' }, at: { 'settings.theme': 5000 } });
    assert.equal(other.v['settings.theme'], 'light');
    // ничья (оба «старые») — остаётся своё
    assert.equal(sp.mergePrefs({ v: { x: 1 }, at: { x: 1 } }, { v: { x: 2 }, at: { x: 1 } }).v.x, 1);
  });
});

describe('курсы валют автоматически', () => {
  test('кросс-курсы через доллар, 6 значащих цифр', () => {
    const usd = { USD: 1, KZT: 452.88, RUB: 81.5, EUR: 0.86 };
    const r = rates.crossRates(usd, 'KZT', ['USD', 'RUB', 'EUR', 'XXX', 'KZT']);
    assert.equal(r.USD, 452.88);
    assert.equal(r.RUB, Number((452.88 / 81.5).toPrecision(6)));
    assert.equal(r.EUR, Number((452.88 / 0.86).toPrecision(6)));
    assert.ok(!('XXX' in r), 'неизвестная валюта пропущена');
    assert.ok(!('KZT' in r), 'основная — без курса');
    assert.deepEqual(rates.crossRates(usd, 'ZZZ', ['USD']), {}, 'нет основной у источника');
  });

  test('по умолчанию включены, пока нет курсов, введённых вручную', () => {
    assert.equal(rates.autoRatesOn({ mainCurrency: 'KZT', rates: {}, updatedAt: 1 }), true);
    assert.equal(rates.autoRatesOn({ mainCurrency: 'KZT', rates: { USD: 450 }, updatedAt: 1 }), false);
    assert.equal(rates.autoRatesOn({ mainCurrency: 'KZT', rates: { USD: 450 }, autoRates: true, updatedAt: 1 }), true);
  });

  test('обновление: нужны только при валютах без курса или раз в 12 часов; ошибка сети не трогает курсы', async () => {
    await finStore.ensureFinance();
    const data = () => finStore.useFinance.getState().data!;
    assert.equal(rates.ratesStale(data()), false, 'все счета в основной валюте');
    finStore.saveAccount({ id: 'usd-acc', name: 'Доллары', currency: 'USD', type: 'card', balance: 0 } as never);
    assert.equal(rates.ratesStale(data()), true);
    let calls = 0;
    const fake = (async () => {
      calls++;
      return new Response(JSON.stringify({ result: 'success', rates: { USD: 1, KZT: 452.88 }, time_last_update_unix: 1792108951 }));
    }) as typeof fetch;
    assert.equal(await finStore.refreshRates(false, fake), true);
    assert.equal(data().prefs.rates.USD, 452.88);
    assert.equal(data().prefs.autoRates, true);
    assert.equal(rates.ratesStale(data()), false);
    assert.equal(await finStore.refreshRates(false, fake), false, 'свежие — не обновляем');
    assert.equal(calls, 1);
    const broken = (async () => new Response('oops', { status: 500 })) as typeof fetch;
    assert.equal(await finStore.refreshRates(true, broken), false);
    assert.equal(data().prefs.rates.USD, 452.88, 'прежний курс остался');
    // выключили — вручную, не обновляем
    finStore.setFinancePrefs({ autoRates: false });
    assert.equal(rates.ratesStale(data(), Date.now() + 86400000), false);
  });
});

describe('выбор нескольких задач', () => {
  const ids: string[] = [];
  test('подготовка', async () => {
    await tasks.ensureTasks();
    for (const title of ['Б-1', 'Б-2', 'Б-3']) ids.push(tasks.addTask({ title, date: todayYmd() })!.id);
  });

  test('выбор: включить, отметить, «выбрать все» и снять', () => {
    bulk.startSelect(ids[0]);
    bulk.toggleSelect(ids[1]);
    assert.deepEqual(bulk.useBulk.getState().ids, [ids[0], ids[1]]);
    bulk.toggleSelect(ids[0]);
    assert.deepEqual(bulk.useBulk.getState().ids, [ids[1]]);
    bulk.selectAll(ids);
    assert.deepEqual(new Set(bulk.useBulk.getState().ids), new Set(ids));
    bulk.selectAll(ids);
    assert.deepEqual(bulk.useBulk.getState().ids, [], 'все уже выбраны — снять');
    bulk.endSelect();
    assert.equal(bulk.useBulk.getState().ids, null);
  });

  test('дата, список, приоритет и тег — всем сразу, «Отменить» возвращает', () => {
    const tomorrow = addDaysYmd(todayYmd(), 1);
    assert.equal(bulk.bulkUpdate(ids, { date: tomorrow }, 'Перенесено'), 3);
    assert.ok(ids.every((id) => tasks.getTask(id)!.date === tomorrow));
    useApp.getState().toastAction!.run();
    assert.ok(ids.every((id) => tasks.getTask(id)!.date === todayYmd()), 'отмена вернула дату');
    const list = tasks.addList('Проект Б')!;
    bulk.bulkUpdate(ids.slice(0, 2), { listId: list.id, priority: 1 }, 'В список');
    assert.equal(tasks.getTask(ids[0])!.listId, list.id);
    assert.equal(tasks.getTask(ids[1])!.priority, 1);
    assert.notEqual(tasks.getTask(ids[2])!.listId, list.id);
    tasks.updateTask(ids[0], { tags: ['срочно'] });
    assert.equal(bulk.bulkTag(ids, 'срочно'), 3);
    assert.deepEqual(tasks.getTask(ids[0])!.tags, ['срочно'], 'без повтора тега');
    assert.deepEqual(tasks.getTask(ids[2])!.tags, ['срочно']);
    assert.match(useApp.getState().toast!, /3 задачи/);
  });

  test('выполнить все и отменить; удалить все и отменить', () => {
    const before = tasks.tasksData()!.log.length;
    assert.equal(bulk.bulkComplete(ids), 3);
    assert.ok(ids.every((id) => tasks.getTask(id)!.done));
    assert.equal(tasks.tasksData()!.log.length, before + 3);
    assert.match(useApp.getState().toast!, /Выполнено: 3 задачи/);
    useApp.getState().toastAction!.run();
    assert.ok(ids.every((id) => !tasks.getTask(id)!.done));
    assert.equal(tasks.tasksData()!.log.length, before, 'записи в статистике убраны');
    assert.equal(bulk.bulkTrash(ids), 3);
    assert.ok(ids.every((id) => tasks.getTask(id)!.deleted));
    useApp.getState().toastAction!.run();
    assert.ok(ids.every((id) => !tasks.getTask(id)!.deleted));
    assert.equal(bulk.bulkComplete([]), 0);
    assert.equal(bulk.tasksWord(1), '1 задача');
    assert.equal(bulk.tasksWord(5), '5 задач');
    assert.equal(bulk.tasksWord(22), '22 задачи');
    assert.equal(bulk.tasksWord(11), '11 задач');
  });

  test('повторяющаяся переходит на следующий повтор', () => {
    const r = tasks.addTask({ title: 'Каждый день', date: todayYmd(), repeat: { freq: 'daily', interval: 1 } as never })!;
    bulk.bulkComplete([r.id]);
    const t = tasks.getTask(r.id)!;
    assert.equal(t.done, false);
    assert.equal(t.date, addDaysYmd(todayYmd(), 1));
  });
});

describe('FreeMind (.mm)', async () => {
  let DOMParser: unknown;
  try {
    ({ DOMParser } = await import('@xmldom/xmldom'));
  } catch {
    /* нет парсера XML */
  }
  const skip = !DOMParser && 'нет @xmldom/xmldom';

  const MM = `<map version="freeplane 1.9.0">
<node TEXT="План &amp; цели" ID="ID_1" LINK="https://example.com" COLOR="#990000">
<node TEXT="Работа" POSITION="left" ID="ID_2" FOLDED="true" BACKGROUND_COLOR="#ffee00">
  <icon BUILTIN="full-2"/><icon BUILTIN="button_ok"/><icon BUILTIN="full-3"/>
  <font NAME="SansSerif" SIZE="12" BOLD="true"/>
  <edge COLOR="#00aa00"/>
  <node TEXT="Отчёт" ID="ID_3"><arrowlink DESTINATION="ID_4" COLOR="#0000ff"/></node>
</node>
<node POSITION="right" ID="ID_4">
  <richcontent TYPE="NODE"><html><head><style>p{}</style></head><body><p>Дом</p><p>и  семья</p></body></html></richcontent>
  <richcontent TYPE="NOTE"><html><body><p>Первая строка</p><p>Вторая &lt;важно&gt;</p></body></html></richcontent>
</node>
<node TEXT="Опасная" LINK="javascript:alert(1)" ID="ID_5"/>
</node>
</map>`;

  test('импорт: текст, HTML, заметки, значки, цвета, свёрнутость, сторона, связи', { skip }, () => {
    (globalThis as { DOMParser?: unknown }).DOMParser = DOMParser;
    const doc = fm.freemindToDoc(MM, 'карта.mm');
    const s = doc.sheets[0];
    const root = s.root;
    assert.equal(doc.title, 'План & цели');
    assert.equal(root.link, 'https://example.com');
    assert.equal(root.style?.textColor, '#990000');
    const [work, home, bad] = root.children;
    assert.equal(work.text, 'Работа');
    assert.equal(work.side, 'left');
    assert.equal(work.collapsed, true);
    assert.deepEqual(work.markers, ['priority-2', 'task-0'], 'один приоритет на тему');
    assert.equal(work.style?.bold, true);
    assert.equal(work.style?.fill, '#ffee00');
    assert.equal(work.style?.lineColor, '#00aa00');
    assert.equal(home.text, 'Дом\nи семья');
    assert.equal(home.note, 'Первая строка\nВторая <важно>');
    assert.equal(home.side, 'right');
    assert.equal(bad.link, undefined, 'javascript: не принимается');
    assert.equal(s.relationships.length, 1);
    assert.equal(s.relationships[0].from, work.children[0].id);
    assert.equal(s.relationships[0].to, home.id);
    assert.equal(s.relationships[0].color, '#0000ff');
  });

  test('экспорт и обратно — то же дерево, заметки, значки и связи', { skip }, () => {
    (globalThis as { DOMParser?: unknown }).DOMParser = DOMParser;
    const a = fm.freemindToDoc(MM, 'x.mm');
    const xml = fm.sheetToFreemind(a.sheets[0]);
    assert.match(xml, /^<map version="1\.0\.1">/);
    const b = fm.freemindToDoc(xml, 'x.mm');
    const shape = (t: { text: string; note?: string; markers?: string[]; side?: string; children: unknown[] }): unknown => ({
      text: t.text,
      note: t.note,
      markers: t.markers,
      side: t.side,
      children: (t.children as (typeof t)[]).map(shape),
    });
    assert.deepEqual(shape(b.sheets[0].root), shape(a.sheets[0].root));
    assert.equal(b.sheets[0].relationships.length, 1);
  });

  test('не карта — понятная ошибка', { skip }, () => {
    (globalThis as { DOMParser?: unknown }).DOMParser = DOMParser;
    assert.throws(() => fm.freemindToDoc('<opml version="2.0"><body/></opml>'), /не карта FreeMind/);
    assert.throws(() => fm.freemindToDoc('<map version="1.0.1"></map>'), /нет тем/);
  });
});
