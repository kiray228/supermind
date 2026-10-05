import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
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
} from 'lucide-react';
import { useApp } from '../store/appStore';
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
import { SmartInput } from '../tasks/ui/QuickAdd';
import '../tasks/ui/tasks.css';

type Sel = { k: 'smart'; id: SmartId } | { k: 'list'; id: string } | { k: 'tag'; id: string } | { k: 'filter'; id: string } | { k: 'matrix' };
type GroupBy = 'date' | 'priority' | 'list' | 'none';

const SMART: { id: SmartId; name: string; icon: typeof Sun; color: string }[] = [
  { id: 'today', name: 'Сегодня', icon: Sun, color: '#f59e0b' },
  { id: 'tomorrow', name: 'Завтра', icon: Sunrise, color: '#f97316' },
  { id: 'week', name: 'Следующие 7 дней', icon: CalendarRange, color: '#8b5cf6' },
  { id: 'inbox', name: 'Входящие', icon: Inbox, color: '#3b82f6' },
  { id: 'all', name: 'Все задачи', icon: ListTodo, color: '#14b8a6' },
  { id: 'nodate', name: 'Без даты', icon: CalendarX2, color: '#64748b' },
  { id: 'maps', name: 'Из карт', icon: Network, color: '#ec4899' },
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
  if (by === 'none') return [{ key: 'all', title: 'Задачи', tasks }];
  if (by === 'priority') {
    return ([1, 2, 3, 0] as Priority[]).map((p) => ({
      key: 'p' + p,
      title: p ? PRIORITY_META[p].label + ' приоритет' : 'Без приоритета',
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
    { key: 'overdue', title: 'Просрочено', color: 'var(--danger)', tasks: [] },
    { key: 'today', title: 'Сегодня', color: 'var(--accent)', tasks: [], drop: { date: today } },
    { key: 'tomorrow', title: 'Завтра', tasks: [], drop: { date: addDaysYmd(today, 1) } },
  ];
  if (perDay) for (let i = 2; i < 7; i++) g.push({ key: 'd' + i, title: `${dayLabel(addDaysYmd(today, i), today)} · ${longDate(addDaysYmd(today, i)).split(', ')[1]}`, tasks: [], drop: { date: addDaysYmd(today, i) } });
  else g.push({ key: 'week', title: 'Следующие 7 дней', tasks: [], drop: { date: addDaysYmd(today, 2) } });
  g.push({ key: 'later', title: 'Позже', tasks: [] }, { key: 'nodate', title: 'Без даты', tasks: [], drop: { date: undefined } });
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
  const today = todayYmd();

  useEffect(() => {
    void ensureTasks();
  }, []);
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
    for (const l of data.lists) c['list:' + l.id] = data.tasks.filter((t) => isActive(t) && t.listId === l.id).length;
    for (const f of data.filters) c['filter:' + f.id] = data.tasks.filter((t) => isActive(t) && applyFilter(t, f, today)).length;
    for (const g of allTags(data)) c['tag:' + g] = data.tasks.filter((t) => isActive(t) && t.tags.includes(g)).length;
    c['smart:maps'] += mapTasks.filter((m) => m.task.status !== 'done').length;
    return c;
  }, [data, today, mapTasks]);

  if (!data) {
    return (
      <div className="page">
        <div className="page-header">
          <h1>Задачи</h1>
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
      ? 'Матрица Эйзенхауэра'
      : sel.k === 'smart'
        ? sel.id === 'completed'
          ? 'Выполненные'
          : sel.id === 'trash'
            ? 'Корзина'
            : smart?.name ?? 'Задачи'
        : sel.k === 'list'
          ? (curList?.emoji ? curList.emoji + ' ' : '') + (curList?.name ?? '')
          : sel.k === 'tag'
            ? '#' + sel.id
            : curFilter?.name ?? 'Фильтр';

  const q = query?.trim().toLowerCase();
  const all = data.tasks.filter((t) => (q ? !t.deleted && (t.title + ' ' + (t.notes ?? '') + ' ' + t.tags.join(' ')).toLowerCase().includes(q) : inSelection(data, sel, t, today)));
  const active = all.filter((t) => !t.done && !t.wontDo).sort((a, b) => compareTasks(a, b, data.prefs.sortBy));
  const done = all.filter((t) => t.done || t.wontDo).sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
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

  const effectiveGroup: GroupBy = sel.k === 'smart' && (sel.id === 'today' || sel.id === 'tomorrow' || sel.id === 'nodate') && groupBy === 'date' ? 'none' : groupBy;
  const groups = groupTasks(active, effectiveGroup, data, today, sel.k === 'smart' && sel.id === 'week').filter((g) => g.tasks.length || (mode === 'kanban' && g.drop));
  const mapList =
    q || sel.k !== 'smart'
      ? []
      : mapTasks.filter((m) => {
          if (m.task.status === 'done') return false;
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
      {navItem('matrix', { k: 'matrix' }, <Grid2x2 size={18} />, 'Матрица Эйзенхауэра', '#ef4444')}
      <div className="tk-nav-sec">
        <span>Списки</span>
        <button className="icon-btn" onClick={() => setListDlg({})} aria-label="Новый список">
          <Plus />
        </button>
      </div>
      {[...data.lists]
        .sort((a, b) => a.order - b.order)
        .map((l) => navItem('list:' + l.id, { k: 'list', id: l.id }, l.emoji ? <span className="tk-emoji">{l.emoji}</span> : <i className="tk-dot" style={{ background: l.color }} />, l.name, l.color))}
      <div className="tk-nav-sec">
        <span>Фильтры</span>
        <button className="icon-btn" onClick={() => setFilterDlg({ id: uid(), name: '', color: LIST_COLORS[data.filters.length % LIST_COLORS.length] })} aria-label="Новый фильтр">
          <Plus />
        </button>
      </div>
      {data.filters.length === 0 && <div className="tk-nav-hint tiny faint">Свои подборки: по спискам, тегам, приоритету и сроку</div>}
      {data.filters.map((f) => navItem('filter:' + f.id, { k: 'filter', id: f.id }, <Filter size={17} />, f.name, f.color))}
      {tagNames.length > 0 && (
        <div className="tk-nav-sec">
          <span>Теги</span>
        </div>
      )}
      {tagNames.map((g) => navItem('tag:' + g, { k: 'tag', id: g }, <Hash size={17} />, g, data.tagColors[g]))}
      <div className="tk-nav-sep" />
      {navItem('smart:completed', { k: 'smart', id: 'completed' }, <CheckCircle2 size={18} />, 'Выполненные', '#22c55e')}
      {navItem('smart:trash', { k: 'smart', id: 'trash' }, <Trash2 size={18} />, 'Корзина', '#94a3b8')}
    </div>
  );

  const renderRows = (ts: TaskItem[]) =>
    ts.map((t) => <TaskRow key={t.id} task={t} list={data.lists.find((l) => l.id === t.listId)} showList={sel.k !== 'list'} tagColors={data.tagColors} draggable />);

  const content = () => {
    if (sel.k === 'matrix' && !q) return <Matrix data={data} />;
    if (isTrash && !q) {
      return (
        <div className="tk-groups">
          {all.length === 0 ? (
            <Empty icon={<Trash2 />} text="Корзина пуста" />
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
                    <Plus size={15} /> Добавить
                  </button>
                )}
              </DropZone>
            ))}
          </div>
        ) : (
          <div className="tk-groups">
            {groups.map((g) => (
              <Collapsible key={g.key} title={g.title} color={g.color} count={g.tasks.length} onDrop={g.drop ? (id) => onDrop(g, id) : undefined} hideHead={groups.length === 1 && effectiveGroup === 'none'}>
                {renderRows(g.tasks)}
              </Collapsible>
            ))}
            {mapList.length > 0 && (
              <Collapsible title="Из карт" color="#ec4899" count={mapList.length}>
                {mapList.map((m) => (
                  <MapRow key={m.docId + m.topicId} m={m} onToggle={() => toggleMap(m, setMapTasks)} />
                ))}
              </Collapsible>
            )}
            {active.length === 0 && mapList.length === 0 && <Empty icon={<Check />} text={q ? 'Ничего не найдено' : 'Здесь пока нет задач. Добавьте первую!'} />}
            {done.length > 0 && !data.prefs.hideCompleted && (
              <section className="tk-group tk-done-group">
                <button className="tk-group-head tk-toggle" onClick={() => setShowDone(!showDone)}>
                  {showDone ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <span className="tk-group-title">Выполненные</span>
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

  const exportCurrent = () => void exportTasksIcs(sel.k === 'matrix' ? data.tasks.filter(isActive) : active);

  return (
    <div className="page tk-page">
      <div className="page-header tk-header">
        <button className="tk-title-btn" onClick={() => setDrawer(true)}>
          <h1 className="ellipsis">{q ? 'Поиск' : title}</h1>
          <ChevronDown size={18} className="tk-mobile-only" />
        </button>
        <div className="grow" />
        {query !== null ? (
          <div className="tk-search">
            <Search size={16} />
            <input autoFocus value={query} placeholder="Поиск задач" onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setQuery(null)} />
            <button className="icon-btn" onClick={() => setQuery(null)} aria-label="Закрыть поиск">
              <X />
            </button>
          </div>
        ) : (
          <button className="icon-btn" onClick={() => setQuery('')} aria-label="Поиск">
            <Search />
          </button>
        )}
        {sel.k !== 'matrix' && !isTrash && !isCompleted && (
          <div className="segmented tk-mode">
            <button className={mode === 'list' ? 'active' : ''} onClick={() => setMode('list')} aria-label="Список">
              <LayoutList size={16} />
            </button>
            <button className={mode === 'kanban' ? 'active' : ''} onClick={() => setMode('kanban')} aria-label="Канбан">
              <Columns3 size={16} />
            </button>
          </div>
        )}
        <div className="td-pop-anchor">
          <button className="icon-btn" onClick={() => setMenu(!menu)} aria-label="Ещё">
            <MoreHorizontal />
          </button>
          {menu && (
            <>
              <div className="td-pop right tk-menu" onClick={() => setMenu(false)}>
                <div className="td-pop-label">Сортировка</div>
                {(
                  [
                    ['date', 'По дате'],
                    ['priority', 'По приоритету'],
                    ['title', 'По названию'],
                    ['created', 'Сначала новые'],
                  ] as const
                ).map(([k, l]) => (
                  <button key={k} className={data.prefs.sortBy === k ? 'active' : ''} onClick={() => setPrefs({ sortBy: k })}>
                    {data.prefs.sortBy === k ? <Check size={16} /> : <span className="tk-sp" />} {l}
                  </button>
                ))}
                <div className="td-pop-label">Группировка</div>
                {(
                  [
                    ['date', 'По дате'],
                    ['priority', 'По приоритету'],
                    ['list', 'По спискам'],
                    ['none', 'Без групп'],
                  ] as const
                ).map(([k, l]) => (
                  <button key={k} className={groupBy === k ? 'active' : ''} onClick={() => setGroupBy(k)}>
                    {groupBy === k ? <Check size={16} /> : <span className="tk-sp" />} {l}
                  </button>
                ))}
                <div className="sep" />
                <button onClick={() => setPrefs({ hideCompleted: !data.prefs.hideCompleted })}>
                  <Layers size={16} /> {data.prefs.hideCompleted ? 'Показывать выполненные' : 'Скрыть выполненные'}
                </button>
                <button onClick={exportCurrent}>
                  <CalendarPlus size={16} /> Экспорт в календарь (.ics)
                </button>
                <button onClick={() => useApp.getState().go('calendar')}>
                  <CalendarDays size={16} /> Открыть календарь
                </button>
                {curList && (
                  <>
                    <div className="sep" />
                    <button onClick={() => setListDlg({ id: curList.id })}>
                      <Pencil size={16} /> Изменить список
                    </button>
                    {curList.id !== 'inbox' && (
                      <button
                        className="danger"
                        onClick={async () => {
                          if (await confirmDialog(`Удалить список «${curList.name}»?`, 'Задачи списка будут перемещены в корзину.', { danger: true, okText: 'Удалить' })) deleteList(curList.id);
                        }}
                      >
                        <Trash2 size={16} /> Удалить список
                      </button>
                    )}
                  </>
                )}
                {sel.k === 'tag' && (
                  <>
                    <div className="sep" />
                    <button
                      onClick={async () => {
                        const v = await askText('Переименовать тег', { value: sel.id });
                        const n = v?.trim().replace(/^#/, '').replace(/\s+/g, '_');
                        if (n && n !== sel.id) {
                          renameTag(sel.id, n);
                          setSel({ k: 'tag', id: n });
                        }
                      }}
                    >
                      <Pencil size={16} /> Переименовать тег
                    </button>
                    <div className="tk-colors">
                      {LIST_COLORS.map((c) => (
                        <button key={c} className="kb-swatch" style={{ background: c }} onClick={() => useTasks.getState().data && setTagColor(sel.id, c)} aria-label={c} />
                      ))}
                    </div>
                    <button
                      className="danger"
                      onClick={async () => {
                        if (await confirmDialog(`Удалить тег #${sel.id}?`, 'Тег будет убран из всех задач.', { danger: true, okText: 'Удалить' })) deleteTag(sel.id);
                      }}
                    >
                      <Trash2 size={16} /> Удалить тег
                    </button>
                  </>
                )}
                {curFilter && (
                  <>
                    <div className="sep" />
                    <button onClick={() => setFilterDlg(curFilter)}>
                      <Pencil size={16} /> Изменить фильтр
                    </button>
                    <button className="danger" onClick={() => deleteFilter(curFilter.id)}>
                      <Trash2 size={16} /> Удалить фильтр
                    </button>
                  </>
                )}
                {isTrash && (
                  <>
                    <div className="sep" />
                    <button
                      className="danger"
                      onClick={async () => {
                        if (await confirmDialog('Очистить корзину?', 'Задачи будут удалены навсегда.', { danger: true, okText: 'Очистить' })) emptyTrash();
                      }}
                    >
                      <Trash2 size={16} /> Очистить корзину
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

      <button className="tk-fab" onClick={() => openQuickAdd(sel.k === 'matrix' ? {} : preset)} aria-label="Новая задача">
        <Plus size={26} />
      </button>

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
          <div className="tk-title">{m.text || 'Без названия'}</div>
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
}: {
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
        <button className="tk-group-head tk-toggle" onClick={() => setOpen(!open)} style={color ? ({ '--gc': color } as CSSProperties) : undefined}>
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <span className="tk-group-title">{title}</span>
          <span className="tk-group-count">{count}</span>
        </button>
      )}
      {open && children}
    </DropZone>
  );
}

/** Приёмник перетаскивания задач (мышь) */
function DropZone({ className, children, onDrop, enabled }: { className: string; children: ReactNode; onDrop?: (id: string) => void; enabled: boolean }) {
  const [over, setOver] = useState(false);
  return (
    <section
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
              {ts.length === 0 && <div className="tiny faint tk-quad-empty">Нет задач</div>}
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
  const entries = [...data.log].sort((a, b) => b.at - a.at).slice(0, 400);
  const byDay = new Map<string, typeof entries>();
  for (const e of entries) {
    const d = new Date(e.at);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    byDay.set(k, [...(byDay.get(k) ?? []), e]);
  }
  if (!entries.length) return <Empty icon={<CheckCircle2 />} text="Выполненных задач пока нет" />;
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
            const t = data.tasks.find((x) => x.id === e.taskId);
            const list = data.lists.find((l) => l.id === e.listId);
            return (
              <div key={e.taskId + e.at + i} className="tk-row-wrap">
                <div className="tk-row is-done" onClick={() => t && openTask(t.id)}>
                  <span className="tk-check on static">
                    <Check size={13} strokeWidth={3.2} />
                  </span>
                  <div className="tk-body">
                    <div className="tk-title">{e.title}</div>
                    <div className="tk-meta">
                      {new Date(e.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                      {t?.repeat && ' · повторяющаяся'}
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
        <h2>{cur ? 'Изменить список' : 'Новый список'}</h2>
        <label className="label">Название</label>
        <input className="input" autoFocus value={name} placeholder="Напр. «Покупки», «Проект X»" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
        <label className="label">Значок</label>
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
        <label className="label">Цвет</label>
        <div className="tk-colors">
          {LIST_COLORS.map((c) => (
            <button key={c} className={`kb-swatch${c === color ? ' active' : ''}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />
          ))}
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Отмена
          </button>
          <button className="btn btn-primary" onClick={save} disabled={!name.trim()}>
            {cur ? 'Сохранить' : 'Создать'}
          </button>
        </div>
      </div>
    </div>
  );
}

const WHEN_OPTIONS: [WhenFilter, string][] = [
  ['any', 'Любой срок'],
  ['overdue', 'Просроченные'],
  ['today', 'Сегодня и просроченные'],
  ['tomorrow', 'Завтра'],
  ['week', 'Ближайшие 7 дней'],
  ['hasdate', 'Есть срок'],
  ['nodate', 'Без срока'],
];

function FilterDialog({ filter, data, onClose, onSave }: { filter: TaskFilter; data: TasksData; onClose: () => void; onSave: (f: TaskFilter) => void }) {
  const [f, setF] = useState<TaskFilter>(filter);
  const toggle = <T,>(arr: T[] | undefined, v: T) => (arr?.includes(v) ? arr.filter((x) => x !== v) : [...(arr ?? []), v]);
  const tags = allTags(data);
  const matched = data.tasks.filter((t) => isActive(t) && applyFilter(t, f, todayYmd())).length;
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2>{filter.name ? 'Изменить фильтр' : 'Новый фильтр'}</h2>
        <label className="label">Название</label>
        <input className="input" autoFocus value={f.name} placeholder="Напр. «Срочное по работе»" onChange={(e) => setF({ ...f, name: e.target.value })} />
        <label className="label">Списки</label>
        <div className="tk-chips">
          {data.lists.map((l) => (
            <button key={l.id} className={`chip${f.lists?.includes(l.id) ? ' active' : ''}`} onClick={() => setF({ ...f, lists: toggle(f.lists, l.id) })}>
              {l.emoji} {l.name}
            </button>
          ))}
        </div>
        {tags.length > 0 && (
          <>
            <label className="label">Теги</label>
            <div className="tk-chips">
              {tags.map((g) => (
                <button key={g} className={`chip${f.tags?.includes(g) ? ' active' : ''}`} onClick={() => setF({ ...f, tags: toggle(f.tags, g) })}>
                  #{g}
                </button>
              ))}
            </div>
          </>
        )}
        <label className="label">Приоритет</label>
        <div className="tk-chips">
          {([1, 2, 3, 0] as const).map((p) => (
            <button key={p} className={`chip${f.priorities?.includes(p) ? ' active' : ''}`} onClick={() => setF({ ...f, priorities: toggle(f.priorities, p) })}>
              {p ? PRIORITY_META[p].label : 'Без приоритета'}
            </button>
          ))}
        </div>
        <label className="label">Срок</label>
        <select className="select" value={f.when ?? 'any'} onChange={(e) => setF({ ...f, when: e.target.value as WhenFilter })}>
          {WHEN_OPTIONS.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <label className="label">Содержит текст</label>
        <input className="input" value={f.query ?? ''} placeholder="Необязательно" onChange={(e) => setF({ ...f, query: e.target.value || undefined })} />
        <div className="modal-actions">
          <span className="small muted grow">Подходит задач: {matched}</span>
          <button className="btn" onClick={onClose}>
            Отмена
          </button>
          <button className="btn btn-primary" disabled={!f.name.trim()} onClick={() => onSave({ ...f, name: f.name.trim() })}>
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}
