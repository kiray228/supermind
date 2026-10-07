/** Окно «Поиск по всему»: мгновенные результаты по группам, команды, недавние запросы */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ChevronDown, CornerDownLeft, History, Search, X } from 'lucide-react';
import { toast } from '../store/appStore';
import { highlightRanges, matchToken, norm, snippet, tokenize, type Token } from './match';
import { buildIndex, GROUPS, groupOf, KIND_ICON, type Entry, type GroupId } from './sources';
import { buildCommands } from './commands';
import { closeSearch, useSearchUi } from './state';

// ---------- Недавние запросы ----------

const RECENT_KEY = 'sm-search-recent';
function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 8) : [];
  } catch {
    return [];
  }
}
function writeRecent(list: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* без сохранения */
  }
}
function rememberQuery(q: string) {
  const t = q.trim();
  if (!t || t.startsWith('>')) return;
  const n = norm(t);
  writeRecent([t, ...readRecent().filter((x) => norm(x) !== n)].slice(0, 8));
}

// ---------- Рейтинг ----------

interface Ranked {
  e: Entry;
  s: number;
  /** совпало не в названии, а в тексте — показываем отрывок */
  inBody: boolean;
}

function rank(list: Entry[], toks: Token[], qn: string): Ranked[] {
  const now = Date.now();
  const out: Ranked[] = [];
  for (const e of list) {
    let s = 0;
    let titleAll = true;
    let ok = true;
    for (const tk of toks) {
      const a = matchToken(e.nt, tk);
      const b = e.nb ? matchToken(e.nb, tk) : null;
      if (!a && !b) {
        ok = false;
        break;
      }
      if (!a) titleAll = false;
      s += Math.max(a ? a.score * 3 : 0, b ? b.score : 0);
    }
    if (!ok) continue;
    if (titleAll) {
      if (e.nt === qn) s += 8;
      else if (e.nt.startsWith(qn)) s += 4;
    }
    s += e.boost ?? 0;
    if (e.at) s += Math.max(0, 1 - (now - e.at) / (180 * 86400000));
    out.push({ e, s, inBody: !titleAll });
  }
  out.sort((x, y) => y.s - x.s);
  return out;
}

const LIMIT: Partial<Record<GroupId, number>> = { cmd: 3, maps: 6 };
const ORDER: GroupId[] = ['cmd', 'maps', 'task', 'note', 'goal', 'habit', 'journal', 'tx'];

type Row = { t: 'item'; r: Ranked } | { t: 'more'; g: GroupId; n: number } | { t: 'recent'; text: string };
interface Section {
  id: string;
  label: string;
  icon?: GroupId;
  count?: number;
  rows: Row[];
  action?: ReactNode;
}

/** Последний индекс: повторное открытие показывает результаты сразу, пока индекс обновляется */
let lastEntries: Entry[] | null = null;

export default function Palette() {
  const [q, setQ] = useState(() => useSearchUi.getState().initial);
  const [dq, setDq] = useState(q);
  const [entries, setEntries] = useState<Entry[]>(() => lastEntries ?? []);
  const [ready, setReady] = useState(false);
  const [sel, setSel] = useState({ q: dq, i: 0 });
  const [expanded, setExpanded] = useState<ReadonlySet<GroupId>>(new Set());
  const [recent, setRecent] = useState(readRecent);
  const commands = useMemo(() => buildCommands(), []);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const pointerMoved = useRef(false);

  useLayoutEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  // индекс строится при каждом открытии (данные могли измениться)
  useEffect(() => {
    let alive = true;
    const cached = !!lastEntries;
    void buildIndex(
      (list, done) => {
        if (done) lastEntries = list;
        if (done || !cached) setEntries(list);
        if (done) setReady(true);
      },
      () => alive,
    ).catch(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);

  // запрос с небольшой задержкой — ввод не подтормаживает на больших картах
  useEffect(() => {
    if (q === dq) return;
    const t = setTimeout(() => setDq(q), q.trim() ? 90 : 0);
    return () => clearTimeout(t);
  }, [q, dq]);

  const { sections, toks } = useMemo(() => {
    const raw = dq.trim();
    const sections: Section[] = [];
    if (raw.startsWith('>')) {
      const toks = tokenize(raw.slice(1));
      const list = toks.length ? rank(commands, toks, norm(raw.slice(1).trim())) : commands.map((e) => ({ e, s: 0, inBody: false }));
      sections.push({ id: 'cmd', label: 'Команды', icon: 'cmd', count: list.length, rows: list.map((r) => ({ t: 'item', r })) });
      return { sections, toks };
    }
    if (!raw) {
      return { sections, toks: [] as Token[] };
    }
    const toks = tokenize(raw);
    if (!toks.length) return { sections, toks };
    const ranked = rank([...commands, ...entries], toks, norm(raw));
    const by = new Map<GroupId, Ranked[]>();
    for (const r of ranked) {
      const g = groupOf(r.e.kind);
      const arr = by.get(g);
      if (arr) arr.push(r);
      else by.set(g, [r]);
    }
    const groups = [...by.entries()].sort((a, b) => b[1][0].s - a[1][0].s || ORDER.indexOf(a[0]) - ORDER.indexOf(b[0]));
    for (const [g, list] of groups) {
      const lim = expanded.has(g) ? 100 : (LIMIT[g] ?? 5);
      const rows: Row[] = list.slice(0, lim).map((r) => ({ t: 'item', r }));
      if (list.length > lim && !expanded.has(g)) rows.push({ t: 'more', g, n: list.length - lim });
      sections.push({ id: g, label: GROUPS[g].label, icon: g, count: list.length, rows });
    }
    return { sections, toks };
  }, [dq, entries, commands, expanded]);

  // пустой запрос: недавние + все команды
  const shown: Section[] = useMemo(() => {
    if (dq.trim()) return sections;
    const out: Section[] = [];
    if (recent.length) out.push({ id: 'recent', label: 'Недавние запросы', rows: recent.map((text) => ({ t: 'recent', text })) });
    out.push({ id: 'cmd', label: 'Команды', icon: 'cmd', rows: commands.map((e) => ({ t: 'item', r: { e, s: 0, inBody: false } })) });
    return out;
  }, [dq, sections, recent, commands]);

  const flat = useMemo(() => shown.flatMap((s) => s.rows), [shown]);

  // выбранная строка: с новым запросом — снова первая
  const active = sel.q === dq ? Math.min(sel.i, Math.max(0, flat.length - 1)) : 0;
  const setActive = (i: number) => setSel({ q: dq, i });
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const setQuery = (text: string) => {
    setQ(text);
    setDq(text);
    setExpanded(new Set());
    inputRef.current?.focus({ preventScroll: true });
  };

  const activate = (row: Row | undefined) => {
    if (!row) return;
    if (row.t === 'recent') return setQuery(row.text);
    if (row.t === 'more') {
      setExpanded((s) => new Set(s).add(row.g));
      return;
    }
    rememberQuery(dq);
    closeSearch();
    // синхронно, в обработчике нажатия (на iPhone так открывается клавиатура в новом окне)
    try {
      void Promise.resolve(row.r.e.run()).catch(() => toast('Не удалось открыть'));
    } catch {
      toast('Не удалось открыть');
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!flat.length) return;
      const d = e.key === 'ArrowDown' ? 1 : -1;
      setActive((active + d + flat.length) % flat.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      activate(flat[active]);
    }
  };

  const removeRecent = (text: string) => {
    const next = recent.filter((x) => x !== text);
    setRecent(next);
    writeRecent(next);
  };

  let i = -1;
  const raw = dq.trim();
  const nothing = !!raw && !flat.length;

  return (
    <div className="modal-backdrop sr-backdrop" onPointerDown={(e) => e.target === e.currentTarget && closeSearch()}>
      <div className="sr-panel" role="dialog" aria-modal="true" aria-label="Поиск по всему">
        <div className="sr-head">
          <Search className="sr-head-ico" size={19} />
          <input
            ref={inputRef}
            className="sr-input"
            type="search"
            enterKeyHint="go"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="Поиск по картам, задачам, заметкам…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded="true"
            aria-controls="sr-list"
            aria-activedescendant={flat.length ? `sr-opt-${active}` : undefined}
          />
          {q && (
            <button className="sr-clear" onClick={() => setQuery('')} aria-label="Очистить">
              <X size={16} />
            </button>
          )}
          <button className="sr-cancel" onClick={closeSearch}>
            Отмена
          </button>
          <kbd className="sr-kbd sr-esc">Esc</kbd>
        </div>

        <div className="sr-list" id="sr-list" role="listbox" ref={listRef} onPointerMove={() => (pointerMoved.current = true)}>
          {shown.map((sec) => {
            const G = sec.icon ? GROUPS[sec.icon].icon : History;
            return (
              <div className="sr-sec" key={sec.id}>
                <div className="sr-sec-head">
                  <G size={14} />
                  <span>{sec.label}</span>
                  {sec.count != null && <span className="sr-count">{sec.count}</span>}
                  {sec.id === 'recent' && (
                    <button
                      className="sr-sec-act"
                      onClick={() => {
                        setRecent([]);
                        writeRecent([]);
                      }}
                    >
                      Очистить
                    </button>
                  )}
                </div>
                {sec.rows.map((row) => {
                  i++;
                  const idx = i;
                  const on = idx === active;
                  const common = {
                    id: `sr-opt-${idx}`,
                    'data-i': idx,
                    role: 'option',
                    'aria-selected': on,
                    onMouseMove: () => {
                      if (pointerMoved.current && active !== idx) setActive(idx);
                    },
                  };
                  if (row.t === 'recent')
                    return (
                      <div key={'r:' + row.text} className={`sr-row sr-recent${on ? ' active' : ''}`} {...common} onClick={() => activate(row)}>
                        <span className="sr-ico">
                          <History size={17} />
                        </span>
                        <span className="sr-text">
                          <span className="sr-title">{row.text}</span>
                        </span>
                        <button
                          className="sr-x"
                          aria-label="Убрать из недавних"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeRecent(row.text);
                          }}
                        >
                          <X size={15} />
                        </button>
                      </div>
                    );
                  if (row.t === 'more')
                    return (
                      <div key={'more:' + row.g} className={`sr-row sr-more${on ? ' active' : ''}`} {...common} onClick={() => activate(row)}>
                        <span className="sr-ico">
                          <ChevronDown size={17} />
                        </span>
                        <span className="sr-text">
                          <span className="sr-title">Показать ещё {row.n}</span>
                        </span>
                      </div>
                    );
                  return <ItemRow key={row.r.e.key} r={row.r} toks={toks} on={on} common={common} onClick={() => activate(row)} />;
                })}
              </div>
            );
          })}
          {nothing &&
            (ready ? (
              <div className="sr-empty">
                <Search size={28} />
                <div>Ничего не найдено</div>
                <div className="sr-empty-hint">
                  Попробуйте другое слово или начните с <b>&gt;</b> — команды
                </div>
              </div>
            ) : (
              <div className="sr-empty">
                <div className="spinner" />
              </div>
            ))}
        </div>

        <div className="sr-foot">
          {!ready ? (
            <span className="sr-busy">
              <span className="sr-dot" /> Читаю карты и заметки…
            </span>
          ) : (
            <span className="sr-tip">
              Начните с <b>&gt;</b> — команды
            </span>
          )}
          <span className="grow" />
          <span className="sr-keys">
            <kbd className="sr-kbd">↑</kbd>
            <kbd className="sr-kbd">↓</kbd> выбрать <kbd className="sr-kbd">↵</kbd> открыть <kbd className="sr-kbd">Esc</kbd> закрыть
          </span>
        </div>
      </div>
    </div>
  );
}

function Hl({ text, toks }: { text: string; toks: Token[] }) {
  const ranges = highlightRanges(text, toks);
  if (!ranges.length) return <>{text}</>;
  const parts: ReactNode[] = [];
  let at = 0;
  for (const [a, b] of ranges) {
    if (a > at) parts.push(text.slice(at, a));
    parts.push(
      <mark key={a} className="sr-mark">
        {text.slice(a, b)}
      </mark>,
    );
    at = b;
  }
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}

function ItemRow({ r, toks, on, common, onClick }: { r: Ranked; toks: Token[]; on: boolean; common: Record<string, unknown>; onClick: () => void }) {
  const { e } = r;
  const Icon = KIND_ICON[e.kind];
  const body = r.inBody && e.body ? snippet(e.body, toks) : '';
  return (
    <div className={`sr-row${on ? ' active' : ''}`} {...common} onClick={onClick}>
      <span className={`sr-ico sr-k-${e.kind}`}>{e.emoji ? <span className="sr-emoji">{e.emoji}</span> : <Icon size={17} />}</span>
      <span className="sr-text">
        <span className={`sr-title${e.done ? ' is-done' : ''}`}>
          <Hl text={e.title} toks={toks} />
        </span>
        {body ? (
          <span className="sr-sub">
            {e.kind === 'topic' && e.sub ? <span className="sr-sub-pre">{e.sub} · </span> : null}
            <Hl text={body} toks={toks} />
          </span>
        ) : e.sub ? (
          <span className="sr-sub">
            {e.kind === 'map' ? e.sub : <Hl text={e.sub} toks={toks} />}
          </span>
        ) : null}
      </span>
      {e.kind === 'topic' && <span className="sr-tag">тема</span>}
      {on && <CornerDownLeft className="sr-enter" size={15} />}
    </div>
  );
}
