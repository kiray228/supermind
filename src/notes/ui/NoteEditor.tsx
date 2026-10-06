import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import {
  AudioLines,
  Bold,
  ChevronDown,
  ChevronLeft,
  Copy,
  Download,
  FolderInput,
  FolderPlus,
  Image as ImageIcon,
  Loader2,
  Mic,
  MoreHorizontal,
  Pin,
  PinOff,
  Plus,
  Share2,
  Sparkles,
  Square,
  SquareCheck,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import type { ID } from '../../types';
import { toast, useApp } from '../../store/appStore';
import { AIError } from '../../ai/claude';
import { downloadText, pickFile, safeFilename, isIOS } from '../../io/download';
import { askText, onBack } from '../../ui/dialogs';
import { addTask, ensureTasks, openTask } from '../../tasks/store';
import { type Block, type BlockType, fmtDuration, isBodyEmpty, isTextBlock, LIST_TYPES, markdownToBlocks, MAX_AUDIO_SEC, newBlock, noteDate, noteToMarkdown, stripInline } from '../model';
import { addFolder, duplicateNote, editOpenBody, moveNote, openNote, sortedFolders, togglePin, trashNote, undoOpenBody, useNotes } from '../store';
import { imageFileToDataUrl, type Recognizer, type Recording, recordingSupported, speechSupported, startRecognition, startRecording } from '../media';
import { applyNoteAI, NOTE_AI_LABELS, type NoteAIKind, runNoteAI } from '../ai';
import { autosize, BlockView, type BlockCtx } from './BlockView';
import { cloneBlocks, convertBlock, detectShortcut, listNumbers, nextTypeAfter, wrapSelection } from './editorOps';
import { BlockMenuItems, FORMAT_MARKS, FormatMenuItems, type FormatKind, TypeMenuItems } from './EditorMenus';
import { MenuItem, MenuLabel, MenuSep, NtMenu, type MenuAnchor } from './Menu';

type MenuState = { kind: 'type' | 'format' | 'block' | 'note' | 'folder'; anchor: MenuAnchor; blockId?: ID; replace?: boolean } | null;
type RecState = { r: Recording; after: ID | null; final: string; recog: Recognizer | null; ended?: () => void };
type FocusReq = { id: ID; start: number | 'end'; end?: number };

const blocksNow = () => useNotes.getState().openBody?.blocks ?? [];
const indexOf = (id: ID) => blocksNow().findIndex((b) => b.id === id);
const countNl = (s: string) => s.split('\n').length - 1;
const isMedia = (b: Block) => b.type === 'image' || b.type === 'audio' || b.type === 'divider';

export function NoteEditor({ onClose }: { onClose: () => void }) {
  const openId = useNotes((s) => s.openId);
  const body = useNotes((s) => s.openBody);
  const canUndo = useNotes((s) => s.canUndo);
  const meta = useNotes((s) => s.data?.notes.find((n) => n.id === s.openId));
  const data = useNotes((s) => s.data);
  const folder = data?.folders.find((f) => f.id === meta?.folderId);

  const [menu, setMenu] = useState<MenuState>(null);
  const [focusId, setFocusId] = useState<ID | null>(null);
  const [selId, setSelId] = useState<ID | null>(null);
  const [kb, setKb] = useState(false);
  const [rec, setRec] = useState<{ sec: number; text: string; saving?: boolean } | null>(null);
  const [dict, setDict] = useState<{ interim: string } | null>(null);
  const [ai, setAi] = useState<{ kind: NoteAIKind; chars: number } | null>(null);
  const [viewer, setViewer] = useState<string | null>(null);

  const tas = useRef(new Map<ID, HTMLTextAreaElement>());
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const focusReq = useRef<FocusReq | null>(null);
  const lastFocus = useRef<ID | null>(null);
  const recRef = useRef<RecState | null>(null);
  const dictRef = useRef<{ id: ID; base: string; recog: Recognizer | null; dead?: boolean } | null>(null);
  const aiAbort = useRef<AbortController | null>(null);

  // ---------- Фокус ----------

  const applyFocus = (req: FocusReq) => {
    const el = tas.current.get(req.id);
    if (!el) return false;
    if (document.activeElement !== el) el.focus();
    const s = req.start === 'end' ? el.value.length : Math.min(req.start, el.value.length);
    try {
      el.setSelectionRange(s, req.end ?? s);
    } catch {
      /* поле скрыто */
    }
    return true;
  };
  /** after — фокус после перерисовки (блок только что изменён) */
  const focusBlock = (id: ID, start: number | 'end' = 'end', end?: number, after = true) => {
    const req = { id, start, end };
    if (after) focusReq.current = req;
    else applyFocus(req);
  };
  useLayoutEffect(() => {
    const req = focusReq.current;
    if (req) {
      focusReq.current = null;
      applyFocus(req);
    }
  });

  // ---------- Окружение ----------

  useEffect(() => onBack(() => (void close(), true)));
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const f = () => setKb(window.innerHeight - vv.height > 140);
    vv.addEventListener('resize', f);
    f();
    return () => vv.removeEventListener('resize', f);
  }, []);
  useEffect(() => {
    const f = () => tas.current.forEach((el) => autosize(el));
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  useLayoutEffect(() => autosize(titleRef.current), [body?.title]);
  // при уходе со страницы — остановить запись и диктовку
  useEffect(
    () => () => {
      recRef.current?.r.cancel();
      recRef.current?.recog?.abort();
      dictRef.current?.recog?.abort();
      aiAbort.current?.abort();
    },
    [],
  );
  // новая заметка — курсор в заголовок
  const autoFocused = useRef<ID | null>(null);
  useEffect(() => {
    if (!body || !openId || autoFocused.current === openId) return;
    autoFocused.current = openId;
    if (isBodyEmpty(body) && window.matchMedia('(hover: hover)').matches) titleRef.current?.focus();
  }, [body, openId]);

  async function close() {
    if (recRef.current) await stopRec();
    dictRef.current?.recog?.stop();
    onClose();
  }

  // ---------- Операции с блоками ----------

  const patch = (id: ID, p: Partial<Block>, kind: 'struct' | 'type' = 'struct') =>
    editOpenBody((bd) => {
      const i = bd.blocks.findIndex((b) => b.id === id);
      if (i >= 0) bd.blocks[i] = { ...bd.blocks[i], ...p };
    }, kind);

  /** Вставить блоки после after (null — в конец). Пустой абзац на месте вставки заменяется */
  const insertBlocks = (after: ID | null, list: Block[], focusLast = false) => {
    if (!list.length) return;
    editOpenBody((bd) => {
      let i = after ? bd.blocks.findIndex((b) => b.id === after) : bd.blocks.length - 1;
      if (i < 0) i = bd.blocks.length - 1;
      const cur = bd.blocks[i];
      if (cur && cur.type === 'p' && !cur.text?.trim()) bd.blocks.splice(i, 1, ...list);
      else bd.blocks.splice(i + 1, 0, ...list);
      const lastIns = list[list.length - 1];
      const pos = bd.blocks.indexOf(lastIns);
      let tail: Block | null = null;
      if (isMedia(lastIns) && !bd.blocks[pos + 1]) {
        tail = newBlock('p');
        bd.blocks.push(tail);
      }
      if (focusLast) {
        if (isTextBlock(lastIns)) focusBlock(lastIns.id, 'end');
        else if (tail) focusBlock(tail.id, 0);
      }
    });
  };

  const anchorId = () => selId ?? lastFocus.current;

  function split(id: ID, text: string, pos: number) {
    editOpenBody((bd) => {
      const i = bd.blocks.findIndex((b) => b.id === id);
      if (i < 0) return;
      const b = bd.blocks[i];
      if (LIST_TYPES.includes(b.type) && !text.trim()) {
        bd.blocks[i] = convertBlock({ ...b, text: '' }, 'p');
        focusBlock(id, 0);
        return;
      }
      if (pos === 0 && text) {
        bd.blocks[i] = { ...b, text };
        bd.blocks.splice(i, 0, newBlock(LIST_TYPES.includes(b.type) ? b.type : 'p'));
        focusBlock(id, 0);
        return;
      }
      bd.blocks[i] = { ...b, text: text.slice(0, pos) };
      const nb = newBlock(nextTypeAfter(b.type), { text: text.slice(pos) });
      bd.blocks.splice(i + 1, 0, nb);
      focusBlock(nb.id, 0);
    });
  }

  function mergeBack(id: ID) {
    const blocks = blocksNow();
    const i = blocks.findIndex((b) => b.id === id);
    if (i < 0) return;
    const b = blocks[i];
    const prev = blocks[i - 1];
    if (b.type !== 'p') {
      editOpenBody((bd) => void (bd.blocks[i] = convertBlock(b, 'p')));
      focusBlock(id, 0);
      return;
    }
    if (!prev) return;
    if (isTextBlock(prev)) {
      const pl = prev.text?.length ?? 0;
      editOpenBody((bd) => {
        bd.blocks[i - 1] = { ...prev, text: (prev.text ?? '') + (b.text ?? '') };
        bd.blocks.splice(i, 1);
      });
      focusBlock(prev.id, pl);
    } else if (prev.type === 'divider') {
      editOpenBody((bd) => void bd.blocks.splice(i - 1, 1));
      focusBlock(id, 0);
    } else if (!b.text) {
      editOpenBody((bd) => void bd.blocks.splice(i, 1));
      tas.current.get(id)?.blur();
      setSelId(prev.id);
    }
  }

  function removeBlock(id: ID) {
    editOpenBody((bd) => {
      bd.blocks = bd.blocks.filter((b) => b.id !== id);
      if (!bd.blocks.length) bd.blocks.push(newBlock('p'));
    });
    if (selId === id) setSelId(null);
  }

  function moveBlock(id: ID, dir: -1 | 1) {
    editOpenBody((bd) => {
      const i = bd.blocks.findIndex((b) => b.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= bd.blocks.length) return;
      [bd.blocks[i], bd.blocks[j]] = [bd.blocks[j], bd.blocks[i]];
    });
  }

  function convert(id: ID, type: BlockType) {
    const b = blocksNow().find((x) => x.id === id);
    if (!b) return;
    if (type === 'image') return pickImage(id);
    if (type === 'audio') return void startRec(id);
    if (type === 'divider') {
      const p = newBlock('p');
      editOpenBody((bd) => {
        const i = bd.blocks.findIndex((x) => x.id === id);
        if (isTextBlock(b) && !b.text?.trim()) bd.blocks.splice(i, 1, newBlock('divider'), p);
        else bd.blocks.splice(i + 1, 0, newBlock('divider'), p);
      });
      focusBlock(p.id, 0);
      return;
    }
    if (isTextBlock(b)) {
      editOpenBody((bd) => {
        const i = bd.blocks.findIndex((x) => x.id === id);
        if (i >= 0) bd.blocks[i] = convertBlock(b, type);
      });
      focusBlock(id, 'end');
    } else insertBlocks(id, [newBlock(type)], true);
  }

  /** Меню «+»: пустой текстовый блок меняет тип, иначе — новый блок после текущего */
  function pickType(t: BlockType, blockId: ID | undefined, replace?: boolean) {
    const id = blockId ?? anchorId();
    // «/» из пустого блока убираем
    if (replace && id && blocksNow().find((x) => x.id === id)?.text === '/') patch(id, { text: '' });
    const b = id ? blocksNow().find((x) => x.id === id) : undefined;
    if (b && (replace || (isTextBlock(b) && !b.text?.trim()))) return convert(b.id, t);
    if (t === 'image') return pickImage(id ?? null);
    if (t === 'audio') return void startRec(id ?? null);
    if (t === 'divider') return insertBlocks(id ?? null, [newBlock('divider'), newBlock('p')], true);
    insertBlocks(id ?? null, [newBlock(t)], true);
  }

  function toggleTodo() {
    const id = anchorId();
    const b = id ? blocksNow().find((x) => x.id === id) : undefined;
    if (b && isTextBlock(b)) convert(b.id, b.type === 'todo' ? 'p' : 'todo');
    else insertBlocks(id, [newBlock('todo')], true);
  }

  function format(k: FormatKind) {
    const id = lastFocus.current;
    const el = id ? tas.current.get(id) : undefined;
    if (!id || !el) return toast('Поставьте курсор в текст');
    const [open, closeM] = FORMAT_MARKS[k];
    const r = wrapSelection(el.value, el.selectionStart, el.selectionEnd, open, closeM);
    patch(id, { text: r.text });
    focusBlock(id, r.start, r.end);
  }

  function pickImage(after: ID | null) {
    void pickFile('image/*').then(async (f) => {
      if (!f) return;
      try {
        insertBlocks(after, [newBlock('image', { src: await imageFileToDataUrl(f) })]);
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Не удалось добавить изображение');
      }
    });
  }

  function transcriptToText(id: ID) {
    const b = blocksNow().find((x) => x.id === id);
    const t = b?.transcript?.trim();
    if (!t) return;
    const paras = (t.match(/[^.!?…\n]+[.!?…]*/g) ?? [t]).map((s) => s.trim()).filter(Boolean);
    // по 2–3 предложения в абзаце
    const out: Block[] = [];
    for (let i = 0; i < paras.length; i += 3) out.push(newBlock('p', { text: paras.slice(i, i + 3).join(' ') }));
    insertBlocks(id, out);
    toast('Расшифровка добавлена текстом');
  }

  async function makeTask(id: ID) {
    const b = blocksNow().find((x) => x.id === id);
    const title = stripInline(b?.text ?? '').trim();
    if (!title) return toast('Пункт пустой');
    await ensureTasks().catch(() => undefined);
    const t = addTask({ title });
    if (t) toast('Задача создана во «Входящих»', { label: 'Открыть', run: () => openTask(t.id) });
    else toast('Не удалось создать задачу');
  }

  // ---------- Ввод текста ----------

  function onText(id: ID, value: string, el: HTMLTextAreaElement) {
    const i = indexOf(id);
    if (i < 0) return;
    const b = blocksNow()[i];
    const old = b.text ?? '';
    const d = dictRef.current;
    if (d && d.id === id) {
      // ручной ввод останавливает диктовку
      d.dead = true;
      d.recog?.stop();
    }
    if (value === '/' && old === '') {
      patch(id, { text: value }, 'type');
      setMenu({ kind: 'type', anchor: el, blockId: id, replace: true });
      return;
    }
    if (b.type === 'p') {
      const sc = detectShortcut(old, value);
      if (sc) {
        if (sc.type === 'divider') return convert(id, 'divider');
        const caret = Math.max(0, el.selectionStart - (value.length - sc.text.length));
        editOpenBody((bd) => void (bd.blocks[i] = { id, type: sc.type, text: sc.text, ...(sc.type === 'todo' ? { checked: !!sc.checked } : {}) }));
        focusBlock(id, caret);
        return;
      }
    }
    // перевод строки с экранной клавиатуры (Android) — разбить блок
    if (b.type !== 'code' && countNl(value) > countNl(old)) {
      const caret = el.selectionStart;
      const nl = value.lastIndexOf('\n', caret - 1);
      if (nl >= 0) return split(id, value.slice(0, nl) + value.slice(nl + 1), nl);
    }
    patch(id, { text: value }, 'type');
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>, b: Block, el: HTMLTextAreaElement) {
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    if (mod && (key === 'z' || key === 'я') && !e.shiftKey) {
      e.preventDefault();
      undoOpenBody();
      return;
    }
    if (mod && (key === 'b' || key === 'и')) {
      e.preventDefault();
      return format('bold');
    }
    if (mod && (key === 'i' || key === 'ш')) {
      e.preventDefault();
      return format('italic');
    }
    if (mod && (key === 'k' || key === 'л')) {
      e.preventDefault();
      return format('link');
    }
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    const s = el.selectionStart;
    const en = el.selectionEnd;
    const v = el.value;
    if (e.key === 'Enter') {
      if (b.type === 'code') {
        // Enter на пустой последней строке — выход из блока кода
        if (!e.shiftKey && s === en && s === v.length && v.endsWith('\n')) {
          e.preventDefault();
          split(b.id, v.slice(0, -1), v.length - 1);
        }
        return;
      }
      e.preventDefault();
      if (e.shiftKey && (b.type === 'p' || b.type === 'quote' || b.type === 'callout')) {
        patch(b.id, { text: v.slice(0, s) + '\n' + v.slice(en) }, 'type');
        focusBlock(b.id, s + 1);
        return;
      }
      split(b.id, v.slice(0, s) + v.slice(en), s);
      return;
    }
    if (e.key === 'Backspace' && s === 0 && en === 0) {
      e.preventDefault();
      mergeBack(b.id);
      return;
    }
    if ((e.key === 'ArrowUp' && s === 0 && en === 0) || (e.key === 'ArrowDown' && s === v.length)) {
      const blocks = blocksNow();
      const i = blocks.findIndex((x) => x.id === b.id);
      const step = e.key === 'ArrowUp' ? -1 : 1;
      for (let j = i + step; j >= 0 && j < blocks.length; j += step) {
        if (isTextBlock(blocks[j])) {
          e.preventDefault();
          focusBlock(blocks[j].id, step < 0 ? 'end' : 0, undefined, false);
          return;
        }
      }
      if (step < 0) {
        e.preventDefault();
        titleRef.current?.focus();
      }
    }
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>, b: Block, el: HTMLTextAreaElement) {
    const file = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith('image/'));
    if (file) {
      e.preventDefault();
      void imageFileToDataUrl(file)
        .then((src) => insertBlocks(b.id, [newBlock('image', { src })]))
        .catch(() => toast('Не удалось вставить изображение'));
      return;
    }
    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (b.type === 'code' || !text.includes('\n')) return;
    const parsed = markdownToBlocks(text);
    if (parsed.length < 2) return;
    e.preventDefault();
    const s = el.selectionStart;
    const before = el.value.slice(0, s);
    const after = el.value.slice(el.selectionEnd);
    const first = parsed[0];
    const rest = parsed.slice(1);
    const last = rest[rest.length - 1];
    editOpenBody((bd) => {
      const i = bd.blocks.findIndex((x) => x.id === b.id);
      if (i < 0) return;
      const head: Block = !before && b.type === 'p' ? { ...first, id: b.id } : { ...b, text: before + (first.text ?? '') };
      const tail = isTextBlock(last) ? [...rest.slice(0, -1), { ...last, text: (last.text ?? '') + after }] : after ? [...rest, newBlock('p', { text: after })] : rest;
      bd.blocks.splice(i, 1, head, ...tail);
      const lt = tail[tail.length - 1];
      if (lt && isTextBlock(lt)) focusBlock(lt.id, (lt.text ?? '').length - after.length);
    });
  }

  // ---------- Голос ----------

  function toggleDictation() {
    const cur = dictRef.current;
    if (cur) {
      cur.recog?.stop();
      return;
    }
    if (!speechSupported()) return toast('Диктовка не поддерживается в этом браузере. Попробуйте Safari или Chrome.');
    if (recRef.current) return;
    let id = lastFocus.current;
    let b = id ? blocksNow().find((x) => x.id === id) : undefined;
    if (!b || !isTextBlock(b) || b.type === 'code') {
      const nb = newBlock('p');
      insertBlocks(anchorId(), [nb]);
      id = nb.id;
      b = nb;
    }
    const st: { id: ID; base: string; recog: Recognizer | null; dead?: boolean } = { id: id!, base: b.text ?? '', recog: null };
    dictRef.current = st;
    setDict({ interim: '' });
    st.recog = startRecognition({
      onText: (fin, interim) => {
        if (st.dead) return;
        setDict({ interim });
        if (!fin) return;
        const sep = st.base && !/\s$/.test(st.base) ? ' ' : '';
        const text = st.base + sep + (st.base.trim() ? fin : fin.charAt(0).toUpperCase() + fin.slice(1));
        if (indexOf(st.id) >= 0) patch(st.id, { text }, 'type');
      },
      onEnd: () => {
        if (dictRef.current === st) dictRef.current = null;
        setDict(null);
      },
      onError: (msg) => toast(msg),
    });
    if (!st.recog) {
      dictRef.current = null;
      setDict(null);
      toast('Не удалось запустить диктовку');
    }
  }

  async function startRec(after: ID | null = anchorId()) {
    if (recRef.current) return;
    if (!recordingSupported()) return toast('Запись голоса не поддерживается в этом браузере');
    dictRef.current?.recog?.stop();
    tas.current.forEach((el) => el.blur());
    try {
      const r = await startRecording({
        onTick: (sec) => setRec((x) => (x ? { ...x, sec } : x)),
        onLimit: () => {
          toast(`Запись остановлена: максимум ${MAX_AUDIO_SEC / 60} минут`);
          void stopRec();
        },
      });
      const st: RecState = { r, after, final: '', recog: null };
      recRef.current = st;
      setRec({ sec: 0, text: '' });
      // на iPhone распознавание во время записи может заглушить микрофон — там только запись
      if (speechSupported() && !isIOS()) {
        st.recog = startRecognition({
          onText: (fin, interim) => {
            st.final = fin;
            setRec((x) => (x ? { ...x, text: (fin + ' ' + interim).trim() } : x));
          },
          onEnd: () => st.ended?.(),
        });
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось начать запись');
    }
  }

  async function stopRec() {
    const st = recRef.current;
    if (!st) return;
    recRef.current = null;
    setRec((x) => (x ? { ...x, saving: true } : x));
    const waitText = st.recog
      ? new Promise<void>((res) => {
          st.ended = res;
          st.recog!.stop();
          setTimeout(res, 1800);
        })
      : Promise.resolve();
    try {
      const [{ src, duration }] = await Promise.all([st.r.stop(), waitText]);
      if (useNotes.getState().openBody) insertBlocks(st.after, [newBlock('audio', { src, duration, ...(st.final.trim() ? { transcript: st.final.trim() } : {}) })]);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось сохранить запись');
    } finally {
      setRec(null);
    }
  }

  function cancelRec() {
    const st = recRef.current;
    recRef.current = null;
    st?.r.cancel();
    st?.recog?.abort();
    setRec(null);
  }

  // ---------- ИИ ----------

  async function runAI(kind: NoteAIKind) {
    const b = useNotes.getState().openBody;
    const id = openId;
    if (!b || !id) return;
    if (isBodyEmpty(b)) return toast('Заметка пустая');
    const ac = new AbortController();
    aiAbort.current = ac;
    setAi({ kind, chars: 0 });
    try {
      const res = await runNoteAI(kind, b, (s) => setAi((x) => (x ? { ...x, chars: s.length } : x)), ac.signal);
      if (useNotes.getState().openId !== id) return;
      editOpenBody((bd) => void (bd.blocks = applyNoteAI(kind, bd.blocks, res)));
      toast(kind === 'improve' ? 'Текст улучшен' : 'Готово', { label: 'Отменить', run: undoOpenBody });
    } catch (e) {
      if (e instanceof AIError) {
        if (e.message === 'Остановлено') return;
        toast(e.message, /API-ключ/.test(e.message) ? { label: 'Настройки', run: () => useApp.getState().go('settings') } : undefined);
      } else toast('Ошибка ИИ: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      if (aiAbort.current === ac) aiAbort.current = null;
      setAi(null);
    }
  }

  // ---------- Заметка целиком ----------

  async function share() {
    const b = useNotes.getState().openBody;
    if (!b) return;
    const text = noteToMarkdown(b);
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: b.title || 'Заметка', text });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
      }
    }
    await copyText();
  }

  async function copyText() {
    const b = useNotes.getState().openBody;
    if (!b) return;
    try {
      await navigator.clipboard.writeText(noteToMarkdown(b));
      toast('Текст заметки скопирован');
    } catch {
      toast('Не удалось скопировать');
    }
  }

  function exportMd() {
    const b = useNotes.getState().openBody;
    if (!b) return;
    void downloadText(noteToMarkdown(b, { media: true }), safeFilename(b.title || 'Заметка') + '.md', 'text/markdown').catch(() => toast('Не удалось сохранить файл'));
  }

  async function newFolderAndMove() {
    if (!openId) return;
    const name = (await askText('Новая папка', { placeholder: 'Название' }))?.trim();
    if (!name) return;
    const f = addFolder(name);
    if (f) moveNote(openId, f.id);
  }

  // ---------- Обработчики блоков (стабильный объект) ----------

  const api = useRef<BlockCtx>(null as unknown as BlockCtx);
  api.current = {
    register: (id, el) => {
      if (el) tas.current.set(id, el);
      else if (tas.current.get(id)?.isConnected === false) tas.current.delete(id);
    },
    onFocus: (id) => {
      lastFocus.current = id;
      setFocusId(id);
      setSelId(null);
    },
    onText,
    onKeyDown,
    onPaste,
    toggle: (id) => {
      const b = blocksNow().find((x) => x.id === id);
      if (b) patch(id, { checked: !b.checked });
    },
    patch,
    menu: (id, anchor) => setMenu({ kind: 'block', anchor, blockId: id }),
    select: (id) => {
      setSelId(id);
      lastFocus.current = null;
    },
    transcriptToText,
    viewImage: (src) => setViewer(src),
  };
  const ctx = useMemo<BlockCtx>(
    () => ({
      register: (id, el) => api.current.register(id, el),
      onFocus: (id) => api.current.onFocus(id),
      onText: (id, v, el) => api.current.onText(id, v, el),
      onKeyDown: (e, b, el) => api.current.onKeyDown(e, b, el),
      onPaste: (e, b, el) => api.current.onPaste(e, b, el),
      toggle: (id) => api.current.toggle(id),
      patch: (id, p, k) => api.current.patch(id, p, k),
      menu: (id, a) => api.current.menu(id, a),
      select: (id) => api.current.select(id),
      transcriptToText: (id) => api.current.transcriptToText(id),
      viewImage: (src) => api.current.viewImage(src),
    }),
    [],
  );

  if (!openId) return null;
  if (!body || !meta) {
    return (
      <div className="nt-editor">
        <div className="loading">
          <div className="spinner" />
        </div>
      </div>
    );
  }

  const nums = listNumbers(body.blocks);
  const menuBlock = menu?.blockId ? body.blocks.find((b) => b.id === menu.blockId) : undefined;
  const menuBlockIdx = menuBlock ? body.blocks.indexOf(menuBlock) : -1;
  const focusedBlock = focusId ? body.blocks.find((b) => b.id === focusId) : undefined;
  const keep = (e: { preventDefault(): void }) => e.preventDefault();
  const tb = (label: string, icon: ReactNode, onClick: (el: HTMLElement) => void, opts: { active?: boolean; disabled?: boolean; cls?: string } = {}) => (
    <button
      className={`nt-tool${opts.active ? ' active' : ''}${opts.cls ? ' ' + opts.cls : ''}`}
      onPointerDown={keep}
      onMouseDown={keep}
      onClick={(e) => onClick(e.currentTarget)}
      disabled={opts.disabled}
      aria-label={label}
      title={label}
    >
      {icon}
    </button>
  );

  return (
    <div className={`nt-editor${kb ? ' kb-open' : ''}`}>
      <div className="nt-ed-head">
        <button className="icon-btn nt-back" onClick={() => void close()} aria-label="Назад к заметкам">
          <ChevronLeft />
          <span className="nt-back-text">Заметки</span>
        </button>
        <button className="nt-folder-chip" onClick={(e) => setMenu({ kind: 'folder', anchor: e.currentTarget })} style={folder ? ({ '--fc': folder.color } as CSSProperties) : undefined}>
          {folder ? (folder.emoji ? folder.emoji + ' ' : '') + folder.name : 'Без папки'}
          <ChevronDown size={14} />
        </button>
        <div className="grow" />
        <button className="icon-btn nt-desk-only" onClick={undoOpenBody} disabled={!canUndo} aria-label="Отменить">
          <Undo2 />
        </button>
        <button className={`icon-btn${meta.pinned ? ' active' : ''}`} onClick={() => togglePin(meta.id)} aria-label={meta.pinned ? 'Открепить' : 'Закрепить'}>
          {meta.pinned ? <PinOff /> : <Pin />}
        </button>
        <button className="icon-btn" onClick={(e) => setMenu({ kind: 'note', anchor: e.currentTarget })} aria-label="Ещё">
          <MoreHorizontal />
        </button>
      </div>

      <div className="nt-scroll">
        <div className="nt-doc">
          <textarea
            ref={titleRef}
            className="nt-title"
            rows={1}
            value={body.title}
            placeholder="Заголовок"
            enterKeyHint="next"
            onChange={(e) => editOpenBody((bd) => void (bd.title = e.target.value.replace(/\n/g, ' ')), 'type')}
            onFocus={() => setFocusId(null)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== 'ArrowDown') return;
              e.preventDefault();
              const first = body.blocks[0];
              if (first && isTextBlock(first)) focusBlock(first.id, 0, undefined, false);
              else {
                const p = newBlock('p');
                editOpenBody((bd) => void bd.blocks.unshift(p));
                focusBlock(p.id, 0);
              }
            }}
          />
          <div className="nt-info faint tiny">
            {noteDate(meta.updatedAt)}
            {!!meta.wordCount && ` · ${meta.wordCount} сл.`}
            {!!meta.todoTotal && ` · ✓ ${meta.todoDone ?? 0}/${meta.todoTotal}`}
          </div>
          <div className="nt-blocks">
            {body.blocks.map((b, i) => (
              <BlockView key={b.id} b={b} num={nums[i]} sole={body.blocks.length === 1 && b.type === 'p'} selected={selId === b.id} ctx={ctx} />
            ))}
          </div>
          <div
            className="nt-tail"
            onClick={() => {
              const last = body.blocks[body.blocks.length - 1];
              if (last && isTextBlock(last) && !last.text) return focusBlock(last.id, 0, undefined, false);
              const p = newBlock('p');
              editOpenBody((bd) => void bd.blocks.push(p));
              focusBlock(p.id, 0);
            }}
          />
        </div>
      </div>

      {(dict || ai) && (
        <div className="nt-status">
          {dict && (
            <>
              <span className="nt-rec-dot" />
              <span className="grow ellipsis">{dict.interim || 'Говорите…'}</span>
              <button className="btn btn-sm" onPointerDown={keep} onClick={toggleDictation}>
                Готово
              </button>
            </>
          )}
          {ai && (
            <>
              <Loader2 size={16} className="spin" />
              <span className="grow ellipsis">
                {NOTE_AI_LABELS[ai.kind]}… {ai.chars ? `${ai.chars} симв.` : ''}
              </span>
              <button className="btn btn-sm" onClick={() => aiAbort.current?.abort()}>
                Стоп
              </button>
            </>
          )}
        </div>
      )}

      {rec ? (
        <div className="nt-toolbar nt-recbar">
          <button className="icon-btn" onClick={cancelRec} disabled={rec.saving} aria-label="Отменить запись">
            <X />
          </button>
          <span className="nt-rec-dot" />
          <span className="nt-rec-time">
            {fmtDuration(rec.sec)} <span className="faint">/ {fmtDuration(MAX_AUDIO_SEC)}</span>
          </span>
          <span className="grow ellipsis small muted">{rec.saving ? 'Сохраняю…' : rec.text || 'Идёт запись'}</span>
          <button className="nt-rec-stop" onClick={() => void stopRec()} disabled={rec.saving} aria-label="Остановить и сохранить">
            <Square size={16} fill="currentColor" />
          </button>
        </div>
      ) : (
        <div className="nt-toolbar">
          <div className="nt-tools">
            {tb('Добавить блок', <Plus />, (el) => setMenu({ kind: 'type', anchor: el }))}
            {tb('Чек-лист', <SquareCheck />, toggleTodo, { active: focusedBlock?.type === 'todo' })}
            {tb('Оформление', <Bold />, (el) => setMenu({ kind: 'format', anchor: el }))}
            {tb('Фото', <ImageIcon />, () => pickImage(anchorId()))}
            {tb('Диктовка', <Mic />, toggleDictation, { active: !!dict })}
            {tb('Голосовая запись', <AudioLines />, () => void startRec())}
            {tb('Отменить', <Undo2 />, undoOpenBody, { disabled: !canUndo })}
            {tb('Действия с блоком', <MoreHorizontal />, (el) => {
              const id = anchorId();
              if (id && blocksNow().some((b) => b.id === id)) setMenu({ kind: 'block', anchor: el, blockId: id });
              else toast('Выберите блок');
            })}
          </div>
          {kb && tb('Скрыть клавиатуру', <ChevronDown />, () => (document.activeElement as HTMLElement | null)?.blur(), { cls: 'nt-tool-kb' })}
        </div>
      )}

      {menu?.kind === 'type' && (
        <NtMenu anchor={menu.anchor} onClose={() => setMenu(null)} keepFocus>
          <TypeMenuItems current={menu.replace ? undefined : focusedBlock?.type} withMedia onPick={(t) => pickType(t, menu.blockId, menu.replace)} />
        </NtMenu>
      )}
      {menu?.kind === 'format' && (
        <NtMenu anchor={menu.anchor} onClose={() => setMenu(null)} keepFocus>
          <FormatMenuItems onPick={format} />
        </NtMenu>
      )}
      {menu?.kind === 'block' && menuBlock && (
        <NtMenu anchor={menu.anchor} onClose={() => setMenu(null)} keepFocus>
          <BlockMenuItems
            b={menuBlock}
            first={menuBlockIdx === 0}
            last={menuBlockIdx === body.blocks.length - 1}
            a={{
              convert: (t) => convert(menuBlock.id, t),
              move: (dir) => moveBlock(menuBlock.id, dir),
              duplicate: () => insertBlocks(menuBlock.id, cloneBlocks([menuBlock])),
              remove: () => removeBlock(menuBlock.id),
              makeTask: () => void makeTask(menuBlock.id),
              toText: () => transcriptToText(menuBlock.id),
              view: () => menuBlock.src && setViewer(menuBlock.src),
            }}
          />
        </NtMenu>
      )}
      {menu?.kind === 'folder' && data && (
        <NtMenu anchor={menu.anchor} onClose={() => setMenu(null)}>
          <MenuLabel>Папка</MenuLabel>
          <MenuItem icon={<FolderInput size={17} />} label="Без папки" active={!meta.folderId} onClick={() => moveNote(meta.id, undefined)} />
          {sortedFolders(data).map((f) => (
            <MenuItem key={f.id} icon={<span className="nt-fdot" style={{ background: f.color }}>{f.emoji}</span>} label={f.name} active={meta.folderId === f.id} onClick={() => moveNote(meta.id, f.id)} />
          ))}
          <MenuSep />
          <MenuItem icon={<FolderPlus size={17} />} label="Новая папка…" onClick={() => void newFolderAndMove()} />
        </NtMenu>
      )}
      {menu?.kind === 'note' && (
        <NtMenu anchor={menu.anchor} onClose={() => setMenu(null)}>
          <MenuItem icon={meta.pinned ? <PinOff size={17} /> : <Pin size={17} />} label={meta.pinned ? 'Открепить' : 'Закрепить'} onClick={() => togglePin(meta.id)} />
          <MenuItem icon={<FolderInput size={17} />} label="Переместить в папку" onClick={() => setTimeout(() => setMenu({ kind: 'folder', anchor: menu.anchor }), 0)} />
          <MenuItem icon={<Share2 size={17} />} label="Поделиться" onClick={() => void share()} />
          <MenuItem icon={<Copy size={17} />} label="Копировать текст" onClick={() => void copyText()} />
          <MenuItem icon={<Download size={17} />} label="Экспорт в Markdown" onClick={exportMd} />
          <MenuSep />
          {(Object.keys(NOTE_AI_LABELS) as NoteAIKind[]).map((k) => (
            <MenuItem key={k} icon={<Sparkles size={17} />} label={NOTE_AI_LABELS[k]} onClick={() => void runAI(k)} />
          ))}
          <MenuSep />
          <MenuItem
            icon={<Copy size={17} />}
            label="Дублировать"
            onClick={() =>
              void duplicateNote(meta.id).then((m) => {
                if (m) void openNote(m.id);
              })
            }
          />
          <MenuItem icon={<Trash2 size={17} />} label="Удалить" danger onClick={() => trashNote(meta.id)} />
        </NtMenu>
      )}

      {viewer && (
        <div className="modal-backdrop nt-viewer" onPointerDown={(e) => e.target === e.currentTarget && setViewer(null)}>
          <img src={viewer} alt="" onClick={() => setViewer(null)} />
          <button className="icon-btn nt-viewer-close" onClick={() => setViewer(null)} aria-label="Закрыть">
            <X />
          </button>
        </div>
      )}
    </div>
  );
}
