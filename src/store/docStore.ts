import { create } from 'zustand';
import type {
  Boundary, FloatingTopic, ID, LineStyle, MindDoc, Relationship, Sheet, StructureType, Summary, Topic, TopicStyle,
} from '../types';
import { clone, findInSheet, isAncestor, newTopic, reId, uid, visibleOrder, pathTo } from '../utils/tree';
import { saveDoc, saveLocked } from './db';
import { mapSides } from '../layout/layout';
import { encryptDoc } from '../utils/crypto';

export function newSheet(title = 'Лист 1', rootText = 'Центральная тема', structure: StructureType = 'map'): Sheet {
  return {
    id: uid(),
    title,
    root: newTopic(rootText),
    floating: [],
    relationships: [],
    boundaries: [],
    summaries: [],
    structure,
    themeId: 'classic',
    rainbow: true,
  };
}

export function newDoc(title = 'Новая карта', sheet?: Sheet): MindDoc {
  const s = sheet ?? newSheet('Лист 1', title);
  const now = Date.now();
  return { id: uid(), title, sheets: [s], activeSheet: s.id, createdAt: now, updatedAt: now };
}

interface DocState {
  doc: MindDoc | null;
  /** пароль, если документ зашифрован */
  password: string | null;
  selection: ID[];
  editingId: ID | null;
  /** текст, с которого начинается редактирование (печать без входа в режим) */
  pendingText: string | null;
  /** выбранная связь */
  selectedRel: ID | null;
  past: MindDoc[];
  future: MindDoc[];
  clipboard: Topic[] | null;
  /** текст, отправленный в системный буфер при копировании тем */
  clipboardText: string | null;
  saving: boolean;
  /** счётчик для "сфокусировать камеру на теме" */
  focusReq: { id: ID; n: number } | null;

  open(doc: MindDoc, password?: string | null): void;
  close(): void;
  sheet(): Sheet | null;
  /** Изменение активного листа с записью в историю */
  mutate(fn: (s: Sheet, d: MindDoc) => void, opts?: { history?: boolean }): void;
  mutateDoc(fn: (d: MindDoc) => void): void;
  undo(): void;
  redo(): void;
  setPassword(p: string | null): void;

  select(ids: ID[] | ID | null, add?: boolean): void;
  setEditing(id: ID | null): void;
  selectRel(id: ID | null): void;
  focusTopic(id: ID): void;

  setText(id: ID, text: string): void;
  updateTopic(id: ID, patch: Partial<Topic>): void;
  updateTopics(ids: ID[], fn: (t: Topic) => void): void;
  updateStyle(ids: ID[], patch: Partial<TopicStyle>): void;
  addChild(id?: ID, text?: string, side?: 'left' | 'right'): ID | null;
  setSide(id: ID, side: 'left' | 'right'): void;
  addSibling(id?: ID, before?: boolean, text?: string): ID | null;
  addParent(id?: ID): ID | null;
  addFloating(x: number, y: number): ID;
  insertChildren(parentId: ID, topics: Topic[]): void;
  deleteTopics(ids?: ID[]): void;
  toggleCollapse(id: ID, value?: boolean): void;
  collapseAll(collapsed: boolean, depth?: number): void;
  move(id: ID, newParentId: ID, index: number, side?: 'left' | 'right'): void;
  moveFloating(id: ID, x: number, y: number): void;
  detach(id: ID, x: number, y: number): void;
  reorder(id: ID, dir: -1 | 1): void;
  indent(id: ID): void;
  outdent(id: ID): void;
  copy(cut?: boolean): void;
  paste(targetId?: ID): void;
  duplicate(id?: ID): void;
  navigate(dir: 'up' | 'down' | 'left' | 'right'): void;

  addRelationship(from: ID, to: ID): void;
  updateRelationship(id: ID, patch: Partial<Relationship>): void;
  removeRelationship(id: ID): void;
  addBoundary(topicId?: ID): void;
  updateBoundary(id: ID, patch: Partial<Boundary>): void;
  removeBoundary(id: ID): void;
  addSummary(topicId?: ID): void;
  updateSummary(id: ID, patch: Partial<Summary>): void;
  removeSummary(id: ID): void;

  setSheetProps(patch: Partial<Pick<Sheet, 'structure' | 'themeId' | 'rainbow' | 'lineStyle' | 'spacing' | 'title' | 'background' | 'shapes'>>): void;
  addSheet(sheet?: Sheet): void;
  removeSheet(id: ID): void;
  duplicateSheet(id: ID): void;
  setActiveSheet(id: ID): void;
  setTitle(title: string): void;
  replaceRoot(root: Topic): void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 400);
}

/** Есть несохранённые изменения открытой карты */
export const hasPendingSave = () => !!saveTimer;

export async function flushSave() {
  // нечего сохранять — не трогаем базу (иначе синхронизация считала бы карту изменённой)
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  const { doc, password } = useDoc.getState();
  if (!doc) return;
  useDoc.setState({ saving: true });
  try {
    if (password) await saveLocked(await encryptDoc(doc, password), doc.title);
    else await saveDoc(doc);
  } finally {
    useDoc.setState({ saving: false });
  }
}

const HISTORY_LIMIT = 150;

/** Пакет изменений (перетаскивание ползунка) — один шаг отмены */
let batch: 'off' | 'open' | 'pushed' = 'off';
export function beginBatch() {
  batch = 'open';
}
export function endBatch() {
  batch = 'off';
}

export const useDoc = create<DocState>((set, get) => {
  const activeSheet = (d: MindDoc) => d.sheets.find((s) => s.id === d.activeSheet) ?? d.sheets[0];

  const commit = (next: MindDoc, history = true) => {
    const { doc, past } = get();
    if (history && batch === 'pushed') history = false;
    else if (history && batch === 'open') batch = 'pushed';
    next.updatedAt = Date.now();
    set({
      doc: next,
      past: history && doc ? [...past.slice(-HISTORY_LIMIT), doc] : past,
      future: history ? [] : get().future,
    });
    scheduleSave();
  };

  const target = (id?: ID) => id ?? get().selection[get().selection.length - 1];

  return {
    doc: null,
    password: null,
    selection: [],
    editingId: null,
    pendingText: null,
    selectedRel: null,
    past: [],
    future: [],
    clipboard: null,
    clipboardText: null,
    saving: false,
    focusReq: null,

    open(doc, password = null) {
      // на телефоне ничего не выделяем: первый тап по теме — выбор, а не редактирование
      const touch = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
      set({ doc, password, selection: touch ? [] : [activeSheet(doc).root.id], editingId: null, pendingText: null, past: [], future: [], selectedRel: null });
    },
    close() {
      flushSave();
      set({ doc: null, password: null, selection: [], editingId: null, past: [], future: [] });
    },
    sheet() {
      const d = get().doc;
      return d ? activeSheet(d) : null;
    },
    mutate(fn, opts) {
      const d = get().doc;
      if (!d) return;
      const next = clone(d);
      fn(activeSheet(next), next);
      commit(next, opts?.history ?? true);
    },
    mutateDoc(fn) {
      const d = get().doc;
      if (!d) return;
      const next = clone(d);
      fn(next);
      commit(next);
    },
    undo() {
      const { past, doc, future } = get();
      if (!past.length || !doc) return;
      const prev = past[past.length - 1];
      set({ doc: prev, past: past.slice(0, -1), future: [doc, ...future], editingId: null, pendingText: null, selection: cleanSelection(prev, get().selection) });
      scheduleSave();
    },
    redo() {
      const { past, doc, future } = get();
      if (!future.length || !doc) return;
      const nxt = future[0];
      set({ doc: nxt, past: [...past, doc], future: future.slice(1), editingId: null, pendingText: null, selection: cleanSelection(nxt, get().selection) });
      scheduleSave();
    },
    setPassword(p) {
      set({ password: p });
      scheduleSave();
    },

    select(ids, add) {
      const arr = ids == null ? [] : Array.isArray(ids) ? ids : [ids];
      if (add) {
        const cur = get().selection;
        const res = [...cur];
        for (const id of arr) {
          const i = res.indexOf(id);
          if (i >= 0) res.splice(i, 1);
          else res.push(id);
        }
        set({ selection: res, selectedRel: null });
      } else set({ selection: arr, selectedRel: null });
    },
    setEditing(id) {
      set({ editingId: id });
    },
    selectRel(id) {
      set({ selectedRel: id, selection: id ? [] : get().selection });
    },
    focusTopic(id) {
      const n = (get().focusReq?.n ?? 0) + 1;
      // раскрыть предков
      const s = get().sheet();
      if (s) {
        const path = pathTo(s, id).slice(0, -1);
        if (path.some((p) => p.collapsed)) {
          get().mutate((sh) => {
            for (const p of path) {
              const f = findInSheet(sh, p.id);
              if (f) f.topic.collapsed = false;
            }
          }, { history: false });
        }
      }
      set({ focusReq: { id, n }, selection: [id] });
    },

    setText(id, text) {
      get().mutate((s) => {
        const f = findInSheet(s, id);
        if (f) f.topic.text = text;
      });
    },
    updateTopic(id, patch) {
      get().mutate((s) => {
        const f = findInSheet(s, id);
        if (f) Object.assign(f.topic, patch);
      });
    },
    updateTopics(ids, fn) {
      get().mutate((s) => {
        for (const id of ids) {
          const f = findInSheet(s, id);
          if (f) fn(f.topic);
        }
      });
    },
    updateStyle(ids, patch) {
      get().mutate((s) => {
        for (const id of ids) {
          const f = findInSheet(s, id);
          if (!f) continue;
          const st = { ...f.topic.style, ...patch };
          for (const k of Object.keys(st) as (keyof TopicStyle)[]) if (st[k] === undefined) delete st[k];
          f.topic.style = st;
        }
      });
    },
    setSide(id, side) {
      get().mutate((s) => {
        freezeMainSides(s);
        const f = findInSheet(s, id);
        if (f) f.topic.side = side;
      });
    },
    addChild(id, text, side) {
      const tid = target(id);
      if (!tid) return null;
      const sh = get().sheet();
      const pf = sh ? findInSheet(sh, tid) : null;
      if (!pf) return null;
      const t = newTopic(text ?? defaultTopicText(sh, pf.topic));
      if (side && sh && pf.topic.id === sh.root.id) t.side = side;
      get().mutate((s) => {
        const f = findInSheet(s, tid);
        if (!f) return;
        if (t.side && f.topic.id === s.root.id) freezeMainSides(s);
        f.topic.collapsed = false;
        f.topic.children.push(t);
      });
      set({ selection: [t.id], editingId: t.id });
      return t.id;
    },
    addSibling(id, before, text) {
      const tid = target(id);
      if (!tid) return null;
      const s = get().sheet();
      const f = s && findInSheet(s, tid);
      if (!f) return null;
      if (!f.parent) {
        // у корня/плавающей нет соседей — добавляем ребёнка
        return get().addChild(tid, text);
      }
      const t = newTopic(text ?? defaultTopicText(s, f.parent));
      if (f.parent.id === s.root.id && s.structure === 'map') t.side = topicSide(s, f.topic.id);
      get().mutate((sh) => {
        const ff = findInSheet(sh, tid);
        if (!ff || !ff.parent) return;
        if (t.side) freezeMainSides(sh);
        ff.parent.children.splice(ff.index + (before ? 0 : 1), 0, t);
      });
      set({ selection: [t.id], editingId: t.id });
      return t.id;
    },
    addParent(id) {
      const tid = target(id);
      const s = get().sheet();
      const f = s && tid ? findInSheet(s, tid) : null;
      if (!f || !f.parent) return null;
      const t = newTopic('Тема');
      get().mutate((sh) => {
        const ff = findInSheet(sh, tid!);
        if (!ff || !ff.parent) return;
        const [moved] = ff.parent.children.splice(ff.index, 1, t);
        t.children.push(moved);
      });
      set({ selection: [t.id], editingId: t.id });
      return t.id;
    },
    addFloating(x, y) {
      const t: FloatingTopic = { ...newTopic('Плавающая тема'), x, y };
      get().mutate((s) => {
        s.floating.push(t);
      });
      set({ selection: [t.id], editingId: t.id });
      return t.id;
    },
    insertChildren(parentId, topics) {
      get().mutate((s) => {
        const f = findInSheet(s, parentId);
        if (!f) return;
        f.topic.collapsed = false;
        f.topic.children.push(...topics.map(reId));
      });
    },
    deleteTopics(ids) {
      const s = get().sheet();
      if (!s) return;
      const list = (ids ?? get().selection).filter((id) => id !== s.root.id);
      if (!list.length) return;
      // выбрать соседа/родителя после удаления
      const first = findInSheet(s, list[0]);
      let nextSel: ID | null = s.root.id;
      if (first?.parent) {
        const sib = first.parent.children[first.index + 1] ?? first.parent.children[first.index - 1];
        nextSel = sib && !list.includes(sib.id) ? sib.id : first.parent.id;
      }
      get().mutate((sh) => {
        const removed = new Set<ID>();
        for (const id of list) {
          const fl = sh.floating.findIndex((x) => x.id === id);
          if (fl >= 0) {
            const [r] = sh.floating.splice(fl, 1);
            collectIds(r, removed);
            continue;
          }
          const f = findInSheet(sh, id);
          if (f?.parent) {
            f.parent.children.splice(f.index, 1);
            collectIds(f.topic, removed);
          }
        }
        sh.relationships = sh.relationships.filter((r) => !removed.has(r.from) && !removed.has(r.to));
        sh.boundaries = sh.boundaries.filter((b) => !removed.has(b.topicId));
        sh.summaries = sh.summaries.filter((b) => !removed.has(b.topicId));
      });
      set({ selection: nextSel ? [nextSel] : [], editingId: null });
    },
    toggleCollapse(id, value) {
      get().mutate((s) => {
        const f = findInSheet(s, id);
        if (f && f.topic.children.length) f.topic.collapsed = value ?? !f.topic.collapsed;
      });
      const d = get().doc;
      const cur = get().selection;
      if (d && cur.length) {
        // если выделенная тема скрылась внутри свёрнутой ветви — выделить саму ветвь
        const visible = cleanSelection(d, cur).filter((x) => cur.includes(x));
        if (visible.length !== cur.length) set({ selection: [...new Set([...visible, id])] });
      }
    },
    collapseAll(collapsed, depth = 1) {
      queueMicrotask(() => {
        const d = get().doc;
        if (d) set({ selection: cleanSelection(d, get().selection) });
      });
      get().mutate((s) => {
        const rec = (t: Topic, d: number) => {
          if (t.children.length) t.collapsed = collapsed ? d >= depth : false;
          t.children.forEach((c) => rec(c, d + 1));
        };
        rec(s.root, 0);
        s.floating.forEach((f) => rec(f, 0));
      });
    },
    move(id, newParentId, index, side) {
      const s = get().sheet();
      if (!s || id === s.root.id || isAncestor(s, id, newParentId)) return;
      get().mutate((sh) => {
        let node: Topic | undefined;
        const fl = sh.floating.findIndex((x) => x.id === id);
        let oldParent: Topic | null = null;
        let oldIndex = -1;
        if (fl >= 0) {
          const [r] = sh.floating.splice(fl, 1);
          const { x: _x, y: _y, ...rest } = r;
          void _x; void _y;
          node = rest;
        } else {
          const f = findInSheet(sh, id);
          if (!f?.parent) return;
          oldParent = f.parent;
          oldIndex = f.index;
          node = f.parent.children.splice(f.index, 1)[0];
        }
        const p = findInSheet(sh, newParentId);
        if (!p || !node) return;
        let idx = index;
        if (oldParent && oldParent.id === p.topic.id && oldIndex < idx) idx--;
        p.topic.collapsed = false;
        if (p.topic.id === sh.root.id && sh.structure === 'map') {
          if (side) {
            freezeMainSides(sh);
            node.side = side;
          }
        } else delete node.side;
        p.topic.children.splice(Math.max(0, Math.min(idx, p.topic.children.length)), 0, node);
      });
    },
    moveFloating(id, x, y) {
      get().mutate((s) => {
        const f = s.floating.find((t) => t.id === id);
        if (f) {
          f.x = x;
          f.y = y;
        }
      });
    },
    detach(id, x, y) {
      const s = get().sheet();
      if (!s || id === s.root.id) return;
      get().mutate((sh) => {
        const f = findInSheet(sh, id);
        if (!f?.parent) return;
        const [node] = f.parent.children.splice(f.index, 1);
        sh.floating.push({ ...node, x, y });
      });
    },
    reorder(id, dir) {
      get().mutate((s) => {
        const f = findInSheet(s, id);
        if (!f?.parent) return;
        const j = f.index + dir;
        if (j < 0 || j >= f.parent.children.length) return;
        const arr = f.parent.children;
        [arr[f.index], arr[j]] = [arr[j], arr[f.index]];
      });
    },
    indent(id) {
      const s = get().sheet();
      const f = s && findInSheet(s, id);
      if (!f?.parent || f.index === 0) return;
      const prev = f.parent.children[f.index - 1];
      get().move(id, prev.id, prev.children.length);
    },
    outdent(id) {
      const s = get().sheet();
      const f = s && findInSheet(s, id);
      if (!f?.parent) return;
      const gp = findInSheet(s!, f.parent.id);
      if (!gp?.parent) return;
      get().move(id, gp.parent.id, gp.index + 1);
    },
    copy(cut) {
      const s = get().sheet();
      if (!s) return;
      const items = get()
        .selection.map((id) => findInSheet(s, id)?.topic)
        .filter(Boolean) as Topic[];
      if (!items.length) return;
      const outline = items.map((t) => toOutline(t)).join('');
      set({ clipboard: clone(items), clipboardText: outline });
      try {
        navigator.clipboard?.writeText(outline);
      } catch {
        /* нет доступа к буферу */
      }
      if (cut) get().deleteTopics(items.map((t) => t.id).filter((id) => id !== s.root.id));
    },
    paste(targetId) {
      const tid = target(targetId);
      const cb = get().clipboard;
      if (!tid || !cb) return;
      get().insertChildren(tid, cb);
    },
    duplicate(id) {
      const tid = target(id);
      const s = get().sheet();
      const f = s && tid ? findInSheet(s, tid) : null;
      if (!f?.parent) return;
      const copy = reId(f.topic);
      get().mutate((sh) => {
        const ff = findInSheet(sh, tid!);
        ff?.parent?.children.splice(ff.index + 1, 0, copy);
      });
      set({ selection: [copy.id] });
    },
    navigate(dir) {
      const s = get().sheet();
      const cur = target();
      if (!s || !cur) return;
      const f = findInSheet(s, cur);
      if (!f) return;
      const side = topicSide(s, cur);
      let next: Topic | undefined;
      const goParent = () => f.parent ?? undefined;
      const goChild = (pickRight?: boolean) => {
        if (f.topic.collapsed) return undefined;
        if (!f.parent && s.structure === 'map' && f.root === s.root) {
          // в центральной теме: вправо — правые ветви, влево — левые
          const n = f.topic.children.length;
          const half = Math.ceil(n / 2);
          return pickRight ? f.topic.children[0] : f.topic.children[half] ?? f.topic.children[0];
        }
        return f.topic.children[0];
      };
      const vertical = s.structure === 'org' || s.structure === 'fishbone';
      if (vertical) {
        if (dir === 'up') next = goParent();
        else if (dir === 'down') next = goChild();
        else if (f.parent) next = f.parent.children[f.index + (dir === 'left' ? -1 : 1)];
      } else {
        const outward = side === 'left' ? 'left' : 'right';
        const inward = side === 'left' ? 'right' : 'left';
        if (!f.parent) {
          if (dir === 'right') next = goChild(true);
          else if (dir === 'left') next = goChild(false);
        } else if (dir === outward) next = goChild();
        else if (dir === inward) next = goParent();
        else {
          // вверх/вниз — по видимому порядку среди соседей, затем по обходу
          const sib = f.parent.children[f.index + (dir === 'up' ? -1 : 1)];
          if (sib) next = sib;
          else {
            const order = visibleOrder(s);
            const i = order.findIndex((t) => t.id === cur);
            next = order[i + (dir === 'up' ? -1 : 1)];
          }
        }
      }
      if (next) set({ selection: [next.id] });
    },

    addRelationship(from, to) {
      if (from === to) return;
      const r: Relationship = { id: uid(), from, to, label: '' };
      get().mutate((s) => {
        s.relationships.push(r);
      });
      set({ selectedRel: r.id, selection: [] });
    },
    updateRelationship(id, patch) {
      get().mutate((s) => {
        const r = s.relationships.find((x) => x.id === id);
        if (r) Object.assign(r, patch);
      });
    },
    removeRelationship(id) {
      get().mutate((s) => {
        s.relationships = s.relationships.filter((r) => r.id !== id);
      });
      set({ selectedRel: null });
    },
    addBoundary(topicId) {
      const ids = topicId ? [topicId] : get().selection;
      get().mutate((s) => {
        for (const id of ids) if (!s.boundaries.some((b) => b.topicId === id)) s.boundaries.push({ id: uid(), topicId: id, label: '' });
      });
    },
    updateBoundary(id, patch) {
      get().mutate((s) => {
        const b = s.boundaries.find((x) => x.id === id);
        if (b) Object.assign(b, patch);
      });
    },
    removeBoundary(id) {
      get().mutate((s) => {
        s.boundaries = s.boundaries.filter((b) => b.id !== id);
      });
    },
    addSummary(topicId) {
      const ids = topicId ? [topicId] : get().selection;
      get().mutate((s) => {
        for (const id of ids) if (!s.summaries.some((b) => b.topicId === id)) s.summaries.push({ id: uid(), topicId: id, text: 'Итог' });
      });
    },
    updateSummary(id, patch) {
      get().mutate((s) => {
        const b = s.summaries.find((x) => x.id === id);
        if (b) Object.assign(b, patch);
      });
    },
    removeSummary(id) {
      get().mutate((s) => {
        s.summaries = s.summaries.filter((b) => b.id !== id);
      });
    },

    setSheetProps(patch) {
      get().mutate((s) => {
        Object.assign(s, patch);
      });
    },
    addSheet(sheet) {
      const sh = sheet ?? newSheet(`Лист ${(get().doc?.sheets.length ?? 0) + 1}`);
      get().mutateDoc((d) => {
        d.sheets.push(sh);
        d.activeSheet = sh.id;
      });
      set({ selection: [sh.root.id] });
    },
    removeSheet(id) {
      const d = get().doc;
      if (!d || d.sheets.length <= 1) return;
      get().mutateDoc((doc) => {
        doc.sheets = doc.sheets.filter((s) => s.id !== id);
        if (doc.activeSheet === id) doc.activeSheet = doc.sheets[0].id;
      });
      const nd = get().doc!;
      set({ selection: cleanSelection(nd, get().selection), editingId: null });
    },
    duplicateSheet(id) {
      const d = get().doc;
      const src = d?.sheets.find((s) => s.id === id);
      if (!src) return;
      const copy = clone(src);
      copy.id = uid();
      copy.title = src.title + ' (копия)';
      // новые id у всех тем, чтобы задачи копии не путались с оригиналом
      const map = new Map<ID, ID>();
      const re = (t: Topic) => {
        const nid = uid();
        map.set(t.id, nid);
        t.id = nid;
        t.children.forEach(re);
      };
      re(copy.root);
      copy.floating.forEach(re);
      const m = (id: ID) => map.get(id) ?? id;
      copy.relationships = copy.relationships.map((r) => ({ ...r, id: uid(), from: m(r.from), to: m(r.to) }));
      copy.boundaries = copy.boundaries.map((b) => ({ ...b, id: uid(), topicId: m(b.topicId) }));
      copy.summaries = copy.summaries.map((b) => ({ ...b, id: uid(), topicId: m(b.topicId) }));
      get().addSheet(copy);
    },
    setActiveSheet(id) {
      const d = get().doc;
      if (!d) return;
      const next = { ...d, activeSheet: id };
      set({ doc: next, selection: [next.sheets.find((s) => s.id === id)!.root.id], editingId: null, pendingText: null, selectedRel: null });
      scheduleSave();
    },
    setTitle(title) {
      get().mutateDoc((d) => {
        d.title = title;
      });
    },
    replaceRoot(root) {
      get().mutate((s) => {
        s.root = root;
        s.relationships = [];
        s.boundaries = [];
        s.summaries = [];
      });
      set({ selection: [root.id] });
    },
  };
});

/** Зафиксировать текущие стороны основных тем, чтобы при ручном выборе стороны остальные не «перескакивали» */
function freezeMainSides(s: Sheet) {
  if (s.structure !== 'map') return;
  const m = mapSides(s.root);
  for (const c of s.root.children) if (!c.side) c.side = m.get(c.id);
}

/** Оставить в выделении только существующие и видимые темы */
function cleanSelection(d: MindDoc, sel: ID[]): ID[] {
  const sh = d.sheets.find((x) => x.id === d.activeSheet) ?? d.sheets[0];
  const ok = sel.filter((id) => {
    const path = pathTo(sh, id);
    return path.length > 0 && !path.slice(0, -1).some((p) => p.collapsed);
  });
  return ok.length ? ok : [sh.root.id];
}

/** Текст новой темы по умолчанию, как в Xmind */
function defaultTopicText(s: Sheet | null, parent: Topic | null): string {
  if (!s || !parent) return 'Тема';
  if (parent.id === s.root.id) return `Основная тема ${parent.children.length + 1}`;
  return 'Подтема';
}

function collectIds(t: Topic, out: Set<ID>) {
  out.add(t.id);
  t.children.forEach((c) => collectIds(c, out));
}

function toOutline(t: Topic, depth = 0): string {
  return '  '.repeat(depth) + '- ' + t.text + '\n' + t.children.map((c) => toOutline(c, depth + 1)).join('');
}

/** С какой стороны от центра находится тема (для навигации стрелками) */
export function topicSide(s: Sheet, id: ID): 'left' | 'right' {
  if (s.structure === 'logic-left') return 'left';
  if (s.structure !== 'map') return 'right';
  const path = pathTo(s, id);
  if (path.length < 2 || path[0] !== s.root) return 'right';
  return mapSides(s.root).get(path[1].id) ?? 'right';
}

export type { LineStyle };
