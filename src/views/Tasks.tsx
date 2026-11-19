import { LOCALE, t } from '../i18n/index';
import { useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  CalendarDays,
  CalendarPlus,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Columns3,
  Filter,
  Grid2x2,
  Hash,
  Inbox,
  LayoutList,
  ListTodo,
  MoreHorizontal,
  Network,
  Pencil,
  Plus,
  Search,
  Sun,
  Sunrise,
  Trash2,
  X,
  CalendarRange,
  CalendarX2,
  Layers,
  SquareCheck as CheckSquare,
  LayoutTemplate,
} from 'lucide-react';
import { useApp, toast } from '../store/appStore';
import { loadAllDocs } from '../store/db';
import { addDaysYmd, collectMapTasks, fromYmd, todayYmd, updateMapTask, PRIORITY_META, type MapTask } from '../utils/mapTasks';
import { uid } from '../utils/tree';
import { openDoc } from '../actions';
import { askText, confirmDialog } from '../ui/dialogs';
import {
  compareTasks,
  dayLabel,
  isActive,
  LIST_COLORS,
  longDate,
  matchesWhen,
  QUADRANTS,
  quadrantOf,
  type Priority,
  type SmartId,
  type TaskFilter,
  type TaskItem,
  type TasksData,
  type WhenFilter,
} from '../tasks/model';
import {
  addList,
  allTags,
  deleteFilter,
  deleteList,
  deleteTag,
  emptyTrash,
  ensureTasks,
  openQuickAdd,
  openTask,
  renameTag,
  saveFilter,
  setPrefs,
  updateList,
  updateTask,
  useTasks,
} from '../tasks/store';
import { exportTasksIcs } from '../tasks/sync';
import { TaskCheck, TaskRow } from '../tasks/ui/TaskRow';
import { BulkBar } from '../tasks/ui/BulkBar';
import { TaskTemplatesSheet } from '../tasks/ui/TaskTemplatesSheet';
import { endSelect, startSelect, useBulk } from '../tasks/bulk';
import { registerDropZone } from '../tasks/ui/touchDrag';
import { SmartInput } from '../tasks/ui/QuickAdd';
import '../tasks/ui/tasks.css';
import { IconTile } from '../ui/icons';
import { useToday } from '../ui/useToday';

type Sel = { k: 'smart'; id: SmartId } | { k: 'list'; id: string } | { k: 'tag'; id: string } | { k: 'filter'; id: string } | { k: 'matrix' };
type GroupBy = 'date' | 'priority' | 'list' | 'none';

const SMART: { id: SmartId; name: string; icon: typeof Sun; color: string }[] = [
  { id: 'today', name: t('Сегодня'), icon: Sun, color: '#f59e0b' },
  { id: 'tomorrow', name: t('Завтра'), icon: Sunrise, color: '#f97316' },
  { id: 'week', name: t('Следующие 7 дней'), icon: CalendarRange, color: '#8b5cf6' },
  { id: 'inbox', name: t('Входящие'), icon: Inbox, color: '#3b82f6' },
  { id: 'all', name: t('Все задачи'), icon: ListTodo, color: '#14b8a6' },
  { id: 'nodate', name: t('Без даты'), icon: CalendarX2, color: '#64748b' },
  { id: 'maps', name: t('Из карт'), icon: Network, color: '#ec4899' },
];

function readLS<T>(key: string, def: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : def;
  } catch {
    return def;
  }
}
function writeLS(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* хранилище недоступно */
  }
}

function applyFilter(t: TaskItem, f: TaskFilter, today: string) {
  if (f.lists?.length && !f.lists.includes(t.listId)) return false;
  if (f.tags?.length && !f.tags.some((g) => t.tags.includes(g))) return false;
  if (f.priorities?.length && !f.priorities.includes(t.priority)) return false;
  if (f.when && !matchesWhen(t, f.when, today)) return false;
  if (f.query && !(t.title + ' ' + (t.notes ?? '')).toLowerCase().includes(f.query.toLowerCase())) return false;
  return true;
}

/** Задачи выбранного раздела: base — все подходящие (включая выполненные) */
function inSelection(d: TasksData, sel: Sel, t: TaskItem, today: string): boolean {
  if (sel.k === 'smart' && sel.id === 'trash') return !!t.deleted;
  if (t.deleted) return false;
  switch (sel.k) {
    case 'list':
      return t.listId === sel.id;
    case 'tag':
      return t.tags.includes(sel.id);
    case 'filter': {
      const f = d.filters.find((x) => x.id === sel.id);
      return !!f && applyFilter(t, f, today);
    }
    case 'matrix':
      return true;
    case 'smart':
      switch (sel.id) {
        case 'today':
          return !!t.date && (t.done ? t.date === today : t.date <= today);
        case 'tomorrow':
          return t.date === addDaysYmd(today, 1);
        case 'week':
          return !!t.date && t.date <= addDaysYmd(today, 6) && (!t.done || t.date >= today);
        case 'inbox':
          return t.listId === 'inbox';
        case 'nodate':
          return !t.date;
        case 'completed':
          return t.done || !!t.wontDo;
        case 'maps':
          return !!t.source;
        default:
          return true;
      }
  }
}

interface Group {
  key: string;
  title: string;
  color?: string;
  tasks: TaskItem[];
  /** что поменять у задачи, перетащенной в эту группу */
  drop?: Partial<TaskItem>;
}

function groupTasks(tasks: TaskItem[], by: GroupBy, d: TasksData, today: string, perDay: boolean): Group[] {
  if (by === 'none') return [{ key: 'all', title: t('Задачи'), tasks }];
  if (by === 'priority') {
    return ([1, 2, 3, 0] as Priority[]).map((p) => ({
      key: 'p' + p,
      title: p ? t('{level} приоритет', { level: PRIORITY_META[p].label }) : t('Без приоритета'),
      color: p ? PRIORITY_META[p].color : undefined,
      tasks: tasks.filter((t) => t.priority === p),
      drop: { priority: p },
    }));
  }
  if (by === 'list') {
    return [...d.lists]
      .sort((a, b) => a.order - b.order)
      .map((l) => ({ key: l.id, title: (l.emoji ? l.emoji + ' ' : '') + l.name, color: l.color, tasks: tasks.filter((t) => t.listId === l.id), drop: { listId: l.id } }));
  }
  const g: Group[] = [
    { key: 'overdue', title: t('Просрочено'), color: 'var(--danger)', tasks: [] },
    { key: 'today', title: t('Сегодня'), color: '#3b82f6', tasks: [], drop: { date: today } },
    { key: 'tomorrow', title: t('Завтра'), tasks: [], drop: { date: addDaysYmd(today, 1) } },
  ];
  if (perDay) for (let i = 2; i < 7; i++) g.push({ key: 'd' + i, title: `${dayLabel(addDaysYmd(today, i), today)} · ${longDate(addDaysYmd(today, i)).split(', ')[1]}`, tasks: [], drop: { date: addDaysYmd(today, i) } });
  else g.push({ key: 'week', title: t('Следующие 7 дней'), tasks: [], drop: { date: addDaysYmd(today, 2) } });
  g.push({ key: 'later', title: t('Позже'), tasks: [] }, { key: 'nodate', title: t('Без даты'), tasks: [], drop: { date: undefined } });
  const at = (k: string) => g.find((x) => x.key === k)!;
  for (const t of tasks) {
    if (!t.date) at('nodate').tasks.push(t);
    else if (t.date < today) at('overdue').tasks.push(t);
    else if (t.date === today) at('today').tasks.push(t);
    else if (t.date === addDaysYmd(today, 1)) at('tomorrow').tasks.push(t);
    else if (t.date <= addDaysYmd(today, 6)) at(perDay ? 'd' + Math.round((fromYmd(t.date).getTime() - fromYmd(today).getTime()) / 86400000) : 'week').tasks.push(t);
    else at('later').tasks.push(t);
  }
  return g;
}

export default function Tasks() {
  const data = useTasks((s) => s.data);
  const docsVersion = useApp((s) => s.docsVersion);
  const [sel, setSelState] = useState<Sel>(() => readLS<Sel>('sm-tasks-sel', { k: 'smart', id: 'today' }));
  const [mode, setModeState] = useState<'list' | 'kanban'>(() => readLS('sm-tasks-mode', 'list'));
  const [groupBy, setGroupByState] = useState<GroupBy>(() => readLS('sm-tasks-group', 'date'));
  const [query, setQuery] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [menu, setMenu] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [mapTasks, setMapTasks] = useState<MapTask[]>([]);
  const [listDlg, setListDlg] = useState<{ id?: string } | null>(null);
  const [filterDlg, setFilterDlg] = useState<TaskFilter | null>(null);
  const [tplOpen, setTplOpen] = useState(false);
  // в группе сначала столько задач (тысячи строк сразу — долго на телефоне)
  const [rowCap, setRowCap] = useState(300);
  // приложение открыто через полночь — «Сегодня» и «Просрочено» сменяются сами
  const today = useToday();

  useEffect(() => {
    void ensureTasks();
    // ушли из раздела — выбор задач сбрасывается
    return endSelect;
  }, []);
  const bulkOn = useBulk((s) => s.ids !== null);
  // меню «⋯» закрывается касанием в любом другом месте
  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => !(e.target as Element).closest?.('.td-pop-anchor') && setMenu(false);
    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  }, [menu]);
  useEffect(() => {
    let alive = true;
    loadAllDocs()
      .then((docs) => alive && setMapTasks(collectMapTasks(docs)))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [docsVersion]);

  const setSel = (s: Sel) => {
    endSelect();
    setRowCap(300);
    setSelState(s);
    writeLS('sm-tasks-sel', s);
    setDrawer(false);
    setShowDone(false);
  };
  const setMode = (m: 'list' | 'kanban') => (setModeState(m), writeLS('sm-tasks-mode', m));
  const setGroupBy = (g: GroupBy) => (setGroupByState(g), writeLS('sm-tasks-group', g));

  // раздел мог исчезнуть (удалили список/тег/фильтр)
  useEffect(() => {
    if (!data) return;
    if ((sel.k === 'list' && !data.lists.some((l) => l.id === sel.id)) || (sel.k === 'filter' && !data.filters.some((f) => f.id === sel.id)) || (sel.k === 'tag' && !allTags(data).includes(sel.id)))
      setSel({ k: 'smart', id: 'today' });
  }, [data, sel]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    if (!data) return c;
    for (const s of SMART) c['smart:' + s.id] = data.tasks.filter((t) => isActive(t) && inSelection(data, { k: 'smart', id: s.id }, t, today)).length;
    // списки и теги — одним проходом по задачам (а не проход на каждый список и тег)
    for (const l of data.lists) c['list:' + l.id] = 0;
    for (const g of allTags(data)) c['tag:' + g] = 0;
    for (const t of data.tasks) {
      if (!isActive(t)) continue;
      if (c['list:' + t.listId] !== undefined) c['list:' + t.listId]++;
      for (const g of t.tags) if (c['tag:' + g] !== undefined) c['tag:' + g]++;
    }
    for (const f of data.filters) c['filter:' + f.id] = data.tasks.filter((t) => isActive(t) && applyFilter(t, f, today)).length;
    const linkedIds = new Set(data.tasks.filter((t) => t.source && !t.deleted).map((t) => t.source!.topicId));
    c['smart:maps'] += mapTasks.filter((m) => m.task.status !== 'done' && !linkedIds.has(m.topicId)).length;
    return c;
  }, [data, today, mapTasks]);

  // поиск — с отложенным текстом: при тысячах задач ввод не подтормаживает
  const deferredQuery = useDeferredValue(query);
  const listView = useMemo(() => {
    if (!data) return null;
    const q = deferredQuery?.trim().toLowerCase();
    const all = data.tasks.filter((t) => (q ? !t.deleted && (t.title + ' ' + (t.notes ?? '') + ' ' + t.tags.join(' ')).toLowerCase().includes(q) : inSelection(data, sel, t, today)));
    const active = all.filter((t) => !t.done && !t.wontDo).sort((a, b) => compareTasks(a, b, data.prefs.sortBy));
    const done = all.filter((t) => t.done || t.wontDo).sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
    const effectiveGroup: GroupBy = sel.k === 'smart' && (sel.id === 'tomorrow' || sel.id === 'nodate') && groupBy === 'date' ? 'none' : groupBy;
    const groups = groupTasks(active, effectiveGroup, data, today, sel.k === 'smart' && sel.id === 'week').filter((g) => g.tasks.length || (mode === 'kanban' && g.drop));
    const listById = new Map(data.lists.map((l) => [l.id, l]));
    return { q, all, active, done, effectiveGroup, groups, listById };
  }, [data, sel, deferredQuery, today, groupBy, mode]);

  if (!data || !listView) {
    return (
      <div className="page">
        <div className="page-header">
          <IconTile section="tasks" size="sm" className="ph-tile" />
          <h1>{t('Задачи')}</h1>
        </div>
        <div className="loading">
          <div className="spinner" />
        </div>
      </div>
    );
  }

  const tagNames = allTags(data);
  const curList = sel.k === 'list' ? data.lists.find((l) => l.id === sel.id) : undefined;
  const curFilter = sel.k === 'filter' ? data.filters.find((f) => f.id === sel.id) : undefined;
  const smart = sel.k === 'smart' ? SMART.find((s) => s.id === sel.id) : undefined;
  const title =
    sel.k === 'matrix'
      ? t('Матрица Эйзенхауэра')
      : sel.k === 'smart'
        ? sel.id === 'completed'
          ? t('Выполненные')
          : sel.id === 'trash'
            ? t('Корзина')
            : smart?.name ?? t('Задачи')
        : sel.k === 'list'
          ? (curList?.emoji ? curList.emoji + ' ' : '') + (curList?.name ?? '')
          : sel.k === 'tag'
            ? '#' + sel.id
            : curFilter?.name ?? t('Фильтр');

  const { q, all, active, done, effectiveGroup, groups, listById } = listView;
  const isTrash = sel.k === 'smart' && sel.id === 'trash';
  const isCompleted = sel.k === 'smart' && sel.id === 'completed';

  const preset: Partial<TaskItem> =
    sel.k === 'list'
      ? { listId: sel.id }
      : sel.k === 'tag'
        ? { tags: [sel.id] }
        : sel.k === 'smart' && sel.id === 'today'
          ? { date: today }
          : sel.k === 'smart' && sel.id === 'tomorrow'
            ? { date: addDaysYmd(today, 1) }
            : sel.k === 'smart' && sel.id === 'week'
              ? { date: today }
              : {};

  // темы карт, у которых уже есть задача с напоминанием, не дублируются в «Из карт»
  const linkedTopics = new Set(data.tasks.filter((t) => t.source && !t.deleted).map((t) => t.source!.topicId));
  const mapList =
    q || sel.k !== 'smart'
      ? []
      : mapTasks.filter((m) => {
          if (m.task.status === 'done' || linkedTopics.has(m.topicId)) return false;
          if (sel.id === 'maps' || sel.id === 'all') return true;
          if (sel.id === 'today') return !!m.task.due && m.task.due <= today;
          if (sel.id === 'tomorrow') return m.task.due === addDaysYmd(today, 1);
          if (sel.id === 'week') return !!m.task.due && m.task.due <= addDaysYmd(today, 6);
          return false;
        });

  const onDrop = (g: Group, id: string) => g.drop && updateTask(id, g.drop);

  const navItem = (key: string, s: Sel, icon: ReactNode, name: string, color?: string, extra?: ReactNode) => {
    const on = JSON.stringify(s) === JSON.stringify(sel) && !q;
    return (
      <button key={key} className={`tk-nav-item${on ? ' active' : ''}`} onClick={() => (setQuery(null), setSel(s))} style={color ? ({ '--nc': color } as CSSProperties) : undefined}>
        <span className="tk-nav-ico">{icon}</span>
        <span className="grow ellipsis">{name}</span>
        {extra}
        {!!counts[key] && <span className="tk-nav-count">{counts[key]}</span>}
      </button>
    );
  };

  const nav = (
    <div className="tk-nav-inner">
      {SMART.map((s) => navItem('smart:' + s.id, { k: 'smart', id: s.id }, <s.icon size={18} />, s.name, s.color))}
      {navItem('matrix', { k: 'matrix' }, <Grid2x2 size={18} />, t('Матрица Эйзенхауэра'), '#ef4444')}
      <div className="tk-nav-sec">
        <span>{t('Списки')}</span>
        <button className="icon-btn" onClick={() => setListDlg({})} aria-label={t('Новый список')}>
          <Plus />
        </button>
      </div>
      {[...data.lists]
        .sort((a, b) => a.order - b.order)
        .map((l) => navItem('list:' + l.id, { k: 'list', id: l.id }, l.emoji ? <span className="tk-emoji">{l.emoji}</span> : <i className="tk-dot" style={{ background: l.color }} />, l.name, l.color))}
      <div className="tk-nav-sec">
        <span>{t('Фильтры')}</span>
        <button className="icon-btn" onClick={() => setFilterDlg({ id: uid(), name: '', color: LIST_COLORS[data.filters.length % LIST_COLORS.length] })} aria-label={t('Новый фильтр')}>
          <Plus />
        </button>
      </div>
      {data.filters.length === 0 && <div className="tk-nav-hint tiny faint">{t('Свои подборки: по спискам, тегам, приоритету и сроку')}</div>}
      {data.filters.map((f) => navItem('filter:' + f.id, { k: 'filter', id: f.id }, <Filter size={17} />, f.name, f.color))}
      {tagNames.length > 0 && (
        <div className="tk-nav-sec">
          <span>{t('Теги')}</span>
        </div>
      )}
      {tagNames.map((g) => navItem('tag:' + g, { k: 'tag', id: g }, <Hash size={17} />, g, data.tagColors[g]))}
      <div className="tk-nav-sep" />
      {navItem('smart:completed', { k: 'smart', id: 'completed' }, <CheckCircle2 size={18} />, t('Выполненные'), '#22c55e')}
      {navItem('smart:trash', { k: 'smart', id: 'trash' }, <Trash2 size={18} />, t('Корзина'), '#94a3b8')}
    </div>
  );

  const renderRows = (ts: TaskItem[]) => (
    <>
      {ts.slice(0, rowCap).map((t) => (
        <TaskRow key={t.id} task={t} list={listById.get(t.listId)} showList={sel.k !== 'list'} tagColors={data.tagColors} draggable selectable />
      ))}
      {ts.length > rowCap && (
        <button className="tk-more-rows" onClick={() => setRowCap((n) => n + 300)}>
          {t('Показать ещё {n} из {total}', { n: Math.min(300, ts.length - rowCap), total: ts.length - rowCap })}
        </button>
      )}
    </>
  );

  const content = () => {
    if (sel.k === 'matrix' && !q) return <Matrix data={data} />;
    if (isTrash && !q) {
      return (
        <div className="tk-groups">
          {all.length === 0 ? (
            <Empty icon={<Trash2 />} text={t('Корзина пуста')} />
          ) : (
            <section className="tk-group">
              {all.map((t) => (
                <TaskRow key={t.id} task={t} list={data.lists.find((l) => l.id === t.listId)} tagColors={data.tagColors} />
              ))}
            </section>
          )}
        </div>
      );
    }
    if (isCompleted && !q) return <CompletedView data={data} />;
    return (
      <>
        {!isTrash && (
          <div className="tk-inline-add">
            <SmartInput key={JSON.stringify(sel)} preset={preset} compact />
          </div>
        )}
        {mode === 'kanban' ? (
          <div className="tk-kanban">
            {groups.map((g) => (
              <DropZone key={g.key} className="tk-kcol card" onDrop={(id) => onDrop(g, id)} enabled={!!g.drop}>
                <header className="tk-group-head" style={g.color ? ({ '--gc': g.color } as CSSProperties) : undefined}>
                  <span className="tk-group-title">{g.title}</span>
                  <span className="tk-group-count">{g.tasks.length}</span>
                </header>
                <div className="tk-kcol-body">{renderRows(g.tasks)}</div>
                {g.drop && (
                  <button className="tk-kcol-add" onClick={() => openQuickAdd({ ...preset, ...g.drop })}>
                    <Plus size={15} /> {t('Добавить')}
                  </button>
                )}
              </DropZone>
            ))}
          </div>
        ) : (
          <div className="tk-groups">
            {groups.map((g) => (
              <Collapsible
                key={g.key}
                title={g.title}
                color={g.color}
                count={g.tasks.length}
                onDrop={g.drop ? (id) => onDrop(g, id) : undefined}
                hideHead={groups.length === 1 && effectiveGroup === 'none'}
                action={
                  g.key === 'overdue' ? (
                    <button
                      className="tk-group-act"
                      onClick={(e) => {
                        e.stopPropagation();
                        for (const t of g.tasks) updateTask(t.id, { date: today });
                        toast(t('Перенесено на сегодня: {n}', { n: g.tasks.length }));
                      }}
                    >
                      {t('Перенести на сегодня')}
                    </button>
                  ) : undefined
                }
              >
                {renderRows(g.tasks)}
              </Collapsible>
            ))}
            {mapList.length > 0 && (
              <Collapsible title={t('Из карт')} color="#ec4899" count={mapList.length}>
                {mapList.map((m) => (
                  <MapRow key={m.docId + m.topicId} m={m} onToggle={() => toggleMap(m, setMapTasks)} />
                ))}
              </Collapsible>
            )}
            {active.length === 0 && mapList.length === 0 && <Empty icon={<Check />} text={q ? t('Ничего не найдено') : t('Здесь пока нет задач. Добавьте первую!')} />}
            {done.length > 0 && !data.prefs.hideCompleted && (
              <section className="tk-group tk-done-group">
                <button className="tk-group-head tk-toggle" onClick={() => setShowDone(!showDone)}>
                  {showDone ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <span className="tk-group-title">{t('Выполненные')}</span>
                  <span className="tk-group-count">{done.length}</span>
                </button>
                {showDone && renderRows(done.slice(0, 100))}
              </section>
            )}
          </div>
        )}
      </>
    );
  };

  // выбор нескольких: в обычных списках (не в матрице, корзине и выполненных)
  const canBulk = !(sel.k === 'matrix' && !q) && !isTrash && !isCompleted;
  const shownIds = [...groups.flatMap((g) => g.tasks.map((t) => t.id)), ...(showDone && !data.prefs.hideCompleted ? done.slice(0, 100).map((t) => t.id) : [])];

  const exportCurrent = () => void exportTasksIcs(sel.k === 'matrix' ? data.tasks.filter(isActive) : active);

  return (
    <div className="page tk-page">
      <div className="page-header tk-header">
        <IconTile section="tasks" size="sm" className="ph-tile" />
        <button className="tk-title-btn" onClick={() => setDrawer(true)}>
          <h1 className="ellipsis">{q ? t('Поиск') : title}</h1>
          <ChevronDown size={18} className="tk-mobile-only" />
        </button>
        <div className="grow" />
        {/* телефон: календарь — соседний вид задач (вкладка «Сегодня») */}
        <button className="icon-btn phone-only" onClick={() => useApp.getState().go('calendar')} aria-label={t('Календарь')} title={t('Календарь')}>
          <CalendarDays />
        </button>
        {query !== null ? (
          <div className="tk-search">
            <Search size={16} />
            <input autoFocus value={query} placeholder={t('Поиск задач')} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setQuery(null)} />
            <button className="icon-btn" onClick={() => setQuery(null)} aria-label={t('Закрыть поиск')}>
              <X />
            </button>
          </div>
        ) : (
          <button className="icon-btn" onClick={() => setQuery('')} aria-label={t('Поиск')}>
            <Search />
          </button>
        )}
        {sel.k !== 'matrix' && !isTrash && !isCompleted && (
          <div className="segmented tk-mode">
            <button className={mode === 'list' ? 'active' : ''} onClick={() => setMode('list')} aria-label={t('Список')}>
              <LayoutList size={16} />
            </button>
            <button className={mode === 'kanban' ? 'active' : ''} onClick={() => setMode('kanban')} aria-label={t('Канбан')}>
              <Columns3 size={16} />
            </button>
          </div>
        )}
        <div className="td-pop-anchor">
          <button className="icon-btn" onClick={() => setMenu(!menu)} aria-label={t('Ещё')}>
            <MoreHorizontal />
          </button>
          {menu && (
            <>
              <div className="td-pop right tk-menu" onClick={() => setMenu(false)}>
                <div className="td-pop-label">{t('Сортировка')}</div>
                {(
                  [
                    ['date', t('По дате')],
                    ['priority', t('По приоритету')],
                    ['title', t('По названию')],
                    ['created', t('Сначала новые')],
                  ] as const
                ).map(([k, l]) => (
                  <button key={k} className={data.prefs.sortBy === k ? 'active' : ''} onClick={() => setPrefs({ sortBy: k })}>
                    {data.prefs.sortBy === k ? <Check size={16} /> : <span className="tk-sp" />} {l}
                  </button>
                ))}
                <div className="td-pop-label">{t('Группировка')}</div>
                {(
                  [
                    ['date', t('По дате')],
                    ['priority', t('По приоритету')],
                    ['list', t('По спискам')],
                    ['none', t('Без групп')],
                  ] as const
                ).map(([k, l]) => (
                  <button key={k} className={groupBy === k ? 'active' : ''} onClick={() => setGroupBy(k)}>
                    {groupBy === k ? <Check size={16} /> : <span className="tk-sp" />} {l}
                  </button>
                ))}
                <div className="sep" />
                <button onClick={() => setTplOpen(true)}>
                  <LayoutTemplate size={16} /> {t('Из шаблона…')}
                </button>
                {canBulk && (
                  <button onClick={() => startSelect()}>
                    <CheckSquare size={16} /> {t('Выбрать задачи')}
                  </button>
                )}
                <button onClick={() => setPrefs({ hideCompleted: !data.prefs.hideCompleted })}>
                  <Layers size={16} /> {data.prefs.hideCompleted ? t('Показывать выполненные') : t('Скрыть выполненные')}
                </button>
                <button onClick={exportCurrent}>
                  <CalendarPlus size={16} /> {t('Экспорт в календарь (.ics)')}
                </button>
                <button onClick={() => useApp.getState().go('calendar')}>
                  <CalendarDays size={16} /> {t('Открыть календарь')}
                </button>
                {curList && (
                  <>
                    <div className="sep" />
                    <button onClick={() => setListDlg({ id: curList.id })}>
                      <Pencil size={16} /> {t('Изменить список')}
                    </button>
                    {curList.id !== 'inbox' && (
                      <button
                        className="danger"
                        onClick={async () => {
                          if (await confirmDialog(t('Удалить список «{name}»?', { name: curList.name }), t('Задачи списка будут перемещены в корзину.'), { danger: true, okText: t('Удалить') })) deleteList(curList.id);
                        }}
                      >
                        <Trash2 size={16} /> {t('Удалить список')}
                      </button>
                    )}
                  </>
                )}
                {sel.k === 'tag' && (
                  <>
                    <div className="sep" />
                    <button
                      onClick={async () => {
                        const v = await askText(t('Переименовать тег'), { value: sel.id });
                        const n = v?.trim().replace(/^#/, '').replace(/\s+/g, '_');
                        if (n && n !== sel.id) {
                          renameTag(sel.id, n);
                          setSel({ k: 'tag', id: n });
                        }
                      }}
                    >
                      <Pencil size={16} /> {t('Переименовать тег')}
                    </button>
                    <div className="tk-colors">
                      {LIST_COLORS.map((c) => (
                        <button key={c} className="kb-swatch" style={{ background: c }} onClick={() => useTasks.getState().data && setTagColor(sel.id, c)} aria-label={c} />
                      ))}
                    </div>
                    <button
                      className="danger"
                      onClick={async () => {
                        if (await confirmDialog(t('Удалить тег #{tag}?', { tag: sel.id }), t('Тег будет убран из всех задач.'), { danger: true, okText: t('Удалить') })) deleteTag(sel.id);
                      }}
                    >
                      <Trash2 size={16} /> {t('Удалить тег')}
                    </button>
                  </>
                )}
                {curFilter && (
                  <>
                    <div className="sep" />
                    <button onClick={() => setFilterDlg(curFilter)}>
                      <Pencil size={16} /> {t('Изменить фильтр')}
                    </button>
                    <button className="danger" onClick={() => deleteFilter(curFilter.id)}>
                      <Trash2 size={16} /> {t('Удалить фильтр')}
                    </button>
                  </>
                )}
                {isTrash && (
                  <>
                    <div className="sep" />
                    <button
                      className="danger"
                      onClick={async () => {
                        if (await confirmDialog(t('Очистить корзину?'), t('Задачи будут удалены навсегда.'), { danger: true, okText: t('Очистить') })) emptyTrash();
                      }}
                    >
                      <Trash2 size={16} /> {t('Очистить корзину')}
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="tk-layout">
        <aside className="tk-nav">{nav}</aside>
        <div className="page-body tk-main">{content()}</div>
      </div>

      {tplOpen && <TaskTemplatesSheet preset={sel.k === 'matrix' || isTrash || isCompleted ? {} : preset} onClose={() => setTplOpen(false)} />}
      {bulkOn && canBulk ? (
        <BulkBar visible={shownIds} />
      ) : (
        <button className="tk-fab" onClick={() => openQuickAdd(sel.k === 'matrix' ? {} : preset)} aria-label={t('Новая задача')}>
          <Plus size={26} />
        </button>
      )}

      {drawer && (
        <div className="modal-backdrop tk-drawer-backdrop" onPointerDown={(e) => e.target === e.currentTarget && setDrawer(false)}>
          <div className="tk-drawer">{nav}</div>
        </div>
      )}
      {listDlg && <ListDialog id={listDlg.id} onClose={() => setListDlg(null)} onCreated={(id) => setSel({ k: 'list', id })} />}
      {filterDlg && (
        <FilterDialog
          filter={filterDlg}
          data={data}
          onClose={() => setFilterDlg(null)}
          onSave={(f) => {
            saveFilter(f);
            setFilterDlg(null);
            setSel({ k: 'filter', id: f.id });
          }}
        />
      )}
    </div>
  );
}

function setTagColor(tag: string, color: string) {
  import('../tasks/store').then(({ mutateTasks }) => mutateTasks((d) => void (d.tagColors[tag] = color)));
}

async function toggleMap(m: MapTask, set: (fn: (ts: MapTask[]) => MapTask[]) => void) {
  const done = m.task.status !== 'done';
  const patch = done ? { status: 'done' as const, progress: 100 } : { status: 'todo' as const };
  set((ts) => ts.map((x) => (x.docId === m.docId && x.topicId === m.topicId ? { ...x, task: { ...x.task, ...patch } } : x)));
  await updateMapTask(m.docId, m.topicId, patch).catch(() => undefined);
}

function MapRow({ m, onToggle }: { m: MapTask; onToggle: () => void }) {
  const today = todayYmd();
  return (
    <div className="tk-row-wrap">
      <div className="tk-row" onClick={() => void openDoc(m.docId, m.topicId)}>
        <TaskCheck task={{ done: m.task.status === 'done', priority: (m.task.priority ?? 0) as Priority }} onToggle={onToggle} />
        <div className="tk-body">
          <div className="tk-title">{m.text || t('Без названия')}</div>
          <div className="tk-meta">
            {m.task.due && <span className={`tk-when${m.task.due < today ? ' overdue' : m.task.due === today ? ' today' : ''}`}>{dayLabel(m.task.due, today)}</span>}
            <Network size={12} className="tk-mi" />
            <span className="ellipsis">
              {m.docTitle}
              {m.path.length > 0 && ' › ' + m.path.slice(-2).join(' › ')}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Collapsible({
  title,
  color,
  count,
  children,
  onDrop,
  hideHead,
  action,
}: {
  action?: ReactNode;
  title: string;
  color?: string;
  count: number;
  children: ReactNode;
  onDrop?: (id: string) => void;
  hideHead?: boolean;
}) {
  const [open, setOpen] = useState(true);
  return (
    <DropZone className="tk-group" onDrop={onDrop} enabled={!!onDrop}>
      {!hideHead && (
        <div className="tk-group-head" style={color ? ({ '--gc': color } as CSSProperties) : undefined}>
          <button className="tk-toggle tk-group-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            <span className="tk-group-title">{title}</span>
            <span className="tk-group-count">{count}</span>
          </button>
          {action}
        </div>
      )}
      {open && children}
    </DropZone>
  );
}

/** Приёмник перетаскивания задач: мышью (drag-and-drop) и пальцем (touchDrag) */
function DropZone({ className, children, onDrop, enabled }: { className: string; children: ReactNode; onDrop?: (id: string) => void; enabled: boolean }) {
  const [over, setOver] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const dropRef = useRef(onDrop);
  useEffect(() => {
    dropRef.current = onDrop;
  });
  useEffect(() => {
    if (!enabled || !ref.current) return;
    return registerDropZone({ el: ref.current, onDrop: (id) => dropRef.current?.(id), setOver });
  }, [enabled]);
  return (
    <section
      ref={ref}
      className={`${className}${over ? ' drop-over' : ''}`}
      onDragOver={(e) => {
        if (!enabled || !e.dataTransfer.types.includes('text/sm-task')) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const id = e.dataTransfer.getData('text/sm-task');
        if (id && onDrop) {
          e.preventDefault();
          onDrop(id);
        }
      }}
    >
      {children}
    </section>
  );
}

function Empty({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="empty tk-empty">
      <div className="tk-empty-ico">{icon}</div>
      <div>{text}</div>
    </div>
  );
}

// ---------- Матрица Эйзенхауэра ----------

function Matrix({ data }: { data: TasksData }) {
  const active = data.tasks.filter(isActive).sort((a, b) => compareTasks(a, b, 'date'));
  return (
    <div className="tk-matrix">
      {QUADRANTS.map((qd) => {
        const ts = active.filter((t) => quadrantOf(t) === qd.q);
        return (
          <DropZone key={qd.q} className="tk-quad card" enabled onDrop={(id) => updateTask(id, { priority: qd.priority })}>
            <header className="tk-quad-head" style={{ '--gc': qd.color } as CSSProperties}>
              <span className="tk-quad-num">{['I', 'II', 'III', 'IV'][qd.q - 1]}</span>
              <div className="grow">
                <div className="tk-quad-title">{qd.title}</div>
                <div className="tiny faint">{qd.hint}</div>
              </div>
              <span className="tk-group-count">{ts.length}</span>
            </header>
            <div className="tk-quad-body">
              {ts.map((t) => (
                <TaskRow key={t.id} task={t} list={data.lists.find((l) => l.id === t.listId)} showList={false} tagColors={data.tagColors} draggable />
              ))}
              {ts.length === 0 && <div className="tiny faint tk-quad-empty">{t('Нет задач')}</div>}
            </div>
            <div className="tk-quad-add">
              <SmartInput preset={{ priority: qd.priority }} compact />
            </div>
          </DropZone>
        );
      })}
    </div>
  );
}

// ---------- Выполненные ----------

function CompletedView({ data }: { data: TasksData }) {
  const today = todayYmd();
  const taskById = new Map(data.tasks.map((x) => [x.id, x]));
  const listById = new Map(data.lists.map((l) => [l.id, l]));
  const entries = [...data.log].sort((a, b) => b.at - a.at).slice(0, 400);
  const byDay = new Map<string, typeof entries>();
  for (const e of entries) {
    const d = new Date(e.at);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    byDay.set(k, [...(byDay.get(k) ?? []), e]);
  }
  if (!entries.length) return <Empty icon={<CheckCircle2 />} text={t('Выполненных задач пока нет')} />;
  return (
    <div className="tk-groups">
      {[...byDay.entries()].map(([day, es]) => (
        <section key={day} className="tk-group">
          <div className="tk-group-head">
            <span className="tk-group-title">
              {dayLabel(day, today)} · {longDate(day).split(', ')[1]}
            </span>
            <span className="tk-group-count">{es.length}</span>
          </div>
          {es.map((e, i) => {
            const task = taskById.get(e.taskId);
            const list = listById.get(e.listId);
            return (
              <div key={e.taskId + e.at + i} className="tk-row-wrap">
                <div className="tk-row is-done" onClick={() => task && openTask(task.id)}>
                  <span className="tk-check on static">
                    <Check size={13} strokeWidth={3.2} />
                  </span>
                  <div className="tk-body">
                    <div className="tk-title">{e.title}</div>
                    <div className="tk-meta">
                      {new Date(e.at).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' })}
                      {task?.repeat && t(' · повторяющаяся')}
                    </div>
                  </div>
                  {list && (
                    <span className="tk-list-dot">
                      <i style={{ background: list.color }} />
                      <span className="ellipsis">{list.name}</span>
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}

// ---------- Диалоги списков и фильтров ----------

const EMOJIS = ['📥', '🏡', '💼', '🛒', '🎯', '📚', '💪', '✈️', '💡', '🎨', '💰', '❤️', '🎓', '🧘', '🍳', '🚗', '🎮', '🐾'];

function ListDialog({ id, onClose, onCreated }: { id?: string; onClose: () => void; onCreated: (id: string) => void }) {
  const data = useTasks((s) => s.data)!;
  const cur = id ? data.lists.find((l) => l.id === id) : undefined;
  const [name, setName] = useState(cur?.name ?? '');
  const [color, setColor] = useState(cur?.color ?? LIST_COLORS[data.lists.length % LIST_COLORS.length]);
  const [emoji, setEmoji] = useState<string | undefined>(cur?.emoji);
  const save = () => {
    const n = name.trim();
    if (!n) return;
    if (cur) updateList(cur.id, { name: n, color, emoji });
    else {
      const l = addList(n, color, emoji);
      if (l) onCreated(l.id);
    }
    onClose();
  };
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2>{cur ? t('Изменить список') : t('Новый список')}</h2>
        <label className="label">{t('Название')}</label>
        <input className="input" autoFocus value={name} placeholder={t('Напр. «Покупки», «Проект X»')} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
        <label className="label">{t('Значок')}</label>
        <div className="tk-emojis">
          <button className={`tk-emoji-btn${!emoji ? ' on' : ''}`} onClick={() => setEmoji(undefined)}>
            <i className="tk-dot" style={{ background: color }} />
          </button>
          {EMOJIS.map((e) => (
            <button key={e} className={`tk-emoji-btn${emoji === e ? ' on' : ''}`} onClick={() => setEmoji(e)}>
              {e}
            </button>
          ))}
        </div>
        <label className="label">{t('Цвет')}</label>
        <div className="tk-colors">
          {LIST_COLORS.map((c) => (
            <button key={c} className={`kb-swatch${c === color ? ' active' : ''}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />
          ))}
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            {t('Отмена')}
          </button>
          <button className="btn btn-primary" onClick={save} disabled={!name.trim()}>
            {cur ? t('Сохранить') : t('Создать')}
          </button>
        </div>
      </div>
    </div>
  );
}

const WHEN_OPTIONS: [WhenFilter, string][] = [
  ['any', t('Любой срок')],
  ['overdue', t('Просроченные')],
  ['today', t('Сегодня и просроченные')],
  ['tomorrow', t('Завтра')],
  ['week', t('Ближайшие 7 дней')],
  ['hasdate', t('Есть срок')],
  ['nodate', t('Без срока')],
];

function FilterDialog({ filter, data, onClose, onSave }: { filter: TaskFilter; data: TasksData; onClose: () => void; onSave: (f: TaskFilter) => void }) {
  const [f, setF] = useState<TaskFilter>(filter);
  const toggle = <T,>(arr: T[] | undefined, v: T) => (arr?.includes(v) ? arr.filter((x) => x !== v) : [...(arr ?? []), v]);
  const tags = allTags(data);
  const matched = data.tasks.filter((t) => isActive(t) && applyFilter(t, f, todayYmd())).length;
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2>{filter.name ? t('Изменить фильтр') : t('Новый фильтр')}</h2>
        <label className="label">{t('Название')}</label>
        <input className="input" autoFocus value={f.name} placeholder={t('Напр. «Срочное по работе»')} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <label className="label">{t('Списки')}</label>
        <div className="tk-chips">
          {data.lists.map((l) => (
            <button key={l.id} className={`chip${f.lists?.includes(l.id) ? ' active' : ''}`} onClick={() => setF({ ...f, lists: toggle(f.lists, l.id) })}>
              {l.emoji} {l.name}
            </button>
          ))}
        </div>
        {tags.length > 0 && (
          <>
            <label className="label">{t('Теги')}</label>
            <div className="tk-chips">
              {tags.map((g) => (
                <button key={g} className={`chip${f.tags?.includes(g) ? ' active' : ''}`} onClick={() => setF({ ...f, tags: toggle(f.tags, g) })}>
                  #{g}
                </button>
              ))}
            </div>
          </>
        )}
        <label className="label">{t('Приоритет')}</label>
        <div className="tk-chips">
          {([1, 2, 3, 0] as const).map((p) => (
            <button key={p} className={`chip${f.priorities?.includes(p) ? ' active' : ''}`} onClick={() => setF({ ...f, priorities: toggle(f.priorities, p) })}>
              {p ? PRIORITY_META[p].label : t('Без приоритета')}
            </button>
          ))}
        </div>
        <label className="label">{t('Срок')}</label>
        <select className="select" value={f.when ?? 'any'} onChange={(e) => setF({ ...f, when: e.target.value as WhenFilter })}>
          {WHEN_OPTIONS.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <label className="label">{t('Содержит текст')}</label>
        <input className="input" value={f.query ?? ''} placeholder={t('Необязательно')} onChange={(e) => setF({ ...f, query: e.target.value || undefined })} />
        <div className="modal-actions">
          <span className="small muted grow">{t('Подходит задач: {n}', { n: matched })}</span>
          <button className="btn" onClick={onClose}>
            {t('Отмена')}
          </button>
          <button className="btn btn-primary" disabled={!f.name.trim()} onClick={() => onSave({ ...f, name: f.name.trim() })}>
            {t('Сохранить')}
          </button>
        </div>
      </div>
    </div>
  );
}
