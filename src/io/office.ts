/**
 * Экспорт в Word (.docx), Excel (.xlsx), PowerPoint (.pptx) и CSV задач.
 * Минимальный, но валидный OOXML, собранный через JSZip.
 */
import type { MindDoc, Sheet, Topic } from '../types';
import {
  STATUS_TEXT, XML_DECL, escAttr, escXml, newZip, oneLine, stripDirs, topicPriority, topicProgress,
} from './common';
import type { Zip } from './common';

// ---------------------------------------------------------------------
// Общие части OOXML
// ---------------------------------------------------------------------

const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const RT = {
  officeDocument: `${NS_REL}/officeDocument`,
  core: 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties',
  app: `${NS_REL}/extended-properties`,
  styles: `${NS_REL}/styles`,
  hyperlink: `${NS_REL}/hyperlink`,
  worksheet: `${NS_REL}/worksheet`,
  slide: `${NS_REL}/slide`,
  slideLayout: `${NS_REL}/slideLayout`,
  slideMaster: `${NS_REL}/slideMaster`,
  theme: `${NS_REL}/theme`,
  presProps: `${NS_REL}/presProps`,
  viewProps: `${NS_REL}/viewProps`,
  tableStyles: `${NS_REL}/tableStyles`,
};

interface Rel {
  id: string;
  type: string;
  target: string;
  external?: boolean;
}

function relsXml(rels: Rel[]): string {
  return (
    XML_DECL +
    `<Relationships xmlns="${NS_PKG_REL}">` +
    rels
      .map(
        (r) =>
          `<Relationship Id="${r.id}" Type="${r.type}" Target="${escAttr(r.target)}"${r.external ? ' TargetMode="External"' : ''}/>`,
      )
      .join('') +
    '</Relationships>'
  );
}

function contentTypes(overrides: [string, string][]): string {
  return (
    XML_DECL +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    overrides.map(([p, t]) => `<Override PartName="${p}" ContentType="${t}"/>`).join('') +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
    '</Types>'
  );
}

function w3cdtf(d = new Date()): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function addDocProps(zip: Zip, title: string, mainTarget: string) {
  const now = w3cdtf();
  zip.file(
    'docProps/core.xml',
    XML_DECL +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
      'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
      'xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      `<dc:title>${escXml(title)}</dc:title><dc:creator>2Mind</dc:creator><cp:lastModifiedBy>2Mind</cp:lastModifiedBy>` +
      `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>` +
      `<dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>` +
      '</cp:coreProperties>',
  );
  zip.file(
    'docProps/app.xml',
    XML_DECL +
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" ' +
      'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>2Mind</Application></Properties>',
  );
  zip.file(
    '_rels/.rels',
    relsXml([
      { id: 'rId1', type: RT.officeDocument, target: mainTarget },
      { id: 'rId2', type: RT.core, target: 'docProps/core.xml' },
      { id: 'rId3', type: RT.app, target: 'docProps/app.xml' },
    ]),
  );
}

function generate(zip: Zip, mimeType: string): Promise<Blob> {
  return stripDirs(zip).generateAsync({ type: 'blob', mimeType, compression: 'DEFLATE' });
}

function rootsOf(s: Sheet): Topic[] {
  return [s.root, ...s.floating];
}

// ---------------------------------------------------------------------
// DOCX
// ---------------------------------------------------------------------

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function wText(text: string): string {
  // перевод строки внутри темы → <w:br/>
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((part) => `<w:t xml:space="preserve">${escXml(part)}</w:t>`)
    .join('<w:br/>');
}

function wRun(text: string, rPr = ''): string {
  return `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}${wText(text)}</w:r>`;
}

function isSafeUrl(u: string): boolean {
  return /^(https?|mailto|ftp|tel):/i.test(u);
}

const DOCX_STYLES =
  XML_DECL +
  `<w:styles xmlns:w="${W_NS}">` +
  '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/>' +
  '<w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="ru-RU" w:eastAsia="en-US" w:bidi="ar-SA"/></w:rPr></w:rPrDefault>' +
  '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
  '<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="10"/><w:qFormat/>' +
  '<w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:color w:val="1F2937"/><w:sz w:val="52"/><w:szCs w:val="52"/></w:rPr></w:style>' +
  [
    [1, 36, '1F3864', 360],
    [2, 30, '2F5496', 280],
    [3, 26, '2F5496', 240],
    [4, 24, '404040', 200],
  ]
    .map(
      ([n, sz, color, before]) =>
        `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/>` +
        `<w:pPr><w:keepNext/><w:spacing w:before="${before}" w:after="120"/><w:outlineLvl w:val="${Number(n) - 1}"/></w:pPr>` +
        `<w:rPr><w:b/><w:color w:val="${color}"/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr></w:style>`,
    )
    .join('') +
  '<w:style w:type="paragraph" w:styleId="Note"><w:name w:val="Note"/><w:basedOn w:val="Normal"/><w:qFormat/>' +
  '<w:rPr><w:i/><w:color w:val="595959"/></w:rPr></w:style>' +
  '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/>' +
  '<w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>' +
  '</w:styles>';

export async function exportDocx(doc: MindDoc): Promise<Blob> {
  const zip = await newZip();
  const rels: Rel[] = [{ id: 'rId1', type: RT.styles, target: 'styles.xml' }];
  const body: string[] = [];

  const para = (style: string | null, content: string, opts: { indent?: number; pageBreak?: boolean } = {}) => {
    let pPr = '';
    if (style) pPr += `<w:pStyle w:val="${style}"/>`;
    if (opts.pageBreak) pPr += '<w:pageBreakBefore/>';
    if (opts.indent) pPr += `<w:ind w:left="${opts.indent}" w:hanging="240"/>`;
    body.push(`<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${content}</w:p>`);
  };

  const topicRuns = (t: Topic, prefix: string): string => {
    let s = '';
    const task = t.task ? (t.task.status === 'done' ? '☑ ' : '☐ ') : '';
    if (prefix || task) s += wRun(prefix + task);
    const text = t.text || ' ';
    if (t.link && isSafeUrl(t.link)) {
      const id = `rId${rels.length + 1}`;
      rels.push({ id, type: RT.hyperlink, target: t.link, external: true });
      s += `<w:hyperlink r:id="${id}" w:history="1">${wRun(text, '<w:rStyle w:val="Hyperlink"/>')}</w:hyperlink>`;
    } else {
      s += wRun(text);
      if (t.link) s += wRun(` (${t.link})`, '<w:color w:val="0563C1"/>');
    }
    const extra: string[] = [];
    if (t.labels?.length) extra.push(t.labels.join(', '));
    if (t.task?.due) extra.push(`срок: ${t.task.due}`);
    if (t.task?.assignee) extra.push(t.task.assignee);
    if (extra.length) s += wRun(`  [${extra.join('; ')}]`, '<w:color w:val="7F7F7F"/><w:sz w:val="18"/><w:szCs w:val="18"/>');
    return s;
  };

  const notes = (t: Topic, indent: number) => {
    if (!t.note?.trim()) return;
    for (const line of t.note.replace(/\r\n?/g, '\n').split('\n')) {
      para('Note', line ? wRun(line) : '', { indent: indent || undefined });
    }
  };

  const rec = (t: Topic, depth: number) => {
    if (depth <= 4) {
      para(`Heading${depth}`, topicRuns(t, ''));
      notes(t, 0);
    } else {
      const indent = (depth - 4) * 360;
      para(null, topicRuns(t, '• '), { indent });
      notes(t, indent + 240);
    }
    for (const c of t.children) rec(c, depth + 1);
  };

  doc.sheets.forEach((sheet, si) => {
    para('Title', topicRuns(sheet.root, ''), { pageBreak: si > 0 });
    notes(sheet.root, 0);
    for (const c of sheet.root.children) rec(c, 1);
    for (const f of sheet.floating) rec(f, 1);
  });

  const documentXml =
    XML_DECL +
    `<w:document xmlns:w="${W_NS}" xmlns:r="${NS_REL}"><w:body>` +
    body.join('') +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
    '<w:pgMar w:top="1134" w:right="850" w:bottom="1134" w:left="1701" w:header="708" w:footer="708" w:gutter="0"/>' +
    '</w:sectPr></w:body></w:document>';

  zip.file(
    '[Content_Types].xml',
    contentTypes([
      ['/word/document.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'],
      ['/word/styles.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml'],
    ]),
  );
  addDocProps(zip, doc.title, 'word/document.xml');
  zip.file('word/document.xml', documentXml);
  zip.file('word/styles.xml', DOCX_STYLES);
  zip.file('word/_rels/document.xml.rels', relsXml(rels));
  return generate(zip, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
}

// ---------------------------------------------------------------------
// XLSX
// ---------------------------------------------------------------------

const S_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const XLSX_MAX_CELL = 32767;

function colName(i: number): string {
  let s = '';
  let n = i + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function xCell(col: number, row: number, value: string, style = 2): string {
  if (!value) return '';
  const v = value.length > XLSX_MAX_CELL ? value.slice(0, XLSX_MAX_CELL) : value;
  return `<c r="${colName(col)}${row}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escXml(v)}</t></is></c>`;
}

function sheetNames(doc: MindDoc): string[] {
  const used = new Set<string>();
  return doc.sheets.map((s, i) => {
    let base = (s.title || `Лист ${i + 1}`).replace(/[[\]:*?/\\]/g, ' ').replace(/^'+|'+$/g, '').trim() || `Лист ${i + 1}`;
    base = base.slice(0, 31);
    let name = base;
    let k = 2;
    while (used.has(name.toLowerCase()) || name.toLowerCase() === 'history') {
      const suf = ` (${k++})`;
      name = base.slice(0, 31 - suf.length) + suf;
    }
    used.add(name.toLowerCase());
    return name;
  });
}

const ATTR_HEADERS = ['Заметка', 'Метки', 'Статус', 'Приоритет', 'Срок', 'Прогресс'];

function attrCells(t: Topic): string[] {
  const prog = topicProgress(t);
  return [
    t.note?.trim() ?? '',
    (t.labels ?? []).join(', '),
    t.task ? STATUS_TEXT[t.task.status] : '',
    topicPriority(t),
    t.task?.due ?? '',
    prog == null ? '' : `${prog}%`,
  ];
}

function depthOf(t: Topic): number {
  let d = 0;
  for (const c of t.children) d = Math.max(d, depthOf(c) + 1);
  return d;
}

function worksheetXml(sheet: Sheet): string {
  const roots = rootsOf(sheet);
  const levels = Math.max(1, ...roots.map((r) => depthOf(r) + 1));
  const rows: string[][] = [];
  const leaves: Topic[] = [];
  const merges: string[] = [];

  // строка на каждый путь до листа; родитель пишется в первой строке группы и объединяется по вертикали
  const rec = (t: Topic, depth: number): number => {
    const startRow = rows.length;
    if (!t.children.length) {
      const r = new Array<string>(levels).fill('');
      rows.push(r);
      leaves.push(t);
    } else {
      for (const c of t.children) rec(c, depth + 1);
    }
    rows[startRow][depth] = oneLine(t.text) || ' ';
    const span = rows.length - startRow;
    if (span > 1) merges.push(`${colName(depth)}${startRow + 2}:${colName(depth)}${startRow + 1 + span}`);
    return span;
  };
  for (const r of roots) rec(r, 0);

  const headers = [...Array.from({ length: levels }, (_, i) => `Уровень ${i + 1}`), ...ATTR_HEADERS];
  const totalCols = headers.length;
  const out: string[] = [];
  out.push(`<row r="1">${headers.map((h, i) => xCell(i, 1, h, 1)).join('')}</row>`);
  rows.forEach((r, i) => {
    const rowNum = i + 2;
    const cells = [...r, ...attrCells(leaves[i])];
    out.push(`<row r="${rowNum}">${cells.map((v, c) => xCell(c, rowNum, v)).join('')}</row>`);
  });

  const lastRef = `${colName(totalCols - 1)}${rows.length + 1}`;
  const cols =
    `<cols><col min="1" max="${levels}" width="26" customWidth="1"/>` +
    `<col min="${levels + 1}" max="${levels + 1}" width="40" customWidth="1"/>` +
    `<col min="${levels + 2}" max="${totalCols}" width="16" customWidth="1"/></cols>`;
  return (
    XML_DECL +
    `<worksheet xmlns="${S_NS}" xmlns:r="${NS_REL}">` +
    `<dimension ref="A1:${lastRef}"/>` +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    cols +
    `<sheetData>${out.join('')}</sheetData>` +
    (merges.length ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '') +
    '</worksheet>'
  );
}

const XLSX_STYLES =
  XML_DECL +
  `<styleSheet xmlns="${S_NS}">` +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
  '<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>' +
  '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF7"/><bgColor indexed="64"/></patternFill></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="3">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

export async function exportXlsx(doc: MindDoc): Promise<Blob> {
  const zip = await newZip();
  const names = sheetNames(doc);
  const n = doc.sheets.length;

  zip.file(
    '[Content_Types].xml',
    contentTypes([
      ['/xl/workbook.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'],
      ['/xl/styles.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml'],
      ...doc.sheets.map(
        (_, i) =>
          [`/xl/worksheets/sheet${i + 1}.xml`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'] as [string, string],
      ),
    ]),
  );
  addDocProps(zip, doc.title, 'xl/workbook.xml');
  zip.file(
    'xl/workbook.xml',
    XML_DECL +
      `<workbook xmlns="${S_NS}" xmlns:r="${NS_REL}"><bookViews><workbookView/></bookViews><sheets>` +
      names.map((nm, i) => `<sheet name="${escAttr(nm)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
      '</sheets></workbook>',
  );
  zip.file(
    'xl/_rels/workbook.xml.rels',
    relsXml([
      ...doc.sheets.map((_, i) => ({ id: `rId${i + 1}`, type: RT.worksheet, target: `worksheets/sheet${i + 1}.xml` })),
      { id: `rId${n + 1}`, type: RT.styles, target: 'styles.xml' },
    ]),
  );
  zip.file('xl/styles.xml', XLSX_STYLES);
  doc.sheets.forEach((s, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, worksheetXml(s)));
  return generate(zip, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

// ---------------------------------------------------------------------
// PPTX (16:9)
// ---------------------------------------------------------------------

const A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const P_NS = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const P_ROOT_NS = `xmlns:a="${A_NS}" xmlns:r="${NS_REL}" xmlns:p="${P_NS}"`;
const SLIDE_W = 12192000;
const SLIDE_H = 6858000;
const LINES_PER_SLIDE = 12;

const GRP =
  '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
  '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

function xfrm(x: number, y: number, cx: number, cy: number): string {
  return `<a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`;
}

function phShape(id: number, name: string, ph: string, spPr: string, bodyPr: string, lstStyle: string, paras: string): string {
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${escAttr(name)}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>` +
    `<p:nvPr>${ph}</p:nvPr></p:nvSpPr><p:spPr>${spPr}</p:spPr>` +
    `<p:txBody>${bodyPr}<a:lstStyle>${lstStyle}</a:lstStyle>${paras}</p:txBody></p:sp>`
  );
}

const EMPTY_P = '<a:p><a:endParaRPr lang="ru-RU"/></a:p>';

function aPara(text: string, lvl = 0, noBullet = false): string {
  const pPr = noBullet ? `<a:pPr marL="0" indent="0"${lvl ? ` lvl="${lvl}"` : ''}><a:buNone/></a:pPr>` : lvl ? `<a:pPr lvl="${lvl}"/>` : '';
  if (!text) return `<a:p>${pPr}<a:endParaRPr lang="ru-RU"/></a:p>`;
  return `<a:p>${pPr}<a:r><a:rPr lang="ru-RU" dirty="0"/><a:t>${escXml(text)}</a:t></a:r></a:p>`;
}

const PPT_THEME =
  XML_DECL +
  `<a:theme xmlns:a="${A_NS}" name="2Mind"><a:themeElements>` +
  '<a:clrScheme name="2Mind">' +
  '<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>' +
  '<a:dk2><a:srgbClr val="1F2937"/></a:dk2><a:lt2><a:srgbClr val="F3F4F6"/></a:lt2>' +
  '<a:accent1><a:srgbClr val="4F46E5"/></a:accent1><a:accent2><a:srgbClr val="F97316"/></a:accent2>' +
  '<a:accent3><a:srgbClr val="22C55E"/></a:accent3><a:accent4><a:srgbClr val="EAB308"/></a:accent4>' +
  '<a:accent5><a:srgbClr val="06B6D4"/></a:accent5><a:accent6><a:srgbClr val="E11D48"/></a:accent6>' +
  '<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>' +
  '<a:fontScheme name="2Mind"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>' +
  '<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>' +
  '<a:fmtScheme name="2Mind"><a:fillStyleLst>' +
  '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'.repeat(3) +
  '</a:fillStyleLst><a:lnStyleLst>' +
  [6350, 12700, 19050].map((w) => `<a:ln w="${w}"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>`).join('') +
  '</a:lnStyleLst><a:effectStyleLst>' +
  '<a:effectStyle><a:effectLst/></a:effectStyle>'.repeat(3) +
  '</a:effectStyleLst><a:bgFillStyleLst>' +
  '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'.repeat(3) +
  '</a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>';

const TITLE_BOX = xfrm(838200, 365125, 10515600, 1325563);
const BODY_BOX = xfrm(838200, 1825625, 10515600, 4351338);
const RECT = '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>';

const BODY_LEVELS: [number, number][] = [
  [228600, 2400],
  [685800, 2000],
  [1143000, 1800],
  [1600200, 1600],
];

const PPT_MASTER =
  XML_DECL +
  `<p:sldMaster ${P_ROOT_NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>` +
  GRP +
  phShape(2, 'Title Placeholder 1', '<p:ph type="title"/>', TITLE_BOX + RECT, '<a:bodyPr anchor="ctr"><a:normAutofit/></a:bodyPr>', '', aPara('Заголовок')) +
  phShape(3, 'Text Placeholder 2', '<p:ph type="body" idx="1"/>', BODY_BOX + RECT, '<a:bodyPr><a:normAutofit/></a:bodyPr>', '', aPara('Текст')) +
  '</p:spTree></p:cSld>' +
  '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
  '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/><p:sldLayoutId id="2147483650" r:id="rId2"/></p:sldLayoutIdLst>' +
  '<p:txStyles><p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="3600" b="1"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mj-lt"/><a:ea typeface="+mj-ea"/><a:cs typeface="+mj-cs"/></a:defRPr></a:lvl1pPr></p:titleStyle>' +
  '<p:bodyStyle>' +
  BODY_LEVELS.map(
    ([marL, sz], i) =>
      `<a:lvl${i + 1}pPr marL="${marL}" indent="-228600"><a:spcBef><a:spcPts val="${i ? 500 : 1000}"/></a:spcBef>` +
      `<a:buFont typeface="Arial"/><a:buChar char="${i % 2 ? '–' : '•'}"/>` +
      `<a:defRPr sz="${sz}"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl${i + 1}pPr>`,
  ).join('') +
  '</p:bodyStyle><p:otherStyle><a:defPPr><a:defRPr lang="ru-RU"/></a:defPPr></p:otherStyle></p:txStyles></p:sldMaster>';

const PPT_LAYOUT_TITLE =
  XML_DECL +
  `<p:sldLayout ${P_ROOT_NS} type="title" preserve="1"><p:cSld name="Титульный слайд"><p:spTree>` +
  GRP +
  phShape(
    2, 'Title 1', '<p:ph type="ctrTitle"/>', xfrm(1524000, 1122363, 9144000, 2387600),
    '<a:bodyPr anchor="b"><a:normAutofit/></a:bodyPr>',
    '<a:lvl1pPr algn="ctr"><a:defRPr sz="5400"/></a:lvl1pPr>', EMPTY_P,
  ) +
  phShape(
    3, 'Subtitle 2', '<p:ph type="subTitle" idx="1"/>', xfrm(1524000, 3602038, 9144000, 1655762),
    '<a:bodyPr><a:normAutofit/></a:bodyPr>',
    '<a:lvl1pPr marL="0" indent="0" algn="ctr"><a:buNone/><a:defRPr sz="2400"><a:solidFill><a:srgbClr val="595959"/></a:solidFill></a:defRPr></a:lvl1pPr>',
    EMPTY_P,
  ) +
  '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>';

const PPT_LAYOUT_CONTENT =
  XML_DECL +
  `<p:sldLayout ${P_ROOT_NS} type="obj" preserve="1"><p:cSld name="Заголовок и объект"><p:spTree>` +
  GRP +
  phShape(2, 'Title 1', '<p:ph type="title"/>', TITLE_BOX, '<a:bodyPr/>', '', EMPTY_P) +
  phShape(3, 'Content Placeholder 2', '<p:ph idx="1"/>', BODY_BOX, '<a:bodyPr/>', '', EMPTY_P) +
  '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>';

function slideXml(shapes: string): string {
  return (
    XML_DECL +
    `<p:sld ${P_ROOT_NS}><p:cSld><p:spTree>${GRP}${shapes}</p:spTree></p:cSld>` +
    '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>'
  );
}

interface SlideDef {
  layout: 1 | 2;
  xml: string;
}

function titleSlide(title: string, subtitle: string): SlideDef {
  return {
    layout: 1,
    xml: slideXml(
      phShape(2, 'Title 1', '<p:ph type="ctrTitle"/>', '', '<a:bodyPr><a:normAutofit/></a:bodyPr>', '', aPara(title)) +
        phShape(3, 'Subtitle 2', '<p:ph type="subTitle" idx="1"/>', '', '<a:bodyPr><a:normAutofit/></a:bodyPr>', '', subtitle ? aPara(subtitle, 0, true) : EMPTY_P),
    ),
  };
}

function contentSlide(title: string, paras: string[]): SlideDef {
  return {
    layout: 2,
    xml: slideXml(
      phShape(2, 'Title 1', '<p:ph type="title"/>', '', '<a:bodyPr><a:normAutofit/></a:bodyPr>', '', aPara(title)) +
        phShape(3, 'Content Placeholder 2', '<p:ph idx="1"/>', '', '<a:bodyPr><a:normAutofit/></a:bodyPr>', '', paras.length ? paras.join('') : EMPTY_P),
    ),
  };
}

function topicLine(t: Topic): string {
  const task = t.task ? (t.task.status === 'done' ? '☑ ' : '☐ ') : '';
  return task + (oneLine(t.text) || '…');
}

export async function exportPptx(doc: MindDoc): Promise<Blob> {
  const zip = await newZip();
  const slides: SlideDef[] = [];

  for (const sheet of doc.sheets) {
    const subtitle = doc.sheets.length > 1 ? sheet.title : oneLine(sheet.root.note?.split('\n')[0]);
    slides.push(titleSlide(oneLine(sheet.root.text) || doc.title, subtitle));
    for (const main of [...sheet.root.children, ...sheet.floating]) {
      const lines: string[] = [];
      const rec = (t: Topic, lvl: number) => {
        lines.push(aPara(topicLine(t), Math.min(lvl, 3)));
        for (const c of t.children) rec(c, lvl + 1);
      };
      for (const c of main.children) rec(c, 0);
      if (!lines.length && main.note?.trim()) {
        for (const l of main.note.replace(/\r\n?/g, '\n').split('\n').slice(0, LINES_PER_SLIDE)) lines.push(aPara(l, 0, true));
      }
      const title = topicLine(main);
      if (!lines.length) {
        slides.push(contentSlide(title, []));
        continue;
      }
      const parts = Math.ceil(lines.length / LINES_PER_SLIDE);
      for (let i = 0; i < parts; i++) {
        slides.push(contentSlide(parts > 1 ? `${title} (${i + 1}/${parts})` : title, lines.slice(i * LINES_PER_SLIDE, (i + 1) * LINES_PER_SLIDE)));
      }
    }
  }

  const ns = slides.length;
  zip.file(
    '[Content_Types].xml',
    contentTypes([
      ['/ppt/presentation.xml', 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml'],
      ['/ppt/slideMasters/slideMaster1.xml', 'application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml'],
      ['/ppt/slideLayouts/slideLayout1.xml', 'application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml'],
      ['/ppt/slideLayouts/slideLayout2.xml', 'application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml'],
      ['/ppt/theme/theme1.xml', 'application/vnd.openxmlformats-officedocument.theme+xml'],
      ['/ppt/presProps.xml', 'application/vnd.openxmlformats-officedocument.presentationml.presProps+xml'],
      ['/ppt/viewProps.xml', 'application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml'],
      ['/ppt/tableStyles.xml', 'application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml'],
      ...slides.map(
        (_, i) => [`/ppt/slides/slide${i + 1}.xml`, 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml'] as [string, string],
      ),
    ]),
  );
  addDocProps(zip, doc.title, 'ppt/presentation.xml');

  zip.file(
    'ppt/presentation.xml',
    XML_DECL +
      `<p:presentation ${P_ROOT_NS} saveSubsetFonts="1">` +
      '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>' +
      `<p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 3}"/>`).join('')}</p:sldIdLst>` +
      `<p:sldSz cx="${SLIDE_W}" cy="${SLIDE_H}"/><p:notesSz cx="6858000" cy="9144000"/>` +
      '<p:defaultTextStyle><a:defPPr><a:defRPr lang="ru-RU"/></a:defPPr></p:defaultTextStyle>' +
      '</p:presentation>',
  );
  zip.file(
    'ppt/_rels/presentation.xml.rels',
    relsXml([
      { id: 'rId1', type: RT.slideMaster, target: 'slideMasters/slideMaster1.xml' },
      { id: 'rId2', type: RT.theme, target: 'theme/theme1.xml' },
      ...slides.map((_, i) => ({ id: `rId${i + 3}`, type: RT.slide, target: `slides/slide${i + 1}.xml` })),
      { id: `rId${ns + 3}`, type: RT.presProps, target: 'presProps.xml' },
      { id: `rId${ns + 4}`, type: RT.viewProps, target: 'viewProps.xml' },
      { id: `rId${ns + 5}`, type: RT.tableStyles, target: 'tableStyles.xml' },
    ]),
  );
  zip.file('ppt/presProps.xml', XML_DECL + `<p:presentationPr ${P_ROOT_NS}/>`);
  zip.file('ppt/viewProps.xml', XML_DECL + `<p:viewPr ${P_ROOT_NS}><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>`);
  zip.file('ppt/tableStyles.xml', XML_DECL + `<a:tblStyleLst xmlns:a="${A_NS}" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`);
  zip.file('ppt/theme/theme1.xml', PPT_THEME);
  zip.file('ppt/slideMasters/slideMaster1.xml', PPT_MASTER);
  zip.file(
    'ppt/slideMasters/_rels/slideMaster1.xml.rels',
    relsXml([
      { id: 'rId1', type: RT.slideLayout, target: '../slideLayouts/slideLayout1.xml' },
      { id: 'rId2', type: RT.slideLayout, target: '../slideLayouts/slideLayout2.xml' },
      { id: 'rId3', type: RT.theme, target: '../theme/theme1.xml' },
    ]),
  );
  zip.file('ppt/slideLayouts/slideLayout1.xml', PPT_LAYOUT_TITLE);
  zip.file('ppt/slideLayouts/slideLayout2.xml', PPT_LAYOUT_CONTENT);
  const layoutRels = relsXml([{ id: 'rId1', type: RT.slideMaster, target: '../slideMasters/slideMaster1.xml' }]);
  zip.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels', layoutRels);
  zip.file('ppt/slideLayouts/_rels/slideLayout2.xml.rels', layoutRels);
  slides.forEach((s, i) => {
    zip.file(`ppt/slides/slide${i + 1}.xml`, s.xml);
    zip.file(
      `ppt/slides/_rels/slide${i + 1}.xml.rels`,
      relsXml([{ id: 'rId1', type: RT.slideLayout, target: `../slideLayouts/slideLayout${s.layout}.xml` }]),
    );
  });
  return generate(zip, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
}

// ---------------------------------------------------------------------
// CSV задач
// ---------------------------------------------------------------------

function csvCell(v: string, sep: string): string {
  let s = v.replace(/\r\n?/g, '\n');
  // защита от CSV-инъекций формул
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return s.includes(sep) || /["\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV всех тем с задачами. По умолчанию разделитель «;» и BOM — чтобы Excel (ru) открыл корректно. */
export function exportCsvTasks(docs: MindDoc[], opts: { sep?: string; bom?: boolean } = {}): string {
  const sep = opts.sep ?? ';';
  const header = ['Карта', 'Лист', 'Задача', 'Путь', 'Статус', 'Приоритет', 'Начало', 'Срок', 'Исполнитель', 'Прогресс', 'Метки', 'Заметка'];
  const rows: string[][] = [header];
  for (const d of docs) {
    for (const s of d.sheets) {
      for (const r of rootsOf(s)) {
        const path: string[] = [];
        const rec = (t: Topic) => {
          if (t.task) {
            const prog = topicProgress(t);
            rows.push([
              d.title,
              s.title,
              oneLine(t.text),
              path.join(' / '),
              STATUS_TEXT[t.task.status] ?? '',
              topicPriority(t),
              t.task.start ?? '',
              t.task.due ?? '',
              t.task.assignee ?? '',
              prog == null ? '' : `${prog}%`,
              (t.labels ?? []).join(', '),
              t.note?.trim() ?? '',
            ]);
          }
          path.push(oneLine(t.text));
          t.children.forEach(rec);
          path.pop();
        };
        rec(r);
      }
    }
  }
  return (opts.bom === false ? '' : '﻿') + rows.map((r) => r.map((c) => csvCell(c, sep)).join(sep)).join('\r\n') + '\r\n';
}
