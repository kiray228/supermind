/**
 * Поиск по тексту: без учёта регистра и «ё», совпадения с начала слова,
 * простая «русская» основа слова (встречи → встреч… найдёт «встреча»).
 */

/** Нижний регистр и ё → е; длина строки не меняется (позиции подсветки совпадают с исходником) */
export function norm(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const l = c.toLowerCase();
    out += l.length === 1 ? (l === 'ё' ? 'е' : l) : c;
  }
  return out;
}

const WORD = /[\p{L}\p{N}]/u;
const isWord = (c: string | undefined) => !!c && WORD.test(c);

/** Типичные окончания: отбрасываются у длинных слов запроса */
const ENDING = /(иями|ями|ами|ией|ием|иях|ого|его|ому|ему|ыми|ими|ый|ий|ой|ая|яя|ое|ее|ые|ие|ую|юю|ов|ев|ей|ам|ям|ах|ях|ом|ем|а|я|о|е|ы|и|у|ю|ь|й)$/;

export interface Token {
  t: string;
  /** основа слова (или само слово) */
  st: string;
}

export function tokenize(q: string): Token[] {
  return norm(q)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((t) => {
      let st = t;
      if (t.length >= 4 && /\p{L}$/u.test(t)) {
        const s = t.replace(ENDING, '');
        if (s.length >= (t.length >= 5 ? 4 : 3) && s !== t) st = s;
      }
      return { t, st };
    });
}

export interface Hit {
  score: number;
  pos: number;
  len: number;
}

/** Лучшее совпадение слова запроса в нормализованном тексте */
export function matchToken(h: string, tk: Token): Hit | null {
  let best: Hit | null = null;
  for (let i = h.indexOf(tk.t); i >= 0; i = h.indexOf(tk.t, i + 1)) {
    let score = 0;
    if (!isWord(h[i - 1])) score = isWord(h[i + tk.t.length]) ? 2 : 3;
    else if (tk.t.length >= 3) score = 0.8;
    if (score && (!best || score > best.score)) best = { score, pos: i, len: tk.t.length };
    if (score === 3) break;
  }
  if ((!best || best.score < 2) && tk.st !== tk.t) {
    for (let i = h.indexOf(tk.st); i >= 0; i = h.indexOf(tk.st, i + 1)) {
      if (isWord(h[i - 1])) continue;
      let e = i + tk.st.length;
      while (isWord(h[e]) && e - i < tk.t.length + 3) e++;
      if (!best || 1.5 > best.score) best = { score: 1.5, pos: i, len: e - i };
      break;
    }
  }
  return best;
}

/** Диапазоны подсветки [начало, конец) в показываемом тексте */
export function highlightRanges(text: string, toks: Token[]): [number, number][] {
  if (!toks.length || !text) return [];
  const h = norm(text);
  const out: [number, number][] = [];
  for (const tk of toks) {
    let found = false;
    for (let i = h.indexOf(tk.t); i >= 0; i = h.indexOf(tk.t, i + 1)) {
      if (!isWord(h[i - 1]) || tk.t.length >= 3) {
        out.push([i, i + tk.t.length]);
        found = true;
      }
    }
    if (!found && tk.st !== tk.t) {
      for (let i = h.indexOf(tk.st); i >= 0; i = h.indexOf(tk.st, i + 1)) {
        if (isWord(h[i - 1])) continue;
        let e = i + tk.st.length;
        while (isWord(h[e]) && e - i < tk.t.length + 3) e++;
        out.push([i, e]);
      }
    }
  }
  out.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of out) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

/** Отрывок текста вокруг первого совпадения (в одну строку) */
export function snippet(text: string, toks: Token[], max = 110): string {
  const h = norm(text);
  let pos = -1;
  for (const tk of toks) {
    const m = matchToken(h, tk);
    if (m && (pos < 0 || m.pos < pos)) pos = m.pos;
  }
  if (pos < 0) pos = 0;
  let start = Math.max(0, pos - 32);
  if (start > 0) {
    const sp = text.lastIndexOf(' ', pos);
    if (sp > start - 12 && sp < pos) start = sp + 1;
  }
  const end = Math.min(text.length, start + max);
  return (start > 0 ? '…' : '') + text.slice(start, end).replace(/\s+/g, ' ').trim() + (end < text.length ? '…' : '');
}
