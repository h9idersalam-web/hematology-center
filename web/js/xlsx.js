// قراءة ملفات إكسل (xlsx) و CSV، وكتابة ملف xlsx، بلا مكتبات خارجية.
// ملف xlsx هو أرشيف zip فيه ملفات XML؛ يُفك بـ DecompressionStream المدمجة في المتصفح.
// الملفات القديمة (xls) غير مدعومة: تُحفظ من إكسل بصيغة xlsx أولاً.

// ------------------------------------------------------------------ zip: القراءة
async function inflateRaw(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const out = new Response(new Blob([bytes]).stream().pipeThrough(ds));
  return new Uint8Array(await out.arrayBuffer());
}

async function unzip(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('الملف ليس بصيغة xlsx. احفظه من إكسل بصيغة «Excel Workbook (.xlsx)» أو CSV.');
  const n = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = new Map();
  const dec = new TextDecoder();
  for (let k = 0; k < n; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('ملف xlsx تالف');
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
    const off = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nl));
    const lnl = dv.getUint16(off + 26, true), lel = dv.getUint16(off + 28, true);
    const start = off + 30 + lnl + lel;
    files.set(name, { method, data: u8.subarray(start, start + csize) });
    p += 46 + nl + el + cl;
  }
  return {
    has: (name) => files.has(name),
    async text(name) {
      const f = files.get(name);
      if (!f) return null;
      if (f.method === 0) return dec.decode(f.data);
      if (f.method === 8) return dec.decode(await inflateRaw(f.data));
      throw new Error('ضغط غير مدعوم في ملف xlsx');
    },
  };
}

// ------------------------------------------------------------------ xlsx → صفوف
const xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
const all = (node, tag) => [...node.getElementsByTagNameNS('*', tag)];
const one = (node, tag) => node.getElementsByTagNameNS('*', tag)[0] || null;

const DATE_FMTS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

function colIndex(ref) {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// رقم تسلسلي في إكسل إلى تاريخ YYYY-MM-DD
export function serialToISO(v) {
  const d = new Date(Math.round((v - 25569) * 86400000));
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}

async function readXlsx(buf) {
  const z = await unzip(buf);
  const wb = xml(await z.text('xl/workbook.xml') || '');
  const sheet = one(wb, 'sheet');
  if (!sheet) throw new Error('لا توجد ورقة في ملف الإكسل');
  // مسار الورقة الأولى من علاقات المصنف
  let target = 'worksheets/sheet1.xml';
  const rid = sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || sheet.getAttribute('r:id');
  const rels = await z.text('xl/_rels/workbook.xml.rels');
  if (rels && rid) {
    const r = all(xml(rels), 'Relationship').find((x) => x.getAttribute('Id') === rid);
    if (r) target = r.getAttribute('Target').replace(/^\/?xl\//, '').replace(/^\//, '');
  }
  const sheetXml = await z.text('xl/' + target);
  if (!sheetXml) throw new Error('تعذّرت قراءة ورقة الإكسل');

  const shared = [];
  const ss = await z.text('xl/sharedStrings.xml');
  if (ss) for (const si of all(xml(ss), 'si')) shared.push(all(si, 't').map((t) => t.textContent).join(''));

  // أنماط الخلايا: أيها تاريخ
  const dateStyle = [];
  const st = await z.text('xl/styles.xml');
  if (st) {
    const sd = xml(st);
    const custom = new Map(all(sd, 'numFmt').map((f) => [+f.getAttribute('numFmtId'), f.getAttribute('formatCode') || '']));
    const xfs = one(sd, 'cellXfs');
    if (xfs) for (const xf of [...xfs.children].filter((c) => c.localName === 'xf')) {
      const id = +xf.getAttribute('numFmtId');
      const code = (custom.get(id) || '').replace(/"[^"]*"|\[[^\]]*\]/g, '');
      dateStyle.push(DATE_FMTS.has(id) || (custom.has(id) && /[dy]/i.test(code)) || (custom.has(id) && /m/i.test(code) && !/[hs]/i.test(code) && /[\/\-.]/.test(code)));
    }
  }

  const rows = [];
  for (const row of all(xml(sheetXml), 'row')) {
    const r = [];
    for (const c of all(row, 'c')) {
      const ref = c.getAttribute('r');
      const i = ref ? colIndex(ref) : r.length;
      const t = c.getAttribute('t');
      const v = one(c, 'v')?.textContent ?? '';
      let val = '';
      if (t === 's') val = shared[+v] ?? '';
      else if (t === 'inlineStr') val = all(c, 't').map((x) => x.textContent).join('');
      else if (t === 'str' || t === 'e') val = v;
      else if (t === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
      else if (v !== '') {
        const num = Number(v);
        val = dateStyle[+(c.getAttribute('s') || 0)] && num > 0 ? { date: serialToISO(num) } : num;
      }
      r[i] = val;
    }
    rows.push(Array.from(r, (x) => x ?? ''));
  }
  return rows;
}

// ------------------------------------------------------------------ CSV
function decodeText(buf) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, ''); }
  catch { return new TextDecoder('windows-1256').decode(buf); }   // CSV عربي محفوظ من إكسل ويندوز
}

function readCsv(text) {
  const first = text.split(/\r?\n/, 1)[0];
  const sep = [',', ';', '\t'].map((s) => [s, first.split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// يقرأ ملفاً (File) ويعيد صفوف الورقة الأولى: كل خلية نص أو رقم أو {date}
export async function readSheet(file) {
  const buf = await file.arrayBuffer();
  const u8 = new Uint8Array(buf);
  if (u8[0] === 0x50 && u8[1] === 0x4b) {
    if (typeof DecompressionStream === 'undefined') throw new Error('المتصفح قديم ولا يقرأ ملفات xlsx. حدّث المتصفح أو احفظ الملف بصيغة CSV.');
    return readXlsx(buf);
  }
  if (u8[0] === 0xd0 && u8[1] === 0xcf) throw new Error('هذا ملف إكسل قديم (xls). افتحه في إكسل واحفظه بصيغة «Excel Workbook (.xlsx)» ثم ارفعه.');
  return readCsv(decodeText(buf));
}

// ------------------------------------------------------------------ كتابة xlsx (للتنزيل)
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(u8) { let c = 0xffffffff; for (const b of u8) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

function zip(entries) {
  const enc = new TextEncoder();
  const parts = [], central = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const nb = enc.encode(name), data = enc.encode(text), crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, nb.length, true);
    parts.push(new Uint8Array(lh.buffer), nb, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
    ch.setUint16(28, nb.length, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), nb);
    offset += 30 + nb.length + data.length;
  }
  const csize = central.reduce((s, x) => s + x.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, csize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
function colName(i) { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }

// rows: مصفوفة صفوف، الأول عناوين. الأرقام تُكتب أرقاماً والباقي نصاً. الورقة من اليمين لليسار.
export function writeXlsx(rows, sheetName = 'Sheet1', widths = []) {
  const sheetRows = rows.map((r, ri) => `<row r="${ri + 1}">` + r.map((v, ci) => {
    const ref = colName(ci) + (ri + 1);
    const s = ri === 0 ? ' s="1"' : '';
    if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}"${s}><v>${v}</v></c>`;
    if (v === null || v === undefined || v === '') return '';
    return `<c r="${ref}" t="inlineStr"${s}><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  }).join('') + '</row>').join('');
  const cols = widths.length ? '<cols>' + widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols>' : '';
  const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const PR = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const OR = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  return zip([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PR}"><Relationship Id="rId1" Type="${OR}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook ${NS} ${R}><sheets><sheet name="${esc(sheetName.slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PR}"><Relationship Id="rId1" Type="${OR}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${OR}/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet ${NS}><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf fontId="0" xfId="0"/><xf fontId="1" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`],
    ['xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet ${NS}><sheetViews><sheetView workbookViewId="0" rightToLeft="1"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols}<sheetData>${sheetRows}</sheetData></worksheet>`],
  ]);
}

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
