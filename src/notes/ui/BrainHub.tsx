import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { t, tn } from '../../i18n/index';
import { Bell, BookOpenText, Brain, ClipboardCopy, CloudOff, Compass, Copy, Equal, Gauge, GraduationCap, LayoutTemplate, Link2, Loader2, MessageCircleQuestion, Mic, Newspaper, NotebookPen, Share2, SquareArrowOutUpRight, Upload, Waypoints, X } from 'lucide-react';
import { onBack } from '../../ui/dialogs';
import { useNotes } from '../store';
import { todaysCards } from '../cards';
import { markHubSeen } from '../hub';
import { fmtMs, perfReport, perfSummary } from '../perfLog';
import { processQueue, useAiQueue } from '../aiQueue';
import { toast } from '../../store/appStore';
import { brainNotifyPrefs, setBrainNotify } from '../brainNotify';

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
      title: t('Связи — сами'),
      items: [
        { icon: <Waypoints size={18} />, title: t('Связанные записи и граф'), text: t('Приложение само находит важные слова и связывает заметки, карты, задачи и цели с общей темой. Внизу заметки — «Связи», на графе — всё сразу, с темами.'), action: { label: t('Граф'), run: go(act.graph) } },
        { icon: <Link2 size={18} />, title: t('[[Ссылки]] и упоминания'), text: t('Наберите «[[» — появится подсказка названий, после «#» — разделы заметки. Названия других записей в тексте подсвечиваются сами, внизу — «Упоминается в».') },
        { icon: <SquareArrowOutUpRight size={18} />, title: t('Встроить заметку'), text: t('Строка «![[Заметка]]» или «![[Заметка#Раздел]]» показывает другую заметку прямо в тексте — и обновляется вместе с ней. В меню «/» → «Встроить заметку».') },
        { icon: <Equal size={18} />, title: t('Синонимы'), text: t('ИИ найдёт слова одного понятия («бег» и «пробежка») — связи и поиск будут считать их одним словом.'), action: { label: t('Синонимы'), run: go(act.synonyms) } },
      ],
    },
    {
      title: t('Спросить и понять'),
      items: [
        { icon: <Brain size={18} />, title: t('Спросить у мозга'), text: t('Вопрос своими словами — ответ из ваших записей, со ссылками на них.'), action: { label: t('Спросить'), run: go(act.ask) } },
        { icon: <BookOpenText size={18} />, title: t('Конспект темы'), text: t('ИИ соберёт все записи темы в обзор: главное, решения, открытые вопросы. На графе: «Вид» → «Темы» → тема → «Конспект».') },
        { icon: <MessageCircleQuestion size={18} />, title: t('Вопрос дня'), text: t('Раз в день — вопрос по давней заметке: актуально ли, что изменилось. Приходит и утренним уведомлением — ответить можно прямо в шторке. Ответ — в заметку дня.') },
        { icon: <Compass size={18} />, title: t('Обзор мозга'), text: t('Раз в неделю: забытые заметки, которые пригодятся сейчас, заметки без связей, дубли, длинные — разбить.'), action: { label: t('Обзор'), run: go(act.review) } },
        { icon: <Copy size={18} />, title: t('Дубли'), text: t('Почти одинаковые заметки — объединить в одну или отметить «не дубль».'), action: { label: t('Найти'), run: go(act.duplicates) } },
      ],
    },
    {
      title: t('Записывать быстро'),
      items: [
        { icon: <NotebookPen size={18} />, title: t('Заметка дня'), text: t('Одна на день: задачи дня, мысли, итоги. Видна в календаре. Свой вид — шаблон «Заметка дня».'), action: { label: t('Сегодня'), run: lazy(() => import('../daily').then((m) => m.openDailyNote())) } },
        { icon: <LayoutTemplate size={18} />, title: t('Шаблоны'), text: t('Встреча, книга, проект — или свои: заметки папки «Шаблоны». Дата, время и задачи дня подставятся сами.'), action: { label: t('Шаблоны'), run: lazy(() => import('../templates').then((m) => m.openTemplates())) } },
        { icon: <Mic size={18} />, title: t('Голосом'), text: t('«Запиши в дневник: …», «Итоги дня: …». Длинную мысль ИИ сам разложит на заметку, задачи и запись в дневник.'), action: { label: t('Сказать'), run: lazy(() => import('../../voice/state').then((m) => m.openVoice())) } },
        { icon: <Newspaper size={18} />, title: t('Статья по ссылке'), text: t('ИИ прочитает статью и сохранит главные мысли со ссылкой на источник.'), action: { label: t('Ссылка'), run: lazy(() => import('../article').then((m) => m.askArticle())) } },
        { icon: <Share2 size={18} />, title: t('«Поделиться» из других приложений'), text: t('Текст, ссылку или фото — в новую заметку, заметку дня или дописать в подходящую.') },
      ],
    },
    {
      title: t('Помнить'),
      items: [
        { icon: <GraduationCap size={18} />, title: t('Карточки для повторения'), text: t('В заметке «⋯» → «Карточки»: ИИ сделает вопросы и ответы, приложение покажет их, когда начнёте забывать. Утром карточка приходит уведомлением.'), action: { label: t('Повторить'), run: lazy(() => import('../cards').then((m) => m.openCardsReview())) } },
        { icon: <Upload size={18} />, title: 'Obsidian', text: t('Импорт хранилища (.zip или .md) и экспорт обратно — с папками и [[ссылками]].'), action: { label: t('Импорт'), run: go(act.importObsidian) } },
      ],
    },
  ];

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal nt-dups nt-hub" role="dialog" aria-label={t('Второй мозг')}>
        <div className="nt-ask-head">
          <Brain size={19} className="nt-ask-logo" />
          <h2 className="grow">{t('Второй мозг')}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t('Закрыть')}>
            <X size={20} />
          </button>
        </div>
        <div className="nt-dups-list nt-hub-body">
          <div className="nt-hub-stats">
            <span>
              <b>{stats.notes}</b> {tn(stats.notes, 'заметка', 'заметки', 'заметок')}
            </span>
            {stats.days > 0 && (
              <span>
                <b>{stats.days}</b> {t('{days} в дневнике', { days: tn(stats.days, 'день', 'дня', 'дней') })}
              </span>
            )}
            {stats.articles > 0 && (
              <span>
                <b>{stats.articles}</b> {tn(stats.articles, 'статья', 'статьи', 'статей')}
              </span>
            )}
            {stats.cards > 0 && (
              <span>
                <b>{stats.cards}</b> {tn(stats.cards, 'карточка', 'карточки', 'карточек')}
                {stats.due > 0 ? `, ${t('на сегодня {n}', { n: stats.due })}` : ''}
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
          <Health notes={stats.notes} />
        </div>
      </div>
    </div>
  );
}

/** Скорость на этом устройстве и работа, которая ждёт ИИ */
function Health({ notes }: { notes: number }) {
  const queue = useAiQueue((s) => s.items);
  const [busy, setBusy] = useState(false);
  const rows = useMemo(() => perfSummary(), []);
  // устройство: «Linux; Android 14; Pixel 7» — из первых скобок строки браузера, и сколько ядер
  const device = typeof navigator !== 'undefined' ? `${/\(([^)]*)\)/.exec(navigator.userAgent)?.[1] ?? navigator.userAgent.slice(0, 60)}, ядер: ${navigator.hardwareConcurrency ?? '?'}` : '';

  const runQueue = async () => {
    setBusy(true);
    try {
      const r = await processQueue();
      toast(r.messages.length ? r.messages.join('; ') : useAiQueue.getState().items.length ? t('ИИ пока недоступен — попробую позже сам') : t('Готово'));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(perfReport(device, notes));
      toast(t('Отчёт скопирован — пришлите его, если что-то медленно'));
    } catch {
      toast(t('Не удалось скопировать'));
    }
  };

  return (
    <section className="nt-rv-sec">
      <h3 className="nt-rv-h">
        <Gauge size={16} /> {t('На этом устройстве')}
      </h3>
      {queue.length > 0 && (
        <div className="nt-hub-item">
          <span className="nt-hub-ic">
            <CloudOff size={18} />
          </span>
          <div className="grow nt-hub-text">
            <b>{t('Ждут ИИ: {n}', { n: queue.length })}</b>
            <span>{t('{list} — доделается сам, когда появится связь.', { list: queue.map((x) => (x.kind === 'article' ? t('пересказ статьи') : t('разбор голосовой записи'))).join(', ') })}</span>
          </div>
          <button className="nt-ai-btn" disabled={busy} onClick={() => void runQueue()}>
            {busy ? <Loader2 size={14} className="spin" /> : null} {t('Сейчас')}
          </button>
        </div>
      )}
      {rows.length ? (
        <div className="nt-hub-perf">
          {rows.map((r) => (
            <div key={r.op} className={`nt-hub-perf-row${r.slow ? ' is-slow' : ''}`}>
              <span className="grow">{r.label}</span>
              <b>{fmtMs(r.ms)}</b>
            </div>
          ))}
          {rows.some((r) => r.slow) && <p className="nt-rv-hint">{t('Что-то работает медленно — скопируйте отчёт и пришлите его разработчику.')}</p>}
        </div>
      ) : (
        <p className="nt-rv-hint">{t('Скорость появится здесь, когда мозг поработает: связи, граф, обзор.')}</p>
      )}
      <button className="nt-ai-undo" onClick={() => void copy()}>
        <ClipboardCopy size={14} /> {t('Скопировать отчёт о скорости')}
      </button>
      <MorningPrefs />
    </section>
  );
}

/** Утренние уведомления мозга на этом устройстве */
function MorningPrefs() {
  const [p, setP] = useState(brainNotifyPrefs);
  const flip = (k: 'question' | 'cards') => {
    setBrainNotify({ [k]: !p[k] });
    setP(brainNotifyPrefs());
  };
  return (
    <div className="nt-hub-prefs">
      <div className="nt-hub-prefs-h">
        <Bell size={14} /> {t('Утром, после «Плана на день»')}
      </div>
      <label className="nt-hub-check">
        <input type="checkbox" checked={p.question} onChange={() => flip('question')} /> {t('Вопрос дня — ответить прямо в уведомлении')}
      </label>
      <label className="nt-hub-check">
        <input type="checkbox" checked={p.cards} onChange={() => flip('cards')} /> {t('Карточка для повторения')}
      </label>
    </div>
  );
}
