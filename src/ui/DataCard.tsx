import { useEffect, useState } from 'react';
import { ClockCounterClockwise, Cloud, DownloadSimple, HardDrives, ShieldCheck, ShieldWarning, Trash, UploadSimple } from '@phosphor-icons/react';
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
import { IconTile } from './icons';
import { ListRow, ListSection } from './list';

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

  const restoreBtn = (onClick: () => void) => (
    <button className="btn btn-sm btn-tinted" disabled={busy} onClick={onClick}>
      Вернуть
    </button>
  );

  return (
    <>
      <ListSection header="Данные и копии">
        <ListRow
          icon={<IconTile icon={account ? ShieldCheck : ShieldWarning} tone={account ? 'green' : 'orange'} size="list" />}
          title={account ? 'Данные в безопасности' : 'Данные только на этом устройстве'}
          subtitle={
            account
              ? `Всё сохраняется в облаке аккаунта ${account.user.email}; переустановка, обновление или новый телефон ничего не сотрут — просто войдите.`
              : 'Создайте аккаунт выше — тогда карты и задачи не потеряются при удалении приложения, очистке Safari или смене телефона.'
          }
        />
        {!isNative() && persisted === false && (
          <ListRow
            icon={<IconTile icon={HardDrives} tone="gray" size="list" />}
            title="Запретить браузеру очищать данные"
            tone="accent"
            onClick={async () => {
              const ok = await requestPersistence();
              setPersisted(ok);
              toast(ok ? 'Браузер больше не будет очищать данные SuperMind' : 'Браузер не разрешил — установите SuperMind на экран «Домой» или создайте аккаунт');
            }}
          />
        )}
      </ListSection>

      <ListSection
        header="Автокопии на устройстве"
        footer={`${newest ? `Последняя — ${when(newest.at)}. ` : ''}Делаются сами: каждые 3 часа, перед обновлением приложения, перед входом в аккаунт и перед восстановлением. Хранятся свежие, а за прошлые дни — первая и последняя копия каждого дня (2 недели).`}
      >
        {shown.map((s) => (
          <ListRow
            key={s.id}
            title={
              <>
                {when(s.at)} <span className="dc-tag">{REASON_LABEL[s.reason as SnapshotReason] ?? s.reason}</span>
              </>
            }
            subtitle={`${s.summary} · ${size(s.bytes)} · v${s.version}`}
            trailing={restoreBtn(() => void restoreFrom(`Копия от ${when(s.at)}`, () => snapshotData(s.id)))}
          />
        ))}
        {local.length > 3 && <ListRow title={all ? 'Свернуть' : `Все копии (${local.length})`} tone="accent" onClick={() => setAll(!all)} />}
        <ListRow
          icon={<IconTile icon={ClockCounterClockwise} tone="teal" size="list" />}
          title="Сделать копию сейчас"
          tone="accent"
          disabled={busy}
          onClick={() => void run(async () => void ((await takeSnapshot('manual')) ? toast('Копия сохранена на устройстве') : toast('Пока нечего копировать')))}
        />
      </ListSection>

      {account && (
        <ListSection
          header="Копии в облаке"
          footer={`${cloud?.[0] ? `Последняя — ${when(cloud[0].at)}. ` : ''}Сервер сам сохраняет копию каждый час, когда вы что-то меняете: все за последние сутки, а за прошлые дни — первая и последняя копия каждого дня (30 дней) — даже если данные испортятся на всех устройствах.`}
        >
          {cloudErr && <ListRow title="Не удалось загрузить" subtitle={cloudErr} />}
          {cloud?.length === 0 && <ListRow title="Копий пока нет" subtitle="Первая копия появится при следующем изменении." />}
          {(cloud ?? []).slice(0, all ? 60 : 3).map((s) => (
            <ListRow
              key={s.id}
              title={
                <>
                  {when(s.at)} <span className="dc-tag">{CLOUD_REASON[s.reason] ?? s.reason}</span>
                </>
              }
              subtitle={`записей: ${s.keys} · ${size(s.bytes)}`}
              trailing={restoreBtn(() => void restoreFrom(`Облачная копия от ${when(s.at)}`, () => cloudSnapshotData(s.id)))}
            />
          ))}
          <ListRow
            icon={<IconTile icon={Cloud} tone="blue" size="list" />}
            title="Копия в облако"
            tone="accent"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await makeCloudSnapshot();
                setCloud(await listCloudSnapshots());
                toast('Копия сохранена в облаке');
              })
            }
          />
        </ListSection>
      )}

      <ListSection header="Файл" footer="Файл-копию можно хранить где угодно и восстановить на любом устройстве.">
        <ListRow icon={<IconTile icon={DownloadSimple} tone="blue" size="list" />} title="Скачать копию" tone="accent" disabled={busy} onClick={() => void backupFile()} />
        <ListRow icon={<IconTile icon={UploadSimple} tone="indigo" size="list" />} title="Восстановить из файла" tone="accent" disabled={busy} onClick={() => void restoreFile()} />
        <ListRow icon={<IconTile icon={Trash} tone="red" size="list" />} title="Удалить всё" tone="danger" onClick={() => void wipe()} />
      </ListSection>
    </>
  );
}
