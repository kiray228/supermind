// Голосовой ввод: конец фразы по паузе, «Готово», отмена, тишина и ошибки — на подделках распознавателей
// (нативный плагин Android ведёт себя как в режиме диктовки: сам не останавливается и ошибок не присылает)
import './tsResolve.ts';
import { test, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const { nativeSession, webSession, NO_SPEECH_MS } = await import('../src/voice/sessions.ts');
const { SILENCE_MS, FINAL_WAIT_MS } = await import('../src/voice/silence.ts');

beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }));
afterEach(() => mock.timers.reset());

type Fn = (d: never) => void;
function fakePlugin(opts: { failStart?: boolean } = {}) {
  const ls: Record<string, Fn[]> = {};
  const p = {
    stops: 0,
    removed: 0,
    stop: async () => void p.stops++,
    start: async () => {
      if (opts.failStart) throw new Error('busy');
    },
    addListener: async (ev: string, fn: Fn) => {
      (ls[ev] ??= []).push(fn);
      return { remove: async () => void p.removed++ };
    },
    say: (s: string) => ls.partialResults?.forEach((f) => f({ matches: [s] } as never)),
    stopped: () => ls.listeningState?.forEach((f) => f({ status: 'stopped' } as never)),
  };
  return p;
}
function recorder() {
  const r = { texts: [] as string[], done: [] as string[], errors: [] as string[] };
  return { r, o: { onText: (s: string) => r.texts.push(s), onDone: (s: string) => r.done.push(s), onError: (m: string) => r.errors.push(m) } };
}
const tick = (ms: number) => mock.timers.tick(ms);

test('Android: после паузы фраза заканчивается сама — без «Готово»', async () => {
  const sr = fakePlugin();
  const { r, o } = recorder();
  await nativeSession(sr, o);
  sr.say('купить');
  tick(500);
  sr.say('купить хлеб');
  tick(SILENCE_MS - 1);
  assert.equal(sr.stops, 0, 'ещё говорит');
  tick(1);
  assert.equal(sr.stops, 1, 'пауза — распознаватель остановлен');
  tick(450);
  assert.deepEqual(r.done, ['купить хлеб']);
  assert.equal(sr.removed, 2, 'подписки сняты');
});

test('Android: короткая пауза посреди фразы её не обрывает', async () => {
  const sr = fakePlugin();
  const { r, o } = recorder();
  await nativeSession(sr, o);
  sr.say('купить хлеб');
  tick(SILENCE_MS - 200);
  sr.say('купить хлеб завтра в девять');
  tick(SILENCE_MS - 200);
  assert.deepEqual(r.done, []);
  tick(200);
  tick(450);
  assert.deepEqual(r.done, ['купить хлеб завтра в девять']);
});

test('Android: окончательный текст после остановки подхватывается', async () => {
  const sr = fakePlugin();
  const { r, o } = recorder();
  await nativeSession(sr, o);
  sr.say('купить хлеп');
  tick(SILENCE_MS);
  sr.say('Купить хлеб');
  tick(250);
  assert.deepEqual(r.done, ['Купить хлеб']);
});

test('Android: «Готово» заканчивает сразу, повторное «Готово» и поздние события ничего не ломают', async () => {
  const sr = fakePlugin();
  const { r, o } = recorder();
  const l = (await nativeSession(sr, o))!;
  sr.say('позвонить маме');
  tick(300);
  l.stop();
  l.stop();
  tick(700);
  assert.deepEqual(r.done, ['позвонить маме']);
  sr.say('лишнее');
  sr.stopped();
  tick(5000);
  assert.deepEqual(r.done, ['позвонить маме'], 'итог — один раз');
});

test('Android: отмена — без результата', async () => {
  const sr = fakePlugin();
  const { r, o } = recorder();
  const l = (await nativeSession(sr, o))!;
  sr.say('что-то');
  l.abort();
  tick(20000);
  assert.deepEqual(r.done, []);
  assert.ok(sr.stops >= 1);
});

test('Android: тишина — через 9 с пустой итог (окно скажет «ничего не услышал»)', async () => {
  const sr = fakePlugin();
  const { r, o } = recorder();
  await nativeSession(sr, o);
  tick(NO_SPEECH_MS - 1);
  assert.deepEqual(r.done, []);
  tick(1);
  assert.deepEqual(r.done, ['']);
  assert.equal(sr.stops, 1);
});

test('распознаватель остановился сам (iPhone, ошибка сети) — итог с тем, что успели сказать', async () => {
  const sr = fakePlugin();
  const { r, o } = recorder();
  await nativeSession(sr, o);
  sr.say('выпил стакан воды');
  sr.stopped();
  tick(900);
  assert.deepEqual(r.done, ['выпил стакан воды']);
});

test('Android: не удалось начать — ошибка, без итога', async () => {
  const sr = fakePlugin({ failStart: true });
  const { r, o } = recorder();
  assert.equal(await nativeSession(sr, o), null);
  assert.equal(r.errors.length, 1);
  assert.deepEqual(r.done, []);
});

// ---------- браузер (Web Speech API) ----------
class FakeSR {
  static last: FakeSR;
  lang = '';
  continuous = true;
  interimResults = false;
  maxAlternatives = 0;
  stops = 0;
  aborts = 0;
  onresult: ((e: { results: { 0: { transcript: string }; isFinal: boolean; length: number }[] }) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  constructor() {
    FakeSR.last = this;
  }
  start() {}
  stop() {
    this.stops++;
    this.onend?.();
  }
  abort() {
    this.aborts++;
    this.onend?.();
  }
  say(...parts: string[]) {
    this.onresult?.({ results: parts.map((p) => ({ 0: { transcript: p }, isFinal: false, length: 1 })) });
  }
}

test('браузер: промежуточный текст, пауза → стоп → итог', () => {
  const { r, o } = recorder();
  webSession(FakeSR as never, o);
  const sr = FakeSR.last;
  assert.equal(sr.interimResults, true);
  sr.say('купить ', ' хлеб');
  assert.deepEqual(r.texts, ['купить хлеб']);
  tick(SILENCE_MS);
  assert.equal(sr.stops, 1);
  assert.deepEqual(r.done, ['купить хлеб']);
});

test('браузер: отмена — без итога; запрет микрофона — ошибка без итога', () => {
  const a = recorder();
  const l = webSession(FakeSR as never, a.o)!;
  FakeSR.last.say('что-то');
  l.abort();
  tick(5000);
  assert.deepEqual(a.r.done, []);

  const b = recorder();
  webSession(FakeSR as never, b.o);
  FakeSR.last.onerror?.({ error: 'not-allowed' });
  FakeSR.last.onend?.();
  assert.equal(b.r.errors.length, 1);
  assert.deepEqual(b.r.done, []);
});

// ---------- Android: свой модуль SmSpeech ----------
const { smSession, RESULT_WAIT_MS } = await import('../src/voice/sessions.ts');
type Ev = { type: string; session: number; text?: string; level?: number; code?: string };
function fakeSm(opts: { failStart?: string } = {}) {
  let fn: ((e: Ev) => void) | null = null;
  const p = {
    session: 7,
    stops: 0,
    cancels: 0,
    start: async () => {
      if (opts.failStart) throw new Error(opts.failStart);
      return { session: p.session };
    },
    stop: async () => void p.stops++,
    cancel: async () => void p.cancels++,
    addListener: async (_: string, f: (e: Ev) => void) => {
      fn = f;
      return { remove: async () => void (fn = null) };
    },
    emit: (e: Partial<Ev> & { type: string }) => fn?.({ session: p.session, ...e } as Ev),
  };
  return p;
}
function rec2() {
  const r = { texts: [] as string[], done: [] as string[], errors: [] as string[], levels: [] as number[] };
  return { r, o: { onText: (s: string) => r.texts.push(s), onDone: (s: string) => r.done.push(s), onError: (m: string) => r.errors.push(m), onLevel: (l: number) => r.levels.push(l) } };
}

test('SmSpeech: слова → конец речи → окончательный текст — итог сразу', async () => {
  const sr = fakeSm();
  const { r, o } = rec2();
  await smSession(sr as never, o);
  sr.emit({ type: 'partial', text: 'купить хлеп' });
  sr.emit({ type: 'end' });
  sr.emit({ type: 'result', text: 'Купить хлеб' });
  assert.deepEqual(r.done, ['Купить хлеб']);
  tick(10000);
  assert.deepEqual(r.done, ['Купить хлеб'], 'один раз');
});

test('SmSpeech: распознаватель молчит о конце — пауза его останавливает, ждём результат', async () => {
  const sr = fakeSm();
  const { r, o } = rec2();
  await smSession(sr as never, o);
  sr.emit({ type: 'partial', text: 'позвонить маме' });
  tick(SILENCE_MS);
  assert.equal(sr.stops, 1);
  sr.emit({ type: 'result', text: 'Позвонить маме' });
  assert.deepEqual(r.done, ['Позвонить маме']);
});

test('SmSpeech: результата нет — через паузу ожидания берём услышанное', async () => {
  const sr = fakeSm();
  const { r, o } = rec2();
  await smSession(sr as never, o);
  sr.emit({ type: 'partial', text: 'выпил воды' });
  sr.emit({ type: 'end' });
  tick(FINAL_WAIT_MS - 1);
  assert.deepEqual(r.done, [], 'ещё ждём окончательный');
  tick(1);
  assert.deepEqual(r.done, ['выпил воды'], 'со сказанным текстом долго не ждём');
});

test('SmSpeech: пауза после слов — итог меньше чем через полторы секунды', async () => {
  const sr = fakeSm();
  const { r, o } = rec2();
  await smSession(sr as never, o);
  sr.emit({ type: 'partial', text: 'купить молоко' });
  tick(SILENCE_MS);
  tick(FINAL_WAIT_MS);
  assert.deepEqual(r.done, ['купить молоко']);
  assert.ok(SILENCE_MS + FINAL_WAIT_MS <= 1500);
});

test('SmSpeech: конец речи без слов — результат ждём дольше', async () => {
  const sr = fakeSm();
  const { r, o } = rec2();
  await smSession(sr as never, o);
  sr.emit({ type: 'end' });
  tick(FINAL_WAIT_MS);
  assert.deepEqual(r.done, []);
  sr.emit({ type: 'result', text: 'Привет' });
  assert.deepEqual(r.done, ['Привет']);
});

test('SmSpeech: ошибки — «ничего не сказали» не ошибка; сеть без слов — ошибка; сеть после слов — берём слова', async () => {
  let s = fakeSm();
  let x = rec2();
  await smSession(s as never, x.o);
  s.emit({ type: 'error', code: 'no-speech' });
  assert.deepEqual(x.r.done, ['']);
  assert.deepEqual(x.r.errors, []);

  s = fakeSm();
  x = rec2();
  await smSession(s as never, x.o);
  s.emit({ type: 'error', code: 'network' });
  assert.equal(x.r.errors.length, 1);
  assert.deepEqual(x.r.done, []);

  s = fakeSm();
  x = rec2();
  await smSession(s as never, x.o);
  s.emit({ type: 'partial', text: 'купить сыр' });
  s.emit({ type: 'error', code: 'network' });
  assert.deepEqual(x.r.done, ['купить сыр']);
});

test('SmSpeech: нет разрешения на микрофон — понятная ошибка', async () => {
  const s = fakeSm({ failStart: 'permission' });
  const x = rec2();
  assert.equal(await smSession(s as never, x.o), null);
  assert.match(x.r.errors[0], /микрофон/);
});

test('SmSpeech: события прошлого сеанса не мешают; громкость 0…1; отмена — без итога', async () => {
  const s = fakeSm();
  const x = rec2();
  const l = (await smSession(s as never, x.o))!;
  s.emit({ type: 'result', text: 'старое', session: 6 });
  assert.deepEqual(x.r.done, []);
  s.emit({ type: 'level', level: 10 });
  s.emit({ type: 'level', level: -5 });
  assert.deepEqual(x.r.levels, [1, 0]);
  l.abort();
  s.emit({ type: 'result', text: 'после отмены' });
  tick(20000);
  assert.deepEqual(x.r.done, []);
  assert.equal(s.cancels, 1);
});

test('SmSpeech: «Готово» — стоп и итог по результату или через 1,2 с', async () => {
  const s = fakeSm();
  const x = rec2();
  const l = (await smSession(s as never, x.o))!;
  s.emit({ type: 'partial', text: 'новая привычка' });
  l.stop();
  assert.equal(s.stops, 1);
  tick(1200);
  assert.deepEqual(x.r.done, ['новая привычка']);
});

test('SmSpeech: тишина 9 с — отмена и пустой итог', async () => {
  const s = fakeSm();
  const x = rec2();
  await smSession(s as never, x.o);
  tick(NO_SPEECH_MS);
  assert.deepEqual(x.r.done, ['']);
  assert.equal(s.cancels, 1);
});

test('разрешение на микрофон: пустой ответ плагина не роняет голосовой ввод', async () => {
  const { micAllowed } = await import('../src/voice/sessions.ts');
  const none = async () => undefined;
  const st = (s: string) => async () => ({ speechRecognition: s });
  assert.equal(await micAllowed(none, none, 'speechRecognition'), true, 'неизвестно — решает запуск');
  assert.equal(await micAllowed(st('granted'), none, 'speechRecognition'), true);
  assert.equal(await micAllowed(st('prompt'), st('granted'), 'speechRecognition'), true);
  assert.equal(await micAllowed(st('prompt'), st('denied'), 'speechRecognition'), false);
  assert.equal(await micAllowed(none, st('denied'), 'speechRecognition'), false);
});

test('Android: запуск без доступа к микрофону — понятное сообщение', async () => {
  const sr = fakePlugin();
  sr.start = async () => {
    throw new Error('Missing permission');
  };
  const { r, o } = recorder();
  assert.equal(await nativeSession(sr, o), null);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /микрофон/);
});
