import { useEffect, useMemo, useRef, useState } from 'react';
import { GraduationCap, Loader2, PartyPopper, Plus, Sparkles, Trash2, Undo2, X } from 'lucide-react';
import { onBack } from '../../ui/dialogs';
import { toast } from '../../store/appStore';
import { todayYmd } from '../../utils/mapTasks';
import type { StudyCard } from '../model';
import { GRADE_LABEL, type Grade, intervalLabel, nextInterval } from '../cardsCore';
import { addCard, closeCards, deleteCard, editCard, gradeCard, makeCards, restoreCard, todaysCards, useCardsUi } from '../cards';
import { openNote, useNotes } from '../store';
import { renderInline } from '../inline';

const GRADES: Grade[] = [0, 1, 2, 3];

/** Окна карточек: повторение и карточки заметки. Монтируется один раз в «Заметках» */
export function CardsLayer() {
  const ui = useCardsUi();
  if (ui.review) return <CardsReview />;
  if (ui.noteId) return <NoteCards noteId={ui.noteId} />;
  return null;
}

function useClose() {
  useEffect(() => onBack(() => (closeCards(), true)), []);
}

/** Повторение: вопрос → «Показать ответ» → оценка; забытые карточки возвращаются в конец очереди */
function CardsReview() {
  useClose();
  const cards = useNotes((s) => s.data?.cards);
  const notes = useNotes((s) => s.data?.notes);
  // очередь — снимок на начало повторения
  const [queue, setQueue] = useState<string[]>(() => todaysCards().map((c) => c.id));
  const [shown, setShown] = useState(false);
  const [done, setDone] = useState(0);
  const [last, setLast] = useState<{ prev: StudyCard; queue: string[]; done: number } | null>(null);
  const [total] = useState(queue.length);
  const card = cards?.find((c) => c.id === queue[0]);
  const note = card && notes?.find((n) => n.id === card.noteId);

  const grade = (g: Grade) => {
    if (!card) return;
    const prev = gradeCard(card.id, g);
    if (prev) setLast({ prev, queue, done });
    // не вспомнил — ещё раз в конце
    setQueue((q) => (g === 0 ? [...q.slice(1), q[0]] : q.slice(1)));
    if (g !== 0) setDone((n) => n + 1);
    setShown(false);
  };

  const undo = () => {
    if (!last) return;
    restoreCard(last.prev);
    setQueue(last.queue);
    setDone(last.done);
    setShown(true);
    setLast(null);
  };

  // клавиши: пробел — ответ, 1–4 — оценка
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (!card) return;
      if (!shown && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        setShown(true);
      } else if (shown && ['1', '2', '3', '4'].includes(e.key)) grade((Number(e.key) - 1) as Grade);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const tomorrow = useMemo(() => {
    if (card) return 0;
    const t = todayYmd();
    return (cards ?? []).filter((c) => c.due > t && c.due <= nextDay(t)).length;
  }, [card, cards]);

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && closeCards()}>
      <div className="modal nt-dups nt-cards" role="dialog" aria-label="Повторение карточек">
        <div className="nt-ask-head">
          <GraduationCap size={19} className="nt-ask-logo" />
          <h2 className="grow">Повторение</h2>
          {card && (
            <span className="nt-cards-count">
              {done + 1} из {Math.max(total, done + queue.length)}
            </span>
          )}
          <button className="icon-btn" onClick={closeCards} aria-label="Закрыть">
            <X size={20} />
          </button>
        </div>
        {!card ? (
          <div className="nt-cards-done">
            <PartyPopper size={36} />
            <b>{done ? 'На сегодня всё!' : 'Карточек на сегодня нет'}</b>
            <span>{done ? `Повторено: ${done}.` : 'Сделайте карточки из заметки: «⋯» в заметке → «Карточки для повторения».'}</span>
            {tomorrow > 0 && <span>Завтра: {tomorrow}.</span>}
            {last && (
              <button className="nt-ai-undo" onClick={undo}>
                <Undo2 size={14} /> Отменить последний ответ
              </button>
            )}
          </div>
        ) : (
          <div className="nt-cards-body">
            {note && (
              <button
                className="nt-cards-src"
                onClick={() => {
                  closeCards();
                  void openNote(note.id);
                }}
              >
                {note.title || 'Без названия'}
              </button>
            )}
            <div className="nt-cards-q">{renderInline(card.q)}</div>
            {shown ? (
              <>
                <div className="nt-cards-a">{renderInline(card.a)}</div>
                <div className="nt-cards-grades">
                  {GRADES.map((g) => (
                    <button key={g} className={`nt-cards-grade g${g}`} onClick={() => grade(g)}>
                      <b>{GRADE_LABEL[g]}</b>
                      <span>{intervalLabel(nextInterval(card, g))}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <button className="btn btn-primary nt-cards-show" onClick={() => setShown(true)}>
                Показать ответ
              </button>
            )}
            {last && (
              <button className="nt-ai-undo nt-cards-undo" onClick={undo}>
                <Undo2 size={14} /> Отменить
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function nextDay(ymd: string) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(y, m - 1, d + 1);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

/** Карточки заметки: сделать ИИ, добавить свою, исправить, удалить */
function NoteCards({ noteId }: { noteId: string }) {
  useClose();
  const all = useNotes((s) => s.data?.cards);
  const meta = useNotes((s) => s.data?.notes.find((n) => n.id === noteId));
  const cards = (all ?? []).filter((c) => c.noteId === noteId);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [a, setA] = useState('');
  const [edit, setEdit] = useState<string | null>(null);
  const ac = useRef<AbortController | null>(null);
  useEffect(() => () => ac.current?.abort(), []);
  const today = todayYmd();

  const make = async () => {
    if (busy) return ac.current?.abort();
    const c = (ac.current = new AbortController());
    setBusy(true);
    try {
      const n = await makeCards(noteId, c.signal);
      toast(n ? `Карточек добавлено: ${n}` : 'Новых карточек не получилось — всё главное уже есть');
    } catch (e) {
      if (!c.signal.aborted) toast(e instanceof Error ? e.message : 'Не удалось сделать карточки');
    } finally {
      setBusy(false);
    }
  };

  const add = () => {
    if (!addCard(noteId, q, a)) return toast('Нужны и вопрос, и ответ');
    setQ('');
    setA('');
  };

  const when = (c: StudyCard) => (c.due <= today ? 'сегодня' : `через ${intervalLabel(Math.round((new Date(c.due).getTime() - new Date(today).getTime()) / 86400000))}`);

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && closeCards()}>
      <div className="modal nt-dups nt-cards" role="dialog" aria-label="Карточки заметки">
        <div className="nt-ask-head">
          <GraduationCap size={19} className="nt-ask-logo" />
          <h2 className="grow ellipsis">Карточки: {meta?.title || 'Без названия'}</h2>
          <button className="icon-btn" onClick={closeCards} aria-label="Закрыть">
            <X size={20} />
          </button>
        </div>
        <p className="nt-dups-hint">Вопросы и ответы по заметке. Приложение покажет их снова, когда вы начнёте забывать: сначала через день, потом через неделю, месяц…</p>
        <div className="nt-syn-actions">
          <button className="nt-ai-btn" onClick={() => void make()}>
            {busy ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />}
            {busy ? 'Делаю… (нажмите, чтобы остановить)' : cards.length ? 'Ещё карточки ИИ' : 'Сделать карточки ИИ'}
          </button>
        </div>
        <div className="nt-dups-list">
          {cards.map((c) =>
            edit === c.id ? (
              <CardEdit key={c.id} card={c} onDone={() => setEdit(null)} />
            ) : (
              <div key={c.id} className="nt-card-row">
                <button className="nt-card-text" onClick={() => setEdit(c.id)} title="Исправить">
                  <b>{c.q}</b>
                  <span>{c.a}</span>
                  <i>{when(c)}</i>
                </button>
                <button className="icon-btn nt-syn-del" onClick={() => deleteCard(c.id)} aria-label="Удалить карточку">
                  <Trash2 size={16} />
                </button>
              </div>
            ),
          )}
          <form
            className="nt-card-new"
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <input className="nt-syn-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Свой вопрос" aria-label="Вопрос" />
            <input className="nt-syn-input" value={a} onChange={(e) => setA(e.target.value)} placeholder="Ответ" aria-label="Ответ" />
            <button className="nt-syn-add" type="submit" disabled={!q.trim() || !a.trim()} aria-label="Добавить карточку">
              <Plus size={18} />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function CardEdit({ card, onDone }: { card: StudyCard; onDone: () => void }) {
  const [q, setQ] = useState(card.q);
  const [a, setA] = useState(card.a);
  return (
    <form
      className="nt-card-new is-edit"
      onSubmit={(e) => {
        e.preventDefault();
        editCard(card.id, { q, a });
        onDone();
      }}
    >
      <input className="nt-syn-input" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Вопрос" autoFocus />
      <input className="nt-syn-input" value={a} onChange={(e) => setA(e.target.value)} aria-label="Ответ" />
      <button className="nt-ai-btn" type="submit">
        Готово
      </button>
    </form>
  );
}
