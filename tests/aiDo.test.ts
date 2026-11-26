// «Сделать с ИИ»: какие задачи ИИ может сделать, задание для ChatGPT/Claude, разбор результата; тишина в голосовом вводе
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, aiCanDo, dueSoon, resultBody, resultTitle, taskBrief } from '../src/tasks/aiDo.ts';
import type { TaskItem } from '../src/tasks/model.ts';

const task = (p: Partial<TaskItem>): TaskItem => ({ id: 'x', title: '', listId: 'inbox', done: false, createdAt: 0, updatedAt: 0, priority: 0, tags: [], reminders: [], checklist: [], order: 0, ...p });

test('ИИ берётся за то, что можно написать или придумать, а не за «купить хлеб»', () => {
  for (const s of ['Сделать презентацию для клиента', 'Написать письмо директору', 'Пост в инстаграм', 'Подготовить доклад', 'План на неделю', 'Перевести договор', 'Write a report', 'Баяндама дайындау']) assert.ok(aiCanDo({ title: s }), s);
  for (const s of ['Купить хлеб', 'Постирать вещи', 'Планшет купить', 'Позвонить маме', 'Тренировка']) assert.ok(!aiCanDo({ title: s }), s);
  assert.ok(aiCanDo({ title: 'Клиент', notes: 'нужна презентация на 10 слайдов' }));
});

test('срок близко: сегодня, завтра или прошёл (не больше недели), не сделано', () => {
  const today = '2026-11-25';
  const tm = addDays(today, 1);
  assert.equal(tm, '2026-11-26');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.ok(dueSoon(task({ date: today }), today, tm));
  assert.ok(dueSoon(task({ date: tm }), today, tm));
  assert.ok(dueSoon(task({ date: '2026-11-20' }), today, tm));
  assert.ok(!dueSoon(task({ date: '2026-11-10' }), today, tm));
  assert.ok(!dueSoon(task({ date: '2026-11-27' }), today, tm));
  assert.ok(!dueSoon(task({ date: today, done: true }), today, tm));
  assert.ok(!dueSoon(task({}), today, tm));
});

test('задание: название, срок, описание без прошлых результатов ИИ, шаги и пожелания', () => {
  const b = taskBrief(
    task({ title: 'Презентация', date: '2026-11-26', time: '10:00', notes: 'Для отдела продаж\n\n— Результат ИИ, 2026-11-25 —\nстарый текст', checklist: [{ id: '1', text: 'Цифры за квартал', done: true }] }),
    '10 слайдов',
  );
  assert.match(b, /«Презентация»/);
  assert.match(b, /Срок: 2026-11-26 10:00/);
  assert.match(b, /Для отдела продаж/);
  assert.doesNotMatch(b, /старый текст/);
  assert.match(b, /- \[x\] Цифры за квартал/);
  assert.match(b, /Пожелания: 10 слайдов/);
});

test('результат: заголовок из «# …», текст без него', () => {
  const md = '# Презентация: итоги квартала\n\n## Слайд 1. Цели\n- рост';
  assert.equal(resultTitle(md, 'x'), 'Презентация: итоги квартала');
  assert.equal(resultBody(md), '## Слайд 1. Цели\n- рост');
  assert.equal(resultTitle('просто текст', 'Задача'), 'Задача');
});

test('голос: пауза после последнего слова заканчивает фразу, новые слова откладывают конец', async () => {
  const { silenceTimer } = await import('../src/voice/silence.ts');
  let fired = 0;
  const q = silenceTimer(40, () => fired++);
  q.bump();
  await new Promise((r) => setTimeout(r, 25));
  q.bump();
  await new Promise((r) => setTimeout(r, 25));
  assert.equal(fired, 0);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(fired, 1);
  q.bump();
  q.clear();
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(fired, 1);
});
