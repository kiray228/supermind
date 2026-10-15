/**
 * Длинная голосовая мысль → ИИ раскладывает её на заметку, задачи с датами и запись в заметку дня.
 * «Разбери: …» — разобрать так даже короткую фразу. Модуль чистый — тесты гоняют его в Node.
 */
import type { VoiceAction } from './intent';

/** длиннее — уже не команда, а мысль, которую стоит разобрать */
export const LONG_WORDS = 22;

const FORCE_RE = /^(?:разбери|разложи|раскидай)(?:\s+(?:это|мысль|запись))?[\s,:—–-]+/iu;

/** Явная просьба разобрать («Разбери: …») — текст без неё; иначе null */
export function forcedSplit(text: string): string | null {
  const m = FORCE_RE.exec(text.trim());
  return m ? text.trim().slice(m[0].length).trim() || null : null;
}

/** Длинная мысль (много слов или несколько предложений) */
export function isLongDictation(text: string): boolean {
  const t = text.trim();
  const words = t.split(/\s+/).filter(Boolean).length;
  const sentences = t.split(/[.!?…]+\s+/).filter((s) => s.trim().split(/\s+/).length >= 3).length;
  return words >= LONG_WORDS || (sentences >= 3 && words >= 14);
}

const WD = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

export const SPLIT_SYSTEM = `Ты разбираешь голосовую запись человека (распознанную речь, без знаков препинания и с ошибками) для его личного приложения.
Разложи её на части:
— note: мысль, идея, знание, план — то, что стоит сохранить заметкой. title — короткое название (до 60 символов), text — аккуратный текст в markdown (исправь ошибки распознавания, расставь знаки, списки — «- »). Если сохранять заметкой нечего — null.
— tasks: конкретные дела («позвонить», «купить», «записаться»…). title — коротко, с глагола; date — YYYY-MM-DD, если в речи есть когда («завтра», «в пятницу», «15-го»); time — HH:MM, если названо время. Нет дел — [].
— journal: что произошло и как человек себя чувствует сегодня — запись в дневник (1–3 предложения от первого лица). Нет — null.
Одно и то же не повторяй в разных частях: дело — в tasks, а не в тексте заметки. Ничего не придумывай.
Ответ — ТОЛЬКО JSON: {"note":{"title":"…","text":"…"}|null,"tasks":[{"title":"…","date":"…","time":"…"}],"journal":"…"|null}`;

export function buildSplitPrompt(text: string, now = new Date()): string {
  const ymd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return `Сегодня ${ymd} (${WD[now.getDay()]}), сейчас ${hm}.\n\nЗапись:\n${text.trim()}`;
}

const str = (x: unknown, max: number) => (typeof x === 'string' && x.trim() ? x.trim().slice(0, max) : undefined);
const ymd = (x: unknown) => {
  const s = str(x, 10);
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(y, m - 1, d);
  return t.getMonth() === m - 1 && t.getDate() === d && y > 2000 ? s : undefined;
};
const hhmm = (x: unknown) => {
  const m = str(x, 5)?.match(/^(\d{1,2}):(\d{2})$/);
  return m && +m[1] < 24 && +m[2] < 60 ? `${m[1].padStart(2, '0')}:${m[2]}` : undefined;
};

/** Ответ ИИ → действия голосового окна (заметка, задачи, запись в дневник). Непонятный ответ — [] */
export function parseSplit(answer: string): VoiceAction[] {
  const fenced = answer.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const src = fenced ? fenced[1] : answer;
  const a = src.indexOf('{');
  const b = src.lastIndexOf('}');
  if (a < 0 || b <= a) return [];
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(src.slice(a, b + 1));
  } catch {
    return [];
  }
  if (!o || typeof o !== 'object') return [];
  const out: VoiceAction[] = [];
  const note = o.note as Record<string, unknown> | null | undefined;
  if (note && typeof note === 'object') {
    const text = str(note.text, 8000) ?? '';
    const title = str(note.title, 80) ?? text.split('\n')[0].slice(0, 60);
    if (title) out.push({ type: 'add_note', title, text });
  }
  const seen = new Set<string>();
  for (const t of Array.isArray(o.tasks) ? o.tasks.slice(0, 10) : []) {
    if (!t || typeof t !== 'object') continue;
    const r = t as Record<string, unknown>;
    const title = str(r.title, 200);
    if (!title || seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());
    const date = ymd(r.date);
    const time = date ? hhmm(r.time) : undefined;
    out.push({ type: 'add_task', title, ...(date ? { date } : {}), ...(time ? { time } : {}) });
  }
  const journal = str(o.journal, 2000);
  if (journal) out.push({ type: 'add_journal', text: journal, section: 'thoughts' });
  return out;
}
