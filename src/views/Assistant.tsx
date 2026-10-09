import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, CalendarCheck, CircleAlert, PencilLine, Sparkles, Square, Target, Trash2, Wallet } from 'lucide-react';
import { AIError, streamText, type ChatTurn } from '../ai/claude';
import { confirmDialog } from '../ui/dialogs';
import { uid } from '../utils/tree';
import { BriefingCard } from '../assistant/BriefingCard';
import { FirstSteps } from '../onboarding/FirstSteps';
import { WeeklyReviewCard } from '../review/WeeklyEntry';
import { MessageView, StreamingView } from '../assistant/ChatParts';
import { buildContext, systemPrompt } from '../assistant/context';
import { describeAction, parseActions, toItems } from '../assistant/actions';
import { addMessage, clearChat, ensureChat, removeMessage, setChatBusy, useChat, type ChatMessage } from '../assistant/history';
import './assistant.css';
import { IconTile } from '../ui/icons';

interface Suggestion {
  label: string;
  icon: typeof Sparkles;
  prompt: string;
  /** только вставить в поле (пользователь допишет) */
  fill?: boolean;
}

const SUGGESTIONS: Suggestion[] = [
  { label: 'Спланируй мой день', icon: CalendarCheck, prompt: 'Спланируй мой день: расставь задачи по времени с учётом приоритетов и предложи, что перенести.' },
  { label: 'Что просрочено?', icon: CircleAlert, prompt: 'Что у меня просрочено? Предложи, что сделать сегодня, а что перенести.' },
  { label: 'Разбей цель на шаги', icon: Target, prompt: 'Помоги разбить мою главную активную цель на этапы и конкретные шаги.' },
  { label: 'Сколько я потратил в этом месяце?', icon: Wallet, prompt: 'Сколько я потратил в этом месяце и на что больше всего? Дай короткие выводы.' },
  { label: 'Запиши задачу…', icon: PencilLine, prompt: 'Запиши задачу: ', fill: true },
];

const stamp = () => Date.now();

/** История для модели: без ошибок, последние 20, роли чередуются, первой идёт реплика пользователя */
function toTurns(messages: ChatMessage[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (const m of messages.filter((x) => !x.error).slice(-20)) {
    let content = m.text;
    if (m.role === 'assistant' && m.actions?.length) {
      const list = m.actions.map((a) => {
        const v = describeAction(a);
        return `${v.label}: «${v.title}» — ${a.status === 'done' ? 'выполнено' : a.status === 'error' ? 'ошибка' : 'не подтверждено'}`;
      });
      content += `\n\n[Предложенные действия: ${list.join('; ')}]`;
    }
    if (!content.trim()) continue;
    const last = turns[turns.length - 1];
    if (last && last.role === m.role) last.content += '\n\n' + content;
    else turns.push({ role: m.role, content });
  }
  while (turns.length && turns[0].role !== 'user') turns.shift();
  return turns;
}

export default function Assistant() {
  // ИИ есть у всех: свой ключ Claude или бесплатный ИИ на сервере
  const hasKey = true;
  const messages = useChat((s) => s.messages);
  const loaded = useChat((s) => s.loaded);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState<string | null>(null);
  const [kb, setKb] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const liveRef = useRef('');
  const stickRef = useRef(false);

  useEffect(() => {
    void ensureChat();
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // экранная клавиатура: страница занимает только видимую часть экрана
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const f = () => setKb(window.innerHeight - vv.height > 140);
    vv.addEventListener('resize', f);
    f();
    return () => vv.removeEventListener('resize', f);
  }, []);

  // автопрокрутка вниз — пока пользователь у нижнего края
  const nearBottom = () => {
    const el = scrollRef.current;
    return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };
  const scrollDown = (smooth = false) => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  };
  useLayoutEffect(() => {
    if (stickRef.current) scrollDown();
  }, [messages, streaming]);
  // открыли раздел с уже свёрнутым брифингом — сразу к последним сообщениям
  useLayoutEffect(() => {
    if (loaded && document.querySelector('.as-brief.collapsed')) scrollDown();
  }, [loaded]);
  useEffect(() => {
    if (kb && stickRef.current) scrollDown();
  }, [kb]);

  // высота поля ввода — по содержимому (до ~6 строк)
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  }, [input, hasKey]);

  async function send(raw: string) {
    const text = raw.trim();
    if (!text || streaming !== null) return;
    const now = stamp();
    addMessage({ id: uid(), role: 'user', text, at: now, updatedAt: now });
    setInput('');
    stickRef.current = true;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    liveRef.current = '';
    setStreaming('');
    setChatBusy(true);
    try {
      const context = await buildContext();
      const full = await streamText({
        system: systemPrompt(context),
        messages: toTurns(useChat.getState().messages),
        signal: ctrl.signal,
        effort: 'medium',
        onText: (s) => {
          liveRef.current = s;
          setStreaming(parseActions(s).text);
        },
      });
      const { text: answer, actions } = parseActions(full);
      const at = stamp();
      addMessage({
        id: uid(),
        role: 'assistant',
        text: answer || (actions.length ? 'Вот что предлагаю:' : 'Пустой ответ. Попробуйте переформулировать.'),
        at,
        updatedAt: at,
        ...(actions.length ? { actions: toItems(actions) } : {}),
      });
    } catch (e) {
      const at = stamp();
      const partial = parseActions(liveRef.current).text;
      if (ctrl.signal.aborted) {
        if (partial) addMessage({ id: uid(), role: 'assistant', text: partial + '\n\n*(остановлено)*', at, updatedAt: at });
      } else {
        addMessage({ id: uid(), role: 'assistant', text: e instanceof AIError ? e.message : 'Не удалось получить ответ. Попробуйте ещё раз.', at, updatedAt: at, error: true });
      }
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
      setStreaming(null);
      setChatBusy(false);
    }
  }

  /** Повторить: убрать ошибку и отправить последний вопрос заново */
  function retry(errId: string) {
    const list = useChat.getState().messages;
    const i = list.findIndex((m) => m.id === errId);
    const q = [...list.slice(0, i)].reverse().find((m) => m.role === 'user');
    removeMessage(errId);
    if (q) {
      removeMessage(q.id);
      void send(q.text);
    }
  }

  const pick = (s: Suggestion) => {
    if (s.fill) {
      setInput(s.prompt);
      // фокус прямо в обработчике касания — иначе iPhone не покажет клавиатуру
      const el = inputRef.current;
      if (el) {
        el.focus();
        requestAnimationFrame(() => el.setSelectionRange(el.value.length, el.value.length));
      }
    } else void send(s.prompt);
  };

  const onClear = async () => {
    if (!messages.length) return;
    if (await confirmDialog('Очистить чат?', 'История переписки с ассистентом будет удалена на всех устройствах.', { okText: 'Очистить', danger: true })) clearChat();
  };

  const busy = streaming !== null;
  const empty = loaded && !messages.length && !busy;
  const coarse = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

  return (
    <div className={`page as-page${kb ? ' kb-open' : ''}${hasKey ? '' : ' no-composer'}`}>
      <div className="page-header">
        <IconTile section="assistant" size="sm" className="ph-tile" />
        <h1>Ассистент</h1>
        <span className="grow" />
        {hasKey && messages.length > 0 && (
          <button className="icon-btn" onClick={() => void onClear()} title="Очистить чат" aria-label="Очистить чат" disabled={busy}>
            <Trash2 />
          </button>
        )}
      </div>

      <div
        className="as-scroll"
        data-navscroll=""
        ref={scrollRef}
        onScroll={() => {
          stickRef.current = nearBottom();
        }}
      >
        <div className="as-inner">
          <BriefingCard hasKey={hasKey} />
          <FirstSteps />
          <WeeklyReviewCard />

          {empty ? (
            <div className="as-welcome">
              <div className="as-welcome-badge">
                <Sparkles size={22} />
              </div>
              <h3>Чем помочь?</h3>
              <p className="muted small">Я вижу ваши задачи, привычки, цели и финансы. Могу спланировать день, найти просрочку, разбить цель на шаги или записать задачу.</p>
              <div className="as-suggest">
                {SUGGESTIONS.map((s) => (
                  <button key={s.label} className="as-suggest-item" onClick={() => pick(s)}>
                    <s.icon size={17} />
                    <span>{s.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="as-thread">
              {messages.map((m) => (
                <MessageView key={m.id} msg={m} onRetry={m.error ? () => retry(m.id) : undefined} />
              ))}
              {busy && <StreamingView text={streaming ?? ''} />}
            </div>
          )}
        </div>
      </div>

      {hasKey && (
        <div className="as-composer">
          {!empty && !busy && !input && (
            <div className="as-chips">
              {SUGGESTIONS.map((s) => (
                <button key={s.label} className="chip as-chip" onClick={() => pick(s)}>
                  <s.icon size={13} />
                  {s.label}
                </button>
              ))}
            </div>
          )}
          <form
            className="as-input-row"
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
          >
            <textarea
              ref={inputRef}
              className="as-input"
              rows={1}
              value={input}
              placeholder="Спросите или попросите что-нибудь…"
              enterKeyHint={coarse ? 'enter' : 'send'}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !coarse && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send(input);
                }
              }}
            />
            {busy ? (
              <button type="button" className="as-send stop" onClick={() => abortRef.current?.abort()} aria-label="Остановить">
                <Square size={14} fill="currentColor" />
              </button>
            ) : (
              <button
                type="submit"
                className="as-send"
                disabled={!input.trim()}
                aria-label="Отправить"
                // не забирать фокус у поля: клавиатура на телефоне не закрывается
                onMouseDown={(e) => e.preventDefault()}
              >
                <ArrowUp size={18} />
              </button>
            )}
          </form>
        </div>
      )}
    </div>
  );
}
