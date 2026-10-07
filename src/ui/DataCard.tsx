import { useEffect, useState } from 'react';
import { Cloud, Download, HardDrive, History, RotateCcw, ShieldCheck, ShieldAlert, Trash2, Upload } from 'lucide-react';
import { cloudSnapshotData, listCloudSnapshots, makeCloudSnapshot, useCloud, type CloudSnapshot } from '../store/cloud';
import { clear } from '../store/kv';
import { toast } from '../store/appStore';
import {
  APP_VERSION,
  REASON_LABEL,
  collectData,
  isPersisted,
  listSnapshots,
  requestPersistence,
  restoreData,
  snapshotData,
  takeSnapshot,
  type SnapshotInfo,
  type SnapshotReason,
} from '../store/safety';
import { downloadBlob, pickFile } from '../io/download';
import { confirmDialog } from './dialogs';
import { isNative } from '../platform';

const when = (ms: number) =>
  new Date(ms).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const size = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} МБ` : `${Math.max(1, Math.round(b / 1024))} КБ`);
const CLOUD_REASON: Record<string, string> = { auto: 'Автоматическая', manual: 'Вручную' };

/** Данные: защита, автокопии на устройстве и в облаке, файл-копия, удаление */
export function DataCard() {
  const account = useCloud((s) => s.account);
  const [local, setLocal] = useState<SnapshotInfo[]>([]);
  const [cloud, setCloud] = useState<CloudSnapshot[] | null>(null);
  const [cloudErr, setCloudErr] = useState('');
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = () => void listSnapshots().then(setLocal).catch(() => {});
  useEffect(() => {
    refresh();
    void isPersisted().then(setPersisted);
  }, []);
  useEffect(() => {
    if (!account) return setCloud(null);
    listCloudSnapshots()
      .then((l) => (setCloud(l), setCloudErr('')))
      .catch((e) => setCloudErr(e instanceof Error ? e.message : String(e)));
  }, [account]);

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast('Ошибка: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const restoreFrom = (label: string, load: () => Promise<Record<string, unknown> | null>) =>
    run(async () => {
      if (
        !(await confirmDialog(
          'Вернуть данные из копии?',
          `${label}. Карты, задачи и записи из копии вернутся в том виде, как были; созданное позже — останется. Текущее состояние сохранится отдельной копией — можно передумать.`,
          { okText: 'Вернуть' },
        ))
      )
        return;
      const data = await load();
      if (!data) throw new Error('Копия не найдена');
      const r = await restoreData(data);
      toast(`Восстановлено. Карт в копии: ${r.maps}`);
    });

  const backupFile = () =>
    run(async () => {
      const blob = new Blob([JSON.stringify({ format: 'supermind-backup', version: 1, app: APP_VERSION, createdAt: Date.now(), data: await collectData() })], {
        type: 'application/json',
      });
      const d = new Date();
      await downloadBlob(blob, `supermind-backup-${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}.json`);
    });

  const restoreFile = async () => {
    const f = await pickFile('.json,application/json');
    if (!f) return;
    let data: Record<string, unknown>;
    try {
      const j = JSON.parse(await f.text());
      if ((j.format !== 'supermind-backup' && j.format !== '2mind-backup') || !j.data) throw new Error();
      data = j.data;
    } catch {
      toast('Это не резервная копия SuperMind');
      return;
    }
    await restoreFrom(`Файл «${f.name}»`, async () => data);
  };

  const wipe = async () => {
    if (!(await confirmDialog('Удалить все данные?', 'Все карты, задачи, ежедневник и настройки будут удалены с этого устройства. Автокопии на устройстве и данные в облаке останутся.', { danger: true, okText: 'Удалить всё' }))) return;
    await takeSnapshot('manual');
    await clear();
    location.reload();
  };

  const shown = all ? local : local.slice(0, 3);
  const newest = local[0];

  return (
    <section className="card set-card dc-card">
      <h3>
        <History size={18} color="var(--accent)" /> Данные и копии
      </h3>

      <div className={`dc-status ${account ? 'ok' : 'warn'}`}>
        {account ? <ShieldCheck size={18} /> : <ShieldAlert size={18} />}
        <div className="grow small">
          {account ? (
            <>
              <b>Данные в безопасности.</b> Всё сохраняется в облаке аккаунта {account.user.email}; переустановка, обновление или новый телефон ничего не сотрут — просто войдите.
            </>
          ) : (
            <>
              <b>Данные только на этом устройстве.</b> Создайте аккаунт выше — тогда карты и задачи не потеряются при удалении приложения, очистке Safari или смене телефона.
            </>
          )}
        </div>
      </div>

      {!isNative() && persisted === false && (
        <button
          className="btn btn-sm dc-persist"
          onClick={async () => {
            const ok = await requestPersistence();
            setPersisted(ok);
            toast(ok ? 'Браузер больше не будет очищать данные SuperMind' : 'Браузер не разрешил — установите SuperMind на экран «Домой» или создайте аккаунт');
          }}
        >
          <HardDrive size={15} /> Запретить браузеру очищать данные
        </button>
      )}

      <div className="dc-head">
        <b>Автокопии на устройстве</b>
        <span className="tiny muted">{newest ? `последняя ${when(newest.at)}` : 'ещё нет'}</span>
      </div>
      <p className="tiny muted dc-note">Делаются сами: каждые 3 часа, перед обновлением приложения, перед входом в аккаунт и перед восстановлением. Хранятся свежие и по одной на каждый день за 2 недели.</p>
      <div className="dc-list">
        {shown.map((s) => (
          <div key={s.id} className="dc-row">
            <div className="grow">
              <div className="small bold">
                {when(s.at)} <span className="dc-tag">{REASON_LABEL[s.reason as SnapshotReason] ?? s.reason}</span>
              </div>
              <div className="tiny muted ellipsis">
                {s.summary} · {size(s.bytes)} · v{s.version}
              </div>
            </div>
            <button className="btn btn-sm" disabled={busy} onClick={() => restoreFrom(`Копия от ${when(s.at)}`, () => snapshotData(s.id))}>
              <RotateCcw size={14} /> Вернуть
            </button>
          </div>
        ))}
        {local.length > 3 && (
          <button className="btn btn-ghost btn-sm" onClick={() => setAll(!all)}>
            {all ? 'Свернуть' : `Все копии (${local.length})`}
          </button>
        )}
        <button className="btn btn-sm" disabled={busy} onClick={() => run(async () => void ((await takeSnapshot('manual')) ? toast('Копия сохранена на устройстве') : toast('Пока нечего копировать')))}>
          <History size={14} /> Сделать копию сейчас
        </button>
      </div>

      {account && (
        <>
          <div className="dc-head">
            <b>
              <Cloud size={14} /> Копии в облаке
            </b>
            <span className="tiny muted">{cloud?.[0] ? `последняя ${when(cloud[0].at)}` : ''}</span>
          </div>
          <p className="tiny muted dc-note">Сервер сам сохраняет копию каждый час, когда вы что-то меняете: все за последние сутки и по одной на каждый день за 30 дней — даже если данные испортятся на всех устройствах.</p>
          <div className="dc-list">
            {cloudErr && <p className="tiny muted">{cloudErr}</p>}
            {cloud?.length === 0 && <p className="tiny muted">Первая копия появится при следующем изменении или нажмите «Копия в облако».</p>}
            {(cloud ?? []).slice(0, all ? 60 : 3).map((s) => (
              <div key={s.id} className="dc-row">
                <div className="grow">
                  <div className="small bold">
                    {when(s.at)} <span className="dc-tag">{CLOUD_REASON[s.reason] ?? s.reason}</span>
                  </div>
                  <div className="tiny muted">
                    записей: {s.keys} · {size(s.bytes)}
                  </div>
                </div>
                <button className="btn btn-sm" disabled={busy} onClick={() => restoreFrom(`Облачная копия от ${when(s.at)}`, () => cloudSnapshotData(s.id))}>
                  <RotateCcw size={14} /> Вернуть
                </button>
              </div>
            ))}
            <button
              className="btn btn-sm"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await makeCloudSnapshot();
                  setCloud(await listCloudSnapshots());
                  toast('Копия сохранена в облаке');
                })
              }
            >
              <Cloud size={14} /> Копия в облако
            </button>
          </div>
        </>
      )}

      <div className="dc-head">
        <b>Файл</b>
      </div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button className="btn" disabled={busy} onClick={backupFile}>
          <Download size={16} /> Скачать копию
        </button>
        <button className="btn" disabled={busy} onClick={restoreFile}>
          <Upload size={16} /> Восстановить из файла
        </button>
        <button className="btn btn-danger" onClick={wipe}>
          <Trash2 size={16} /> Удалить всё
        </button>
      </div>
    </section>
  );
}
