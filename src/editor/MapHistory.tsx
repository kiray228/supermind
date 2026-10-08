/** «История версий» карты: снимки с этого устройства, просмотр структуры и восстановление. */
import { useEffect, useMemo, useState } from 'react';
import { CaretLeft, ClockCounterClockwise, X } from '@phosphor-icons/react';
import { useDoc } from '../store/docStore';
import { saveDoc } from '../store/db';
import { toast, useApp } from '../store/appStore';
import { diffVersion, listVersions, sameContent, snapshot, type MapVersion } from '../store/mapHistory';
import { confirmDialog } from '../ui/dialogs';
import { clone, countTopics, uid } from '../utils/tree';
import type { MindDoc, Topic } from '../types';
import './map-history.css';

const time = (at: number) => new Date(at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

function dayLabel(at: number): string {
  const d = new Date(at);
  const today = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(today) - start(d)) / 86_400_000);
  if (diff === 0) return 'Сегодня';
  if (diff === 1) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) });
}

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10;
  const m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
};
const topicsWord = (n: number) => `${n} ${plural(n, 'тема', 'темы', 'тем')}`;

const PREVIEW_LIMIT = 400;

export default function MapHistory({ onClose }: { onClose(): void }) {
  const doc = useDoc((s) => s.doc);
  const password = useDoc((s) => s.password);
  const [list, setList] = useState<MapVersion[] | null>(null);
  const [selAt, setSelAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const docId = doc?.id;

  useEffect(() => {
    if (!docId) return;
    let off = false;
    void listVersions(docId).then((l) => !off && setList(l));
    return () => {
      off = true;
    };
  }, [docId]);

  // версии, совпадающие с тем, что сейчас на экране, не показываем — это «Сейчас»
  const versions = useMemo(() => (doc && list ? list.filter((v) => !sameContent(v.doc, doc)) : []), [list, doc]);
  const sel = versions.find((v) => v.at === selAt) ?? null;
  const diff = useMemo(() => (sel && doc ? diffVersion(sel.doc, doc) : null), [sel, doc]);
  const groups = useMemo(() => {
    const out: { day: string; items: MapVersion[] }[] = [];
    for (const v of versions) {
      const day = dayLabel(v.at);
      const last = out[out.length - 1];
      if (last?.day === day) last.items.push(v);
      else out.push({ day, items: [v] });
    }
    return out;
  }, [versions]);

  if (!doc) return null;
  const current = doc.sheets.reduce((n, s) => n + countTopics(s), 0);

  const restore = async (v: MapVersion) => {
    if (!(await confirmDialog('Восстановить версию?', `Карта станет такой, какой была ${dayLabel(v.at).toLowerCase()} в ${time(v.at)}. Текущее состояние останется в истории, а сразу после — можно отменить.`, { okText: 'Восстановить' }))) return;
    setBusy(true);
    try {
      const cur = useDoc.getState().doc;
      if (cur) await snapshot(cur);
      const old = clone(v.doc);
      useDoc.getState().mutateDoc((d) => {
        d.title = old.title;
        d.sheets = old.sheets;
        d.activeSheet = old.sheets.some((s) => s.id === d.activeSheet) ? d.activeSheet : old.activeSheet;
      });
      useDoc.setState({ selection: [], editingId: null, pendingText: null, selectedRel: null });
      toast('Версия восстановлена', { label: 'Отменить', run: () => useDoc.getState().undo() });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const saveCopy = async (v: MapVersion) => {
    setBusy(true);
    try {
      const now = Date.now();
      const copy: MindDoc = { ...clone(v.doc), id: uid(), title: `${v.doc.title || 'Карта'} (${dayLabel(v.at).toLowerCase()}, ${time(v.at)})`, createdAt: now, updatedAt: now };
      await saveDoc(copy);
      useApp.setState({ docsVersion: now });
      toast('Копия сохранена в «Мои карты»');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal mh${sel ? ' mh-has-sel' : ''}`} role="dialog" aria-label="История версий">
        <div className="mh-head">
          {sel && <button className="icon-btn mh-back" onClick={() => setSelAt(null)} aria-label="К списку"><CaretLeft /></button>}
          <ClockCounterClockwise className="mh-head-icon" size={22} />
          <h2>История версий</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть"><X /></button>
        </div>

        {password ? (
          <p className="mh-empty">Для карт с паролем история не ведётся: снимки хранились бы без шифрования.</p>
        ) : (
          <div className="mh-body">
            <div className="mh-list">
              <div className="mh-row mh-now">
                <span className="mh-time">Сейчас</span>
                <span className="mh-meta">{topicsWord(current)}</span>
              </div>
              {list === null ? (
                <p className="mh-empty">Загрузка…</p>
              ) : versions.length === 0 ? (
                <p className="mh-empty">Других версий пока нет. Версия сохраняется, когда вы открываете карту, и каждые 10 минут правок — на этом устройстве.</p>
              ) : (
                groups.map((g) => (
                  <div key={g.day}>
                    <div className="mh-day">{g.day}</div>
                    {g.items.map((v) => (
                      <button key={v.at} className={`mh-row${v.at === selAt ? ' active' : ''}`} onClick={() => setSelAt(v.at)}>
                        <span className="mh-time">{time(v.at)}</span>
                        <span className="mh-meta">
                          {topicsWord(v.topics)}
                          {v.title !== doc.title && <> · «{v.title}»</>}
                        </span>
                      </button>
                    ))}
                  </div>
                ))
              )}
              <p className="mh-foot">Хранится на этом устройстве: последние 2 часа — все версии, двое суток — по одной в час, дальше — по одной в день.</p>
            </div>

            <div className="mh-preview">
              {sel && diff ? (
                <>
                  <div className="mh-pv-head">
                    <div className="mh-pv-title">{dayLabel(sel.at)}, {time(sel.at)}</div>
                    <div className="mh-diff">
                      {diff.removed > 0 && <span className="mh-plus">{plural(diff.removed, 'вернётся', 'вернутся', 'вернутся')} {topicsWord(diff.removed)}</span>}
                      {diff.added > 0 && <span className="mh-minus">{plural(diff.added, 'пропадёт', 'пропадут', 'пропадут')} {topicsWord(diff.added)}</span>}
                      {diff.changed > 0 && <span>{plural(diff.changed, 'изменится', 'изменятся', 'изменятся')} {topicsWord(diff.changed)}</span>}
                      {!diff.removed && !diff.added && !diff.changed && <span>отличается оформлением</span>}
                    </div>
                  </div>
                  <Outline version={sel.doc} current={doc} />
                  <div className="mh-actions">
                    <button className="btn" disabled={busy} onClick={() => void saveCopy(sel)}>Сохранить копией</button>
                    <button className="btn btn-primary" disabled={busy} onClick={() => void restore(sel)}>Восстановить</button>
                  </div>
                </>
              ) : (
                <p className="mh-empty mh-pick">Выберите версию, чтобы посмотреть, какой была карта.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Структура версии; темы, которых сейчас нет в карте, выделены цветом */
function Outline({ version, current }: { version: MindDoc; current: MindDoc }) {
  const rows = useMemo(() => {
    const now = new Set<string>();
    const mark = (t: Topic) => {
      now.add(t.id);
      t.children.forEach(mark);
    };
    for (const s of current.sheets) {
      mark(s.root);
      s.floating.forEach(mark);
    }
    const out: { id: string; text: string; depth: number; isNew: boolean; sheet?: boolean }[] = [];
    const multi = version.sheets.length > 1;
    const rec = (t: Topic, depth: number) => {
      if (out.length >= PREVIEW_LIMIT) return;
      out.push({ id: t.id, text: t.text.trim() || 'Без названия', depth, isNew: !now.has(t.id) });
      t.children.forEach((c) => rec(c, depth + 1));
    };
    for (const s of version.sheets) {
      if (multi) out.push({ id: `sheet-${s.id}`, text: s.title, depth: 0, isNew: false, sheet: true });
      rec(s.root, 0);
      s.floating.forEach((f) => rec(f, 0));
    }
    return out;
  }, [version, current]);
  const total = version.sheets.reduce((n, s) => n + countTopics(s), 0);
  const shown = rows.filter((r) => !r.sheet).length;
  return (
    <div className="mh-outline">
      {rows.map((r) => (
        <div key={r.id} className={`mh-ol${r.sheet ? ' sheet' : ''}${r.isNew ? ' new' : ''}${r.depth === 0 && !r.sheet ? ' root' : ''}`} style={{ paddingLeft: 4 + r.depth * 16 }}>
          {r.text}
        </div>
      ))}
      {total > shown && <div className="mh-ol more">…и ещё {topicsWord(total - shown)}</div>}
    </div>
  );
}
