import { useRef, useState } from 'react';
import {
  Sparkle, X, Lightbulb, ListChecks, BookOpen, MagicWand, Translate, FileText, Scroll, PaperPlaneRight, Stop, ChatCircle, CaretLeft, Plus, Swap,
} from '@phosphor-icons/react';
import { useDoc } from '../store/docStore';
import { toast } from '../store/appStore';
import { PROMPTS, streamText, transformTopics, type ChatTurn, AIError } from '../ai/claude';
import { markdownToTopic, textToTopics } from '../io/markdown';
import { findInSheet, pathTo, walk } from '../utils/tree';
import type { Topic } from '../types';
import { newSheet } from '../store/docStore';

type Mode = 'menu' | 'run' | 'chat';

interface RunState {
  title: string;
  text: string;
  busy: boolean;
  error?: string;
  /** что делать с результатом */
  kind: 'children' | 'note' | 'replace' | 'summary' | 'info';
  targetId?: string;
}

export function AIPanel({ onClose }: { onClose(): void }) {
  const sheet = useDoc((s) => s.sheet());
  const selection = useDoc((s) => s.selection);
  const [mode, setMode] = useState<Mode>('menu');
  const [run, setRun] = useState<RunState | null>(null);
  const [extra, setExtra] = useState('');
  const [bigText, setBigText] = useState('');
  const [chat, setChat] = useState<ChatTurn[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  if (!sheet) return null;
  const selId = selection[selection.length - 1] ?? sheet.root.id;
  const sel = findInSheet(sheet, selId)?.topic ?? sheet.root;
  const selPath = pathTo(sheet, sel.id).map((t) => t.text || 'Без названия');

  const start = async (title: string, kind: RunState['kind'], p: { system: string; user: string }, targetId?: string, effort: 'low' | 'medium' | 'high' = 'medium') => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setMode('run');
    setRun({ title, text: '', busy: true, kind, targetId });
    try {
      const text = await streamText({
        system: p.system,
        messages: [{ role: 'user', content: p.user }],
        onText: (t) => setRun((r) => (r ? { ...r, text: t } : r)),
        signal: ac.signal,
        effort,
      });
      setRun((r) => (r ? { ...r, text, busy: false } : r));
    } catch (e) {
      setRun((r) => (r ? { ...r, busy: false, error: e instanceof AIError ? e.message : String(e) } : r));
    }
  };

  const stop = () => abortRef.current?.abort();

  const apply = (how?: 'newSheet') => {
    if (!run) return;
    const st = useDoc.getState();
    if (run.kind === 'children' && run.targetId) {
      const items = textToTopics(stripFences(run.text));
      if (!items.length) return toast('Не удалось разобрать ответ');
      st.insertChildren(run.targetId, items);
      toast(`Добавлено тем: ${items.length}`);
    } else if (run.kind === 'note' && run.targetId) {
      const cur = findInSheet(st.sheet()!, run.targetId)?.topic.note;
      st.updateTopic(run.targetId, { note: (cur ? cur + '\n\n' : '') + run.text.trim() });
      toast('Сохранено в заметку');
    } else if (run.kind === 'replace') {
      const root = markdownToTopic(stripFences(run.text));
      if (how === 'newSheet') {
        const sh = newSheet(root.text.slice(0, 40) || 'ИИ-карта');
        sh.root = root;
        st.addSheet(sh);
      } else st.replaceRoot(root);
      toast('Карта создана');
    } else if (run.kind === 'summary') {
      const rootId = st.sheet()!.root.id;
      st.updateTopic(rootId, { note: run.text.trim() });
      toast('Резюме сохранено в заметку центральной темы');
    }
    setMode('menu');
    setRun(null);
  };

  const transform = async (title: string, instruction: string, scope: 'selection' | 'all') => {
    const st = useDoc.getState();
    const sh = st.sheet()!;
    const topics: Topic[] = [];
    const roots = scope === 'all' ? [sh.root, ...sh.floating] : [sel];
    roots.forEach((r) => walk(r, (t) => void topics.push(t)));
    if (topics.length > 400) return toast('Слишком большая карта (более 400 тем)');
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setMode('run');
    setRun({ title, text: '', busy: true, kind: 'info' });
    try {
      const map = await transformTopics(topics, instruction, (t) => setRun((r) => (r ? { ...r, text: t } : r)), ac.signal);
      st.updateTopics([...map.keys()], (t) => void (t.text = map.get(t.id)!));
      setRun((r) => (r ? { ...r, busy: false, text: `Готово: изменено тем — ${map.size}.` } : r));
    } catch (e) {
      setRun((r) => (r ? { ...r, busy: false, error: e instanceof AIError ? e.message : String(e) } : r));
    }
  };

  const sendChat = async () => {
    const q = chatInput.trim();
    if (!q || chatBusy) return;
    const history: ChatTurn[] = [...chat, { role: 'user', content: q }];
    setChat([...history, { role: 'assistant', content: '' }]);
    setChatInput('');
    setChatBusy(true);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      await streamText({
        system: PROMPTS.chat(useDoc.getState().sheet()!),
        messages: history,
        onText: (t) => setChat([...history, { role: 'assistant', content: t }]),
        signal: ac.signal,
      });
    } catch (e) {
      setChat([...history, { role: 'assistant', content: '⚠️ ' + (e instanceof AIError ? e.message : String(e)) }]);
    } finally {
      setChatBusy(false);
    }
  };

  const header = (
    <div className="inspector-head">
      {mode !== 'menu' ? (
        <button className="icon-btn" onClick={() => { stop(); setMode('menu'); setRun(null); }} title="Назад">
          <CaretLeft />
        </button>
      ) : (
        <div className="ai-badge"><Sparkle size={17} weight="fill" /></div>
      )}
      <div className="bold grow">{mode === 'chat' ? 'Чат с картой' : mode === 'run' ? run?.title : 'ИИ-помощник'}</div>
      <button className="icon-btn" onClick={() => { stop(); onClose(); }} title="Закрыть">
        <X weight="bold" />
      </button>
    </div>
  );

  return (
    <aside className="inspector">
      {header}
      <div className="inspector-body scroll">
        {mode === 'menu' && (
          <div className="col">
            <div className="ai-target small">
              Тема: <b>{sel.text || 'Без названия'}</b>
            </div>
            <input className="input" placeholder="Пожелание (необязательно)" value={extra} onChange={(e) => setExtra(e.target.value)} />
            <AIAction icon={<Lightbulb weight="duotone" />} title="Мозговой штурм" desc="Новые идеи-подтемы для выбранной темы" onClick={() => start('Мозговой штурм', 'children', PROMPTS.expand(sheet, selPath, sel.children.map((c) => c.text), extra), sel.id, 'low')} />
            <AIAction icon={<ListChecks weight="duotone" />} title="Разбить на задачи" desc="План действий с чекбоксами" onClick={() => start('Разбить на задачи', 'children', PROMPTS.tasks(sheet, selPath), sel.id, 'low')} />
            <AIAction icon={<BookOpen weight="duotone" />} title="Объяснить тему" desc="Подробное пояснение в заметку" onClick={() => start('Объяснение', 'note', PROMPTS.explain(sheet, selPath), sel.id, 'low')} />
            <AIAction icon={<MagicWand weight="duotone" />} title="Улучшить формулировки" desc="Чётче и короче — для выбранной ветви" onClick={() => transform('Улучшение текста', 'Сделай формулировки чётче, короче и единообразнее, исправь ошибки. Смысл не меняй.' + (extra ? ' ' + extra : ''), 'selection')} />
            <AIAction
              icon={<Translate weight="duotone" />}
              title="Перевести карту"
              desc={`На язык: ${extra || 'английский'} (укажите в пожелании)`}
              onClick={() => transform('Перевод', `Переведи на ${extra || 'английский'} язык.`, 'all')}
            />
            <AIAction icon={<Scroll weight="duotone" />} title="Резюме карты" desc="Краткий пересказ и выводы" onClick={() => start('Резюме карты', 'summary', PROMPTS.summarize(sheet))} />
            <AIAction icon={<ChatCircle weight="duotone" />} title="Чат с картой" desc="Вопросы, идеи, обсуждение" onClick={() => setMode('chat')} />
            <div className="divider" />
            <label className="label"><FileText size={12} /> Текст → карта / Идея → карта</label>
            <textarea className="textarea" rows={4} placeholder="Вставьте статью, конспект или опишите идею: «План запуска кофейни»" value={bigText} onChange={(e) => setBigText(e.target.value)} />
            <div className="row">
              <button className="btn btn-sm grow" disabled={!bigText.trim()} onClick={() => start('Идея → карта', 'replace', PROMPTS.generate(bigText, 'normal'))}>
                <Sparkle size={14} /> Сгенерировать
              </button>
              <button className="btn btn-sm grow" disabled={bigText.trim().length < 40} onClick={() => start('Текст → карта', 'replace', PROMPTS.textToMap(bigText))}>
                <FileText size={14} /> Из текста
              </button>
            </div>
          </div>
        )}

        {mode === 'run' && run && (
          <div className="col">
            {run.error ? (
              <div className="ai-error">{run.error}</div>
            ) : (
              <pre className="ai-output">{run.text || (run.busy ? 'Думаю…' : '')}</pre>
            )}
            {run.busy ? (
              <button className="btn" onClick={stop}><Stop size={14} /> Остановить</button>
            ) : !run.error && run.kind !== 'info' ? (
              <div className="col">
                {run.kind === 'replace' ? (
                  <>
                    <button className="btn btn-primary" onClick={() => apply('newSheet')}><Plus size={16} /> На новый лист</button>
                    <button className="btn" onClick={() => apply()}><Swap size={16} /> Заменить текущую карту</button>
                  </>
                ) : (
                  <button className="btn btn-primary" onClick={() => apply()}>
                    <Plus size={16} /> {run.kind === 'children' ? 'Добавить в карту' : 'Сохранить в заметку'}
                  </button>
                )}
                <button className="btn btn-ghost" onClick={() => { setMode('menu'); setRun(null); }}>Отмена</button>
              </div>
            ) : (
              <button className="btn" onClick={() => { setMode('menu'); setRun(null); }}>Готово</button>
            )}
          </div>
        )}

        {mode === 'chat' && (
          <div className="chat">
            <div className="chat-list">
              {!chat.length && <div className="faint small" style={{ padding: 8 }}>Спросите что-нибудь о карте: «Чего не хватает?», «Какие риски?», «Предложи следующие шаги»</div>}
              {chat.map((m, i) => (
                <div key={i} className={`bubble ${m.role}`}>
                  {m.content || '…'}
                  {m.role === 'assistant' && !chatBusy && /^\s*[-*]\s+/m.test(m.content) && (
                    <button
                      className="btn btn-sm"
                      style={{ marginTop: 8 }}
                      onClick={() => {
                        const items = textToTopics(m.content.split('\n').filter((l) => /^\s*[-*]\s+/.test(l)).join('\n'));
                        useDoc.getState().insertChildren(sel.id, items);
                        toast(`Добавлено в «${sel.text}»: ${items.length}`);
                      }}
                    >
                      <Plus size={14} /> Вставить пункты в «{(sel.text || '').slice(0, 20)}»
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="row chat-input">
              <textarea
                className="textarea"
                rows={2}
                style={{ minHeight: 44 }}
                placeholder="Сообщение…"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendChat();
                  }
                }}
              />
              {chatBusy ? (
                <button className="icon-btn" onClick={stop}><Stop /></button>
              ) : (
                <button className="icon-btn active" onClick={sendChat}><PaperPlaneRight /></button>
              )}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

function AIAction({ icon, title, desc, onClick }: { icon: React.ReactNode; title: string; desc: string; onClick(): void }) {
  return (
    <button className="ai-action" onClick={onClick}>
      <span className="ai-action-icon">{icon}</span>
      <span className="col" style={{ gap: 0, textAlign: 'left' }}>
        <span className="bold">{title}</span>
        <span className="tiny muted">{desc}</span>
      </span>
    </button>
  );
}

export function stripFences(s: string) {
  return s.replace(/^```[a-z]*\n?/im, '').replace(/```\s*$/m, '').trim();
}
