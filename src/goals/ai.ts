import { AIError, streamText } from '../ai/claude';
import { daysBetween } from '../tasks/model';
import { addDaysYmd, todayYmd } from '../utils/mapTasks';
import type { Goal, LifeArea } from './model';

export interface AiStage {
  title: string;
  days?: number;
  steps: string[];
}

export interface StageDraft {
  title: string;
  deadline?: string;
  steps: string[];
}

const SYSTEM = `Ты — коуч по достижению целей. Разбиваешь цель на последовательные этапы с конкретными шагами.
Ответ — ТОЛЬКО JSON без пояснений и без Markdown, строго в формате:
{"stages":[{"title":"Название этапа","days":14,"steps":["Шаг 1","Шаг 2"]}]}
Правила:
- от 3 до 7 этапов, в каждом 2–6 шагов;
- шаги конкретные и выполнимые, начинаются с глагола, 2–8 слов;
- days — через сколько дней от сегодня этап должен быть завершён (числа по возрастанию);
- язык — как у цели (по умолчанию русский).`;

/** Попросить ИИ разбить цель на этапы и шаги */
export async function aiBreakdown(goal: Goal, area: LifeArea | undefined, opts: { signal?: AbortSignal; onText?: (s: string) => void } = {}): Promise<StageDraft[]> {
  const today = todayYmd();
  const lines = [
    `Цель: ${goal.emoji} ${goal.title}`,
    area ? `Сфера жизни: ${area.name}` : '',
    goal.why.trim() ? `Зачем это нужно: ${goal.why.trim()}` : '',
    goal.deadline ? `Срок: до ${goal.deadline} (осталось дней: ${Math.max(0, daysBetween(today, goal.deadline))})` : 'Срок не задан',
    goal.mode === 'target' && goal.target ? `Числовая цель: ${goal.target.target} ${goal.target.unit}` : '',
    goal.stages.length ? `Уже есть этапы (не повторяй их): ${goal.stages.map((s) => s.title).join('; ')}` : '',
    goal.notes.trim() ? `Заметки: ${goal.notes.trim().slice(0, 2000)}` : '',
    `Сегодня: ${today}`,
  ].filter(Boolean);
  const text = await streamText({
    system: SYSTEM,
    messages: [{ role: 'user', content: lines.join('\n') }],
    signal: opts.signal,
    onText: opts.onText,
    effort: 'low',
  });
  const stages = parseStages(text);
  if (!stages.length) throw new AIError('Не удалось разобрать ответ ИИ. Попробуйте ещё раз.');
  return toDrafts(goal, stages, today);
}

const str = (v: unknown): string => {
  if (typeof v === 'string') return v.trim();
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return str(o.title ?? o.text ?? o.name ?? o.step ?? '');
  }
  return '';
};

/** Разобрать ответ: JSON (в том числе внутри ```), иначе — Markdown-список */
export function parseStages(text: string): AiStage[] {
  const clean = text.replace(/```(?:json)?/gi, '').trim();
  const a = clean.search(/[[{]/);
  const b = Math.max(clean.lastIndexOf('}'), clean.lastIndexOf(']'));
  if (a >= 0 && b > a) {
    try {
      const raw: unknown = JSON.parse(clean.slice(a, b + 1));
      const o = raw as Record<string, unknown>;
      const arr = Array.isArray(raw) ? raw : Array.isArray(o.stages) ? o.stages : Array.isArray(o['этапы']) ? (o['этапы'] as unknown[]) : [];
      const out: AiStage[] = [];
      for (const it of arr as unknown[]) {
        const s = (it ?? {}) as Record<string, unknown>;
        const title = str(s.title ?? s.name ?? s['этап'] ?? (typeof it === 'string' ? it : ''));
        if (!title) continue;
        const stepsRaw = Array.isArray(s.steps) ? s.steps : Array.isArray(s['шаги']) ? (s['шаги'] as unknown[]) : [];
        const days = Number(s.days ?? s.deadlineDays);
        out.push({ title, steps: stepsRaw.map(str).filter(Boolean).slice(0, 12), ...(Number.isFinite(days) && days > 0 ? { days } : {}) });
      }
      if (out.length) return out.slice(0, 10);
    } catch {
      /* ниже — разбор как текста */
    }
  }
  // запасной вариант: «# Этап» / «1. Этап» / «- Этап» и вложенные «  - шаг»
  const out: AiStage[] = [];
  for (const line of clean.split('\n')) {
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    const t = line
      .trim()
      .replace(/^(#+|\d+[.)]|[-*•]|\[[ x]\])\s*/i, '')
      .replace(/^\[[ x]\]\s*/i, '')
      .replace(/\*\*/g, '')
      .trim();
    if (!t) continue;
    const isStage = indent < 2 && (/^(#|\d+[.)])/.test(line.trim()) || !out.length);
    if (isStage) out.push({ title: t.replace(/:$/, ''), steps: [] });
    else out[out.length - 1].steps.push(t);
  }
  return out.filter((s) => s.title.length < 120).slice(0, 10);
}

/** Сроки этапов: распределяем до срока цели (или берём days от ИИ) */
export function toDrafts(goal: Goal, stages: AiStage[], today = todayYmd()): StageDraft[] {
  const span = goal.deadline ? daysBetween(today, goal.deadline) : 0;
  const maxDays = Math.max(0, ...stages.map((s) => s.days ?? 0));
  return stages.map((s, i) => {
    let deadline: string | undefined;
    if (span > 0) {
      const frac = maxDays > 0 && s.days ? s.days / maxDays : (i + 1) / stages.length;
      deadline = addDaysYmd(today, Math.max(1, Math.round(frac * span)));
    } else if (!goal.deadline && s.days) deadline = addDaysYmd(today, Math.round(s.days));
    return { title: s.title, steps: s.steps, ...(deadline ? { deadline } : {}) };
  });
}
