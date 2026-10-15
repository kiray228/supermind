import { useEffect, useRef, useState } from 'react';
import { Loader2, Plus, Sparkles, Trash2, X, Equal } from 'lucide-react';
import { onBack } from '../../ui/dialogs';
import { toast } from '../../store/appStore';
import { addSynonymGroup, findSynonyms, removeSynonymGroup, removeSynonymWord } from '../synonyms';
import { useNotes } from '../store';
import type { SynonymGroup } from '../model';

const NONE: SynonymGroup[] = [];

/** Синонимы по смыслу: группы слов, которые связи и поиск считают одним словом */
export function SynonymsSheet({ onClose }: { onClose: () => void }) {
  const groups = useNotes((s) => s.data?.synonyms) ?? NONE;
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const ac = useRef<AbortController | null>(null);

  useEffect(() => onBack(() => (onClose(), true)));
  useEffect(() => () => ac.current?.abort(), []);

  const find = async () => {
    if (busy) {
      ac.current?.abort();
      return;
    }
    const c = (ac.current = new AbortController());
    setBusy(true);
    try {
      const n = await findSynonyms(c.signal);
      toast(n ? `Добавлено слов в синонимы: ${n}` : 'Новых синонимов не нашлось');
    } catch (e) {
      if (!c.signal.aborted) toast(e instanceof Error ? e.message : 'Не удалось найти синонимы');
    } finally {
      if (ac.current === c) ac.current = null;
      setBusy(false);
    }
  };

  const add = () => {
    if (!draft.trim()) return;
    const w = addSynonymGroup(draft);
    if (!w) return toast('Нужно хотя бы два разных слова: «бег = пробежка»');
    setDraft('');
  };

  // свежие группы — выше
  const list = [...groups].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal nt-dups nt-syn" role="dialog" aria-label="Синонимы">
        <div className="nt-ask-head">
          <Equal size={19} className="nt-ask-logo" />
          <h2 className="grow">Синонимы</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <X size={20} />
          </button>
        </div>
        <p className="nt-dups-hint">Разные слова для одного понятия — «бег» и «пробежка». Связи между записями и «Спросить у мозга» считают их одним словом.</p>
        <div className="nt-syn-actions">
          <button className="nt-ai-btn" onClick={() => void find()}>
            {busy ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />}
            {busy ? 'Ищу… (нажмите, чтобы остановить)' : 'Найти синонимы ИИ'}
          </button>
          <form
            className="nt-syn-form"
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <input className="nt-syn-input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="бег = пробежка, забег" aria-label="Своя группа синонимов" enterKeyHint="done" />
            <button className="nt-syn-add" type="submit" disabled={!draft.trim()} aria-label="Добавить группу">
              <Plus size={18} />
            </button>
          </form>
        </div>
        {list.length === 0 ? (
          <p className="nt-dups-empty">Групп пока нет. ИИ найдёт синонимы среди главных слов ваших записей, или добавьте свою группу.</p>
        ) : (
          <div className="nt-dups-list nt-syn-list">
            {list.map((g) => (
              <div key={g.id} className="nt-syn-group">
                <div className="nt-syn-words">
                  {g.words.map((w) => (
                    <span key={w} className="nt-syn-word">
                      {w}
                      <button onClick={() => removeSynonymWord(g.id, w)} aria-label={`Убрать «${w}»`} title="Не синоним">
                        <X size={13} />
                      </button>
                    </span>
                  ))}
                </div>
                <span className="nt-syn-by">{g.by === 'ai' ? 'ИИ' : 'вы'}</span>
                <button className="icon-btn nt-syn-del" onClick={() => removeSynonymGroup(g.id)} aria-label="Удалить группу" title="Удалить группу">
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
