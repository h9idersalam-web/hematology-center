// إضافة بروتوكول جديد إلى المكتبة. من طبيب الاختصاص يُعتمد فوراً، ومن غيره ينتظر الاعتماد.
import { rpc } from '../api.js';
import { h, mount, icon, topbar, field, notice, toast, busy, latinDigits } from '../ui.js';
import { go, state } from '../app.js';
import { can } from '../perms.js';
import { UNITS, ROUTES, ROUTE_AR, OUT_UNITS, calcDose, validDays, daysText, cyclesText, num } from '../dose.js';
import { uploadProtocolFile, checkFile } from '../files.js';

const KINDS = [['iv', 'وريدي'], ['oral', 'فموي'], ['mixed', 'مختلط']];
const EX = { bsa: 1.8, weight: 70 };

export async function render(root) {
  if (!can('createProtocol')) {
    mount(root, h('div', { class: 'screen' }, topbar({ title: 'بروتوكول جديد', back: '#/protocols' }),
      h('main', { class: 'main' }, notice('info', 'lock', h('p', { text: 'إضافة البروتوكولات للأطباء (عدا الدوري) والصيادلة السريريين.' })))));
    return;
  }
  const isSpecialist = state.profile.role === 'specialist';
  const name = h('input', { class: 'input ltr', style: 'text-align: right', placeholder: 'مثال: R-CHOP-21', maxlength: 60, autocomplete: 'off' });
  const disease = h('input', { class: 'input', placeholder: 'مثال: لمفوما الخلايا البائية الكبيرة المنتشرة', maxlength: 160 });
  const len = h('input', { class: 'input ltr', type: 'number', inputmode: 'numeric', min: 1, max: 120, style: 'text-align: right', placeholder: '21' });
  const total = h('input', { class: 'input ltr', type: 'number', inputmode: 'numeric', min: 1, max: 60, style: 'text-align: right', placeholder: '6' });
  const notes = h('textarea', { class: 'input', rows: 3, placeholder: 'فحوص قبل البدء، أدوية وقائية، سقوف تراكمية، تحذيرات...', maxlength: 2000 });
  const fileIn = h('input', { type: 'file', accept: 'application/pdf,image/*', class: 'input', style: 'padding-top: 12px' });
  let kind = 'iv';
  const kindSeg = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'نوع العلاج' });
  const drawKind = () => kindSeg.replaceChildren(...KINDS.map(([k, l]) => h('button', { type: 'button', 'aria-pressed': kind === k ? 'true' : 'false', text: l, onclick: () => { kind = k; drawKind(); } })));
  drawKind();

  const drugsBox = h('div', { class: 'section' });
  const drugs = [];
  const addDrug = () => { const d = drugEditor(drugs.length + 1, () => { drugs.splice(drugs.indexOf(d), 1); d.el.remove(); renumber(); }, () => Number(len.value), () => Number(total.value)); drugs.push(d); drugsBox.append(d.el); renumber(); };
  const renumber = () => drugs.forEach((d, i) => d.setNo(i + 1));
  addDrug();

  const err = h('div');
  const submit = h('button', { class: 'btn primary block', type: 'submit', text: isSpecialist ? 'حفظ واعتماد' : 'حفظ وإرسال للاعتماد' });
  const form = h('form', { novalidate: true },
    h('div', { class: 'card' },
      h('h2', { text: 'بيانات البروتوكول' }),
      field('الاسم المختصر', name, 'اسم مميز. للنسخة المعدّلة أضف رقماً، مثل R-CHOP-14 أو ABVD-v2'),
      field('المرض', disease),
      h('div', { class: 'field' }, h('span', { class: 'label', text: 'نوع العلاج' }), kindSeg),
      h('div', { class: 'grid-2' }, field('المدة بين الجرعات (يوم)', len), field('عدد الجرعات', total)),
      field('ملاحظات ومتطلبات', notes),
      field('ملف البروتوكول المرجعي (اختياري)', fileIn, 'PDF أو صورة من بروتوكول المركز. يمكن إرفاقه لاحقاً أيضاً.')),
    h('div', { class: 'section-head' }, h('h2', { text: 'الأدوية' })),
    drugsBox,
    h('button', { type: 'button', class: 'btn secondary block', onclick: addDrug }, icon('plus', 22), 'إضافة دواء'),
    notice(isSpecialist ? 'info' : 'warn', 'info', h('p', { text: isSpecialist
      ? 'لأنك طبيب اختصاص، يُعتمد البروتوكول عند حفظه. راجع كل جرعة دوائية وسقف قبل الحفظ.'
      : 'سيُرسل إشعار لأطباء الاختصاص، ولا يُستخدم البروتوكول لأي مريض قبل اعتماده.' })),
    err, submit);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    busy(submit, async () => {
      err.replaceChildren();
      const fail = (m) => { err.replaceChildren(notice('err', 'warn', h('p', { text: m }))); err.scrollIntoView({ block: 'center', behavior: 'smooth' }); };
      const nm = name.value.trim();
      const L = Number(latinDigits(len.value)), T = Number(latinDigits(total.value));
      if (nm.length < 2) return fail('اكتب اسم البروتوكول');
      if (!disease.value.trim()) return fail('اكتب المرض');
      if (!(L >= 1 && L <= 120 && Number.isInteger(L))) return fail('المدة بين الجرعات عدد أيام صحيح بين 1 و120');
      if (!(T >= 1 && T <= 60 && Number.isInteger(T))) return fail('عدد الجرعات بين 1 و60');
      if (!drugs.length) return fail('أضف دواءً واحداً على الأقل');
      if (fileIn.files[0]) { const bad = checkFile(fileIn.files[0]); if (bad) return fail(bad); }
      const list = [];
      for (const d of drugs) { const r = d.value(L, T); if (r.error) return fail(`الدواء ${d.no}: ${r.error}`); list.push(r); }
      try {
        const id = await rpc('create_protocol', { p_name: nm, p_disease: disease.value.trim(), p_kind: kind, p_cycle_length: L,
          p_total_cycles: T, p_drugs: list, p_notes: notes.value.trim() || null });
        let fileErr = null;
        if (fileIn.files[0]) { try { await uploadProtocolFile(id, fileIn.files[0]); } catch (e3) { fileErr = e3.message; } }
        toast(fileErr ? 'حُفظ البروتوكول، لكن تعذّر رفع الملف: ' + fileErr : isSpecialist ? 'حُفظ البروتوكول واعتُمد' : 'حُفظ البروتوكول وأُرسل للاعتماد', !!fileErr);
        go('/protocol?id=' + id);
      } catch (e2) { fail(e2.message); }
    });
  });

  mount(root, h('div', { class: 'screen' }, topbar({ title: 'بروتوكول جديد', back: '#/protocols' }), h('main', { class: 'main' }, form)));
}

function drugEditor(no, onRemove, cycleLen, totalCycles) {
  const title = h('h2');
  const name = h('input', { class: 'input ltr', style: 'text-align: right', placeholder: 'Doxorubicin', autocomplete: 'off', maxlength: 80 });
  const value = h('input', { class: 'input ltr', type: 'number', inputmode: 'decimal', step: 'any', min: 0, style: 'text-align: right' });
  const unit = h('select', { class: 'input' }, Object.entries(UNITS).map(([k, l]) => h('option', { value: k, text: `${l} (${k})` })));
  const route = h('select', { class: 'input' }, ROUTES.map((r) => h('option', { value: r, text: `${r} · ${ROUTE_AR[r]}` })));
  const days = h('input', { class: 'input ltr', style: 'text-align: right', placeholder: '1  أو  1,15  أو  1-5', value: '1' });
  const max = h('input', { class: 'input ltr', type: 'number', inputmode: 'decimal', step: 'any', min: 0, style: 'text-align: right', placeholder: 'اختياري' });
  const mixed = h('input', { type: 'checkbox', checked: true });
  const ins = h('input', { class: 'input', maxlength: 200, placeholder: 'مثال: كل 12 ساعة، جرعتان دوائيتان يومياً' });
  const cyc = h('input', { class: 'input ltr', style: 'text-align: right', placeholder: 'فارغ = كل الجرعات · مثال: 1 أو 2-12' });
  const cycHint = h('p', { class: 'hint' });
  const daysHint = h('p', { class: 'hint' });
  const preview = h('p', { class: 'hint', style: 'font-weight: 600' });
  const maxLabel = h('label');

  route.addEventListener('change', () => { mixed.checked = route.value !== 'PO'; });
  const redraw = () => {
    daysHint.textContent = validDays(days.value, cycleLen()) ? daysText(days.value) : 'اكتب الأيام بالأرقام مفصولة بفاصلة، أو مدى مثل 1-5';
    cycHint.textContent = !cyc.value.trim() ? 'يُعطى في كل الجرعات' : validDays(cyc.value, totalCycles()) ? cyclesText(cyc.value) : 'اكتب أرقام الجرعات مفصولة بفاصلة، أو مدى مثل 2-12';
    const out = unit.value.startsWith('units') ? 'units' : 'mg';
    maxLabel.textContent = `سقف الجرعة الدوائية (${OUT_UNITS[out]})`;
    const v = Number(latinDigits(value.value));
    if (v > 0) {
      const c = calcDose(v, unit.value, EX.bsa, EX.weight, max.value ? Number(latinDigits(max.value)) : null);
      preview.textContent = `مثال لمريض ${EX.bsa} م² و${EX.weight} كغ: ${num(c.final)} ${OUT_UNITS[c.finalUnit]}${c.capped ? ' (بالسقف)' : ''}`;
    } else preview.textContent = '';
  };
  [value, unit, days, max, cyc].forEach((x) => x.addEventListener('input', redraw));
  unit.addEventListener('change', redraw);
  redraw();

  const el = h('div', { class: 'card' },
    h('div', { style: 'display: flex; justify-content: space-between; align-items: center' }, title,
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'حذف هذا الدواء', onclick: onRemove }, icon('x', 22))),
    field('اسم الدواء (بالإنجليزية)', name),
    h('div', { class: 'grid-2' }, field('الجرعة الدوائية', value), field('الوحدة', unit)),
    h('div', { class: 'grid-2' }, field('طريق الإعطاء', route), h('div', { class: 'field' }, maxLabel, max)),
    field('أيام الإعطاء داخل الجرعة', days), daysHint,
    field('الجرعات التي يُعطى فيها (اختياري)', cyc), cycHint,
    field('تعليمات الجرعة الدوائية (اختياري)', ins, 'التكرار في اليوم أو التقسيم أو شرط الجرعة الدوائية. لا تكتب المحلول أو مدة التسريب، فهذه لقسم المزج.'),
    h('label', { class: 'check' }, mixed, h('span', { text: 'يُحضَّر في قسم المزج الكيميائي' })),
    preview);
  maxLabel.htmlFor = max.id = 'mx' + Math.random().toString(36).slice(2, 7);

  return {
    el, get no() { return no; },
    setNo(n) { no = n; title.textContent = 'الدواء ' + n; },
    value(L, T) {
      const nm = name.value.trim();
      const v = Number(latinDigits(value.value));
      const mx = max.value ? Number(latinDigits(max.value)) : null;
      if (!/^[A-Za-z][\w\s\-().,/+]*$/.test(nm)) return { error: 'اكتب اسم الدواء بالأحرف الإنجليزية' };
      if (!(v > 0)) return { error: 'الجرعة الدوائية يجب أن تكون أكبر من صفر' };
      if (!validDays(days.value, L)) return { error: `أيام الإعطاء غير صحيحة أو تتجاوز المدة بين الجرعات (${L} يوماً)` };
      if (mx !== null && !(mx > 0)) return { error: 'سقف الجرعة الدوائية يجب أن يكون أكبر من صفر' };
      if (cyc.value.trim() && !validDays(cyc.value, T)) return { error: `الجرعات غير صحيحة أو تتجاوز عدد الجرعات (${T})` };
      return { drug_name: nm, dose_value: v, dose_unit: unit.value, route: route.value, days: days.value.replace(/\s/g, ''),
        max_dose: mx, is_mixed: mixed.checked, instructions: ins.value.trim() || null,
        cycles: cyc.value.trim() ? cyc.value.replace(/\s/g, '') : null };
    },
  };
}
