/**
 * Голосовая команда: нажал на микрофон → сказал → задача / расход / привычка / заметка появилась.
 * Всё сохраняется сразу: окно так и говорит «Сохранено», сохранённое можно отменить крестиком или открыть.
 * Конец фразы приложение ловит само по паузе — кнопки «закончить» нет, но сфера по нажатию тоже заканчивает.
 */
import { useEffect, useRef, useState } from 'react';
import { ArrowUp, CaretRight, ChatCircleText, Check, CheckCircle, CheckSquare, Microphone, NotePencil, Plant, SpeakerHigh, SpeakerSlash, Wallet, X } from '@phosphor-icons/react';
import { canListen, listen, type Listening } from './listen';
import { execute, interpret, type Done, type VoiceAction } from './run';
import { haptic } from '../editor/touch';
import { isIOS } from '../io/download';
import { isNative } from '../platform';
import { closeVoice, useVoice } from './state';
import { speak, speakEnabled, setSpeakEnabled, stopSpeaking } from './speak';
import { t } from '../i18n/index';
import { Orb } from './Orb';
import './voice.css';

/** Окно открыто, пока VoiceHost в DOM; закрывается снаружи через closeVoice */
const close = closeVoice;

export default function VoiceHost() {
  const open = useVoice((s) => s.open);
  return open ? <VoiceSheet /> : null;
}

type Phase = 'listening' | 'thinking' | 'done' | 'idle' | 'unknown';
type Card = Done & { key: number; kind: VoiceAction['type']; undone?: boolean };

const KIND_ICON = { add_task: CheckSquare, add_transaction: Wallet, add_habit: Plant, add_note: NotePencil, add_journal: NotePencil, mark_done: CheckCircle, ask: ChatCircleText } as const;
const EXAMPLES = [t('Купить хлеб завтра в 9'), t('Каждый день выпивать 2 л воды'), t('Потратил 2000 на такси и 3500 на обед'), t('Выпил стакан воды'), t('Выполнил задачу купить хлеб'), t('Что у меня сегодня?'), t('Сколько я потратил за месяц?'), t('Новая привычка — читать 20 минут'), t('Запиши в дневник: сегодня пробежал 10 км')];

function VoiceSheet() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [heard, setHeard] = useState('');
  const [typed, setTyped] = useState('');
  const [cards, setCards] = useState<Card[]>([]);
  /** итог последней команды: что-то сохранено / только ответ на вопрос / не получилось */
  const [outcome, setOutcome] = useState<'saved' | 'answer' | 'failed'>('saved');
  const [error, setError] = useState('');
  const [voiceOut, setVoiceOut] = useState(speakEnabled);
  const [speaking, setSpeaking] = useState(false);
  const rec = useRef<Listening | null>(null);
  /** номер текущего прослушивания: нажатие на сферу или закрытие отменяют то, что ещё только запускается */
  const listenSeq = useRef(0);
  /** последний услышанный текст — нажатие на сферу сразу отправляет его, не дожидаясь распознавателя */
  const heardNow = useRef('');
  const listeningNow = useRef(false);
  const alive = useRef(true);
  const seq = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  /** сфера в окне: громкость голоса — CSS-переменной, без перерисовки React */
  const orbRef = useRef<HTMLButtonElement>(null);
  const setLevel = (l: number) => orbRef.current?.style.setProperty('--lvl', l.toFixed(2));
  const voiceOk = canListen();

  /** byVoice — фраза сказана голосом: тогда и ответ проговариваем */
  const run = async (text: string, byVoice = false) => {
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
      setOutcome(out.some((c) => c.ok && c.kind !== 'ask') ? 'saved' : out.some((c) => c.ok) ? 'answer' : 'failed');
      setPhase('done');
      haptic(15);
      const say = out.map((c) => c.say).filter(Boolean).join(' ');
      if (say && byVoice && speakEnabled()) {
        setSpeaking(true);
        void speak(say).finally(() => alive.current && setSpeaking(false));
      }
    } catch (e) {
      if (!alive.current) return;
      setError(e instanceof Error ? e.message : String(e));
      setPhase('idle');
    }
  };

  const start = async () => {
    if (rec.current) return;
    const my = ++listenSeq.current;
    const mine = () => alive.current && listenSeq.current === my;
    setError('');
    setHeard('');
    heardNow.current = '';
    listeningNow.current = true;
    setPhase('listening');
    haptic();
    const r = await listen({
      onLevel: (l) => mine() && setLevel(l),
      onText: (s) => {
        if (!mine()) return;
        heardNow.current = s;
        setHeard(s);
      },
      onDone: (s) => {
        if (!mine()) return;
        rec.current = null;
        listeningNow.current = false;
        listenSeq.current++;
        if (s.trim()) void run(s, true);
        else {
          setError(t('Ничего не услышал — нажмите на сферу и скажите ещё раз'));
          setPhase('idle');
        }
      },
      onError: (msg) => {
        if (!mine()) return;
        rec.current = null;
        listeningNow.current = false;
        listenSeq.current++;
        setError(msg);
        setPhase('idle');
      },
    });
    // пока микрофон запускался, нажали на сферу или закрыли окно
    if (!mine()) return r?.abort();
    rec.current = r;
    if (!r) {
      listeningNow.current = false;
      setPhase((p) => (p === 'listening' ? 'idle' : p));
    }
  };

  /** Нажали на сферу во время записи: сразу берём то, что уже услышали, а распознаватель гасим */
  const stop = () => {
    // повторное нажатие уже ничего не делает
    if (!listeningNow.current) return;
    listeningNow.current = false;
    listenSeq.current++;
    rec.current?.abort();
    rec.current = null;
    const s = heardNow.current.trim();
    haptic(10);
    if (s) void run(s, true);
    else setPhase('idle');
  };

  useEffect(() => {
    alive.current = true;
    if (voiceOk) void start();
    else setTimeout(() => inputRef.current?.focus(), 50);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => {
      alive.current = false;
      listenSeq.current++;
      rec.current?.abort();
      rec.current = null;
      void stopSpeaking();
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitTyped = () => {
    const t = typed.trim();
    if (!t || phase === 'thinking') return;
    listenSeq.current++;
    listeningNow.current = false;
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
        ? t('Слушаю…')
        : t('Говорите…')
      : phase === 'thinking'
        ? t('Разбираю команду…')
        : phase === 'unknown'
          ? t('Не понял команду — скажите иначе')
          : phase === 'done'
            ? outcome === 'saved'
              ? t('Сохранено')
              : outcome === 'answer'
                ? t('Ответ')
                : t('Не получилось')
            : voiceOk
              ? t('Нажмите на сферу и скажите команду')
              : t('Напишите команду');

  return (
    <div className="modal-backdrop vc-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal vc-sheet" role="dialog" aria-label={t('Голосовая команда')}>
        <button
          className="vc-speaker"
          onClick={() => {
            const on = !voiceOut;
            setVoiceOut(on);
            setSpeakEnabled(on);
            if (!on) void stopSpeaking();
          }}
          aria-label={voiceOut ? t('Не озвучивать ответы') : t('Озвучивать ответы')}
          title={voiceOut ? t('Ответы озвучиваются') : t('Ответы без звука')}
        >
          {voiceOut ? <SpeakerHigh size={18} weight="fill" /> : <SpeakerSlash size={18} weight="fill" />}
        </button>
        <button className="vc-close" onClick={close} aria-label={t('Закрыть')}>
          <X size={18} weight="bold" />
        </button>

        <div className="vc-top">
          {voiceOk && (
            <button
              ref={orbRef}
              className={`vc-orb${listening ? ' on' : ''}${phase === 'thinking' ? ' busy' : ''}`}
              onClick={() => (listening ? stop() : phase !== 'thinking' && void start())}
              aria-label={listening ? t('Закончить') : t('Сказать команду')}
            >
              <span className="vc-ring" />
              <span className="vc-ring r2" />
              <Orb size={92} state={listening ? 'listening' : phase === 'thinking' ? 'thinking' : speaking ? 'speaking' : 'idle'} />
            </button>
          )}
          <div className={`vc-status${phase === 'unknown' || (phase === 'done' && outcome === 'failed') ? ' warn' : ''}${phase === 'done' && outcome === 'saved' ? ' ok' : ''}`}>
            {phase === 'done' && outcome === 'saved' && <CheckCircle size={22} weight="fill" />}
            {status}
          </div>
          {heard ? <div className={`vc-heard${listening ? ' live' : ''}`}>«{heard}»</div> : null}
          {listening && <div className="vc-hint">{t('Закончу сам, когда вы замолчите')}</div>}
          {phase === 'done' && outcome === 'saved' && <div className="vc-hint">{t('Подтверждать не нужно — всё уже сохранено. Передумали — нажмите ✕.')}</div>}
          {error && <div className="vc-error">{error}</div>}
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
                    <span className="vc-label">{c.undone ? t('Отменено') : c.label}</span>
                    <span className="vc-title">{c.title}</span>
                    {c.meta && <span className="vc-meta">{c.meta}</span>}
                  </button>
                  {c.ok && !c.undone && c.undo ? (
                    <button className="vc-undo" onClick={() => void undo(c)} aria-label={t('Отменить')} title={t('Отменить')}>
                      <X size={18} weight="bold" />
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
            <div className="vc-ex-title">{t('Например')}</div>
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
              listenSeq.current++;
              listeningNow.current = false;
              rec.current?.abort();
              rec.current = null;
              setPhase('idle');
            }}
            placeholder={voiceOk ? t('Или напишите команду') : isIOS() && !isNative() ? t('Напишите или нажмите 🎤 на клавиатуре') : t('Например: купить хлеб завтра')}
            enterKeyHint="send"
          />
          <button type="submit" className="vc-send" disabled={!typed.trim() || phase === 'thinking'} aria-label={t('Выполнить')}>
            <ArrowUp size={18} weight="bold" />
          </button>
        </form>
        {phase === 'done' && (
          <div className="vc-actions">
            {voiceOk && (
              <button className="vc-again" onClick={() => void start()}>
                <Microphone size={18} weight="fill" /> {t('Ещё команда')}
              </button>
            )}
            <button className="vc-finish" onClick={close}>
              <Check size={18} weight="bold" /> {t('Готово')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
