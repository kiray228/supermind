import { useEffect, useState } from 'react';
import { CalendarDays, LayoutTemplate, Loader2, Pencil, Plus, Sparkles, X } from 'lucide-react';
import { onBack } from '../../ui/dialogs';
import { toast } from '../../store/appStore';
import { normTitle } from '../links';
import { isBodyEmpty } from '../model';
import { editOpenBody, openNote, updateNoteMeta, useNotes } from '../store';
import { DAILY_TEMPLATE, TEMPLATE_PRESETS, TEMPLATE_VARS, templateName } from '../templatesCore';
import { addPresetTemplates, closeTemplates, createFromTemplate, fromTemplate, listTemplates, newTemplate, useTemplatesUi, varsNow } from '../templates';

/** Окно шаблонов: новая заметка по шаблону или вставка шаблона в открытую заметку. Монтируется в «Заметках» */
export function TemplatesLayer() {
  const open = useTemplatesUi((s) => s.open);
  return open ? <TemplatesSheet /> : null;
}

function TemplatesSheet() {
  const insert = useTemplatesUi((s) => s.insert);
  const folderId = useTemplatesUi((s) => s.folderId);
  const data = useNotes((s) => s.data);
  const [busy, setBusy] = useState<string | null>(null);
  const list = listTemplates(data);
  const have = new Set(list.map((n) => normTitle(templateName(n.title))));
  const missing = TEMPLATE_PRESETS.filter((p) => !have.has(normTitle(templateName(p.title))));
  const daily = normTitle(DAILY_TEMPLATE);

  useEffect(() => onBack(() => (closeTemplates(), true)), []);

  const pick = async (id: string) => {
    setBusy(id);
    try {
      if (insert) {
        const s = useNotes.getState();
        const empty = !!s.openBody && isBodyEmpty(s.openBody);
        const r = await fromTemplate(id, varsNow({ ...(empty ? {} : { title: s.openBody?.title ?? '' }) }));
        if (!r) return;
        // пустая заметка становится заметкой по шаблону: и название, и связь с шаблоном
        if (empty && s.openId) {
          if (r.title) editOpenBody((b) => void (b.title = r.title));
          updateNoteMeta(s.openId, { tpl: id });
        }
        insert(r.blocks);
      } else await createFromTemplate(id, { folderId });
      closeTemplates();
    } finally {
      setBusy(null);
    }
  };

  const edit = (id: string) => {
    closeTemplates();
    void openNote(id);
  };

  const presets = async () => {
    setBusy('presets');
    try {
      const n = await addPresetTemplates();
      toast(n ? `Добавлено шаблонов: ${n}` : 'Готовые шаблоны уже есть');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && closeTemplates()}>
      <div className="modal nt-dups nt-tpl" role="dialog" aria-label="Шаблоны">
        <div className="nt-ask-head">
          <LayoutTemplate size={19} className="nt-ask-logo" />
          <h2 className="grow">{insert ? 'Вставить шаблон' : 'Новая заметка по шаблону'}</h2>
          <button className="icon-btn" onClick={closeTemplates} aria-label="Закрыть">
            <X size={20} />
          </button>
        </div>
        {list.length === 0 ? (
          <p className="nt-dups-empty">
            Шаблонов пока нет. Шаблон — обычная заметка в папке «Шаблоны»: напишите её один раз, и новые заметки будут начинаться с неё. Начните с готовых — их можно поменять под себя.
          </p>
        ) : (
          <div className="nt-dups-list nt-tpl-list">
            {list.map((n) => {
              const name = templateName(n.title);
              const isDaily = normTitle(name) === daily;
              return (
                <div key={n.id} className="nt-tpl-row">
                  <button className="nt-tpl-pick" disabled={!!busy} onClick={() => void pick(n.id)}>
                    <span className="nt-hub-ic">{busy === n.id ? <Loader2 size={18} className="spin" /> : isDaily ? <CalendarDays size={18} /> : <LayoutTemplate size={18} />}</span>
                    <span className="grow nt-hub-text">
                      <b>{name}</b>
                      <span>{isDaily ? 'Так оформляется заметка дня' : n.preview || 'Пустой шаблон'}</span>
                    </span>
                  </button>
                  <button className="icon-btn" onClick={() => edit(n.id)} aria-label={`Изменить шаблон «${name}»`} title="Изменить шаблон">
                    <Pencil size={16} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <div className="nt-tpl-actions">
          {missing.length > 0 && (
            <button className="nt-ai-btn" disabled={!!busy} onClick={() => void presets()}>
              {busy === 'presets' ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />}
              Готовые: {missing.map((p) => templateName(p.title)).join(', ')}
            </button>
          )}
          <button
            className="nt-ai-undo"
            onClick={() => {
              closeTemplates();
              void newTemplate();
            }}
          >
            <Plus size={14} /> Свой шаблон
          </button>
        </div>
        <p className="nt-rv-hint nt-tpl-vars">
          В шаблоне можно писать: {TEMPLATE_VARS.map((v, i) => (
            <span key={v.name} title={v.hint}>
              {i ? ', ' : ''}
              <code>{`{{${v.name}}}`}</code>
            </span>
          ))}{' '}
          — подставятся сами. Шаблон «{DAILY_TEMPLATE}» оформляет заметку дня.
        </p>
      </div>
    </div>
  );
}
