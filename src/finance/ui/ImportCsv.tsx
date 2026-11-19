import { useMemo, useState } from 'react';
import { FileArrowUp } from '@phosphor-icons/react';
import { pickFile } from '../../io/download';
import { toast } from '../../store/appStore';
import { categoryMap, curSymbol, dateShort, fmtMoney, sortedAccounts, type FinanceData } from '../model';
import { buildImport, detectDelimiter, dropPreamble, guessColumns, looksLikeHeader, parseCsv, type ColumnMap } from '../csv';
import { addTransactions, removeTransactions } from '../store';
import { Sheet } from './common';
import { t, tn } from '../../i18n/index';

interface Loaded {
  name: string;
  rows: string[][];
  delim: string;
}

/** Читает текст файла: UTF-8, а если похоже на Windows-1251 — перечитывает в ней */
async function readText(f: File): Promise<string> {
  const buf = await f.arrayBuffer();
  const utf = new TextDecoder('utf-8').decode(buf);
  if (!utf.includes('�')) return utf;
  try {
    return new TextDecoder('windows-1251').decode(buf);
  } catch {
    return utf;
  }
}

export function ImportCsvSheet({ data, onClose }: { data: FinanceData; onClose: () => void }) {
  const [file, setFile] = useState<Loaded | null>(null);
  const [hasHeader, setHasHeader] = useState(true);
  const [map, setMap] = useState<ColumnMap>({ date: 0, amount: 1, description: 2, category: -1 });
  const [invert, setInvert] = useState(false);
  const accounts = sortedAccounts(data);
  const [accountId, setAccountId] = useState(data.prefs.lastAccountId && accounts.some((a) => a.id === data.prefs.lastAccountId) ? data.prefs.lastAccountId : (accounts[0]?.id ?? ''));
  const cats = useMemo(() => categoryMap(data), [data]);
  const acc = accounts.find((a) => a.id === accountId);

  const choose = async () => {
    const f = await pickFile('.csv,text/csv,text/plain');
    if (!f) return;
    try {
      const text = await readText(f);
      const delim = detectDelimiter(text);
      const rows = dropPreamble(parseCsv(text, delim));
      if (!rows.length) return toast(t('Файл пустой'));
      const header = looksLikeHeader(rows[0]);
      setHasHeader(header);
      setMap(header ? guessColumns(rows[0]) : guessColumns([]));
      setFile({ name: f.name, rows, delim });
    } catch {
      toast(t('Не удалось прочитать файл'));
    }
  };

  const body = file ? (hasHeader ? file.rows.slice(1) : file.rows) : [];
  const width = file ? Math.max(...file.rows.slice(0, 20).map((r) => r.length)) : 0;
  const colName = (i: number) => (file && hasHeader ? file.rows[0][i] || t('Столбец {n}', { n: i + 1 }) : t('Столбец {n}', { n: i + 1 })) + (body[0]?.[i] ? ` — ${body[0][i].slice(0, 24)}` : '');
  const preview = useMemo(() => (file && accountId ? buildImport(data, body, map, accountId, { invert }) : null), [file, data, map, accountId, invert, hasHeader]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = () => {
    if (!preview || !preview.items.length) return toast(t('Нечего импортировать'));
    const ids = addTransactions(preview.items);
    toast(
      preview.duplicates
        ? t('Импортировано операций: {n}, пропущено дубликатов: {dup}', { n: ids.length, dup: preview.duplicates })
        : t('Импортировано операций: {n}', { n: ids.length }),
      {
      label: t('Отменить'),
      run: () => removeTransactions(ids),
      },
    );
    onClose();
  };

  const colSelect = (key: keyof ColumnMap, optional = false) => (
    <select className="select" value={map[key]} onChange={(e) => setMap({ ...map, [key]: Number(e.target.value) })}>
      {optional && <option value={-1}>{t('— нет —')}</option>}
      {Array.from({ length: width }, (_, i) => (
        <option key={i} value={i}>
          {colName(i)}
        </option>
      ))}
    </select>
  );

  return (
    <Sheet
      title={t('Импорт из CSV')}
      onClose={onClose}
      className="fn-import"
      actions={
        <>
          <button className="btn" onClick={onClose}>
            {t('Отмена')}
          </button>
          <button className="btn btn-primary" disabled={!preview?.items.length} onClick={run}>
            {t('Импортировать')}{preview?.items.length ? ` (${preview.items.length})` : ''}
          </button>
        </>
      }
    >
      {!file ? (
        <div className="fn-import-start">
          <p className="small muted">
            {t('Выгрузите выписку из банка в формате CSV и выберите файл. Нужны столбцы с датой и суммой (отрицательная сумма — расход). Категории подберутся автоматически по описанию.')}
          </p>
          <button className="btn btn-primary" onClick={() => void choose()}>
            <FileArrowUp size={16} /> {t('Выбрать файл')}
          </button>
        </div>
      ) : (
        <>
          <div className="row small">
            <span className="grow ellipsis muted">
              {file.name} · {file.rows.length} {tn(file.rows.length, 'строка', 'строки', 'строк')} · {t('разделитель «{d}»', { d: file.delim === '\t' ? 'Tab' : file.delim })}
            </span>
            <button className="btn btn-sm btn-ghost" onClick={() => void choose()}>
              {t('Другой файл')}
            </button>
          </div>
          <label className="row fn-check">
            <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} />
            <span>{t('Первая строка — заголовки')}</span>
          </label>
          <div className="fn-grid2">
            <div>
              <label className="label">{t('Дата')}</label>
              {colSelect('date')}
            </div>
            <div>
              <label className="label">{t('Сумма')}</label>
              {colSelect('amount')}
            </div>
            <div>
              <label className="label">{t('Описание')}</label>
              {colSelect('description', true)}
            </div>
            <div>
              <label className="label">{t('Категория (необязательно)')}</label>
              {colSelect('category', true)}
            </div>
            <div>
              <label className="label">{t('На счёт')}</label>
              <select className="select" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.emoji} {a.name} ({curSymbol(a.currency)})
                  </option>
                ))}
              </select>
            </div>
          </div>
          <label className="row fn-check">
            <input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} />
            <span>{t('Расходы в файле — положительные числа (поменять знак)')}</span>
          </label>

          {preview && (
            <>
              <div className="row small fn-import-stats">
                <span className="fn-pos">{t('Новых: {n}', { n: preview.items.length })}</span>
                {preview.duplicates > 0 && <span className="muted">{t('Дубликатов: {n}', { n: preview.duplicates })}</span>}
                {preview.errors > 0 && <span className="fn-warn-text">{t('Не распознано: {n}', { n: preview.errors })}</span>}
              </div>
              <div className="fn-import-preview">
                {preview.items.slice(0, 8).map((x, i) => {
                  const c = x.categoryId ? cats.get(x.categoryId) : undefined;
                  return (
                    <div key={i} className="fn-import-row small">
                      <span className="faint fn-import-date">{dateShort(x.date)}</span>
                      <span className="grow ellipsis">
                        {c ? `${c.emoji} ` : '❔ '}
                        {x.note || c?.name || t('Без описания')}
                      </span>
                      <span className={x.type === 'income' ? 'fn-pos' : ''}>{fmtMoney(x.type === 'income' ? x.amount : -x.amount, acc?.currency ?? '', { sign: true })}</span>
                    </div>
                  );
                })}
                {preview.items.length > 8 && <div className="tiny faint">{t('…и ещё {n}', { n: preview.items.length - 8 })}</div>}
                {!preview.items.length && <div className="small muted">{t('Проверьте, правильно ли выбраны столбцы с датой и суммой.')}</div>}
              </div>
            </>
          )}
        </>
      )}
    </Sheet>
  );
}
