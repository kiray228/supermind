/**
 * Самопроверка приложения на симуляторе iPhone и эмуляторе Android (CI, .github/workflows/selftest.yml).
 * Попадает только в тестовую сборку (VITE_SELFTEST=1) — в магазинных версиях её нет.
 *
 * Сообщения идут в консоль строками «SMTEST {json}»: Capacitor в отладочной сборке переписывает консоль
 * в журнал устройства, CI их читает. «shot» — сигнал CI снять экран (ждём, пока снимет).
 *
 * Два запуска: первый создаёт данные во всех разделах и проверяет функции и плагины,
 * второй (после полного перезапуска приложения) — что всё сохранилось на устройстве.
 */
import { Capacitor } from '@capacitor/core';
import { useApp, type View } from '../store/appStore';

const SEED_KEY = 'sm-selftest-seed';
const MARK = 'Самопроверка';

type Seed = { docId: string; taskId: string; noteId: string; txId: string; habitId: string };

const out = (kind: string, data: Record<string, unknown> = {}) => console.log('SMTEST ' + JSON.stringify({ kind, ...data }));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
let errors: string[] = [];

function watchErrors() {
  const push = (m: unknown) => {
    const s = m instanceof Error ? `${m.message}\n${(m.stack ?? '').split('\n').slice(0, 3).join('\n')}` : String(m);
    errors.push(s.slice(0, 400));
    out('error', { message: s.slice(0, 400) });
  };
  window.addEventListener('error', (e) => push(e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => push(e.reason));
}

/** Проверка: исключение, превышение времени или ошибка страницы во время шага — провал */
async function check(name: string, fn: () => Promise<unknown> | unknown, timeoutMs = 15000) {
  const before = errors.length;
  const t0 = Date.now();
  try {
    const detail = await Promise.race([Promise.resolve().then(fn), sleep(timeoutMs).then(() => Promise.reject(new Error(`не уложились в ${timeoutMs / 1000} с`)))]);
    const pageErrors = errors.slice(before);
    if (pageErrors.length) throw new Error('ошибка на странице: ' + pageErrors[0]);
    pass++;
    out('pass', { name, ms: Date.now() - t0, detail: detail === undefined ? undefined : String(detail).slice(0, 200) });
  } catch (e) {
    fail++;
    out('fail', { name, ms: Date.now() - t0, message: (e instanceof Error ? e.message : String(e)).slice(0, 500) });
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

/** Попросить CI снять экран и дать ему время */
async function shot(name: string) {
  await sleep(1200);
  out('shot', { name });
  // симулятор iPhone снимает экран 3–4 с (Android — меньше секунды): не уходить с экрана раньше
  await sleep(Capacitor.getPlatform() === 'ios' ? 7000 : 2500);
}

/** Плагины, без которых функции не работают (у каждой платформы свои) */
function expectedPlugins(): string[] {
  const common = ['App', 'Filesystem', 'LocalNotifications', 'Share', 'SplashScreen', 'StatusBar', 'SpeechRecognition', 'TextToSpeech'];
  if (Capacitor.getPlatform() === 'android') return [...common, 'SmAlarm', 'SmCalendar', 'WidgetBridge'];
  return common;
}

async function screens(docId: string) {
  const { openDoc, leaveEditor } = await import('../actions');
  const views: View[] = ['today', 'home', 'notes', 'more', 'tasks', 'calendar', 'habits', 'finance', 'goals', 'focus', 'progress', 'assistant', 'board', 'settings', 'health'];
  for (const v of views) {
    await check(`экран: ${v}`, async () => {
      useApp.getState().go(v);
      await sleep(1500);
      assert(useApp.getState().view === v, `открылся «${useApp.getState().view}» вместо «${v}»`);
      assert(!document.querySelector('.view-crash'), 'раздел упал (экран ошибки)');
      const text = document.getElementById('root')?.innerText.trim() ?? '';
      assert(text.length > 20, 'экран пустой');
      await shot(v);
    }, 20000);
  }
  await check('экран: карта в редакторе', async () => {
    await openDoc(docId);
    await sleep(1500);
    assert(useApp.getState().view === 'editor', 'редактор не открылся');
    assert(!document.querySelector('.view-crash'), 'редактор упал');
    await shot('editor');
    await leaveEditor('today');
  }, 20000);
  await check('экран: голосовые команды', async () => {
    const { useVoice } = await import('../voice/state');
    useVoice.setState({ open: true });
    await sleep(1500);
    const text = document.getElementById('root')?.innerText ?? '';
    assert(!/not implemented/i.test(text), 'на экране «plugin is not implemented»');
    await shot('voice');
    useVoice.setState({ open: false });
  }, 20000);
}

async function firstRun() {
  const seed: Partial<Seed> = {};

  out('phase', { phase: 1 });
  await shot('start');

  await check('платформа', () => {
    const p = Capacitor.getPlatform();
    assert(Capacitor.isNativePlatform(), `не нативное приложение (${p})`);
    return p;
  });

  for (const name of expectedPlugins()) {
    await check(`плагин ${name}`, () => assert(Capacitor.isPluginAvailable(name), `плагин «${name}» не подключён`));
  }

  await check('версия приложения', async () => {
    const { App } = await import('@capacitor/app');
    const info = await App.getInfo();
    return `${info.version} (${info.build})`;
  });

  // --- данные во всех разделах ---
  await check('карта: создать, ветки, отмена, сохранение', async () => {
    const { newDoc, useDoc, flushSave } = await import('../store/docStore');
    const { createAndOpen, leaveEditor } = await import('../actions');
    const { loadDoc } = await import('../store/db');
    const doc = newDoc(`${MARK}: карта`);
    await createAndOpen(doc);
    const st = useDoc.getState();
    const root = st.sheet()!.root;
    const a = st.addChild(root.id, 'Ветка 1');
    const b = st.addChild(root.id, 'Ветка 2');
    assert(a && b, 'ветки не добавились');
    st.addChild(root.id, 'Лишняя');
    useDoc.getState().undo();
    const kids = useDoc.getState().sheet()!.root.children.map((c) => c.text);
    assert(kids.length === 2 && !kids.includes('Лишняя'), `после отмены ветки: ${kids.join(', ')}`);
    await flushSave(true);
    await leaveEditor('today');
    const saved = await loadDoc(doc.id);
    assert(saved && !('locked' in saved), 'карта не сохранилась в базе');
    assert(saved.sheets[0].root.children.length === 2, 'в базе не те ветки');
    seed.docId = doc.id;
  });

  await check('задачи: умный ввод', async () => {
    const { parseTask } = await import('../tasks/parse');
    const p = parseTask('позвонить маме завтра в 18:30 каждый понедельник');
    assert(p.title.startsWith('позвонить маме'), `название: «${p.title}»`);
    assert(p.time === '18:30', `время: ${p.time}`);
    assert(p.date && p.repeat, 'не распознались дата или повтор');
    return `${p.date} ${p.time}`;
  });

  await check('задачи: добавить, выполнить, сохранить', async () => {
    const { ensureTasks, addTask, toggleDone, flushTasks, getTask } = await import('../tasks/store');
    await ensureTasks();
    const t = addTask({ title: `${MARK}: задача` });
    assert(t, 'задача не добавилась');
    toggleDone(t.id);
    assert(getTask(t.id)?.done, 'не отметилась выполненной');
    toggleDone(t.id);
    await flushTasks();
    seed.taskId = t.id;
  });

  await check('заметки: создать и сохранить текст', async () => {
    const { ensureNotes, createNote, saveNoteBody, flushNotes, loadNoteBody } = await import('../notes/store');
    const { newBlock } = await import('../notes/model');
    await ensureNotes();
    const n = createNote({ title: `${MARK}: заметка` });
    assert(n, 'заметка не создалась');
    saveNoteBody(n.id, { title: `${MARK}: заметка`, blocks: [newBlock('p', { text: 'Текст самопроверки' })], updatedAt: Date.now() });
    await flushNotes();
    const body = await loadNoteBody(n.id);
    assert(body.blocks.some((b) => b.text === 'Текст самопроверки'), 'текст заметки не сохранился');
    seed.noteId = n.id;
  });

  await check('привычки: создать и отметить', async () => {
    const { loadPlanner, savePlanner } = await import('../store/db');
    const { toggleHabitOn } = await import('../habits/store');
    const { todayYmd } = await import('../utils/mapTasks');
    const p = await loadPlanner();
    const habit = { id: `selftest-${Date.now()}`, name: `${MARK}: привычка`, color: '#3b82f6', icon: '✅' };
    await savePlanner({ ...p, habits: [...(p.habits ?? []), habit] });
    const done = await toggleHabitOn(habit, todayYmd());
    assert(done, 'привычка не отметилась');
    seed.habitId = habit.id;
  });

  await check('финансы: добавить трату', async () => {
    const { ensureFinance, addTransaction, flushFinance } = await import('../finance/store');
    const { todayYmd } = await import('../utils/mapTasks');
    const d = await ensureFinance();
    const acc = d.accounts[0];
    const cat = d.categories.find((c) => c.kind === 'expense');
    assert(acc, 'нет ни одного счёта');
    const tx = addTransaction({ type: 'expense', amount: 1234, accountId: acc.id, categoryId: cat?.id, date: todayYmd(), note: `${MARK}: трата` }, { silent: true });
    assert(tx, 'трата не добавилась');
    await flushFinance();
    seed.txId = tx.id;
  });

  // метка для второго запуска — сразу после данных: Android пишет localStorage на диск с задержкой,
  // а до перезапуска ещё минута проверок
  try {
    localStorage.setItem(SEED_KEY, JSON.stringify(seed));
  } catch {
    /* без хранилища второй запуск ничего не проверит */
  }

  // --- возможности телефона ---
  await check('уведомления: поставить и снять напоминание', async () => {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const perm = await LocalNotifications.checkPermissions();
    const id = 987654;
    // неточное: точное на Android 14+ без разрешения само открыло бы экран настроек
    await LocalNotifications.schedule({
      notifications: [{ id, title: MARK, body: 'проверка', schedule: { at: new Date(Date.now() + 86_400_000) }, isExactNotification: false }],
    });
    const pending = await LocalNotifications.getPending();
    const found = pending.notifications.some((n) => Number(n.id) === id);
    await LocalNotifications.cancel({ notifications: [{ id }] });
    assert(found, 'напоминание не попало в очередь');
    return `разрешение: ${perm.display}`;
  });

  await check('распознавание речи: плагин отвечает', async () => {
    const { SpeechRecognition } = await import('@capacitor-community/speech-recognition');
    const { available } = await SpeechRecognition.available();
    const perm = await SpeechRecognition.checkPermissions();
    return `доступно: ${available}, разрешение: ${perm.speechRecognition}`;
  });

  await check('озвучка: список голосов', async () => {
    const { TextToSpeech } = await import('@capacitor-community/text-to-speech');
    const { languages } = await TextToSpeech.getSupportedLanguages();
    return `языков: ${languages.length}`;
  });

  await check('файлы: записать и прочитать', async () => {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
    const path = 'selftest.txt';
    await Filesystem.writeFile({ path, data: 'привет', directory: Directory.Cache, encoding: Encoding.UTF8 });
    const r = await Filesystem.readFile({ path, directory: Directory.Cache, encoding: Encoding.UTF8 });
    await Filesystem.deleteFile({ path, directory: Directory.Cache });
    assert(r.data === 'привет', `прочитали «${String(r.data)}»`);
  });

  await check('поделиться: системное меню доступно', async () => {
    const { Share } = await import('@capacitor/share');
    const { value } = await Share.canShare();
    assert(value, 'меню «Поделиться» недоступно');
  });

  if (Capacitor.getPlatform() === 'android') {
    await check('будильник: плагин отвечает', async () => {
      const { SmAlarm } = await import('../tasks/alarm');
      const { alarms } = await SmAlarm.list();
      const { allowed } = await SmAlarm.fullScreenAllowed();
      return `будильников: ${alarms.length}, на весь экран: ${allowed}`;
    });
  }

  await screens(seed.docId ?? '');
}

/** Второй запуск после перезапуска: данные первого должны быть на месте */
async function secondRun(seed: Seed) {
  out('phase', { phase: 2 });
  await shot('restart');

  await check('после перезапуска: карта', async () => {
    const { loadDoc } = await import('../store/db');
    const d = await loadDoc(seed.docId);
    assert(d && !('locked' in d) && d.sheets[0].root.children.length === 2, 'карты нет или она другая');
  });
  await check('после перезапуска: задача', async () => {
    const { ensureTasks, getTask } = await import('../tasks/store');
    await ensureTasks();
    assert(getTask(seed.taskId), 'задачи нет');
  });
  await check('после перезапуска: заметка', async () => {
    const { ensureNotes, loadNoteBody } = await import('../notes/store');
    await ensureNotes();
    const b = await loadNoteBody(seed.noteId);
    assert(b.blocks.some((x) => x.text === 'Текст самопроверки'), 'текста заметки нет');
  });
  await check('после перезапуска: привычка', async () => {
    const { loadPlanner } = await import('../store/db');
    assert((await loadPlanner()).habits.some((h) => h.id === seed.habitId), 'привычки нет');
  });
  await check('после перезапуска: трата', async () => {
    const { ensureFinance } = await import('../finance/store');
    assert((await ensureFinance()).transactions.some((t) => t.id === seed.txId), 'траты нет');
  });

  useApp.getState().go('today');
  await sleep(1500);
  await shot('today-after-restart');
  try {
    localStorage.removeItem(SEED_KEY);
  } catch {
    /* следующий запуск снова будет вторым — не страшно */
  }
}

export async function runSelfTest() {
  watchErrors();
  // приложение должно успеть загрузиться, как у пользователя
  await sleep(4000);
  pass = 0;
  fail = 0;
  errors = [];
  let seed: Seed | null = null;
  try {
    seed = JSON.parse(localStorage.getItem(SEED_KEY) ?? 'null');
  } catch {
    seed = null;
  }
  const phase = seed ? 2 : 1;
  try {
    if (seed) await secondRun(seed);
    else await firstRun();
  } catch (e) {
    fail++;
    out('fail', { name: 'самопроверка', message: e instanceof Error ? e.message : String(e) });
  }
  out('done', { phase, pass, fail });
}
