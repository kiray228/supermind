import { useState } from 'react';
import { Check, CheckCircle2, Copy, Flag, ListPlus, NotebookPen, RotateCcw, Sparkles, Target, Wallet, CalendarArrowUp, X } from 'lucide-react';
import { toast } from '../store/appStore';
import { describeAction, executeAction, type ActionItem, type ActionView } from './actions';
import { patchMessage, useChat, type ChatMessage } from './history';
import { Markdown } from './Markdown';

const KIND_ICON: Record<ActionView['kind'], typeof Check> = {
  task: ListPlus,
  done: CheckCircle2,
  move: CalendarArrowUp,
  note: NotebookPen,
  money: Wallet,
  goal: Target,
};

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Скопировано');
  } catch {
    toast('Не удалось скопировать');
  }
}

/** Выполнить действия сообщения (по одному или все) и сохранить отметки */
async function runActions(msgId: string, keys: string[]) {
  const msg = useChat.getState().messages.find((m) => m.id === msgId);
  if (!msg?.actions) return;
  const results = new Map<string, { ok: boolean; info: string }>();
  for (const a of msg.actions) {
    if (!keys.includes(a.key) || a.status === 'done') continue;
    try {
      results.set(a.key, await executeAction(a));
    } catch (e) {
      results.set(a.key, { ok: false, info: e instanceof Error ? e.message : 'Ошибка' });
    }
  }
  if (!results.size) return;
  // перечитать: за время выполнения сообщение могло измениться
  const cur = useChat.getState().messages.find((m) => m.id === msgId);
  if (!cur?.actions) return;
  patchMessage(msgId, {
    actions: cur.actions.map((a) => {
      const r = results.get(a.key);
      return r ? { ...a, status: r.ok ? 'done' : 'error', info: r.info } : a;
    }),
  });
  const ok = [...results.values()].filter((r) => r.ok).length;
  if (results.size > 1) toast(ok === results.size ? `Готово: ${ok}` : `Выполнено ${ok} из ${results.size}`);
}

function ActionCard({ a, onRun, busy }: { a: ActionItem; onRun: () => void; busy: boolean }) {
  const v = describeAction(a);
  const Icon = KIND_ICON[v.kind];
  const done = a.status === 'done';
  return (
    <div className={`as-act${done ? ' done' : ''}${a.status === 'error' ? ' err' : ''}`}>
      <span className={`as-act-ico k-${v.kind}`}>
        <Icon size={17} />
      </span>
      <div className="grow">
        <div className="as-act-label">{v.label}</div>
        <div className="as-act-title">{v.title}</div>
        {(a.info || v.meta) && <div className="as-act-meta">{a.status ? a.info : v.meta}</div>}
      </div>
      {done ? (
        <span className="as-act-ok" aria-label="Выполнено">
          <Check size={16} />
        </span>
      ) : (
        <button className="btn btn-sm as-act-run" onClick={onRun} disabled={busy}>
          {a.status === 'error' ? 'Повторить' : 'Выполнить'}
        </button>
      )}
    </div>
  );
}

function ActionList({ msg }: { msg: ChatMessage }) {
  const [busy, setBusy] = useState(false);
  const actions = msg.actions ?? [];
  const pending = actions.filter((a) => a.status !== 'done');
  const run = async (keys: string[]) => {
    setBusy(true);
    try {
      await runActions(msg.id, keys);
    } finally {
      setBusy(false);
    }
  };
  const dismiss = () => patchMessage(msg.id, { actions: actions.filter((a) => a.status === 'done') });
  return (
    <div className="as-acts">
      {actions.map((a) => (
        <ActionCard key={a.key} a={a} busy={busy} onRun={() => void run([a.key])} />
      ))}
      {pending.length > 1 && (
        <div className="as-acts-bar">
          <button className="btn btn-primary btn-sm" onClick={() => void run(pending.map((a) => a.key))} disabled={busy}>
            <Check size={15} /> Выполнить все ({pending.length})
          </button>
          <button className="btn btn-ghost btn-sm" onClick={dismiss} disabled={busy}>
            <X size={15} /> Не нужно
          </button>
        </div>
      )}
    </div>
  );
}

export function MessageView({ msg, onRetry }: { msg: ChatMessage; onRetry?: () => void }) {
  if (msg.role === 'user')
    return (
      <div className="as-msg user">
        <div className="as-bubble">{msg.text}</div>
      </div>
    );
  return (
    <div className={`as-msg bot${msg.error ? ' error' : ''}`}>
      <span className="as-avatar" aria-hidden>
        {msg.error ? <Flag size={15} /> : <Sparkles size={15} />}
      </span>
      <div className="as-bot-body">
        {msg.error ? <div className="as-err-text">{msg.text}</div> : msg.text && <Markdown text={msg.text} />}
        {!!msg.actions?.length && <ActionList msg={msg} />}
        <div className="as-msg-tools">
          {!msg.error && msg.text && (
            <button className="as-tool" onClick={() => void copyText(msg.text)} aria-label="Копировать">
              <Copy size={14} /> Копировать
            </button>
          )}
          {onRetry && (
            <button className="as-tool" onClick={onRetry}>
              <RotateCcw size={14} /> Повторить
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function StreamingView({ text }: { text: string }) {
  return (
    <div className="as-msg bot streaming">
      <span className="as-avatar" aria-hidden>
        <Sparkles size={15} />
      </span>
      <div className="as-bot-body">
        {text ? (
          <Markdown text={text} className="as-md-live" />
        ) : (
          <div className="as-typing" aria-label="Ассистент думает">
            <i />
            <i />
            <i />
          </div>
        )}
      </div>
    </div>
  );
}
