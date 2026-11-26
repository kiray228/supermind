/** «Сделать с ИИ»: встроенный ИИ сразу делает результат (презентацию, текст, письмо…) и кладёт его в заметки */
import { useEffect, useRef, useState } from 'react';
import { Check, Copy, NotePencil, Sparkle, Stop, X } from '@phosphor-icons/react';
import { closeAiDo, useAiDo } from '../aiDoState';
import { aiNoteAlive, doTaskWithAi, openAiNote } from '../aiRun';
import { toggleDone, useTasks } from '../store';
import { whenLabel } from '../model';
import { toast } from '../../store/appStore';
import { Markdown } from '../../assistant/Markdown';
import { Orb } from '../../voice/Orb';
import { t } from '../../i18n/index';
import '../../views/assistant.css';
import './aido.css';

export default function AiDoHost() {
  const id = useAiDo((s) => s.taskId);
  const task = useTasks((s) => (id ? s.data?.tasks.find((x) => x.id === id) : undefined));
  if (!id || !task) return null;
  return <AiDoSheet key={id} taskId={id} />;
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function AiDoSheet({ taskId }: { taskId: string }) {
  const task = useTasks((s) => s.data?.tasks.find((x) => x.id === taskId))!;
  const [wish, setWish] = useState('');
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState('');
  const [noteId, setNoteId] = useState<string | null>(null);
  const [prevNote, setPrevNote] = useState(false);
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    void aiNoteAlive(task.aiNoteId).then(setPrevNote);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeAiDo();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      abort.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async () => {
    // прошлый вариант — вернуть на экран, если новый остановили или он не получился
    const prev = { out, noteId };
    setBusy(true);
    setError('');
    setOut('');
    setNoteId(null);
    const ac = new AbortController();
    abort.current = ac;
    try {
      const r = await doTaskWithAi(task, wish, setOut, ac.signal);
      // «Ещё вариант» заменяет прошлый вариант из этого окна (он уходит в корзину — его можно вернуть), а не плодит дубли
      if (prev.noteId && prev.noteId !== r.noteId) void import('../../notes/store').then((m) => m.trashNote(prev.noteId!));
      setOut(r.text);
      setNoteId(r.noteId);
    } catch (e) {
      if (!ac.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      setOut(prev.out);
      setNoteId(prev.noteId);
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };

  return (
    <div className="modal-backdrop aid-backdrop" onPointerDown={(e) => e.target === e.currentTarget && !busy && closeAiDo()}>
      <div className="modal aid-sheet" role="dialog" aria-label={t('Сделать с ИИ')}>
        <button className="aid-close" onClick={closeAiDo} aria-label={t('Закрыть')}>
          <X size={18} weight="bold" />
        </button>
        <div className="aid-head">
          <Orb size={44} state={busy ? 'thinking' : 'idle'} />
          <div className="aid-head-x">
            <small>{t('ИИ сделает за вас')}</small>
            <b>{task.title || t('Без названия')}</b>
            {task.date && <span className="aid-when">{whenLabel(task)}</span>}
          </div>
        </div>

        {!out && !busy && (
          <>
            <textarea
              className="aid-wish"
              rows={2}
              value={wish}
              onChange={(e) => setWish(e.target.value)}
              placeholder={t('Пожелания, если есть: «10 слайдов, для начальства», «коротко и по делу»…')}
            />
            <button className="aid-main" onClick={() => void run()}>
              <Sparkle size={20} weight="fill" />
              <span>
                <b>{t('Сделать сейчас')}</b>
                <small>{t('Встроенный ИИ SuperMind · результат сохранится в заметки')}</small>
              </span>
            </button>
            {prevNote && task.aiNoteId && (
              <button className="aid-link" onClick={() => (closeAiDo(), void openAiNote(task.aiNoteId!))}>
                <NotePencil size={15} /> {t('Открыть прошлый результат')}
              </button>
            )}
          </>
        )}

        {(busy || out) && (
          <div className="aid-out">
            {out ? <Markdown text={out} /> : <p className="aid-wait">{t('Думаю над задачей…')}</p>}
          </div>
        )}
        {error && <div className="aid-error">{error}</div>}

        {busy && (
          <button className="aid-btn" onClick={() => abort.current?.abort()}>
            <Stop size={16} weight="fill" /> {t('Остановить')}
          </button>
        )}
        {!busy && noteId && (
          <div className="aid-done">
            <p className="aid-saved">
              <Check size={15} weight="bold" /> {t('Сохранено в заметки и привязано к задаче')}
            </p>
            <div className="aid-row">
              <button className="aid-btn primary" onClick={() => (closeAiDo(), void openAiNote(noteId))}>
                <NotePencil size={16} /> {t('Открыть')}
              </button>
              <button className="aid-btn" onClick={() => void copy(out).then((ok) => ok && toast(t('Скопировано')))}>
                <Copy size={16} /> {t('Копировать')}
              </button>
              <button className="aid-btn" onClick={() => void run()}>
                <Sparkle size={16} /> {t('Ещё вариант')}
              </button>
            </div>
            {!task.done && (
              <button
                className="aid-link"
                onClick={() => {
                  toggleDone(task.id);
                  closeAiDo();
                }}
              >
                <Check size={15} weight="bold" /> {t('Задача сделана — отметить')}
              </button>
            )}
          </div>
        )}
        {!busy && error && !out && (
          <button className="aid-btn" onClick={() => void run()}>
            {t('Попробовать ещё раз')}
          </button>
        )}
      </div>
    </div>
  );
}
