import { useState } from 'react';
import { Sparkles, Sun, Moon, Monitor, Download, Upload, Trash2, Smartphone, Eye, EyeOff, CheckCircle2, Info } from 'lucide-react';
import { get, set, keys, clear } from 'idb-keyval';
import { useApp, toast } from '../store/appStore';
import { AI_MODELS, streamText, AIError } from '../ai/claude';
import { downloadBlob, pickFile } from '../io/download';
import { confirmDialog } from '../ui/dialogs';

export default function Settings() {
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  const [key, setKey] = useState(settings.apiKey);
  const [show, setShow] = useState(false);
  const [testing, setTesting] = useState(false);

  const saveKey = () => {
    setSettings({ apiKey: key.trim() });
    toast(key.trim() ? 'Ключ сохранён' : 'Ключ удалён');
  };

  const test = async () => {
    saveKey();
    setTesting(true);
    try {
      const r = await streamText({ system: 'Отвечай одним словом.', messages: [{ role: 'user', content: 'Скажи «работает»' }], effort: 'low' });
      toast('✅ ИИ ' + r.trim().toLowerCase());
    } catch (e) {
      toast(e instanceof AIError ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  };

  const backup = async () => {
    const all: Record<string, unknown> = {};
    // API-ключ в копию не попадает
    for (const k of await keys()) if (String(k) !== 'settings') all[String(k)] = await get(k);
    const blob = new Blob([JSON.stringify({ format: 'supermind-backup', version: 1, createdAt: Date.now(), data: all })], { type: 'application/json' });
    const d = new Date();
    await downloadBlob(blob, `supermind-backup-${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}.json`);
  };

  const restore = async () => {
    const f = await pickFile('.json,application/json');
    if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      if ((j.format !== 'supermind-backup' && j.format !== '2mind-backup') || !j.data) throw new Error('Это не резервная копия SuperMind');
      if (!(await confirmDialog('Восстановить из копии?', 'Карты из копии будут добавлены, совпадающие — заменены. Ежедневник и доска будут заменены.', { okText: 'Восстановить' }))) return;
      const cur = ((await get('docs:index')) ?? []) as { id: string }[];
      for (const [k, v] of Object.entries(j.data)) {
        if (k === 'docs:index' || k === 'settings') continue;
        await set(k, v);
      }
      const incoming = (j.data['docs:index'] ?? []) as { id: string }[];
      const merged = [...incoming, ...cur.filter((c) => !incoming.some((i) => i.id === c.id))];
      await set('docs:index', merged);
      toast('Восстановлено карт: ' + incoming.length);
    } catch (e) {
      toast('Ошибка: ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  const wipe = async () => {
    if (!(await confirmDialog('Удалить все данные?', 'Все карты, ежедневник, доска задач и настройки будут удалены с этого устройства. Сначала сделайте резервную копию!', { danger: true, okText: 'Удалить всё' }))) return;
    await clear();
    location.reload();
  };

  return (
    <div className="page">
      <div className="page-header"><h1>Настройки</h1></div>
      <div className="page-body">
        <div className="settings">
          <section className="card set-card">
            <h3><Sparkles size={18} color="var(--accent)" /> Искусственный интеллект</h3>
            <p className="muted small">
              ИИ-функции (генерация карт, мозговой штурм, задачи, резюме, перевод, чат) работают на Claude от Anthropic. Получите ключ на{' '}
              <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com</a> — он хранится только на этом устройстве и отправляется напрямую в Anthropic.
            </p>
            <label className="label">API-ключ</label>
            <div className="row">
              <input className="input" type={show ? 'text' : 'password'} autoComplete="off" placeholder="sk-ant-…" value={key} onChange={(e) => setKey(e.target.value)} onBlur={saveKey} />
              <button className="icon-btn" onClick={() => setShow(!show)}>{show ? <EyeOff size={18} /> : <Eye size={18} />}</button>
            </div>
            <label className="label">Модель</label>
            <select className="select" value={settings.model} onChange={(e) => setSettings({ model: e.target.value })}>
              {AI_MODELS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <button className="btn" style={{ marginTop: 12 }} onClick={test} disabled={!key.trim() || testing}>
              <CheckCircle2 size={16} /> {testing ? 'Проверяю…' : 'Проверить подключение'}
            </button>
          </section>

          <section className="card set-card">
            <h3>Оформление</h3>
            <div className="segmented">
              <button className={settings.theme === 'system' ? 'active' : ''} onClick={() => setSettings({ theme: 'system' })}><Monitor size={14} /> Авто</button>
              <button className={settings.theme === 'light' ? 'active' : ''} onClick={() => setSettings({ theme: 'light' })}><Sun size={14} /> Светлая</button>
              <button className={settings.theme === 'dark' ? 'active' : ''} onClick={() => setSettings({ theme: 'dark' })}><Moon size={14} /> Тёмная</button>
            </div>
          </section>

          <section className="card set-card">
            <h3>Данные</h3>
            <p className="muted small">Все данные хранятся локально на устройстве (IndexedDB) и работают без интернета. Делайте резервные копии, чтобы перенести карты на другое устройство.</p>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <button className="btn" onClick={backup}><Download size={16} /> Резервная копия</button>
              <button className="btn" onClick={restore}><Upload size={16} /> Восстановить</button>
              <button className="btn btn-danger" onClick={wipe}><Trash2 size={16} /> Удалить всё</button>
            </div>
          </section>

          <section className="card set-card">
            <h3><Smartphone size={18} /> Установка на телефон</h3>
            <p className="small"><b>iPhone:</b> откройте сайт в Safari → «Поделиться» → «На экран „Домой“». Приложение будет работать как обычное, в том числе офлайн.</p>
            <p className="small"><b>Android:</b> установите APK-файл SuperMind или в Chrome откройте меню ⋮ → «Установить приложение».</p>
          </section>

          <section className="card set-card">
            <h3><Info size={18} /> О приложении</h3>
            <p className="small muted" style={{ margin: 0 }}>SuperMind 1.3 — бесплатные интеллект-карты, ежедневник и доска задач. Все функции открыты, без подписок.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
