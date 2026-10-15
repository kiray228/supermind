import { useEffect, useMemo, type ReactNode } from 'react';
import { BookOpenText, Brain, Compass, Copy, Equal, GraduationCap, Link2, Mic, Newspaper, NotebookPen, Share2, Upload, Waypoints, X } from 'lucide-react';
import { onBack } from '../../ui/dialogs';
import { useNotes } from '../store';
import { todaysCards } from '../cards';
import { markHubSeen } from '../hub';

export interface HubActions {
  graph: () => void;
  ask: () => void;
  review: () => void;
  synonyms: () => void;
  duplicates: () => void;
  importObsidian: () => void;
}

interface Feature {
  icon: ReactNode;
  title: string;
  text: string;
  action?: { label: string; run: () => void };
}

const plural = (n: number, one: string, few: string, many: string) => {
  const a = n % 100;
  const b = n % 10;
  return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many;
};

/** «Второй мозг»: что он умеет — со сводкой и кнопками «попробовать» */
export function BrainHub({ onClose, act }: { onClose: () => void; act: HubActions }) {
  const notes = useNotes((s) => s.data?.notes);
  const cards = useNotes((s) => s.data?.cards);
  useEffect(() => onBack(() => (onClose(), true)));
  useEffect(() => markHubSeen(), []);

  const stats = useMemo(() => {
    const alive = (notes ?? []).filter((n) => !n.trashed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return { notes: alive.length, days: alive.filter((n) => n.day).length, articles: alive.filter((n) => n.source).length, cards: cards?.length ?? 0, due: todaysCards().length };
  }, [notes, cards]);

  const go = (fn: () => void) => () => {
    onClose();
    fn();
  };
  const lazy = (load: () => Promise<void>) => go(() => void load());

  const sections: { title: string; items: Feature[] }[] = [
    {
      title: 'Связи — сами',
      items: [
        { icon: <Waypoints size={18} />, title: 'Связанные записи и граф', text: 'Приложение само находит важные слова и связывает заметки, карты, задачи и цели с общей темой. Внизу заметки — «Связи», на графе — всё сразу, с темами.', action: { label: 'Граф', run: go(act.graph) } },
        { icon: <Link2 size={18} />, title: '[[Ссылки]] и упоминания', text: 'Наберите «[[» — появится подсказка названий. Названия других записей в тексте подсвечиваются сами, внизу — «Упоминается в».' },
        { icon: <Equal size={18} />, title: 'Синонимы', text: 'ИИ найдёт слова одного понятия («бег» и «пробежка») — связи и поиск будут считать их одним словом.', action: { label: 'Синонимы', run: go(act.synonyms) } },
      ],
    },
    {
      title: 'Спросить и понять',
      items: [
        { icon: <Brain size={18} />, title: 'Спросить у мозга', text: 'Вопрос своими словами — ответ из ваших записей, со ссылками на них.', action: { label: 'Спросить', run: go(act.ask) } },
        { icon: <BookOpenText size={18} />, title: 'Конспект темы', text: 'ИИ соберёт все записи темы в обзор: главное, решения, открытые вопросы. На графе: «Вид» → «Темы» → тема → «Конспект».' },
        { icon: <Compass size={18} />, title: 'Обзор мозга', text: 'Раз в неделю: забытые заметки, которые пригодятся сейчас, заметки без связей, дубли, длинные — разбить.', action: { label: 'Обзор', run: go(act.review) } },
        { icon: <Copy size={18} />, title: 'Дубли', text: 'Почти одинаковые заметки — объединить в одну или отметить «не дубль».', action: { label: 'Найти', run: go(act.duplicates) } },
      ],
    },
    {
      title: 'Записывать быстро',
      items: [
        { icon: <NotebookPen size={18} />, title: 'Заметка дня', text: 'Одна на день: задачи дня, мысли, итоги. Видна в календаре.', action: { label: 'Сегодня', run: lazy(() => import('../daily').then((m) => m.openDailyNote())) } },
        { icon: <Mic size={18} />, title: 'Голосом', text: '«Запиши в дневник: …», «Итоги дня: …». Длинную мысль ИИ сам разложит на заметку, задачи и запись в дневник.', action: { label: 'Сказать', run: lazy(() => import('../../voice/state').then((m) => m.openVoice())) } },
        { icon: <Newspaper size={18} />, title: 'Статья по ссылке', text: 'ИИ прочитает статью и сохранит главные мысли со ссылкой на источник.', action: { label: 'Ссылка', run: lazy(() => import('../article').then((m) => m.askArticle())) } },
        { icon: <Share2 size={18} />, title: '«Поделиться» из других приложений', text: 'Текст, ссылку или фото — в новую заметку, заметку дня или дописать в подходящую.' },
      ],
    },
    {
      title: 'Помнить',
      items: [
        { icon: <GraduationCap size={18} />, title: 'Карточки для повторения', text: 'В заметке «⋯» → «Карточки»: ИИ сделает вопросы и ответы, приложение покажет их, когда начнёте забывать.', action: { label: 'Повторить', run: lazy(() => import('../cards').then((m) => m.openCardsReview())) } },
        { icon: <Upload size={18} />, title: 'Obsidian', text: 'Импорт хранилища (.zip или .md) и экспорт обратно — с папками и [[ссылками]].', action: { label: 'Импорт', run: go(act.importObsidian) } },
      ],
    },
  ];

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal nt-dups nt-hub" role="dialog" aria-label="Второй мозг">
        <div className="nt-ask-head">
          <Brain size={19} className="nt-ask-logo" />
          <h2 className="grow">Второй мозг</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <X size={20} />
          </button>
        </div>
        <div className="nt-dups-list nt-hub-body">
          <div className="nt-hub-stats">
            <span>
              <b>{stats.notes}</b> {plural(stats.notes, 'заметка', 'заметки', 'заметок')}
            </span>
            {stats.days > 0 && (
              <span>
                <b>{stats.days}</b> {plural(stats.days, 'день', 'дня', 'дней')} в дневнике
              </span>
            )}
            {stats.articles > 0 && (
              <span>
                <b>{stats.articles}</b> {plural(stats.articles, 'статья', 'статьи', 'статей')}
              </span>
            )}
            {stats.cards > 0 && (
              <span>
                <b>{stats.cards}</b> {plural(stats.cards, 'карточка', 'карточки', 'карточек')}
                {stats.due > 0 ? `, на сегодня ${stats.due}` : ''}
              </span>
            )}
          </div>
          {sections.map((s) => (
            <section key={s.title} className="nt-rv-sec">
              <h3 className="nt-rv-h">{s.title}</h3>
              {s.items.map((f) => (
                <div key={f.title} className="nt-hub-item">
                  <span className="nt-hub-ic">{f.icon}</span>
                  <div className="grow nt-hub-text">
                    <b>{f.title}</b>
                    <span>{f.text}</span>
                  </div>
                  {f.action && (
                    <button className="nt-ai-btn" onClick={f.action.run}>
                      {f.action.label}
                    </button>
                  )}
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
