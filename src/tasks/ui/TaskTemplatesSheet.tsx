import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { LayoutTemplate, ListChecks, Pencil, Trash2, X } from 'lucide-react';
import { onBack, askText } from '../../ui/dialogs';
import { toast } from '../../store/appStore';
import type { TaskItem } from '../model';
import { useTasks } from '../store';
import { deleteTaskTemplate, renameTaskTemplate, taskFromTemplate } from '../templates';

/** Список шаблонов задач: нажатие — новая задача по шаблону (с датой и списком текущего раздела) */
export function TaskTemplatesSheet({ preset, onClose }: { preset: Partial<TaskItem>; onClose: () => void }) {
  const templates = useTasks((s) => s.data?.templates ?? []);
  const sorted = [...templates].sort((a, b) => b.createdAt - a.createdAt);
  useEffect(() => onBack(() => (onClose(), true)), [onClose]);

  const use = (id: string) => {
    const t = taskFromTemplate(id, preset);
    onClose();
    if (t) toast(`Задача «${t.title}» создана по шаблону`);
  };

  return createPortal(
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal tk-tpl-sheet" role="dialog" aria-label="Шаблоны задач">
        <div className="tk-tpl-head">
          <LayoutTemplate size={18} />
          <h3 className="grow">Шаблоны задач</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <X size={18} />
          </button>
        </div>
        {sorted.length === 0 ? (
          <p className="muted small tk-tpl-empty">
            Шаблонов пока нет. Откройте задачу, которую делаете снова и снова (сборы в поездку, отчёт, уборка), и в меню «⋯» выберите «Сохранить как шаблон» — название, описание, чек-лист, теги и время сохранятся.
          </p>
        ) : (
          <div className="tk-tpl-list">
            {sorted.map((t) => (
              <div key={t.id} className="tk-tpl-row">
                <button className="tk-tpl-use" onClick={() => use(t.id)}>
                  <span className="tk-tpl-name ellipsis">{t.name}</span>
                  <span className="tk-tpl-sub ellipsis">
                    {t.checklist.length > 0 && (
                      <>
                        <ListChecks size={12} /> {t.checklist.length} ·{' '}
                      </>
                    )}
                    {[t.time, ...t.tags.map((g) => '#' + g)].filter(Boolean).join(' · ') || (t.title !== t.name ? t.title : 'Задача')}
                  </span>
                </button>
                <button
                  className="icon-btn"
                  aria-label="Переименовать шаблон"
                  onClick={async () => {
                    const n = await askText('Название шаблона', { value: t.name });
                    if (n?.trim()) renameTaskTemplate(t.id, n);
                  }}
                >
                  <Pencil size={16} />
                </button>
                <button
                  className="icon-btn"
                  aria-label="Удалить шаблон"
                  onClick={() => {
                    deleteTaskTemplate(t.id);
                    toast(`Шаблон «${t.name}» удалён`);
                  }}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
