/** «Текст с фото»: выбрать или снять фото → распознанный текст для проверки → новая заметка, вставка в заметку или копия */
import { useEffect, useRef, useState } from 'react';
import { Camera, Copy, Images, Loader2, ScanText, ShieldCheck, StickyNote, TextCursorInput } from 'lucide-react';
import { toast } from '../../store/appStore';
import { isNative } from '../../platform';
import { t } from '../../i18n/index';
import { newBlock, type Block } from '../model';
import { joinTexts, ocrNoteParts, ocrTextToBlocks } from '../ocrCore';
import { OcrError, canScanDocument, ocrConsent, ocrEngine, prepareImage, recognizeText, scanDocument } from '../ocr';

export interface OcrSheetProps {
  /** вставить в открытую заметку (кнопка «Вставить в заметку»); без него — только новая заметка */
  onInsert?: (blocks: Block[]) => void;
  /** фото уже есть (прислали через «Поделиться») — сразу распознать */
  images?: string[];
  /** папка новой заметки */
  folderId?: string;
  onClose: () => void;
}

type Stage = 'pick' | 'busy' | 'review';

/** Скрытый input: capture — сразу камера (на телефоне), иначе — галерея и файлы */
function pickPhoto(capture: boolean, onFile: (f: File) => void) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  if (capture) input.setAttribute('capture', 'environment');
  input.style.cssText = 'position:fixed;left:-10000px;top:0;opacity:0';
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    input.remove();
    if (f) onFile(f);
  });
  input.addEventListener('cancel', () => input.remove());
  document.body.appendChild(input);
  input.click();
}

export default function OcrSheet({ onInsert, images: given, folderId, onClose }: OcrSheetProps) {
  const engine = ocrEngine();
  const [stage, setStage] = useState<Stage>(given?.length ? 'busy' : 'pick');
  const [images, setImages] = useState<string[]>(given ?? []);
  const [text, setText] = useState('');
  const [attach, setAttach] = useState(false);
  const [canScan, setCanScan] = useState(false);
  const ac = useRef<AbortController | null>(null);
  const touch = isNative() || (typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches);

  useEffect(() => {
    void canScanDocument().then(setCanScan);
    return () => ac.current?.abort();
  }, []);

  const close = () => {
    ac.current?.abort();
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Распознать готовые снимки (data URL) по очереди */
  const run = async (pics: string[]) => {
    const c = (ac.current = new AbortController());
    setImages(pics);
    setStage('busy');
    try {
      const out: string[] = [];
      for (const p of pics) out.push(await recognizeText(p, { engine, signal: c.signal }));
      if (c.signal.aborted) return;
      const all = joinTexts(out);
      if (!all) {
        toast(t('Текст на фото не найден — попробуйте снять ближе и ровнее'));
        setStage('pick');
        return;
      }
      setText(all);
      setStage('review');
    } catch (e) {
      if (c.signal.aborted) return;
      toast(e instanceof Error ? e.message : t('Не удалось распознать текст'));
      setStage('pick');
    }
  };

  // фото прислали — распознать сразу
  useEffect(() => {
    if (given?.length) void run(given);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fromFile = async (f: File) => {
    // согласие — до сжатия: без него фото никуда не уйдёт и ждать нечего
    if (!(await ocrConsent(engine))) return;
    setImages([]);
    setStage('busy');
    try {
      void run([await prepareImage(f)]);
    } catch (e) {
      toast(e instanceof OcrError ? e.message : t('Не удалось открыть изображение'));
      setStage('pick');
    }
  };

  // компьютер: фото из буфера обмена (Ctrl+V, например снимок экрана)
  useEffect(() => {
    if (stage !== 'pick') return;
    const onPaste = (e: ClipboardEvent) => {
      const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith('image/'));
      if (!f) return;
      e.preventDefault();
      void fromFile(f);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  const scan = async () => {
    try {
      const r = await scanDocument();
      if (!r) return;
      if (r.image) setImages([r.image]);
      if (!r.text.trim()) {
        toast(t('Текст на фото не найден — попробуйте снять ближе и ровнее'));
        return;
      }
      setText(r.text);
      setStage('review');
    } catch (e) {
      toast(e instanceof Error ? e.message : t('Не удалось открыть сканер'));
    }
  };

  const imageBlocks = () => (attach ? images.map((src) => newBlock('image', { src })) : []);

  const saveNote = async () => {
    const body = text.trim();
    if (!body) return;
    const { createNote, ensureNotes, openNote } = await import('../store');
    await ensureNotes();
    const { title, blocks } = ocrNoteParts(body);
    const m = createNote({ title, blocks: [...blocks, ...imageBlocks()], folderId });
    if (!m) return;
    onClose();
    const { nav } = await import('../../search/sources');
    await openNote(m.id);
    await nav('notes');
    toast(t('Заметка создана'));
  };

  const insert = () => {
    const body = text.trim();
    if (!body || !onInsert) return;
    onInsert([...ocrTextToBlocks(body), ...imageBlocks()]);
    onClose();
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text.trim());
      toast(t('Текст скопирован'));
    } catch {
      toast(t('Не удалось скопировать'));
    }
  };

  const privacy =
    engine === 'device'
      ? t('Текст распознаётся прямо на iPhone — фото никуда не отправляется.')
      : engine === 'claude'
        ? t('Фото отправится на распознавание в Anthropic (Claude) по вашему ключу.')
        : t('Фото отправится на распознавание: через сервер SuperMind в Google Gemini. На сервере SuperMind фото не сохраняется.');
  const big = { flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: 'auto', padding: '14px 6px', whiteSpace: 'normal', lineHeight: 1.2 } as const;

  return (
    // z-index ниже окон подтверждения (100): окно согласия на ИИ должно быть поверх
    <div className="modal-backdrop" style={{ zIndex: 99 }} onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" style={{ width: 'min(520px,100%)' }} role="dialog" aria-label={t('Текст с фото')}>
        <h2>{t('Текст с фото')}</h2>
        {stage === 'pick' && (
          <>
            <p className="muted" style={{ margin: '6px 0 0' }}>
              {t('Сфотографируйте страницу, доску или чек — или выберите снимок экрана. Текст можно будет поправить перед сохранением.')}
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              {canScan && (
                <button className="btn btn-primary" style={big} onClick={() => void scan()}>
                  <ScanText size={22} />
                  {t('Сканировать документ')}
                </button>
              )}
              {touch && (
                <button className={canScan ? 'btn' : 'btn btn-primary'} style={big} onClick={() => pickPhoto(true, (f) => void fromFile(f))}>
                  <Camera size={22} />
                  {t('Сфотографировать')}
                </button>
              )}
              <button className={canScan || touch ? 'btn' : 'btn btn-primary'} style={big} onClick={() => pickPhoto(false, (f) => void fromFile(f))}>
                <Images size={22} />
                {t('Выбрать фото')}
              </button>
            </div>
            {!touch && <p className="muted small" style={{ margin: '10px 0 0' }}>{t('Или вставьте картинку из буфера обмена: Ctrl+V')}</p>}
            <p className="muted small" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', margin: '14px 0 0' }}>
              <ShieldCheck size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{privacy}</span>
            </p>
          </>
        )}
        {stage === 'busy' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '18px 0 6px' }}>
            {images[0] && <img src={images[0]} alt="" style={{ maxHeight: 160, maxWidth: '100%', borderRadius: 12, opacity: 0.85 }} />}
            <span className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <Loader2 size={18} className="spin" />
              {engine === 'device' ? t('Распознаю текст…') : t('Фото отправлено на распознавание…')}
            </span>
          </div>
        )}
        {stage === 'review' && (
          <>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 10 }}>
              {images[0] && <img src={images[0]} alt="" style={{ height: 64, borderRadius: 10, flexShrink: 0 }} />}
              <p className="muted small" style={{ margin: 0 }}>
                {t('Проверьте текст: распознавание иногда ошибается в буквах и цифрах.')}
              </p>
            </div>
            <textarea className="textarea" style={{ marginTop: 12, minHeight: 200 }} rows={10} value={text} onChange={(e) => setText(e.target.value)} aria-label={t('Распознанный текст')} />
            {images.length > 0 && (
              <label className="small" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
                <input type="checkbox" checked={attach} onChange={(e) => setAttach(e.target.checked)} /> {t('Добавить фото в заметку')}
              </label>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
              {onInsert && (
                <button className="btn btn-primary" style={{ flex: '1 1 auto', gap: 8 }} disabled={!text.trim()} onClick={insert}>
                  <TextCursorInput size={18} />
                  {t('Вставить в заметку')}
                </button>
              )}
              <button className={onInsert ? 'btn' : 'btn btn-primary'} style={{ flex: '1 1 auto', gap: 8 }} disabled={!text.trim()} onClick={() => void saveNote()}>
                <StickyNote size={18} />
                {t('Сохранить как заметку')}
              </button>
              <button className="btn" style={{ flex: '0 1 auto', gap: 8 }} disabled={!text.trim()} onClick={() => void copy()}>
                <Copy size={18} />
                {t('Копировать')}
              </button>
            </div>
          </>
        )}
        <div className="modal-actions" style={{ marginTop: 10 }}>
          {stage === 'review' && (
            <button className="btn btn-ghost" onClick={() => setStage('pick')}>
              {t('Другое фото')}
            </button>
          )}
          <button className="btn btn-ghost" onClick={close}>
            {t('Отмена')}
          </button>
        </div>
      </div>
    </div>
  );
}
