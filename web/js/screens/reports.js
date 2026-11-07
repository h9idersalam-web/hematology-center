// الصيدلية الداخلية (تبويب في شريط التنقل): تقرير أسبوعي من ملف إكسل
// قسم التقارير: تقرير الصيدلية السريرية (تسليم الشفتات)
import { sb, q, rpc } from '../api.js';
import { h, mount, icon, topbar, bottomNav, notice, toast, busy, empty, field, fmtDate, fmtTime, todayISO, count, confirmDialog, arNorm, initials } from '../ui.js';
import { can } from '../perms.js';
import { state } from '../app.js';
import { readSheet, writeXlsx, download } from '../xlsx.js';
import { FIELDS, STATUS, guessColumns, rowsToItems, expiryState } from '../inventory.js';

const STATUS_PILL = { available: 'ok', low: 'warn', out: 'err' };
const SHIFTS = [['morning_middle', 'من الصباحي إلى الوسطي'], ['middle_night', 'من الوسطي إلى الخفر']];
const fmtShort = (d) => fmtDate(d, { day: 'numeric', month: 'short', year: 'numeric' });
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

// ================================================================ الصفحة الرئيسية للقسم
export async function hub(root) {
  const hoS = h('span', { class: 's', text: '…' });
  mount(root, h('div', { class: 'screen' },
    topbar({ title: 'التقارير', back: '#/home' }),
    h('main', { class: 'main with-nav' },
      h('div', { class: 'report-tiles' },
        h('a', { class: 'report-tile', href: '#/report-handover' },
          h('span', { class: 'report-ic' }, icon('swap', 30)),
          h('span', { class: 't', text: 'تقرير الصيدلية السريرية' }), hoS))),
    bottomNav('home')));

  q(sb.from('shift_handovers').select('report_date, shift_handover_items(archived_at)').order('report_date', { ascending: false }).limit(2)).then((r) => {
    if (!r.length) return hoS.textContent = 'تسليم واستلام بين الشفتات';
    const d = r[0].report_date;
    const n = r.filter((x) => x.report_date === d).flatMap((x) => x.shift_handover_items).filter((i) => !i.archived_at).length;
    hoS.textContent = `تسليم ${fmtShort(d)} · ${count(n, 'patient')}`;
  }).catch(() => { hoS.textContent = ''; });
}

// ================================================================ تقرير الصيدلية الداخلية
export async function pharmacy(root, params) {
  const editor = can('editInventory');
  const reports = await q(sb.from('inventory_reports').select('id, report_date, source, created_at, updated_at, profiles!inventory_reports_created_by_fkey(full_name)')
    .is('archived_at', null).order('report_date', { ascending: false }).order('created_at', { ascending: false }).limit(60));
  const rep = reports.find((r) => r.id === params.get('id')) || reports[0] || null;
  const isLatest = rep && rep.id === reports[0]?.id;
  let items = rep ? await q(sb.from('inventory_items').select('*').eq('report_id', rep.id).is('archived_at', null).order('sort')) : [];

  let filter = params.get('f') || 'all', search = '';
  const listBox = h('div', { class: 'card flush' });
  const seg = h('div', { class: 'segmented', role: 'group', 'aria-label': 'تصفية الأدوية' });
  const summary = h('div', { class: 'inv-summary' });
  const fileIn = h('input', { type: 'file', accept: '.xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv', hidden: true, id: 'inv-file',
    onchange: (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importFile(f); } });

  const actions = editor ? h('div', { class: 'inv-actions' },
    h('label', { class: 'btn primary', for: 'inv-file', role: 'button', tabindex: 0,
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileIn.click(); } } },
      icon('upload', 20, '#fff'), h('span', { text: 'رفع ملف إكسل الأسبوع' })),
    rep ? h('button', { type: 'button', class: 'btn secondary', onclick: (e) => copyLast(e.currentTarget) }, icon('copy', 20), h('span', { text: 'نسخ هذا التقرير لأسبوع جديد' })) : null,
    h('button', { type: 'button', class: 'btn secondary', onclick: (e) => createReport(e.currentTarget, [], 'إدخال يدوي') }, icon('plus', 20), h('span', { text: 'تقرير فارغ' }))) : null;

  mount(root, h('div', { class: 'screen' },
    topbar({ title: 'الصيدلية الداخلية', sub: rep ? `تقرير أسبوع ${fmtShort(rep.report_date)}` : 'توافر الأدوية في المركز' }),
    h('main', { class: 'main with-nav' },
      fileIn,
      editor ? h('p', { class: 'hint', text: 'ارفع ملف الإكسل كل أسبوع (xlsx أو CSV): يتعرف التطبيق على أعمدة اسم الدواء والعدد والصلاحية والحالة، وتراجعها قبل الحفظ. ثم أضف أو عدّل أو احذف أي دواء.' }) : null,
      actions,
      rep ? h('div', { class: 'card', style: 'gap: 6px' },
        h('div', { style: 'display: flex; justify-content: space-between; gap: 8px; align-items: center; flex-wrap: wrap' },
          h('strong', { text: `تقرير أسبوع ${fmtDate(rep.report_date)}` }),
          isLatest ? h('span', { class: 'pill ok', text: 'الأحدث' }) : h('span', { class: 'pill muted', text: 'تقرير سابق' })),
        h('p', { class: 'hint', text: [rep.profiles?.full_name, rep.source, 'آخر تعديل ' + fmtShort(rep.updated_at) + ' ' + fmtTime(rep.updated_at)].filter(Boolean).join(' · ') }),
        reports.length > 1 ? field('التقارير السابقة', h('select', { class: 'input', onchange: (e) => { location.hash = '#/report-pharmacy?id=' + e.target.value; } },
          reports.map((r) => h('option', { value: r.id, selected: r.id === rep.id, text: `أسبوع ${fmtShort(r.report_date)}${r.id === reports[0].id ? ' (الأحدث)' : ''}` })))) : null)
        : h('div', { class: 'card' }, empty(editor ? 'لا يوجد تقرير بعد. ارفع ملف إكسل الأسبوع لإنشائه.' : 'لم يرفع مسؤول الصيدلية الداخلية تقريراً بعد.', 'pill')),
      rep ? summary : null,
      rep ? h('input', { class: 'input', type: 'search', placeholder: 'ابحث باسم الدواء', 'aria-label': 'ابحث باسم الدواء',
        oninput: (e) => { search = e.target.value; drawList(); } }) : null,
      rep ? seg : null,
      rep ? listBox : null,
      rep ? h('div', { class: 'inv-actions' },
        editor ? h('button', { type: 'button', class: 'btn primary', onclick: () => itemDialog(null) }, icon('plus', 20, '#fff'), h('span', { text: 'إضافة دواء' })) : null,
        h('button', { type: 'button', class: 'btn secondary', onclick: exportXlsx }, icon('download', 20), h('span', { text: 'تنزيل كملف إكسل' })),
        editor ? h('button', { type: 'button', class: 'btn secondary', style: 'color: var(--brand-dark)', onclick: (e) => archiveReport(e.currentTarget) }, icon('archive', 20), h('span', { text: 'حذف التقرير' })) : null) : null),
    bottomNav('pharmacy')));
  if (rep) { drawSeg(); drawList(); }

  function stats() {
    const exp = items.map((i) => expiryState(i.expiry_date));
    return {
      all: items.length,
      low: items.filter((i) => i.status === 'low').length,
      out: items.filter((i) => i.status === 'out').length,
      exp: exp.filter((x) => x === 'expired' || x === 'soon').length,
      expired: exp.filter((x) => x === 'expired').length,
    };
  }
  function drawSeg() {
    const s = stats();
    summary.replaceChildren(
      h('div', { class: 'stat plain' }, h('span', { class: 'n', text: s.all }), h('span', { class: 'l', text: 'دواء في التقرير' })),
      h('div', { class: 'stat warn' }, h('span', { class: 'n', text: s.low }), h('span', { class: 'l', text: 'شحيح' })),
      h('div', { class: 'stat brand' }, h('span', { class: 'n', text: s.out }), h('span', { class: 'l', text: 'نافد' })),
      h('div', { class: 'stat info' }, h('span', { class: 'n', text: s.exp }), h('span', { class: 'l', text: s.expired ? `منتهي أو قريب (${s.expired} منتهٍ)` : 'تنتهي صلاحيته خلال 3 أشهر' })));
    seg.replaceChildren(...[['all', 'الكل', s.all], ['low', 'شحيح', s.low], ['out', 'نافد', s.out], ['exp', 'الصلاحية', s.exp]].map(([id, l, n]) =>
      h('button', { type: 'button', 'aria-pressed': filter === id ? 'true' : 'false', onclick: () => { filter = id; drawSeg(); drawList(); } }, `${l} (${n})`)));
  }
  function drawList() {
    const qs = arNorm(search.trim());
    const rows = items.filter((i) => (filter === 'all' || (filter === 'exp' ? ['expired', 'soon'].includes(expiryState(i.expiry_date)) : i.status === filter))
      && (!qs || arNorm(i.drug_name).includes(qs)));
    if (filter === 'exp') rows.sort((a, b) => a.expiry_date.localeCompare(b.expiry_date));
    listBox.replaceChildren(...(rows.length ? rows.map(itemRow) : [empty(items.length ? 'لا توجد أدوية بهذه التصفية' : 'التقرير فارغ. أضف الأدوية.', 'pill')]));
  }
  function itemRow(i) {
    const es = expiryState(i.expiry_date);
    const tag = editor ? 'button' : 'div';
    return h(tag, { class: 'row inv-row', type: editor ? 'button' : null, onclick: editor ? () => itemDialog(i) : null, 'aria-label': editor ? 'تعديل ' + i.drug_name : null },
      h('span', { class: 'grow' },
        h('span', { class: 't ltr-auto', dir: 'auto', text: i.drug_name }),
        h('span', { class: 's inv-meta' },
          h('span', { text: 'العدد: ' + numTxt(i.quantity) + (i.unit ? ' ' + i.unit : '') }),
          i.expiry_date ? h('span', { class: 'exp ' + es, text: (es === 'expired' ? 'منتهي الصلاحية ' : 'الصلاحية ') + fmtShort(i.expiry_date) }) : h('span', { text: 'الصلاحية: —' })),
        i.notes ? h('span', { class: 's', dir: 'auto', text: i.notes }) : null),
      h('span', { class: 'pill ' + STATUS_PILL[i.status], text: STATUS[i.status] }));
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
          drawSeg(); drawList();
        } catch (x) { err.replaceChildren(notice('err', 'warn', h('p', { text: x.message }))); }
      }) }),
      it ? h('button', { type: 'button', class: 'btn secondary block', style: 'color: var(--brand-dark)', text: 'حذف الدواء من التقرير', onclick: async () => {
        close();
        if (!await confirmDialog({ title: 'حذف ' + it.drug_name, body: 'يُحذف من هذا التقرير، ويبقى في سجل التعديلات.', okText: 'حذف', danger: true })) return;
        try { await rpc('inventory_remove_item', { p_item: it.id }); toast('حُذف الدواء'); items = items.filter((x) => x.id !== it.id); drawSeg(); drawList(); }
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
      'نسخة من تقرير أسبوع ' + rep.report_date);
  }
  async function archiveReport(btn) {
    const reason = await confirmDialog({ title: 'حذف تقرير أسبوع ' + fmtShort(rep.report_date), body: 'يختفي التقرير من القائمة ويبقى في سجل التعديلات.',
      okText: 'حذف', danger: true, input: { label: 'سبب الحذف', placeholder: 'مثلاً: رُفع الملف الخطأ' } });
    if (reason === null) return;
    await busy(btn, async () => {
      try { await rpc('inventory_archive_report', { p_report: rep.id, p_reason: reason }); toast('حُذف التقرير'); location.hash = '#/report-pharmacy?r=' + Date.now(); }
      catch (x) { toast(x.message, true); }
    });
  }
  function exportXlsx() {
    const rows = [['اسم الدواء', 'العدد', 'الوحدة', 'تاريخ انتهاء الصلاحية', 'الحالة', 'الملاحظات'],
      ...items.map((i) => [i.drug_name, i.quantity === null ? '' : +i.quantity, i.unit || '', i.expiry_date || '', STATUS[i.status], i.notes || ''])];
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
        parsed.length ? h('div', { class: 'inv-preview', role: 'region', 'aria-label': 'معاينة الأدوية', tabindex: 0 },
          h('table', null,
            h('thead', null, h('tr', null, ['#', 'اسم الدواء', 'العدد', 'الصلاحية', 'الحالة'].map((t) => h('th', { text: t })))),
            h('tbody', null, parsed.slice(0, 300).map((i) => h('tr', { class: i.warnings.length ? 'warn' : null },
              h('td', { text: i.row }), h('td', { dir: 'auto', text: i.drug_name }),
              h('td', { class: i.warnings.includes('العدد') ? 'bad' : null, text: numTxt(i.quantity) + (i.unit ? ' ' + i.unit : '') }),
              h('td', { class: i.warnings.includes('تاريخ الصلاحية') ? 'bad' : null, text: i.expiry_date || (i.warnings.includes('تاريخ الصلاحية') ? 'لم يُفهم' : '—') }),
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

// ================================================================ تقرير الصيدلية السريرية: تسليم الشفتات
export async function handover(root, params) {
  const writer = can('writeHandover');
  const seesOld = state.profile.is_admin || state.profile.role === 'chief_clinical_pharmacist';
  const current = await rpc('handover_current_date', {});
  const today = await rpc('baghdad_today', {});
  const wanted = /^\d{4}-\d{2}-\d{2}$/.test(params.get('d') || '') && seesOld ? params.get('d') : current;
  const isCurrent = wanted === current;

  const reps = wanted ? await q(sb.from('shift_handovers').select('id, shift, report_date, shift_handover_items(id, patient_id, patient_name, medications, notes, created_at, updated_at, archived_at, author:profiles!shift_handover_items_created_by_fkey(full_name))')
    .eq('report_date', wanted)) : [];
  const patients = writer ? await q(sb.from('patients').select('id, full_name, file_no').is('archived_at', null).order('full_name').limit(1000)) : [];
  const hourNow = +new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Asia/Baghdad' }).format(new Date());
  const defaultShift = hourNow < 14 ? 'morning_middle' : 'middle_night';

  const sections = SHIFTS.map(([k, label]) => {
    const r = reps.find((x) => x.shift === k);
    const rows = (r?.shift_handover_items || []).filter((i) => !i.archived_at).sort((a, b) => a.created_at.localeCompare(b.created_at));
    return h('section', { class: 'section' },
      h('div', { class: 'section-head' }, h('h2', { text: label }), h('span', { class: 'count', text: rows.length })),
      h('div', { class: 'card flush' }, rows.length ? rows.map((i) => hoRow(i, k)) : [empty('لا يوجد مرضى في هذا التسليم', 'users')]));
  });

  mount(root, h('div', { class: 'screen' },
    topbar({ title: 'تقرير الصيدلية السريرية', sub: wanted ? 'تسليم ' + fmtDate(wanted, { weekday: 'long', day: 'numeric', month: 'long' }) : 'تسليم واستلام بين الشفتات', back: '#/reports' }),
    h('main', { class: 'main with-nav' },
      h('p', { class: 'hint', text: 'تسليم واستلام بين الشفتات: من الصباحي إلى الوسطي، ومن الوسطي إلى الخفر. عند أول تسليم في اليوم التالي يختفي هذا التقرير ويبقى محفوظاً.' }),
      seesOld ? field('عرض تسليم يوم سابق (للمدير ومسؤول الصيادلة)', h('input', { class: 'input', type: 'date', value: wanted || '', max: current || today,
        onchange: (e) => { location.hash = '#/report-handover' + (e.target.value ? '?d=' + e.target.value : ''); } })) : null,
      !isCurrent ? notice('info', 'archive', h('p', { text: 'تقرير سابق محفوظ، للعرض فقط.' })) : null,
      writer && isCurrent ? h('button', { type: 'button', class: 'btn primary block', onclick: () => itemDialog(null) }, icon('plus', 20, '#fff'), h('span', { text: 'إضافة مريض إلى التسليم' })) : null,
      writer && isCurrent && current && current < today ? notice('warn', 'info', h('p', { text: `هذا تسليم ${fmtShort(current)}. عند إضافة أول مريض اليوم يبدأ تسليم جديد ويختفي هذا.` })) : null,
      !wanted ? h('div', { class: 'card' }, empty(writer ? 'لا يوجد تسليم بعد. أضف أول مريض.' : 'لم يُكتب تسليم بعد.', 'swap')) : sections),
    bottomNav('home')));

  function hoRow(i, shift) {
    const editable = writer && isCurrent;
    return h(editable ? 'button' : 'div', { class: 'row ho-row', type: editable ? 'button' : null, onclick: editable ? () => itemDialog(i, shift) : null },
      h('span', { class: 'avatar', text: initials(i.patient_name) }),
      h('span', { class: 'grow' },
        h('span', { class: 't', text: i.patient_name }),
        i.medications ? h('span', { class: 'ho-line' }, h('b', { text: 'الأدوية: ' }), h('span', { text: i.medications })) : null,
        i.notes ? h('span', { class: 'ho-line' }, h('b', { text: 'الملاحظات: ' }), h('span', { text: i.notes })) : null,
        h('span', { class: 's', text: `${i.author?.full_name || ''} · ${fmtTime(i.updated_at || i.created_at)}${i.updated_at ? ' (معدّل)' : ''}` })),
      editable ? icon('edit', 18) : null);
  }

  function itemDialog(it, shiftOf) {
    let shift = shiftOf || defaultShift;
    let pid = it?.patient_id || null;
    const listId = 'ho-patients';
    const name = h('input', { class: 'input', value: it?.patient_name || '', list: listId, autocomplete: 'off', maxlength: 200,
      oninput: () => { const m = patients.find((p) => `${p.full_name} · ${p.file_no}` === name.value || p.full_name === name.value); pid = m?.id || null; if (m) name.value = m.full_name; } });
    const dl = h('datalist', { id: listId }, patients.map((p) => h('option', { value: `${p.full_name} · ${p.file_no}` })));
    const meds = h('textarea', { class: 'input', rows: 3, maxlength: 2000, dir: 'auto', placeholder: 'الأدوية المعطاة أو المطلوبة' }); meds.value = it?.medications || '';
    const notes = h('textarea', { class: 'input', rows: 3, maxlength: 2000, dir: 'auto', placeholder: 'ما يجب أن يعرفه الشفت التالي' }); notes.value = it?.notes || '';
    const seg = h('div', { class: 'segmented', role: 'group', 'aria-label': 'الشفت' });
    const drawSeg = () => seg.replaceChildren(...SHIFTS.map(([k, l]) => h('button', { type: 'button', disabled: !!it && k !== shift,
      'aria-pressed': shift === k ? 'true' : 'false', onclick: () => { shift = k; drawSeg(); } }, l)));
    drawSeg();
    const err = h('div');
    dialog(it ? 'تعديل التسليم' : 'إضافة مريض إلى التسليم', (close) => [
      h('div', { class: 'field' }, h('span', { class: 'label', text: 'الشفت' }), seg),
      field('اسم المريض', name, 'اختر من المرضى المسجلين أو اكتب الاسم'), dl,
      field('الأدوية', meds), field('الملاحظات', notes), err,
      h('button', { type: 'button', class: 'btn primary block', text: 'حفظ', onclick: (e) => busy(e.currentTarget, async () => {
        try {
          await rpc('handover_save_item', { p_item: it?.id || null, p_shift: shift, p_patient: pid, p_patient_name: name.value,
            p_medications: meds.value, p_notes: notes.value });
          close(); toast('حُفظ التسليم'); location.hash = '#/report-handover?r=' + Date.now();
        } catch (x) { err.replaceChildren(notice('err', 'warn', h('p', { text: x.message }))); }
      }) }),
      it ? h('button', { type: 'button', class: 'btn secondary block', style: 'color: var(--brand-dark)', text: 'حذف من التسليم', onclick: async () => {
        close();
        if (!await confirmDialog({ title: 'حذف ' + it.patient_name + ' من التسليم', okText: 'حذف', danger: true })) return;
        try { await rpc('handover_remove_item', { p_item: it.id }); toast('حُذف'); location.hash = '#/report-handover?r=' + Date.now(); }
        catch (x) { toast(x.message, true); }
      } }) : null,
      h('button', { type: 'button', class: 'link-btn', text: 'إلغاء', onclick: close }),
    ]);
    name.focus();
  }
}
