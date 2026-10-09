import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Sparkles, Undo2, X } from 'lucide-react';
import type { ID } from '../../types';
import { toast } from '../../store/appStore';
import { noteDate } from '../model';
import { type ReviewSummary, reviewNote, reviewState, setLinkVerdict } from '../aiReview';
import { openLinkedNote, useNotes } from '../store';

/** Проверка связей ИИ под связанными заметками: статус, запуск и итог с отменой */
export function AiReviewPanel({ id }: { id: ID }) {
  const notes = useNotes((s) => s.data?.notes);
  // статус перечитывается при каждом изменении индекса (там же хранятся решения ИИ)
  useNotes((s) => s.data?.aiTerms);
  const st = reviewState(id);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ReviewSummary | null>(null);
  /** «Вернуть»/«Убрать» в итоге: что человек уже поменял */
  const [overridden, setOverridden] = useState<Record<ID, boolean>>({});
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const titleOf = (x: ID) => {
    const m = notes?.find((n) => n.id === x);
    return m ? m.title || m.preview.slice(0, 40) || 'Без названия' : 'Заметка удалена';
  };

  const run = async () => {
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setRunning(true);
    setResult(null);
    setOverridden({});
    try {
      const r = await reviewNote(id, ac.signal);
      if (!ac.signal.aborted) setResult(r);
    } catch (e) {
      if (!ac.signal.aborted) toast(e instanceof Error ? e.message : 'Не удалось проверить');
    } finally {
      if (abort.current === ac) {
        abort.current = null;
        setRunning(false);
      }
    }
  };

  const toggle = (other: ID, ok: boolean) => {
    setLinkVerdict(id, other, ok);
    setOverridden((o) => ({ ...o, [other]: ok }));
  };

  const nothing = result && !result.dropped.length && !result.added.length && !result.rejected.length && !result.found.length;

  return (
    <div className="nt-ai">
      {running ? (
        <div className="nt-ai-bar">
          <Loader2 size={15} className="spin" />
          <span className="grow">ИИ проверяет слова и связи…</span>
          <button className="nt-ai-btn" onClick={() => abort.current?.abort()}>
            Стоп
          </button>
        </div>
      ) : (
        <div className="nt-ai-bar">
          <Sparkles size={15} className="nt-ai-ic" />
          <span className="grow nt-ai-status">
            {!st ? 'ИИ проверит, верно ли выбраны темы и связи' : st.stale ? 'Заметка изменилась после проверки ИИ' : `Проверено ИИ · ${noteDate(st.review.checkedAt)}`}
          </span>
          <button className="nt-ai-btn" onClick={() => void run()}>
            {st ? 'Проверить снова' : 'Проверить'}
          </button>
        </div>
      )}

      {result && (
        <div className="nt-ai-result" role="status">
          <div className="nt-ai-result-head">
            <Sparkles size={15} />
            <span className="grow">{nothing ? 'Всё верно — темы и связи подобраны правильно' : 'ИИ поправил связи'}</span>
            <button className="icon-btn" onClick={() => setResult(null)} aria-label="Закрыть итог">
              <X size={16} />
            </button>
          </div>
          {result.dropped.length > 0 && (
            <div className="nt-ai-line">
              <b>Неважные слова убраны:</b> {result.dropped.join(', ')}
            </div>
          )}
          {result.added.length > 0 && (
            <div className="nt-ai-line">
              <b>Добавлены темы:</b> {result.added.join(', ')}
            </div>
          )}
          {result.confirmed.length > 0 && (
            <div className="nt-ai-line">
              <b>Подтверждены связи:</b> {result.confirmed.map((c) => titleOf(c.id)).join(', ')}
            </div>
          )}
          {result.rejected.length > 0 && (
            <div className="nt-ai-group">
              <b>Случайные связи убраны:</b>
              {result.rejected.map((c) => (
                <LinkRow key={c.id} title={titleOf(c.id)} why={c.why} ok={overridden[c.id] ?? false} onToggle={(ok) => toggle(c.id, ok)} onOpen={() => openLinkedNote(c.id)} />
              ))}
            </div>
          )}
          {result.found.length > 0 && (
            <div className="nt-ai-group">
              <b>Найдены новые связи:</b>
              {result.found.map((c) => (
                <LinkRow key={c.id} title={titleOf(c.id)} why={c.why} ok={overridden[c.id] ?? true} onToggle={(ok) => toggle(c.id, ok)} onOpen={() => openLinkedNote(c.id)} />
              ))}
            </div>
          )}
          {!nothing && (
            <button
              className="nt-ai-undo"
              onClick={() => {
                result.undo();
                setResult(null);
                toast('Проверка ИИ отменена');
              }}
            >
              <Undo2 size={14} /> Отменить проверку
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function LinkRow({ title, why, ok, onToggle, onOpen }: { title: string; why?: string; ok: boolean; onToggle: (ok: boolean) => void; onOpen: () => void }) {
  return (
    <div className={`nt-ai-link${ok ? '' : ' is-off'}`}>
      <button className="nt-ai-link-main" onClick={onOpen}>
        <span className="nt-ai-link-title">{title}</span>
        {why && <span className="nt-ai-link-why">{why}</span>}
      </button>
      <button className="nt-ai-btn" onClick={() => onToggle(!ok)} aria-label={ok ? 'Убрать связь' : 'Вернуть связь'}>
        {ok ? (
          'Убрать'
        ) : (
          <>
            <Check size={13} /> Вернуть
          </>
        )}
      </button>
    </div>
  );
}
