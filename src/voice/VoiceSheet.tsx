/**
 * Голосовая команда: нажал на микрофон → сказал → задача / расход / привычка / заметка появилась.
 * Результат можно сразу отменить или открыть.
 */
import { useEffect, useRef, useState } from 'react';
import { ArrowCounterClockwise, ArrowUp, CaretRight, CheckSquare, Microphone, NotePencil, Plant, Wallet, X } from '@phosphor-icons/react';
import { canListen, listen, type Listening } from './listen';
import { execute, interpret, type Done, type VoiceAction } from './run';
import { haptic } from '../editor/touch';
import { isIOS } from '../io/download';
import { isNative } from '../platform';
import { closeVoice, useVoice } from './state';
import './voice.css';

/** Окно открыто, пока VoiceHost в DOM; закрывается снаружи через closeVoice */
const close = closeVoice;

export default function VoiceHost() {
  const open = useVoice((s) => s.open);
  return open ? <VoiceSheet /> : null;
}

type Phase = 'listening' | 'thinking' | 'done' | 'idle' | 'unknown';
type Card = Done & { key: number; kind: VoiceAction['type']; undone?: boolean };

const KIND_ICON = { add_task: CheckSquare, add_transaction: Wallet, add_habit: Plant, add_note: NotePencil } as const;
const EXAMPLES = ['Купить хлеб завтра в 9', 'Каждый день выпивать 2 л воды', 'Потратил 4500 на одежду', 'Получил зарплату 300 тысяч', 'Новая привычка — читать 20 минут', 'Запиши заметку: идея подарка маме'];

function VoiceSheet() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [heard, setHeard] = useState('');
  const [typed, setTyped] = useState('');
  const [cards, setCards] = useState<Card[]>([]);
  const [error, setError] = useState('');
  const rec = useRef<Listening | null>(null);
  const alive = useRef(true);
  const seq = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const voiceOk = canListen();

  const run = async (text: string) => {
    const t = text.trim();
    if (!t) return;
    setHeard(t);
    setError('');
    setPhase('thinking');
    try {
      const { actions } = await interpret(t);
      if (!alive.current) return;
      if (!actions.length) {
        setPhase('unknown');
        return;
      }
      const out: Card[] = [];
      for (const a of actions) out.push({ ...(await execute(a)), key: ++seq.current, kind: a.type });
      if (!alive.current) return;
      setCards((c) => [...out, ...c]);
      setPhase('done');
      haptic(15);
    } catch (e) {
      if (!alive.current) return;
      setError(e instanceof Error ? e.message : String(e));
      setPhase('idle');
    }
  };

  const start = async () => {
    if (rec.current) return;
    setError('');
    setHeard('');
    setPhase('listening');
    haptic();
    const r = await listen({
      onText: (t) => alive.current && setHeard(t),
      onDone: (t) => {
        rec.current = null;
        if (!alive.current) return;
        if (t.trim()) void run(t);
        else {
          setError('Ничего не услышал — нажмите на микрофон и скажите ещё раз');
          setPhase('idle');
        }
      },
      onError: (msg) => {
        rec.current = null;
        if (!alive.current) return;
        setError(msg);
        setPhase('idle');
      },
    });
    if (!alive.current) return r?.abort();
    rec.current = r;
    if (!r) setPhase((p) => (p === 'listening' ? 'idle' : p));
  };

  const stop = () => rec.current?.stop();

  useEffect(() => {
    alive.current = true;
    if (voiceOk) void start();
    else setTimeout(() => inputRef.current?.focus(), 50);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => {
      alive.current = false;
      rec.current?.abort();
      rec.current = null;
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitTyped = () => {
    const t = typed.trim();
    if (!t || phase === 'thinking') return;
    rec.current?.abort();
    rec.current = null;
    setTyped('');
    inputRef.current?.blur();
    void run(t);
  };

  const undo = async (c: Card) => {
    await c.undo?.();
    setCards((cs) => cs.map((x) => (x.key === c.key ? { ...x, undone: true } : x)));
  };

  const listening = phase === 'listening';
  const status =
    phase === 'listening'
      ? heard
        ? 'Слушаю…'
        : 'Говорите…'
      : phase === 'thinking'
        ? 'Разбираю команду…'
        : phase === 'unknown'
          ? 'Не понял команду — скажите иначе'
          : phase === 'done'
            ? 'Готово'
            : voiceOk
              ? 'Нажмите на микрофон и скажите команду'
              : 'Напишите команду';

  return (
    <div className="modal-backdrop vc-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal vc-sheet" role="dialog" aria-label="Голосовая команда">
        <button className="vc-close" onClick={close} aria-label="Закрыть">
          <X size={18} weight="bold" />
        </button>

        <div className="vc-top">
          {voiceOk && (
            <button
              className={`vc-orb${listening ? ' on' : ''}${phase === 'thinking' ? ' busy' : ''}`}
              onClick={() => (listening ? stop() : phase !== 'thinking' && void start())}
              aria-label={listening ? 'Закончить' : 'Сказать команду'}
            >
              <span className="vc-ring" />
              <span className="vc-ring r2" />
              <Microphone size={34} weight="fill" />
            </button>
          )}
          <div className={`vc-status${phase === 'unknown' ? ' warn' : ''}`}>{status}</div>
          {heard ? <div className={`vc-heard${listening ? ' live' : ''}`}>«{heard}»</div> : null}
          {error && <div className="vc-error">{error}</div>}
          {listening && (
            <button className="vc-stop" onClick={stop}>
              Готово
            </button>
          )}
        </div>

        {cards.length > 0 && (
          <div className="vc-cards">
            {cards.map((c) => {
              const Icon = KIND_ICON[c.kind];
              return (
                <div key={c.key} className={`vc-card k-${c.kind}${c.undone ? ' undone' : ''}${c.ok ? '' : ' fail'}`}>
                  <span className="vc-ico">
                    <Icon size={20} weight="fill" />
                  </span>
                  <button className="vc-card-body" onClick={() => !c.undone && c.open && (close(), c.open())} disabled={c.undone || !c.open}>
                    <span className="vc-label">{c.undone ? 'Отменено' : c.label}</span>
                    <span className="vc-title">{c.title}</span>
                    {c.meta && <span className="vc-meta">{c.meta}</span>}
                  </button>
                  {c.ok && !c.undone && c.undo ? (
                    <button className="vc-undo" onClick={() => void undo(c)} aria-label="Отменить" title="Отменить">
                      <ArrowCounterClockwise size={18} weight="bold" />
                    </button>
                  ) : c.open && !c.undone ? (
                    <CaretRight size={16} className="vc-caret" />
                  ) : null}
                </div>
              );
            })}
          </div>
        )}

        {(phase === 'idle' || phase === 'unknown' || (listening && !heard)) && !cards.length && (
          <div className="vc-examples">
            <div className="vc-ex-title">Например</div>
            {EXAMPLES.map((x) => (
              <button key={x} className="vc-ex" onClick={() => (setTyped(x), inputRef.current?.focus())}>
                «{x}»
              </button>
            ))}
          </div>
        )}

        <form
          className="vc-input"
          onSubmit={(e) => {
            e.preventDefault();
            submitTyped();
          }}
        >
          <input
            ref={inputRef}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onFocus={() => {
              if (!listening) return;
              rec.current?.abort();
              rec.current = null;
              setPhase('idle');
            }}
            placeholder={voiceOk ? 'Или напишите команду' : isIOS() && !isNative() ? 'Напишите или нажмите 🎤 на клавиатуре' : 'Например: купить хлеб завтра'}
            enterKeyHint="send"
          />
          <button type="submit" className="vc-send" disabled={!typed.trim() || phase === 'thinking'} aria-label="Выполнить">
            <ArrowUp size={18} weight="bold" />
          </button>
        </form>
        {phase === 'done' && voiceOk && (
          <button className="vc-again" onClick={() => void start()}>
            <Microphone size={18} weight="fill" /> Ещё команда
          </button>
        )}
      </div>
    </div>
  );
}
