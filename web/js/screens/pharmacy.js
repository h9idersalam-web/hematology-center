// الصيدلية الداخلية (تبويب «الصيدلية» في شريط التنقل): تقرير أسبوعي من ملف إكسل
import { sb, q, rpc } from '../api.js';
import { h, mount, icon, topbar, bottomNav, notice, toast, busy, empty, field, todayISO, count, confirmDialog, arNorm } from '../ui.js';
import { can } from '../perms.js';
import { readSheet, writeXlsx, download } from '../xlsx.js';
import { FIELDS, STATUS, guessColumns, rowsToItems, expiryState } from '../inventory.js';

const STATUS_PILL = { available: 'ok', low: 'warn', out: 'err' };
// التواريخ بالأرقام الإنكليزية مثل 2026/11/12 (بقرار صاحب المشروع)
const ymd = (d) => { if (!d) return '—'; const s = typeof d === 'string' && d.length === 10 ? d : new Date(d).toLocaleDateString('en-CA'); return s.replace(/-/g, '/'); };
const hm = (d) => new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const numTxt = (n) => (n === null || n === undefined ? '—' : String(+n));

function dialog(title, build) {
  const dlg = h('dialog', null);
  const close = () => { dlg.close(); dlg.remove(); };
  dlg.append(h('div', { class: 'dlg' }, h('h2', { text: title }), ...build(close)));
  document.body.append(dlg);
  dlg.addEventListener('cancel', close);
  dlg.showModal();
  return close;
}

export async function render(root, params) {
  const editor = can('editInventory');
  const reports = await q(sb.from('inventory_reports').select('id, report_date, source, created_at, updated_at, profiles!inventory_reports_created_by_fkey(full_name)')
    .is('archived_at', null).order('report_date', { ascending: false }).order('created_at', { ascending: false }).limit(60));
  const rep = reports.find((r) => r.id === params.get('id')) || reports[0] || null;
  const isLatest = rep && rep.id === reports[0]?.id;
  let items = rep ? await q(sb.from('inventory_items').select('*').eq('report_id', rep.id).is('archived_at', null).order('sort')) : [];

  let search = '';
  const listBox = h('div', { class: 'xl-wrap', role: 'region', 'aria-label': 'جدول الأدوية', tabindex: 0 });
  const fileIn = h('input', { type: 'file', accept: '.xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv', hidden: true, id: 'inv-file',
    onchange: (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importFile(f); } });

  const actions = editor ? h('div', { class: 'inv-actions' },
    h('label', { class: 'btn primary', for: 'inv-file', role: 'button', tabindex: 0,
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileIn.click(); } } },
      icon('upload', 20, '#fff'), h('span', { text: 'رفع ملف إكسل الأسبوع' })),
    rep ? h('button', { type: 'button', class: 'btn secondary', onclick: (e) => copyLast(e.currentTarget) }, icon('copy', 20), h('span', { text: 'نسخ هذا التقرير لأسبوع جديد' })) : null,
    h('button', { type: 'button', class: 'btn secondary', onclick: (e) => createReport(e.currentTarget, [], 'إدخال يدوي') }, icon('plus', 20), h('span', { text: 'تقرير فارغ' }))) : null;

  mount(root, h('div', { class: 'screen' },
    topbar({ title: 'الصيدلية الداخلية', sub: rep ? `تقرير بتاريخ ${ymd(rep.report_date)}` : 'توافر الأدوية في المركز' }),
    h('main', { class: 'main with-nav' },
      fileIn,
      editor ? h('p', { class: 'hint', text: 'ارفع ملف الإكسل كل أسبوع (xlsx أو CSV): يتعرف التطبيق على أعمدة اسم الدواء والعدد والصلاحية والحالة، وتراجعها قبل الحفظ. ثم أضف أو عدّل أو احذف أي دواء.' }) : null,
      actions,
      editor ? notice('info', 'info', h('p', { class: 'xls-note', text: 'يجب أن يكون الملف بصيغة xlsx أو CSV. ملفات xls القديمة لا تُقرأ، فتُحفظ من الإكسل بصيغة xlsx أولاً.' })) : null,
      rep ? h('div', { class: 'card', style: 'gap: 6px' },
        h('div', { style: 'display: flex; justify-content: space-between; gap: 8px; align-items: center; flex-wrap: wrap' },
          h('strong', { text: `تقرير بتاريخ ${ymd(rep.report_date)}` }),
          isLatest ? h('span', { class: 'pill ok', text: 'الأحدث' }) : h('span', { class: 'pill muted', text: 'تقرير سابق' })),
        h('p', { class: 'hint', text: [rep.profiles?.full_name, rep.source, 'آخر تعديل ' + ymd(rep.updated_at) + ' ' + hm(rep.updated_at)].filter(Boolean).join(' · ') }),
        reports.length > 1 ? field('التقارير السابقة', h('select', { class: 'input', onchange: (e) => { location.hash = '#/report-pharmacy?id=' + e.target.value; } },
          reports.map((r) => h('option', { value: r.id, selected: r.id === rep.id, text: `تقرير ${ymd(r.report_date)}${r.id === reports[0].id ? ' (الأحدث)' : ''}` })))) : null)
        : h('div', { class: 'card' }, empty(editor ? 'لا يوجد تقرير بعد. ارفع ملف إكسل الأسبوع لإنشائه.' : 'لم يرفع مسؤول الصيدلية الداخلية تقريراً بعد.', 'pill')),
      rep ? h('input', { class: 'input', type: 'search', placeholder: 'ابحث باسم الدواء', 'aria-label': 'ابحث باسم الدواء',
        oninput: (e) => { search = e.target.value; drawList(); } }) : null,
      rep ? listBox : null,
      rep ? h('div', { class: 'inv-actions' },
        editor ? h('button', { type: 'button', class: 'btn primary', onclick: () => itemDialog(null) }, icon('plus', 20, '#fff'), h('span', { text: 'إضافة دواء' })) : null,
        h('button', { type: 'button', class: 'btn secondary', onclick: exportXlsx }, icon('download', 20), h('span', { text: 'تنزيل كملف إكسل' })),
        editor ? h('button', { type: 'button', class: 'btn secondary', style: 'color: var(--brand-dark)', onclick: (e) => archiveReport(e.currentTarget) }, icon('archive', 20), h('span', { text: 'حذف التقرير' })) : null) : null),
    bottomNav('pharmacy')));
  if (rep) drawList();

  // جدول مثل الإكسل: خطوط بين كل الخانات، وعمود ترقيم، ويُعدَّل الدواء بالضغط على صفه
  function drawList() {
    const qs = arNorm(search.trim());
    const rows = items.filter((i) => !qs || arNorm(i.drug_name).includes(qs));
    if (!rows.length) return listBox.replaceChildren(h('div', { class: 'card' }, empty(items.length ? 'لا يوجد دواء بهذا الاسم' : 'التقرير فارغ. أضف الأدوية.', 'pill')));
    listBox.replaceChildren(h('table', { class: 'xl' },
      h('thead', null, h('tr', null, ['#', 'اسم الدواء', 'العدد', 'الوحدة', 'الصلاحية', 'الحالة', 'الملاحظات'].map((t) => h('th', { scope: 'col', text: t })))),
      h('tbody', null, rows.map((i, n) => {
        const es = expiryState(i.expiry_date);
        const tr = h('tr', { class: 'st-' + i.status + (editor ? ' edit' : ''), tabindex: editor ? 0 : null, 'aria-label': editor ? 'تعديل ' + i.drug_name : null,
          onclick: editor ? () => itemDialog(i) : null, onkeydown: editor ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); itemDialog(i); } } : null },
          h('td', { class: 'rn', text: n + 1 }),
          h('td', { class: 'nm', dir: 'auto', text: i.drug_name }),
          h('td', { class: 'num', text: numTxt(i.quantity) }),
          h('td', { dir: 'auto', text: i.unit || '' }),
          h('td', { class: 'num' + (es === 'expired' || es === 'soon' ? ' exp ' + es : ''), title: es === 'expired' ? 'منتهي الصلاحية' : es === 'soon' ? 'تنتهي خلال 3 أشهر' : null, text: ymd(i.expiry_date) }),
          h('td', null, h('span', { class: 'pill ' + STATUS_PILL[i.status], text: STATUS[i.status] })),
          h('td', { class: 'nt', dir: 'auto', text: i.notes || '' }));
        return tr;
      }))));
  }

  async function reload(id) { location.hash = '#/report-pharmacy?id=' + id + '&r=' + Date.now(); }

  function itemDialog(it) {
    const name = h('input', { class: 'input', dir: 'auto', value: it?.drug_name || '', required: true, maxlength: 200 });
    const qty = h('input', { class: 'input', type: 'number', min: 0, step: 'any', inputmode: 'decimal', value: it?.quantity ?? '' });
    const unit = h('input', { class: 'input', dir: 'auto', value: it?.unit || '', maxlength: 40, placeholder: 'vial, amp, tab…' });
    const exp = h('input', { class: 'input', type: 'date', value: it?.expiry_date || '' });
    let st = it?.status || 'available';
    const stSeg = h('div', { class: 'segmented', role: 'group', 'aria-label': 'الحالة' });
    const drawSt = () => stSeg.replaceChildren(...Object.entries(STATUS).map(([k, l]) =>
      h('button', { type: 'button', 'aria-pressed': st === k ? 'true' : 'false', onclick: () => { st = k; drawSt(); } }, l)));
    drawSt();
    const notes = h('textarea', { class: 'input', rows: 2, maxlength: 500, dir: 'auto' }); notes.value = it?.notes || '';
    const err = h('div');
    dialog(it ? 'تعديل الدواء' : 'إضافة دواء', (close) => [
      field('اسم الدواء', name), h('div', { class: 'grid-2' }, field('العدد', qty), field('الوحدة', unit)),
      field('تاريخ انتهاء الصلاحية', exp), h('div', { class: 'field' }, h('span', { class: 'label', text: 'الحالة' }), stSeg),
      field('الملاحظات', notes), err,
      h('button', { type: 'button', class: 'btn primary block', text: 'حفظ', onclick: (e) => busy(e.currentTarget, async () => {
        try {
          await rpc('inventory_save_item', { p_report: rep.id, p_item: it?.id || null,
            p_data: { drug_name: name.value, quantity: qty.value, unit: unit.value, expiry_date: exp.value, status: st, notes: notes.value } });
          close(); toast(it ? 'حُفظ التعديل' : 'أُضيف الدواء');
          items = await q(sb.from('inventory_items').select('*').eq('report_id', rep.id).is('archived_at', null).order('sort'));
          drawList();
        } catch (x) { err.replaceChildren(notice('err', 'warn', h('p', { text: x.message }))); }
      }) }),
      it ? h('button', { type: 'button', class: 'btn secondary block', style: 'color: var(--brand-dark)', text: 'حذف الدواء من التقرير', onclick: async () => {
        close();
        if (!await confirmDialog({ title: 'حذف ' + it.drug_name, body: 'يُحذف من هذا التقرير، ويبقى في سجل التعديلات.', okText: 'حذف', danger: true })) return;
        try { await rpc('inventory_remove_item', { p_item: it.id }); toast('حُذف الدواء'); items = items.filter((x) => x.id !== it.id); drawList(); }
        catch (x) { toast(x.message, true); }
      } }) : null,
      h('button', { type: 'button', class: 'link-btn', text: 'إلغاء', onclick: close }),
    ]);
    name.focus();
  }

  async function createReport(btn, list, source, date) {
    await busy(btn, async () => {
      try {
        const id = await rpc('inventory_create_report', { p_report_date: date || todayISO(), p_source: source, p_items: list });
        toast('أُنشئ تقرير الأسبوع'); reload(id);
      } catch (x) { toast(x.message, true); }
    });
  }
  function copyLast(btn) {
    createReport(btn, items.map(({ drug_name, quantity, unit, expiry_date, status, notes }) => ({ drug_name, quantity, unit, expiry_date, status, notes })),
      'نسخة من تقرير ' + ymd(rep.report_date));
  }
  async function archiveReport(btn) {
    const reason = await confirmDialog({ title: 'حذف تقرير ' + ymd(rep.report_date), body: 'يختفي التقرير من القائمة ويبقى في سجل التعديلات.',
      okText: 'حذف', danger: true, input: { label: 'سبب الحذف', placeholder: 'مثلاً: رُفع الملف الخطأ' } });
    if (reason === null) return;
    await busy(btn, async () => {
      try { await rpc('inventory_archive_report', { p_report: rep.id, p_reason: reason }); toast('حُذف التقرير'); location.hash = '#/report-pharmacy?r=' + Date.now(); }
      catch (x) { toast(x.message, true); }
    });
  }
  function exportXlsx() {
    const rows = [['اسم الدواء', 'العدد', 'الوحدة', 'تاريخ انتهاء الصلاحية', 'الحالة', 'الملاحظات'],
      ...items.map((i) => [i.drug_name, i.quantity === null ? '' : +i.quantity, i.unit || '', i.expiry_date ? ymd(i.expiry_date) : '', STATUS[i.status], i.notes || ''])];
    download(writeXlsx(rows, 'الصيدلية الداخلية', [34, 10, 12, 20, 10, 40]), `تقرير الصيدلية الداخلية ${rep.report_date}.xlsx`);
  }

  // --------------------------------------------- استيراد الملف: مراجعة الأعمدة والقيم قبل الحفظ
  async function importFile(file) {
    let rows;
    try { rows = await readSheet(file); }
    catch (x) { return toast(x.message || 'تعذّرت قراءة الملف', true); }
    rows = rows.filter((r) => r.some((c) => String(c && typeof c === 'object' ? c.date : c ?? '').trim()));
    if (!rows.length) return toast('الملف فارغ', true);
    const g = guessColumns(rows);
    let header = g.header; const map = { ...g.map };
    const width = Math.max(...rows.slice(0, 50).map((r) => r.length));
    const label = (c) => {
      const t = header >= 0 ? rows[header][c] : '';
      return `العمود ${c + 1}` + (t && typeof t !== 'object' ? ` (${String(t).slice(0, 30)})` : '');
    };
    const dateIn = h('input', { class: 'input', type: 'date', value: todayISO() });
    const mapBox = h('div', { class: 'inv-map' });
    const preview = h('div');
    let parsed = [];
    function drawMap() {
      mapBox.replaceChildren(...FIELDS.map(([f, l]) => field(l, h('select', { class: 'input', onchange: (e) => {
        if (e.target.value === '') delete map[f]; else map[f] = +e.target.value; drawPreview(); } },
        h('option', { value: '', text: f === 'drug_name' ? 'اختر العمود' : 'لا يوجد' }),
        Array.from({ length: width }, (_, c) => h('option', { value: c, selected: map[f] === c, text: label(c) }))))));
    }
    function drawPreview() {
      parsed = 'drug_name' in map ? rowsToItems(rows, header, map) : [];
      const warn = parsed.filter((i) => i.warnings.length);
      const s = { low: parsed.filter((i) => i.status === 'low').length, out: parsed.filter((i) => i.status === 'out').length };
      preview.replaceChildren(
        !('drug_name' in map) ? notice('warn', 'warn', h('p', { text: 'اختر عمود اسم الدواء.' }))
          : notice(parsed.length ? 'ok' : 'warn', parsed.length ? 'check' : 'warn', h('p', { text: parsed.length
            ? `قُرئ ${count(parsed.length, 'drug')}: ${s.low} شحيح و${s.out} نافد.` : 'لم يُقرأ أي دواء. تأكد من اختيار الأعمدة.' })),
        warn.length ? notice('warn', 'warn', h('p', { text: `${warn.length} صفاً فيه قيمة لم تُفهم (معلّمة بالأصفر)؛ حُفظ نصها الأصلي في الملاحظات. راجعها قبل الحفظ أو عدّلها بعده.` })) : null,
        parsed.length ? h('div', { class: 'inv-preview xl-wrap', role: 'region', 'aria-label': 'معاينة الأدوية', tabindex: 0 },
          h('table', { class: 'xl' },
            h('thead', null, h('tr', null, ['#', 'اسم الدواء', 'العدد', 'الصلاحية', 'الحالة'].map((t) => h('th', { text: t })))),
            h('tbody', null, parsed.slice(0, 300).map((i) => h('tr', { class: i.warnings.length ? 'warn' : null },
              h('td', { text: i.row }), h('td', { dir: 'auto', text: i.drug_name }),
              h('td', { class: i.warnings.includes('العدد') ? 'bad' : null, text: numTxt(i.quantity) + (i.unit ? ' ' + i.unit : '') }),
              h('td', { class: i.warnings.includes('تاريخ الصلاحية') ? 'bad' : null, text: i.expiry_date ? ymd(i.expiry_date) : (i.warnings.includes('تاريخ الصلاحية') ? 'لم يُفهم' : '—') }),
              h('td', null, h('span', { class: 'pill ' + STATUS_PILL[i.status], text: STATUS[i.status] }))))))) : null,
        parsed.length > 300 ? h('p', { class: 'hint', text: `تُعرض أول 300 صف من ${parsed.length}؛ تُحفظ كلها.` }) : null);
    }
    const headerSel = h('select', { class: 'input', onchange: (e) => { header = +e.target.value; drawMap(); drawPreview(); } },
      h('option', { value: -1, selected: header === -1, text: 'لا يوجد صف عناوين' }),
      rows.slice(0, 10).map((r, i) => h('option', { value: i, selected: header === i, text: `الصف ${i + 1}: ` + r.map((c) => (c && typeof c === 'object' ? c.date : c)).filter((c) => c !== '').join(' | ').slice(0, 60) })));
    drawMap(); drawPreview();
    dialog('مراجعة ملف ' + file.name, (close) => [
      h('p', { class: 'hint', text: 'تأكد أن كل حقل مربوط بالعمود الصحيح، وراجع المعاينة، ثم احفظ. يُنشأ تقرير جديد للأسبوع ويبقى السابق محفوظاً.' }),
      field('تاريخ التقرير', dateIn), field('صف العناوين', headerSel), mapBox, preview,
      h('button', { type: 'button', class: 'btn primary block', text: 'حفظ التقرير', onclick: async (e) => {
        if (!parsed.length) return toast('لا توجد أدوية للحفظ', true);
        const list = parsed.map(({ drug_name, quantity, unit, expiry_date, status, notes }) => ({ drug_name, quantity, unit, expiry_date, status, notes }));
        await createReport(e.currentTarget, list, file.name, dateIn.value);
        close();
      } }),
      h('button', { type: 'button', class: 'link-btn', text: 'إلغاء', onclick: close }),
    ]);
  }
}
