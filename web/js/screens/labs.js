// التحاليل: إدخال النتائج بقوالب جاهزة، وعرض آخر قيمة ومنحنى كل تحليل
import { sb, q, rpc } from '../api.js';
import { h, mount, icon, topbar, bottomNav, field, notice, toast, busy, empty, fmtDate, todayISO, latinDigits } from '../ui.js';
import { go } from '../app.js';
import { can } from '../perms.js';
import { PANELS, ref, flag } from '../labs.js';
import { openFile, signedUrl, isImage } from '../files.js';
import { readCbcImage } from '../ocr-labs.js';

// --------------------------------------------------------------- الإدخال
export async function entry(root, params) {
  const pid = params.get('patient');
  const attId = params.get('attachment');
  const [p, att] = await Promise.all([
    q(sb.from('patients').select('id, full_name, sex, archived_at').eq('id', pid).maybeSingle()),
    attId ? q(sb.from('attachments').select('id, title, file_path, taken_on').eq('id', attId).maybeSingle()) : Promise.resolve(null),
  ]);
  if (!p) throw new Error('المريض غير موجود');
  const back = '#/labs?patient=' + pid;
  const shell = (...c) => mount(root, h('div', { class: 'screen' }, topbar({ title: 'إدخال نتائج تحليل', sub: p.full_name, back }), h('main', { class: 'main' }, ...c)));
  if (!can('labs')) return shell(notice('info', 'lock', h('p', { text: 'إدخال التحاليل للأطباء (عدا الدوري) والصيادلة السريريين والتمريض.' })));

  const sex = p.sex || 'male';
  const date = h('input', { class: 'input', type: 'date', value: att?.taken_on || todayISO(), max: todayISO() });
  const rows = [];
  const panels = PANELS.map((panel, i) => {
    const body = h('div', { class: 'lab-grid' }, panel.tests.map((t) => {
      const r = ref(t, sex);
      const v = h('input', { class: 'input ltr lab-v', type: 'number', inputmode: 'decimal', step: 'any', 'aria-label': `${t.name} (${t.unit})` });
      const lo = h('input', { class: 'input ltr lab-r', type: 'number', step: 'any', value: r.low ?? '', 'aria-label': `${t.name} الحد الأدنى` });
      const hi = h('input', { class: 'input ltr lab-r', type: 'number', step: 'any', value: r.high ?? '', 'aria-label': `${t.name} الحد الأعلى` });
      const mark = h('span', { class: 'lab-flag' });
      const redraw = () => {
        const f = flag(latinDigits(v.value), latinDigits(lo.value), latinDigits(hi.value));
        mark.textContent = f === 'low' ? '↓ منخفض' : f === 'high' ? '↑ مرتفع' : '';
        mark.className = 'lab-flag ' + (f || '');
        v.classList.toggle('out', f === 'low' || f === 'high');
      };
      [v, lo, hi].forEach((x) => x.addEventListener('input', redraw));
      const src = h('div', { class: 'lab-src', hidden: true });
      const row = { t, v, lo, hi, src, redraw, ocr: null, ok: null };
      // المستخدم كتب القيمة بيده: تصبح إدخالاً عادياً ولا تُنسب للقراءة الآلية
      v.addEventListener('input', () => { if (row.ocr && !row.filling) clearOcr(row); });
      rows.push(row);
      return h('div', { class: 'lab-row' },
        h('span', { class: 'lab-n' }, h('b', { class: 'ltr', text: t.name }), h('span', { class: 'ltr', text: t.unit })),
        v, h('span', { class: 'lab-ref' }, lo, h('span', { text: '–' }), hi), mark, src);
    }));
    return h('details', { class: 'card', open: i === 0 },
      h('summary', { style: 'font-weight: 700; font-size: 17px; cursor: pointer', text: panel.label }),
      h('div', { class: 'lab-head' }, h('span', { text: 'التحليل' }), h('span', { text: 'النتيجة' }), h('span', { text: 'الحد الطبيعي' })),
      body);
  });

  // ------------------------------------------------- القراءة الآلية لصورة التحليل
  const reviewed = h('input', { type: 'checkbox' });
  const reviewBox = h('label', { class: 'check card', hidden: true, style: 'font-weight: 700' }, reviewed,
    h('span', { text: 'راجعت كل قيمة مقروءة آلياً مقابل صورة التحليل، وهي صحيحة' }));
  const ocrBox = att && can('labs') ? ocrCard(att, rows, (fresh) => { reviewBox.hidden = !rows.some((r) => r.ocr); if (fresh) reviewed.checked = false; }) : null;

  const err = h('div');
  const submit = h('button', { class: 'btn primary block', type: 'button', text: 'حفظ النتائج' });
  submit.addEventListener('click', () => busy(submit, async () => {
    err.replaceChildren();
    const fail = (m) => { err.replaceChildren(notice('err', 'warn', h('p', { text: m }))); err.scrollIntoView({ block: 'center', behavior: 'smooth' }); };
    const ocrRows = rows.filter((r) => r.ocr && r.v.value !== '');
    const unchecked = ocrRows.filter((r) => r.ocr.uncertain && !r.ok?.checked);
    if (unchecked.length) return fail(`تحقق من القيم غير المؤكدة (${unchecked.map((r) => r.t.name).join('، ')}) مقابل الصورة وضع علامة عليها، أو صحّحها بيدك.`);
    if (ocrRows.length && !reviewed.checked) return fail('أكّد أنك راجعت القيم المقروءة آلياً مقابل الصورة.');
    const results = [];
    for (const r of rows) {
      if (r.v.value === '') continue;
      const v = Number(latinDigits(r.v.value));
      if (!(v >= 0)) return err.replaceChildren(notice('err', 'warn', h('p', { text: `قيمة ${r.t.name} غير صحيحة` })));
      results.push({ test_name: r.t.name, value: v, unit: r.t.unit, ref_low: r.lo.value === '' ? '' : Number(latinDigits(r.lo.value)), ref_high: r.hi.value === '' ? '' : Number(latinDigits(r.hi.value)),
        entry_method: r.ocr ? 'ocr' : 'manual' });
    }
    if (!results.length) return err.replaceChildren(notice('err', 'warn', h('p', { text: 'أدخل نتيجة واحدة على الأقل' })));
    try {
      await rpc('add_lab_results', { p_patient: pid, p_test_date: date.value, p_results: results, p_attachment: attId || null });
      const out = results.filter((r) => flag(r.value, r.ref_low, r.ref_high) !== 'ok').length;
      // الإشعار للطبيب المختص لتحاليل يوم دورة لم تُعتمد بعد فقط (الملف 19)
      const cyc = out ? await rpc('lab_alert_cycle', { p_patient: pid, p_test_date: date.value }).catch(() => null) : null;
      toast(!out ? 'حُفظت النتائج'
        : cyc ? `حُفظت النتائج، و${out} خارج الحد الطبيعي أُبلغ بها الطبيب المختص قبل الجرعة ${cyc}`
        : `حُفظت النتائج، و${out} خارج الحد الطبيعي`);
      go('/labs?patient=' + pid);
    } catch (e) { err.replaceChildren(notice('err', 'warn', h('p', { text: e.message }))); }
  }));

  shell(
    ocrBox || (att ? h('button', { type: 'button', class: 'notice info', style: 'border: 0; text-align: right; width: 100%', onclick: () => openFile(att.file_path).catch((e) => toast(e.message, true)) },
      icon('file', 20), h('span', { text: 'مرتبط بملف التحليل المرفوع. اضغط لفتحه أثناء الإدخال.' })) : null),
    !att && can('upload') ? h('a', { class: 'btn secondary block', href: `#/upload?patient=${pid}&kind=lab` }, icon('share', 20), 'التقط صورة التحليل لتُقرأ قيمها آلياً') : null,
    h('div', { class: 'card' }, field('تاريخ سحب العينة', date)),
    notice('info', 'info', h('p', { text: 'الحدود الطبيعية جاهزة لبالغ ' + (sex === 'female' ? 'أنثى' : 'ذكر') + '. عدّلها لتطابق ورقة مختبركم. اترك أي تحليل فارغاً إن لم يُجرَ.' })),
    ...panels, reviewBox, err, submit);
}

// --------------------------------------------------------------- القراءة الآلية
const OCR_TESTS = ['WBC', 'ANC', 'Hb', 'PLT'];

function clearOcr(row) {
  row.ocr = null; row.ok = null;
  row.v.classList.remove('ocr', 'ocr-doubt');
  row.src.hidden = true; row.src.replaceChildren();
  row.onChange?.();
}

// بطاقة الصورة: تقرأ تلقائياً عند الفتح، وتملأ تعداد الدم للمراجعة
function ocrCard(att, rows, onChange) {
  const status = h('p', { style: 'font-size: 14px; color: var(--muted)' });
  const bar = h('span');
  const progress = h('div', { class: 'ocr-progress', hidden: true }, bar);
  const summary = h('div');
  const again = h('button', { type: 'button', class: 'btn secondary block', hidden: true }, icon('refresh', 20), 'إعادة القراءة');
  const img = h('img', { class: 'ocr-img', alt: 'صورة التحليل', onclick: () => openFile(att.file_path).catch((e) => toast(e.message, true)) });
  const card = h('section', { class: 'card' },
    h('div', { style: 'display: flex; justify-content: space-between; align-items: baseline; gap: 8px' },
      h('h2', { text: 'صورة التحليل' }), h('span', { style: 'font-size: 13px; color: var(--muted-2)', text: 'اضغط الصورة لتكبيرها' })),
    img, status, progress, summary, again);
  for (const r of rows) r.onChange = onChange;

  if (!isImage(att.file_path)) {
    img.replaceWith(h('button', { type: 'button', class: 'btn secondary block', onclick: () => openFile(att.file_path).catch((e) => toast(e.message, true)) }, icon('file', 20), 'فتح الملف'));
    status.textContent = 'القراءة الآلية للصور فقط (لا لملفات PDF). أدخل القيم بيدك.';
    return card;
  }

  const run = async () => {
    again.hidden = true; summary.replaceChildren(); progress.hidden = false; bar.style.width = '5%';
    status.textContent = 'جارٍ تحميل أداة القراءة (مرة واحدة فقط على هذا الجهاز)…';
    try {
      const url = await signedUrl(att.file_path);
      img.src = url;
      const blob = await (await fetch(url)).blob();
      const steps = { 'loading tesseract core': 10, 'loading language traineddata': 30, 'initializing api': 45, 'تجهيز الصورة': 50, 'القراءة الأولى': 60, 'القراءة الثانية للتأكد': 80 };
      const { result } = await readCbcImage(blob, (m) => {
        if (steps[m.status] != null) bar.style.width = steps[m.status] + '%';
        if (m.status === 'تجهيز الصورة' || m.status?.startsWith('القراءة')) status.textContent = m.status + '…';
      });
      bar.style.width = '100%';
      fill(result);
    } catch (e) {
      status.textContent = 'تعذّرت القراءة الآلية: ' + e.message + ' أدخل القيم بيدك.';
    } finally {
      progress.hidden = true; again.hidden = false;
    }
  };

  function fill(result) {
    let n = 0, doubt = 0;
    const rejected = [];
    for (const r of rows) if (OCR_TESTS.includes(r.t.name)) clearOcr(r);
    for (const test of OCR_TESTS) {
      const res = result[test];
      const row = rows.find((r) => r.t.name === test);
      if (!res || !row) continue;
      if (res.rejected) { rejected.push(`${test} (قُرئ ${res.raw})`); continue; }
      row.filling = true;
      row.v.value = String(res.value);
      if (res.low != null) { row.lo.value = String(res.low); row.hi.value = String(res.high); }
      row.filling = false;
      row.ocr = res; n++;
      row.v.classList.add(res.uncertain ? 'ocr-doubt' : 'ocr');
      const parts = [h('span', { text: (res.uncertain ? '⚠ غير مؤكدة: ' : 'مقروءة آلياً') + (res.reasons.length ? (res.uncertain ? '' : ' · ') + res.reasons.join('؛ ') : '') })];
      if (res.line) parts.push(h('code', { text: res.line }));
      if (res.uncertain) {
        row.ok = h('input', { type: 'checkbox' });
        parts.push(h('label', { class: 'check' }, row.ok, h('span', { text: `تحققت من ${test} في الصورة` })));
        doubt++;
      }
      row.src.replaceChildren(...parts); row.src.hidden = false;
      row.redraw();
    }
    status.textContent = '';
    summary.replaceChildren(n
      ? notice(doubt ? 'warn' : 'info', 'info',
          h('p', { style: 'font-weight: 700', text: `قُرئت ${n} من قيم تعداد الدم من الصورة${doubt ? `، منها ${doubt} غير مؤكدة (بالأصفر)` : ''}.` }),
          h('p', { text: 'قارن كل قيمة ومرجعها بالصورة قبل الحفظ. القراءة الآلية اقتراح وقد تخطئ، والمسؤولية على من يحفظ.' }),
          rejected.length ? h('p', { text: 'لم تُملأ لأنها خارج الحدود المعقولة: ' + rejected.join('، ') }) : null)
      : notice('warn', 'warn', h('p', { text: 'لم تُقرأ قيم تعداد الدم من هذه الصورة. صوّر الورقة مستوية وواضحة وبإضاءة جيدة ثم ارفعها مجدداً، أو أدخل القيم بيدك.' })));
    onChange(true);   // قراءة جديدة: يُطلب التأكيد من جديد
  }

  again.addEventListener('click', () => busy(again, run));
  run();
  return card;
}

// --------------------------------------------------------------- العرض والمنحنيات
export async function view(root, params) {
  const pid = params.get('patient');
  const [p, labs] = await Promise.all([
    q(sb.from('patients').select('id, full_name, archived_at').eq('id', pid).maybeSingle()),
    q(sb.from('lab_results').select('id, test_date, test_name, value, unit, ref_low, ref_high, attachment_id, attachments(file_path)').eq('patient_id', pid).order('test_date', { ascending: true })),
  ]);
  if (!p) throw new Error('المريض غير موجود');
  const add = can('labs') && !p.archived_at
    ? h('a', { class: 'icon-btn boxed', href: '#/labs-new?patient=' + pid, 'aria-label': 'إدخال نتائج', style: 'color: var(--brand)' }, icon('plus', 24, 'currentColor', 2.2)) : null;

  const byTest = new Map();
  for (const l of labs) { if (!byTest.has(l.test_name)) byTest.set(l.test_name, []); byTest.get(l.test_name).push(l); }
  const order = PANELS.flatMap((x) => x.tests.map((t) => t.name));
  const names = [...byTest.keys()].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));

  mount(root, h('div', { class: 'screen' },
    topbar({ title: 'التحاليل', sub: p.full_name, back: '#/patient?id=' + pid, actions: add }),
    h('main', { class: 'main with-nav' },
      can('upload') && !p.archived_at ? h('div', { class: 'grid-2' },
        h('a', { class: 'btn secondary', href: `#/upload?patient=${pid}&kind=lab` }, icon('share', 20), 'صورة تحليل'),
        h('a', { class: 'btn primary', href: '#/labs-new?patient=' + pid }, icon('plus', 20, '#fff', 2.2), 'إدخال قيم')) : null,
      names.length ? names.map((n) => testCard(n, byTest.get(n))) : h('div', { class: 'card flush' }, empty('لا توجد نتائج تحاليل بعد', 'file'))),
    bottomNav('patients')));
}

function testCard(name, rows) {
  const last = rows[rows.length - 1];
  const f = flag(last.value, last.ref_low, last.ref_high);
  return h('section', { class: 'card lab-card' },
    h('div', { style: 'display: flex; justify-content: space-between; align-items: flex-start; gap: 8px' },
      h('span', { style: 'display: flex; flex-direction: column' },
        h('b', { class: 'ltr', style: 'text-align: right; font-size: 17px', text: name }),
        h('span', { style: 'font-size: 13px; color: var(--muted-2)', text: `الحد الطبيعي ${last.ref_low ?? '—'} – ${last.ref_high ?? '—'} ${last.unit || ''}` })),
      h('span', { style: 'display: flex; flex-direction: column; align-items: flex-end' },
        h('b', { class: 'ltr lab-last ' + (f || ''), text: String(last.value) }),
        h('span', { style: 'font-size: 13px; color: var(--muted-2)', text: fmtDate(last.test_date, { day: 'numeric', month: 'short' }) + (f === 'low' ? ' · منخفض' : f === 'high' ? ' · مرتفع' : '') }))),
    rows.length > 1 ? spark(rows) : null,
    h('details', null, h('summary', { style: 'cursor: pointer; font-size: 14px; font-weight: 600', text: `كل القيم (${rows.length})` }),
      h('div', { style: 'display: flex; flex-direction: column; gap: 2px; margin-top: 6px' },
        [...rows].reverse().map((r) => {
          const ff = flag(r.value, r.ref_low, r.ref_high);
          return h('div', { style: 'display: flex; justify-content: space-between; font-size: 14px; padding: 4px 0; border-bottom: 1px solid var(--line-2)' },
            h('span', { text: fmtDate(r.test_date) }),
            h('span', { style: 'display: flex; gap: 8px; align-items: center' },
              r.attachments ? h('button', { type: 'button', class: 'link-btn', style: 'min-height: 0; font-size: 13px', text: 'الصورة', onclick: () => openFile(r.attachments.file_path).catch((e) => toast(e.message, true)) }) : null,
              h('b', { class: 'ltr lab-last ' + (ff || ''), style: 'font-size: 14px', text: String(r.value) })));
        }))));
}

// منحنى صغير بالقيم والمرجع (SVG)
function spark(rows) {
  const W = 320, H = 90, P = 8;
  const vals = rows.map((r) => Number(r.value));
  const lo = rows[rows.length - 1].ref_low, hi = rows[rows.length - 1].ref_high;
  const all = [...vals, lo, hi].filter((x) => x != null).map(Number);
  const min = Math.min(...all), max = Math.max(...all), span = max - min || 1;
  const x = (i) => P + (i * (W - 2 * P)) / (rows.length - 1);
  const y = (v) => H - P - ((v - min) / span) * (H - 2 * P);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'spark'); svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'منحنى القيم: ' + vals.join('، '));
  const el = (tag, attrs) => { const e = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); svg.append(e); return e; };
  if (lo != null && hi != null) el('rect', { x: P, y: y(hi), width: W - 2 * P, height: Math.max(1, y(lo) - y(hi)), fill: 'var(--ok-soft)' });
  el('polyline', { points: vals.map((v, i) => `${x(i)},${y(v)}`).join(' '), fill: 'none', stroke: 'var(--ink-2)', 'stroke-width': 2, 'stroke-linejoin': 'round' });
  vals.forEach((v, i) => {
    const f = flag(v, rows[i].ref_low, rows[i].ref_high);
    el('circle', { cx: x(i), cy: y(v), r: 4, fill: f === 'ok' ? 'var(--ok-strong)' : 'var(--brand)' });
  });
  // الخط الزمني من اليسار (الأقدم) إلى اليمين (الأحدث)
  svg.style.direction = 'ltr';
  return svg;
}

// آخر تعداد دم للمريض (لشاشة الدورة)
export async function latestCbc(pid) {
  const rows = await q(sb.from('lab_results').select('test_name, value, unit, ref_low, ref_high, test_date')
    .eq('patient_id', pid).in('test_name', ['WBC', 'ANC', 'Hb', 'PLT']).order('test_date', { ascending: false }).limit(40));
  const latest = {};
  for (const r of rows) if (!latest[r.test_name]) latest[r.test_name] = r;
  return latest;
}
