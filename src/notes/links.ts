/**
 * Автоматические связи между заметками («второй мозг»).
 *
 * Из текста выделяются важные слова и словосочетания: служебные слова отбрасываются,
 * формы слова сводятся к основе (стемминг Snowball для русского, лёгкий — для английского),
 * важность считается по TF-IDF — часто в этой заметке и редко в остальных.
 * Заметки связываются по близости этих наборов (косинус) и по упоминанию названия другой заметки;
 * у каждой связи есть причина — общие термины.
 *
 * Модуль чистый (без импортов) — тесты гоняют его прямо в Node: `npm test`.
 */

// ---------- Стемминг: русский (Snowball) ----------

const RU_VOWELS = 'аеиоуыэюя';
const isRuVowel = (c: string) => RU_VOWELS.includes(c);

const byLength = (list: string[]) => [...list].sort((a, b) => b.length - a.length);

const RU_GERUND_1 = ['в', 'вши', 'вшись'];
const RU_GERUND_2 = ['ив', 'ивши', 'ившись', 'ыв', 'ывши', 'ывшись'];
const RU_ADJECTIVE = byLength(['ее', 'ие', 'ые', 'ое', 'ими', 'ыми', 'ей', 'ий', 'ый', 'ой', 'ем', 'им', 'ым', 'ом', 'его', 'ого', 'ему', 'ому', 'их', 'ых', 'ую', 'юю', 'ая', 'яя', 'ою', 'ею']);
const RU_PARTICIPLE_1 = ['ем', 'нн', 'вш', 'ющ', 'щ'];
const RU_PARTICIPLE_2 = ['ивш', 'ывш', 'ующ'];
const RU_REFLEXIVE = ['ся', 'сь'];
const RU_VERB_1 = ['ла', 'на', 'ете', 'йте', 'ли', 'й', 'л', 'ем', 'н', 'ло', 'но', 'ет', 'ют', 'ны', 'ть', 'ешь', 'нно'];
const RU_VERB_2 = ['ила', 'ыла', 'ена', 'ейте', 'уйте', 'ите', 'или', 'ыли', 'ей', 'уй', 'ил', 'ыл', 'им', 'ым', 'ен', 'ило', 'ыло', 'ено', 'ят', 'ует', 'уют', 'ит', 'ыт', 'ены', 'ить', 'ыть', 'ишь', 'ую', 'ю'];
const RU_NOUN = byLength(['а', 'ев', 'ов', 'ие', 'ье', 'е', 'иями', 'ями', 'ами', 'еи', 'ии', 'и', 'ией', 'ей', 'ой', 'ий', 'й', 'иям', 'ям', 'ием', 'ем', 'ам', 'ом', 'о', 'у', 'ах', 'иях', 'ях', 'ы', 'ь', 'ию', 'ью', 'ю', 'ия', 'ья', 'я']);
const RU_GERUND = byLength([...RU_GERUND_1, ...RU_GERUND_2]);
const RU_PARTICIPLE = byLength([...RU_PARTICIPLE_1, ...RU_PARTICIPLE_2]);
const RU_VERB = byLength([...RU_VERB_1, ...RU_VERB_2]);
/** окончания «первой группы» — только после «а»/«я» (ни одно из них не входит во вторые группы) */
const G1 = new Set([...RU_GERUND_1, ...RU_PARTICIPLE_1, ...RU_VERB_1]);

/** Самое длинное окончание из списка, целиком лежащее не левее from */
function longestSuffix(w: string, list: string[], from: number): string | null {
  for (const s of list) if (w.length - s.length >= from && w.endsWith(s)) return s;
  return null;
}

/**
 * Окончание из «двухгрупповых» списков: для первой группы перед ним должна стоять «а» или «я»
 * (она остаётся в основе). Как в Snowball: берётся самое длинное совпадение, и если условие не выполнено — ничего.
 */
function groupSuffix(w: string, list: string[], rv: number, group1: Set<string>): string | null {
  const s = longestSuffix(w, list, rv);
  if (!s) return null;
  if (!group1.has(s)) return s;
  const at = w.length - s.length - 1;
  return at >= rv && (w[at] === 'а' || w[at] === 'я') ? s : null;
}

export function stemRu(word: string): string {
  let w = word.toLowerCase().replace(/ё/g, 'е');
  // RV — после первой гласной; R1 — после первой согласной, идущей за гласной; R2 — то же внутри R1
  let rv = w.length;
  for (let i = 0; i < w.length; i++)
    if (isRuVowel(w[i])) {
      rv = i + 1;
      break;
    }
  let r1 = w.length;
  for (let i = 1; i < w.length; i++)
    if (!isRuVowel(w[i]) && isRuVowel(w[i - 1])) {
      r1 = i + 1;
      break;
    }
  let r2 = w.length;
  for (let i = r1 + 1; i < w.length; i++)
    if (!isRuVowel(w[i]) && isRuVowel(w[i - 1])) {
      r2 = i + 1;
      break;
    }
  if (rv >= w.length) return w;
  const cut = (s: string) => (w = w.slice(0, w.length - s.length));

  // шаг 1: деепричастие, иначе — возвратность, затем прилагательное (с причастием) / глагол / существительное
  const ger = groupSuffix(w, RU_GERUND, rv, G1);
  if (ger) cut(ger);
  else {
    const refl = longestSuffix(w, RU_REFLEXIVE, rv);
    if (refl) cut(refl);
    const adj = longestSuffix(w, RU_ADJECTIVE, rv);
    if (adj) {
      cut(adj);
      const part = groupSuffix(w, RU_PARTICIPLE, rv, G1);
      if (part) cut(part);
    } else {
      const verb = groupSuffix(w, RU_VERB, rv, G1);
      if (verb) cut(verb);
      else {
        const noun = longestSuffix(w, RU_NOUN, rv);
        if (noun) cut(noun);
      }
    }
  }
  // шаг 2: «и»
  if (w.length > rv && w.endsWith('и')) cut('и');
  // шаг 3: словообразовательное «ост(ь)» в R2
  const der = longestSuffix(w, ['ость', 'ост'], Math.max(rv, r2));
  if (der) cut(der);
  // шаг 4: превосходная степень, «нн» → «н», мягкий знак
  const sup = longestSuffix(w, ['ейше', 'ейш'], rv);
  if (sup) {
    cut(sup);
    if (w.length - 2 >= rv && w.endsWith('нн')) cut('н');
  } else if (w.length - 2 >= rv && w.endsWith('нн')) cut('н');
  else if (w.length - 1 >= rv && w.endsWith('ь')) cut('ь');
  return w;
}

// ---------- Стемминг: английский (лёгкий) ----------

const EN_VOWEL = /[aeiouy]/;

export function stemEn(word: string): string {
  let w = word.toLowerCase();
  if (w.length <= 3) return w;
  if (w.endsWith('ies') && w.length > 4) w = w.slice(0, -3) + 'y';
  else if (w.endsWith('sses')) w = w.slice(0, -2);
  else if (w.endsWith('s') && !/(ss|us|is|ys)$/.test(w) && w.length > 3) w = w.slice(0, -1);
  let stripped = false;
  for (const suf of ['ingly', 'edly', 'ing', 'ed']) {
    if (w.endsWith(suf) && w.length - suf.length >= 3 && EN_VOWEL.test(w.slice(0, -suf.length))) {
      w = w.slice(0, -suf.length);
      stripped = true;
      break;
    }
  }
  if (stripped) {
    // running → run, stopped → stop; hoping → hope (без восстановления «e» — достаточно для сравнения)
    if (/([bdfgkmnprt])\1$/.test(w)) w = w.slice(0, -1);
  } else if (w.endsWith('ly') && w.length > 5) w = w.slice(0, -2);
  if (w.endsWith('e') && w.length > 4) w = w.slice(0, -1);
  if (w.endsWith('y') && w.length > 3 && !EN_VOWEL.test(w[w.length - 2])) w = w.slice(0, -1) + 'i';
  return w;
}

// ---------- Служебные слова ----------

/**
 * Проверяются по самой словоформе (не по основе): у «весь» и «вес» основа одна,
 * а выбросить нужно только первое.
 */
const STOP_RU = `
а без более бы был была были было быть в вам вас ваш ваша ваше ваши весь во вот впрочем все всё всего всей всем всеми всех всю вся
вы где да даже для до его ее её ей ему если есть еще ещё же за здесь и из или им ими их к как какая какие каким какой какое каких
когда кого ком кому которая которого которое которой котором которую которые который которых которым которыми кто куда ли либо
лишь между меня мне мной много мною мое моё мои мой мол моя мы на над надо наш наша наше наши не него нее неё нет ни ним ними них
но ну о об однако он она они оно от очень по под после потом потому почему при про раз с сам сама сами само самого самой самом
самый свое своё свои свой своя себе себя со так такая также такие таким такой такое там твой твоя твое твоё твои те тебе тебя
тем теми то тобой тогда того тоже той только том тот ту тут ты у уж уже хотя чего чей чем через что чтобы чье чья эта эти этим
этими этих это этого этой этом этому этот эту я ага ой ах эх вон ведь вроде будто словно разве неужели пусть пускай нибудь
будет будем будете будешь буду будут был была были было быть есть является являются стал стала стали стало стать становится
может могу можешь можем можете могут мог могла могли могло можно нельзя нужно нужен нужна нужны надо должен должна должно должны
хочу хочешь хочет хотим хотите хотят хотел хотела хотели хотелось хочется
сегодня вчера завтра сейчас теперь потом затем тогда всегда никогда иногда часто редко снова опять уже скоро давно недавно пока
здесь туда сюда оттуда отсюда везде нигде где-то кое-где
очень совсем почти вообще просто именно лишь только даже ещё также тоже точно конечно наверное кажется видимо например кстати вместо
наконец сначала сразу вдруг вместе отдельно иначе поэтому поскольку причем причём зато либо т.е т.к др пр
один одна одно одни одного одной одному одним два две три четыре пять шесть семь восемь девять десять первый второй третий
много мало немного несколько больше меньше более менее самое самая самые лучше хуже
весь вся всё все всех всем всеми всего всей всю каждый каждая каждое каждые любой любая любое другой другая другое другие других
этот эта это эти тот та то те такой такая такое такие сам сама само сами
что-то кто-то как-то где-нибудь что-нибудь кто-нибудь какой-то какая-то какие-то чем-то
делать сделать делаю делает делаем делают сделал сделала сделали сделаю сделаем
говорить сказать говорит сказал сказала говорят
вещь вещи штука штуки дело дела раз разы
да нет ок окей ладно хорошо плохо нормально
перед около возле вокруг среди кроме вместо ради против вдоль мимо внутри вне сквозь насчет насчёт благодаря согласно
решил решила решили решить думаю думал думала думаем кажется знаю знать понял поняла понять помню
важно важный важная важное важные легко сложно интересно понятно главное
час часа часов минута минуты минут секунда секунды секунд день дня дней дни неделя недели неделю недель
месяц месяца месяцев месяцы год года лет году раза
двух двум двумя трех трёх трем трём тремя четырех четырёх пяти шести семи восьми девяти десяти сто тысяча тысячи тысяч
важнее лучшего проще сложнее легче быстрее дольше раньше позже
заметка заметки заметок заметку заметке заметкой заметках
`;

const STOP_EN = `
a about above after again against all am an and any are aren't as at be because been before being below between both but by
can can't cannot could couldn't did didn't do does doesn't doing don't down during each few for from further had hadn't has hasn't
have haven't having he he'd he'll he's her here here's hers herself him himself his how how's i i'd i'll i'm i've if in into is
isn't it it's its itself let's me more most mustn't my myself no nor not of off on once only or other ought our ours ourselves out
over own same shan't she she'd she'll she's should shouldn't so some such than that that's the their theirs them themselves then
there there's these they they'd they'll they're they've this those through to too under until up very was wasn't we we'd we'll
we're we've were weren't what what's when when's where where's which while who who's whom why why's with won't would wouldn't
you you'd you'll you're you've your yours yourself yourselves also just like get got really thing things stuff today tomorrow
yesterday need want make made will one two three new use used using via etc
`;

const STOP = new Set([...STOP_RU.split(/\s+/), ...STOP_EN.split(/\s+/)].filter(Boolean).map((w) => w.replace(/ё/g, 'е')));

export const isStopWord = (w: string) => STOP.has(w.toLowerCase().replace(/ё/g, 'е'));

// ---------- Разбор текста ----------

export interface Token {
  /** ключ термина (основа) */
  key: string;
  /** как слово написано (строчными; аббревиатуры и имена собственные — как есть) */
  form: string;
}

/** null — разрыв: знак препинания, число или служебное слово (словосочетание через него не строится) */
type Tok = Token | null;

const WORD_RE = /[\p{L}][\p{L}\p{N}]*(?:['’][\p{L}]+)?|[\p{N}]+|[^\s\p{L}\p{N}]/gu;
const isAcronym = (s: string) => s.length >= 2 && s.length <= 6 && /^[\p{Lu}\p{N}]+$/u.test(s) && (s.match(/\p{Lu}/gu)?.length ?? 0) >= 2;

/** Убрать адреса, почту, разметку — они не про смысл */
function cleanText(s: string): string {
  return s
    .replace(/\bhttps?:\/\/\S+/gi, ' . ')
    .replace(/\bwww\.\S+/gi, ' . ')
    .replace(/\S+@\S+\.\S+/g, ' . ')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_~=`#>]+/g, ' ');
}

const keyCache = new Map<string, string | null>();

/** Ключ термина для слова (или null, если слово неважное) */
export function termKey(raw: string): string | null {
  let k = keyCache.get(raw);
  if (k === undefined) {
    k = computeKey(raw);
    if (keyCache.size > 50000) keyCache.clear();
    keyCache.set(raw, k);
  }
  return k;
}

function computeKey(raw: string): string | null {
  const lower = raw.toLowerCase().replace(/ё/g, 'е').replace(/’/g, "'");
  if (STOP.has(lower)) return null;
  if (isAcronym(raw)) return lower;
  if (lower.length < 3 || !/\p{L}/u.test(lower)) return null;
  if (/[а-я]/.test(lower)) {
    const s = stemRu(lower);
    return s.length >= 2 ? s : null;
  }
  if (/^[a-z]/.test(lower)) {
    const s = stemEn(lower.replace(/'s$/, ''));
    return s.length >= 2 ? s : null;
  }
  return lower;
}

/**
 * Как показать слово: имя собственное посреди предложения («Стамбул», «React») и слова
 * со смешанным регистром («useEffect», «iPhone») — как написаны, остальное — строчными
 */
function displayOf(raw: string, sentenceStart: boolean): string {
  if (isAcronym(raw) || /^.\p{Ll}*\p{Lu}/u.test(raw)) return raw;
  if (!sentenceStart && /^\p{Lu}/u.test(raw)) return raw;
  return raw.toLowerCase();
}

export function tokenize(text: string): Tok[] {
  const out: Tok[] = [];
  let start = true;
  for (const m of cleanText(text).matchAll(WORD_RE)) {
    const raw = m[0];
    // дефис между словами («бизнес-план») не разрывает словосочетание
    if (raw === '-' || raw === "'") continue;
    if (!/^\p{L}/u.test(raw)) {
      out.push(null);
      if (/[.!?…:;]/.test(raw)) start = true;
      continue;
    }
    const key = termKey(raw);
    out.push(key ? { key, form: displayOf(raw, start) } : null);
    start = false;
  }
  return out;
}

// ---------- Признаки заметки ----------

export interface NoteDoc {
  title: string;
  /** заголовки внутри заметки — весят больше обычного текста */
  headings?: string[];
  text: string;
}

export interface NoteFeatures {
  /** термин → взвешенная частота (слова заголовка — ×3, подзаголовков — ×2) */
  terms: Record<string, number>;
  /** термин → как он чаще всего написан в заметке */
  forms: Record<string, string>;
  /** термин из названия (1–2 значимых слова) — для поиска упоминаний в других заметках */
  titleKey?: string;
}

const TITLE_W = 3;
const HEADING_W = 2;
/** в кэше на заметку храним не больше стольких терминов */
const MAX_TERMS = 400;
export const BIGRAM_SEP = ' ';

export function extractFeatures(doc: NoteDoc): NoteFeatures {
  const tf = new Map<string, number>();
  const formCount = new Map<string, Map<string, number>>();
  const add = (key: string, form: string, w: number) => {
    tf.set(key, (tf.get(key) ?? 0) + w);
    let fc = formCount.get(key);
    if (!fc) formCount.set(key, (fc = new Map()));
    fc.set(form, (fc.get(form) ?? 0) + w);
  };
  const feed = (text: string, w: number) => {
    // строки — отдельные «предложения»: словосочетание не перескакивает через перенос
    for (const line of text.split(/\n+/)) {
      const toks = tokenize(line);
      for (let i = 0; i < toks.length; i++) {
        const t = toks[i];
        if (!t) continue;
        add(t.key, t.form, w);
        const prev = toks[i - 1];
        if (prev && prev.key !== t.key) add(prev.key + BIGRAM_SEP + t.key, prev.form + ' ' + t.form, w);
      }
    }
  };
  feed(doc.title, TITLE_W);
  for (const h of doc.headings ?? []) feed(h, HEADING_W);
  feed(doc.text, 1);

  let entries = [...tf.entries()];
  if (entries.length > MAX_TERMS) entries = entries.sort((a, b) => b[1] - a[1]).slice(0, MAX_TERMS);
  const terms: Record<string, number> = {};
  const forms: Record<string, string> = {};
  for (const [k, v] of entries) {
    terms[k] = v;
    // самая частая форма; если слово хоть раз написано с заглавной посреди предложения — это имя, показываем так
    let best = '';
    let bc = -1;
    let proper = false;
    for (const [f, c] of formCount.get(k)!) {
      const up = f !== f.toLowerCase();
      if ((up && !proper) || (up === proper && c > bc)) [best, bc, proper] = [f, c, up];
    }
    forms[k] = best;
  }
  const titleToks = tokenize(doc.title).filter((t): t is Token => !!t);
  let titleKey: string | undefined;
  if (titleToks.length === 1) titleKey = titleToks[0].key;
  else if (titleToks.length === 2 && titleToks[0].key !== titleToks[1].key) titleKey = titleToks[0].key + BIGRAM_SEP + titleToks[1].key;
  return titleKey && terms[titleKey] ? { terms, forms, titleKey } : { terms, forms };
}

// ---------- Индекс ----------

export interface LinkDoc {
  id: string;
  f: NoteFeatures;
}

interface DocVec {
  id: string;
  f: NoteFeatures;
  /** термин → вес TF-IDF (нормирован: длина вектора = 1) */
  w: Map<string, number>;
  /** термин → частота (формы с беглой гласной слиты) */
  tf: Map<string, number>;
  titleKey?: string;
  /** самые весомые термины с непустым списком заметок — для поиска кандидатов (считаются при первом запросе) */
  top?: string[];
}

export interface LinkIndex {
  n: number;
  docs: Map<string, DocVec>;
  df: Map<string, number>;
  /** термин → заметки, где он есть, с весом */
  post: Map<string, { id: string; w: number }[]>;
  /** ключ названия → заметки с таким названием (только названия, упоминание которых что-то значит) */
  titles: Map<string, string[]>;
  /** ключ названия → заметки, где он встречается в тексте */
  holders: Map<string, string[]>;
  /** решения по парам (pairKey): true — связь верна (показывается, даже если слов общих мало), false — случайна (скрыта) */
  pairs: Map<string, boolean>;
  /** подтверждённые пары — по заметкам, чтобы добавить их в кандидаты */
  forced: Map<string, string[]>;
  /** ключ термина заметки → ключ в индексе (слияние форм с беглой гласной) */
  canon: (k: string) => string;
}

export interface IndexOpts {
  /** решения по парам заметок (ИИ или человек) */
  pairs?: Map<string, boolean>;
}

/** Ключ пары заметок — один на пару, в каком бы порядке их ни назвали */
export const pairKey = (a: string, b: string) => (a < b ? a + '|' + b : b + '|' + a);

const BIGRAM_BOOST = 1.4;

/**
 * Беглая гласная: «привычек» и «привычк(а)» — одно слово, но Snowball даёт разные основы.
 * Если основа без «е/о» перед последней согласной тоже встречается в заметках — сливаем.
 */
function fleetingAliases(vocab: Set<string>): Map<string, string> {
  const alias = new Map<string, string>();
  for (const k of vocab) {
    if (k.length < 5 || k.includes(BIGRAM_SEP)) continue;
    const m = k.match(/^(.*[^аеиоуыэюя])[ео]([^аеиоуыэюяйь])$/);
    if (m && vocab.has(m[1] + m[2])) alias.set(k, m[1] + m[2]);
  }
  return alias;
}

export function buildIndex(items: LinkDoc[], opts: IndexOpts = {}): LinkIndex {
  const vocab = new Set<string>();
  for (const it of items) for (const k in it.f.terms) if (!k.includes(BIGRAM_SEP)) vocab.add(k);
  const alias = fleetingAliases(vocab);
  const memo = new Map<string, string>();
  const canon = (k: string) => {
    if (!alias.size) return k;
    let c = memo.get(k);
    if (c === undefined) {
      c = k.includes(BIGRAM_SEP)
        ? k
            .split(BIGRAM_SEP)
            .map((p) => alias.get(p) ?? p)
            .join(BIGRAM_SEP)
        : (alias.get(k) ?? k);
      memo.set(k, c);
    }
    return c;
  };

  // термины с учётом слияния форм
  const docs = new Map<string, DocVec>();
  const df = new Map<string, number>();
  const raw: { id: string; f: NoteFeatures; tf: Map<string, number>; titleKey?: string }[] = [];
  const seenIds = new Set<string>();
  for (const it of items) {
    if (seenIds.has(it.id)) continue;
    seenIds.add(it.id);
    const tf = new Map<string, number>();
    for (const k in it.f.terms) {
      const c = canon(k);
      tf.set(c, (tf.get(c) ?? 0) + it.f.terms[k]);
    }
    if (!tf.size) continue;
    for (const k of tf.keys()) df.set(k, (df.get(k) ?? 0) + 1);
    raw.push({ id: it.id, f: it.f, tf, titleKey: it.f.titleKey ? canon(it.f.titleKey) : undefined });
  }
  const n = raw.length;

  const post = new Map<string, { id: string; w: number }[]>();
  for (const r of raw) {
    const w = new Map<string, number>();
    let norm = 0;
    for (const [k, c] of r.tf) {
      // термин из одной заметки весит как из двух — опечатки и редкие слова не «размывают» вектор
      const idf = Math.log(1 + n / Math.max(df.get(k)!, 2));
      const v = (1 + Math.log(c)) * idf * (k.includes(BIGRAM_SEP) ? BIGRAM_BOOST : 1);
      w.set(k, v);
      norm += v * v;
    }
    norm = Math.sqrt(norm) || 1;
    for (const [k, v] of w) {
      const nv = v / norm;
      w.set(k, nv);
      // слово из одной заметки ни с чем не связывает; слово почти из всех — почти ничего не значит
      const dk = df.get(k)!;
      if (dk > 1 && (n < 20 || dk <= n * 0.5)) {
        let p = post.get(k);
        if (!p) post.set(k, (p = []));
        p.push({ id: r.id, w: nv });
      }
    }
    docs.set(r.id, { id: r.id, f: r.f, w, tf: r.tf, titleKey: r.titleKey });
  }

  // названия и где они упоминаются — чтобы не перебирать все заметки при каждом запросе
  const titles = new Map<string, string[]>();
  for (const d of docs.values()) if (d.titleKey && mentionableKey(n, df, d.titleKey)) push(titles, d.titleKey, d.id);
  const holders = new Map<string, string[]>();
  for (const d of docs.values()) for (const k of d.w.keys()) if (titles.has(k)) push(holders, k, d.id);
  // решения по парам — только для заметок, которые есть в индексе
  const pairs = new Map<string, boolean>();
  const forced = new Map<string, string[]>();
  for (const [k, ok] of opts.pairs ?? []) {
    const [a, b] = k.split('|');
    if (!docs.has(a) || !docs.has(b) || a === b) continue;
    pairs.set(pairKey(a, b), ok);
    if (ok) {
      push(forced, a, b);
      push(forced, b, a);
    }
  }
  return { n, docs, df, post, titles, holders, pairs, forced, canon };
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
}

// ---------- Связи ----------

export interface Related {
  id: string;
  /** 0…1 */
  score: number;
  /** общие важные слова (как написаны в исходной заметке) */
  terms: string[];
  /** одна заметка упоминает название другой */
  mention?: boolean;
  /** связь подтверждена (ИИ или человеком) */
  confirmed?: boolean;
}

export interface RelatedOpts {
  limit?: number;
  /** порог силы связи */
  min?: number;
  /** без решений по парам — как связал бы один алгоритм (для повторной проверки ИИ) */
  raw?: boolean;
  /** и пары с одним общим словом — кандидаты, которые ИИ может счесть связанными */
  loose?: boolean;
}

export const MIN_SCORE = 0.08;
const MENTION_BONUS = 0.15;
const STRONG_ALONE = 0.25;

/** Термин из названия достаточно редкий, чтобы считать его упоминание связью */
function mentionableKey(n: number, df: Map<string, number>, key: string): boolean {
  if (key.includes(BIGRAM_SEP)) return true;
  return (df.get(key) ?? 0) <= Math.max(3, Math.ceil(n * 0.15));
}

function displayForm(d: DocVec, key: string): string {
  if (d.f.forms[key]) return d.f.forms[key];
  // слитая беглая форма — ищем исходный ключ
  for (const k in d.f.forms) if (k !== key && k.length === key.length + 1 && k.replace(/[ео](?=[^аеиоуыэюяйь]$)/, '') === key) return d.f.forms[k];
  return key;
}

/**
 * Отобрать до max терминов по порядку важности: слово, входящее в выбранное словосочетание,
 * отдельно не показывается («длинная пробежка», а не «пробежка» + «длинная пробежка»).
 */
function pickTerms(keys: Iterable<string>, max: number, ok?: (k: string) => boolean): string[] {
  const out: string[] = [];
  const inPhrase = (w: string) => out.some((o) => o.includes(BIGRAM_SEP) && o.split(BIGRAM_SEP).includes(w));
  for (const k of keys) {
    if (out.length >= max) break;
    if (ok && !ok(k)) continue;
    if (k.includes(BIGRAM_SEP)) {
      const parts = k.split(BIGRAM_SEP);
      if (parts.every(inPhrase)) continue;
      for (let i = out.length - 1; i >= 0; i--) if (parts.includes(out[i])) out.splice(i, 1);
      out.push(k);
    } else if (!inPhrase(k)) out.push(k);
  }
  return out;
}

/** Общие термины пары — по вкладу в близость */
function sharedTerms(a: DocVec, b: DocVec, max = 4): string[] {
  const shared: [string, number][] = [];
  for (const [k, w] of a.w) {
    const wb = b.w.get(k);
    if (wb) shared.push([k, w * wb]);
  }
  shared.sort((x, y) => y[1] - x[1]);
  return pickTerms(
    shared.map((x) => x[0]),
    max,
  ).map((k) => displayForm(a, k));
}

/** по скольким самым весомым словам заметки ищутся кандидаты и сколько из них оцениваются точно */
const QUERY_TERMS = 48;
const CANDIDATES = 60;

function topTerms(ix: LinkIndex, a: DocVec): string[] {
  a.top ??= [...a.w.entries()]
    .filter(([k]) => ix.post.has(k))
    .sort((x, y) => y[1] - x[1])
    .slice(0, QUERY_TERMS)
    .map((x) => x[0]);
  return a.top;
}

/** Заметки, связанные упоминанием: эта упоминает их название или они — её (одинаковые названия — не упоминание) */
function mentionsOf(ix: LinkIndex, a: DocVec): Set<string> {
  const out = new Set<string>();
  for (const k of a.w.keys()) {
    const t = ix.titles.get(k);
    if (t && k !== a.titleKey) for (const id of t) out.add(id);
  }
  if (a.titleKey && ix.titles.has(a.titleKey))
    for (const id of ix.holders.get(a.titleKey) ?? []) if (ix.docs.get(id)!.titleKey !== a.titleKey) out.add(id);
  out.delete(a.id);
  return out;
}

/** Точная близость пары: скалярное произведение, число общих слов, есть ли общее словосочетание */
function pairStats(a: DocVec, b: DocVec): { dot: number; words: number; phrase: boolean } {
  const [small, big] = a.w.size <= b.w.size ? [a.w, b.w] : [b.w, a.w];
  let dot = 0;
  let words = 0;
  let phrase = false;
  for (const [k, w] of small) {
    const wb = big.get(k);
    if (wb === undefined) continue;
    dot += w * wb;
    if (k.includes(BIGRAM_SEP)) phrase = true;
    else words++;
  }
  return { dot, words, phrase };
}

interface Scored {
  id: string;
  score: number;
  mention: boolean;
  confirmed: boolean;
}

/** Связи заметки без причин (их считать дороже) — самые сильные первыми */
function scored(ix: LinkIndex, a: DocVec, min: number, raw = false, loose = false): Scored[] {
  // кандидаты — по самым весомым словам (приближённо), затем точная оценка
  const approx = new Map<string, number>();
  for (const k of topTerms(ix, a)) {
    const w = a.w.get(k)!;
    for (const e of ix.post.get(k)!) if (e.id !== a.id) approx.set(e.id, (approx.get(e.id) ?? 0) + w * e.w);
  }
  const cands = new Set(
    [...approx.entries()]
      .sort((x, y) => y[1] - x[1])
      .slice(0, CANDIDATES)
      .map((x) => x[0]),
  );
  const mentions = mentionsOf(ix, a);
  for (const id of mentions) cands.add(id);
  if (!raw) for (const id of ix.forced.get(a.id) ?? []) cands.add(id);

  const out: Scored[] = [];
  for (const bid of cands) {
    const verdict = raw ? undefined : ix.pairs.get(pairKey(a.id, bid));
    if (verdict === false) continue;
    const st = pairStats(a, ix.docs.get(bid)!);
    const mention = mentions.has(bid);
    const score = Math.min(1, st.dot + (mention ? MENTION_BONUS : 0));
    // подтверждённая связь остаётся, даже если общих слов мало
    if (verdict === true) {
      out.push({ id: bid, score: Math.max(score, MIN_SCORE), mention, confirmed: true });
      continue;
    }
    if (score < min) continue;
    // одно общее слово — ещё не связь, если оно не очень весомое
    if (loose || st.words >= 2 || st.phrase || mention || score >= STRONG_ALONE) out.push({ id: bid, score, mention, confirmed: false });
  }
  return out.sort((x, y) => y.score - x.score || (x.id < y.id ? -1 : 1));
}

/** Связанные заметки для id — самые близкие первыми */
export function relatedTo(ix: LinkIndex, id: string, opts: RelatedOpts = {}): Related[] {
  const a = ix.docs.get(id);
  if (!a) return [];
  let list = scored(ix, a, opts.min ?? MIN_SCORE, opts.raw, opts.loose);
  if (opts.limit) list = list.slice(0, opts.limit);
  return list.map(({ id: bid, score, mention, confirmed }) => {
    const b = ix.docs.get(bid)!;
    const terms = sharedTerms(a, b);
    if (mention && !terms.length) terms.push(displayForm(b, b.titleKey ?? '') || displayForm(a, a.titleKey ?? ''));
    const r: Related = { id: bid, score, terms };
    if (mention) r.mention = true;
    if (confirmed) r.confirmed = true;
    return r;
  });
}

/** Ключевые слова заметки — самые весомые термины */
export function keywordsOf(ix: LinkIndex, id: string, max = 6): string[] {
  const d = ix.docs.get(id);
  if (!d) return [];
  const list = [...d.w.entries()].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)).map((x) => x[0]);
  // словосочетание — только если встречается больше одного раза или в нескольких заметках
  return pickTerms(list, max, (k) => !k.includes(BIGRAM_SEP) || (d.tf.get(k) ?? 0) >= 2 || (ix.df.get(k) ?? 0) >= 2).map((k) => displayForm(d, k));
}

/**
 * Ключевые слова по признакам заметки (с ключами) — веса по частотам всего индекса.
 * Нужны, чтобы показать ИИ выбор самого алгоритма, без прежних правок.
 */
export function keywordTerms(ix: LinkIndex, f: NoteFeatures, max = 10): { key: string; raw: string[]; form: string }[] {
  // слить формы, как в индексе; raw — исходные ключи заметки (их убирает правка слов)
  const agg = new Map<string, { tf: number; raw: string[]; form: string; best: number }>();
  for (const k in f.terms) {
    const c = ix.canon(k);
    const a = agg.get(c) ?? { tf: 0, raw: [], form: '', best: -1 };
    a.tf += f.terms[k];
    a.raw.push(k);
    if (f.terms[k] > a.best) [a.form, a.best] = [f.forms[k] ?? k, f.terms[k]];
    agg.set(c, a);
  }
  const w: [string, number][] = [];
  for (const [k, a] of agg) {
    const idf = Math.log(1 + Math.max(1, ix.n) / Math.max(ix.df.get(k) ?? 1, 2));
    w.push([k, (1 + Math.log(a.tf)) * idf * (k.includes(BIGRAM_SEP) ? BIGRAM_BOOST : 1)]);
  }
  w.sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1));
  return pickTerms(
    w.map((x) => x[0]),
    max,
    (k) => !k.includes(BIGRAM_SEP) || agg.get(k)!.tf >= 2 || (ix.df.get(k) ?? 0) >= 2,
  ).map((key) => ({ key, raw: agg.get(key)!.raw, form: agg.get(key)!.form }));
}

/** вес добавленной темы — как у подзаголовка (слова из названия остаются главнее) */
const ADDED_W = 2;

/**
 * Применить правку важных слов: убрать неважные (и словосочетания с ними), добавить пропущенные темы.
 * Возвращает новый объект — кэш признаков не меняется.
 */
export function applyTermReview(f: NoteFeatures, drop: string[], add: string[]): NoteFeatures {
  if (!drop.length && !add.length) return f;
  const gone = new Set(drop);
  const terms: Record<string, number> = {};
  const forms: Record<string, string> = {};
  for (const k in f.terms) {
    if (gone.has(k) || (k.includes(BIGRAM_SEP) && k.split(BIGRAM_SEP).some((p) => gone.has(p)))) continue;
    terms[k] = f.terms[k];
    forms[k] = f.forms[k];
  }
  for (const phrase of add) {
    const toks = tokenize(phrase).filter((t): t is Token => !!t);
    toks.forEach((t, i) => {
      terms[t.key] = (terms[t.key] ?? 0) + ADDED_W;
      forms[t.key] ??= t.form;
      const next = toks[i + 1];
      if (next && next.key !== t.key) {
        const bk = t.key + BIGRAM_SEP + next.key;
        terms[bk] = (terms[bk] ?? 0) + ADDED_W;
        forms[bk] ??= t.form + ' ' + next.form;
      }
    });
  }
  const out: NoteFeatures = { terms, forms };
  if (f.titleKey && terms[f.titleKey]) out.titleKey = f.titleKey;
  return out;
}

export interface LinkEdge {
  a: string;
  b: string;
  score: number;
  mention?: boolean;
  confirmed?: boolean;
}

/**
 * Связи заметки id для графа: не больше perNote самых сильных (без причин — быстрее).
 * Ребро a–b одно на пару: a < b.
 */
export function edgesOf(ix: LinkIndex, id: string, perNote = 6, min = MIN_SCORE): LinkEdge[] {
  const a = ix.docs.get(id);
  if (!a) return [];
  return scored(ix, a, min)
    .slice(0, perNote)
    .map((r) => {
      const [x, y] = id < r.id ? [id, r.id] : [r.id, id];
      const e: LinkEdge = { a: x, b: y, score: r.score };
      if (r.mention) e.mention = true;
      if (r.confirmed) e.confirmed = true;
      return e;
    });
}

/** Все связи (рёбра графа): у каждой заметки не больше perNote самых сильных, без повторов */
export function allLinks(ix: LinkIndex, perNote = 6, min = MIN_SCORE): LinkEdge[] {
  const seen = new Map<string, LinkEdge>();
  for (const id of ix.docs.keys())
    for (const e of edgesOf(ix, id, perNote, min)) {
      const key = e.a + '|' + e.b;
      if (!seen.has(key)) seen.set(key, e);
    }
  return [...seen.values()];
}
