// إنشاء خطة علاج: اختيار بروتوكول معتمد، ومعاينة الجرعات المحسوبة للمريض، ثم الحفظ
import { sb, q, rpc } from '../api.js';
import { h, mount, icon, topbar, field, notice, toast, busy, confirmDialog, bsa, fmtDate, todayISO, addDaysISO, count } from '../ui.js';
import { go, state } from '../app.js';
import { can } from '../perms.js';
import { ROUTE_AR, OUT_UNITS, UNITS, calcDose, daysText, num, instrLine, withCycles } from '../dose.js';
import { NKDA } from './patient-form.js';
import { protocolFileLink } from '../files.js';
import { diagnosesFor, OTHER, STATUS, GRADES, guessStatus } from '../diagnoses.js';

export async function render(root, params) {
  const pid = params.get('patient');
  const back = '#/patient?id=' + pid;
  const shell = (...c) => mount(root, h('div', { class: 'screen' }, topbar({ title: 'خطة علاج جديدة', back }), h('main', { class: 'main' }, ...c)));

  if (!can('createPlan')) return shell(notice('info', 'lock', h('p', { text: 'إنشاء خطط العلاج لطبيب الاختصاص والمقيم الأقدم ومسؤول الصيادلة السريريين.' })));
  shell(h('div', { class: 'empty' }, h('span', { class: 'spinner' })));

  const [p, protocols, current] = await Promise.all([
    q(sb.from('patients').select('id, full_name, file_no, height_cm, weight_kg, allergies, archived_at').eq('id', pid).maybeSingle()),
    q(sb.from('protocols').select('id, name, disease, kind, cycle_length_days, total_cycles, notes, file_path, protocol_drugs(*)')
      .not('approved_at', 'is', null).is('archived_at', null).order('name')),
    q(sb.from('treatments').select('id').eq('patient_id', pid).in('status', ['active', 'pending_approval'])),
  ]);
  if (!p) throw new Error('المريض غير موجود');
  if (p.archived_at) return shell(notice('err', 'archive', h('p', { text: 'ملف المريض مؤرشف.' })));
  if (current.length) return shell(notice('warn', 'warn', h('p', { text: 'للمريض خطة علاج قائمة. لتغيير البروتوكول استخدم «تعديل» من شاشة الجرعة، أو أوقف الخطة الحالية أولاً.' })));
  if (!p.height_cm || !p.weight_kg) {
    return shell(notice('warn', 'warn', h('p', { text: 'الطول والوزن مطلوبان لحساب مساحة سطح الجسم والجرعات الدوائية.' })),
      h('a', { class: 'btn primary block', href: '#/patient-edit?id=' + pid }, icon('edit', 22, '#fff'), 'إدخال الطول والوزن'));
  }
  if (!protocols.length) {
    return shell(notice('warn', 'book', h('p', { text: 'لا توجد بروتوكولات معتمدة بعد. يعتمدها طبيب الاختصاص من مكتبة البروتوكولات.' })),
      h('a', { class: 'btn secondary block', href: '#/protocols?t=pending' }, 'مكتبة البروتوكولات'));
  }

  const B = bsa(Number(p.height_cm), Number(p.weight_kg));
  const W = Number(p.weight_kg);
  let chosen = null;
  // من ينشئ الخطة (طبيب الاختصاص والمقيم الأقدم ومسؤول الصيادلة) يعدّل أي جرعة محسوبة قبل الاعتماد (الملف 35: create_plan)
  const canEditDose = ['specialist', 'senior_resident', 'chief_clinical_pharmacist'].includes(state.profile.role);
  const overrides = new Map();   // protocol_drug_id -> { value, calc, name, unit }

  const picker = h('div', { class: 'section', role: 'radiogroup', 'aria-label': 'البروتوكول' });
  const preview = h('div', { class: 'section' });
  // التشخيص: قائمة حسب البروتوكول المختار (من معلومات ملفه)، أو «أخرى» للكتابة
  const dxSel = h('select', { class: 'input', id: 'dx-sel', disabled: true }, h('option', { value: '', text: 'اختر البروتوكول أولاً' }));
  const diagnosis = h('input', { class: 'input ltr', style: 'text-align: right', maxlength: 200, placeholder: 'Diagnosis', hidden: true, 'aria-label': 'التشخيص (كتابة)' });
  // درجة المرض: قائمة منسدلة
  const stage = h('select', { class: 'input' }, h('option', { value: '', text: 'غير محددة' }), GRADES.map((g) => h('option', { value: g, text: g })));
  // حالة المرض
  let dStatus = null;
  const statusBox = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'حالة المرض' });
  const drawStatus = () => statusBox.replaceChildren(...STATUS.map(([k, en]) => h('button', { type: 'button', role: 'radio', 'aria-pressed': dStatus === k ? 'true' : 'false', 'aria-checked': dStatus === k ? 'true' : 'false',
    onclick: () => { dStatus = k; statusBox.dataset.touched = '1'; drawStatus(); } }, h('span', { class: 'ltr', text: en }))));
  drawStatus();
  let dxList = [];
  function drawDx() {
    dxList = diagnosesFor(chosen);
    const keep = dxSel.value;
    dxSel.disabled = false;
    dxSel.replaceChildren(h('option', { value: '', text: 'اختر التشخيص' }),
      dxList.map((d) => h('option', { value: d.key, text: d.label, dir: 'ltr' })),
      h('option', { value: OTHER, text: 'Other' }));
    dxSel.value = dxList.some((d) => d.key === keep) || keep === OTHER ? keep : (dxList.length === 1 ? dxList[0].key : '');
    onDx();
  }
  const dxFull = h('p', { class: 'hint ltr', style: 'text-align: right; font-weight: 600; color: var(--ink-2)', 'aria-live': 'polite' });
  function onDx() {
    const d = dxList.find((x) => x.key === dxSel.value);
    diagnosis.hidden = dxSel.value !== OTHER;
    dxFull.textContent = d ? d.label : '';   // الاسم الكامل ظاهراً حتى لو قُصّ في الخانة
  }
  dxSel.addEventListener('change', onDx);
  const start = h('input', { class: 'input', type: 'date', value: todayISO(), min: addDaysISO(todayISO(), -365), max: addDaysISO(todayISO(), 180) });
  const schedule = h('p', { class: 'hint' });
  const err = h('div');
  const pending = state.profile.role === 'chief_clinical_pharmacist';
  const submit = h('button', { class: 'btn primary block', type: 'submit', disabled: true, text: pending ? 'حفظ وإرسال للطبيب المختص' : 'إنشاء الخطة' });

  function drawPicker() {
    picker.replaceChildren(...protocols.map((pr) => h('button', {
      type: 'button', class: 'option', 'aria-pressed': chosen === pr ? 'true' : 'false',
      onclick: () => { if (chosen !== pr) overrides.clear(); chosen = pr; drawDx(); if (!statusBox.dataset.touched) { dStatus = guessStatus(pr); drawStatus(); } drawPicker(); drawPreview(); drawSchedule(); submit.disabled = false; },
    }, h('span', { class: 'radio' }),
      h('span', null, h('span', { class: 'ot ltr', style: 'text-align: right', text: pr.name }),
        h('span', { class: 'od', text: `${pr.disease} · كل ${count(pr.cycle_length_days, 'day')} · ${count(pr.total_cycles, 'cycle')}` })))));
  }

  function drawPreview() {
    if (!chosen) return preview.replaceChildren();
    const drugs = [...chosen.protocol_drugs].sort((a, b) => a.sort - b.sort);
    const allergy = p.allergies && p.allergies !== NKDA ? p.allergies.toLowerCase() : '';
    const clash = drugs.filter((d) => allergy && allergy.includes(d.drug_name.toLowerCase()));
    preview.replaceChildren(
      h('div', { class: 'section-head' }, h('h2', { text: 'معاينة الجرعات الدوائية' }), h('span', { class: 'meta ltr', text: `BSA ${B} m²` })),
      clash.length ? notice('err', 'alert', h('p', { style: 'font-weight: 700', text: 'تحذير حساسية: ' + clash.map((d) => d.drug_name).join('، ') }), h('p', { text: 'المريض مسجّل بحساسية لدواء في هذا البروتوكول. راجع الطبيب المختص قبل المتابعة.' })) : null,
      h('div', { class: 'card flush' }, drugs.map((d) => {
        const c = calcDose(Number(d.dose_value), d.dose_unit, B, W, d.max_dose);
        return h('div', { class: 'row', style: 'align-items: flex-start' },
          h('span', { class: 'grow' },
            h('span', { class: 't ltr', style: 'text-align: right', text: d.drug_name }),
            h('span', { class: 's', text: `${d.route} (${ROUTE_AR[d.route] || d.route}) · ${daysText(d.days)}${withCycles(d)}` }),
            instrLine(d),
            h('span', { class: 's ltr', style: 'text-align: right', text: calcText(d, c) }),
            c.capped ? h('span', { class: 'pill warn', style: 'align-self: flex-start; margin-top: 4px', text: `قُصّت إلى السقف ${num(d.max_dose)} ${OUT_UNITS[c.finalUnit]} (المحسوب ${num(c.calculated)})` }) : null),
          canEditDose ? doseInput(d, c) : h('span', { class: 'dose-big' }, h('b', { class: 'ltr', text: num(c.final) }), h('span', { text: OUT_UNITS[c.finalUnit] })));
      })),
      canEditDose ? h('p', { class: 'hint', text: 'اضغط على أي جرعة لتعديلها قبل اعتماد الخطة. تُطبَّق الجرعة المعدّلة على هذا الدواء في كل الجرعات، وتُعلَّم «معدّلة» مع المحسوبة الأصلية في السجل.' }) : null,
      h('p', { class: 'hint', text: `حُسبت من طول ${num(p.height_cm)} سم ووزن ${num(p.weight_kg)} كغ بمعادلة موستيلر. هذه معاينة، والجرعات الدوائية المعتمدة تحسبها قاعدة البيانات عند الحفظ بالطريقة نفسها.` }),
      chosen.notes ? notice('info', 'info', h('p', { text: chosen.notes })) : null,
      protocolFileLink(chosen.file_path, 'مطابقة مع ملف البروتوكول ' + chosen.name));
  }
  function doseInput(d, c) {
    const calc = Number(num(c.final));
    const o = overrides.get(d.id);
    const note = h('span', { class: 'dose-note', 'aria-live': 'polite' });
    const box = h('label', { class: 'dose-big dose-edit' + (o ? ' changed' : '') });
    const inp = h('input', { type: 'number', inputmode: 'decimal', min: 0, step: 'any', class: 'ltr', value: o ? o.value : calc,
      'aria-label': `جرعة ${d.drug_name} (${OUT_UNITS[c.finalUnit]})، المحسوبة ${calc}` });
    const sync = () => {
      const v = inp.value.trim();
      const n = Number(v);
      if (v !== '' && n !== calc) overrides.set(d.id, { value: v, calc, name: d.drug_name, unit: OUT_UNITS[c.finalUnit] });
      else overrides.delete(d.id);
      box.classList.toggle('changed', overrides.has(d.id));
      note.textContent = overrides.has(d.id) ? `المحسوبة ${calc}` : '';
    };
    inp.addEventListener('input', sync);
    inp.addEventListener('blur', () => { if (inp.value.trim() === '') { inp.value = calc; sync(); } });
    box.append(inp, h('span', { text: OUT_UNITS[c.finalUnit] }), note);
    sync();
    return box;
  }
  function calcText(d, c) {
    if (d.dose_unit === 'mg' || d.dose_unit === 'units') return `${num(d.dose_value)} ${d.dose_unit} (fixed)`;
    return `${num(d.dose_value)} ${d.dose_unit} × ${d.dose_unit.endsWith('/m2') ? B + ' m²' : W + ' kg'} = ${num(c.calculated)} ${c.finalUnit}`;
  }
  function drawSchedule() {
    if (!chosen || !start.value) return (schedule.textContent = '');
    const last = addDaysISO(start.value, (chosen.total_cycles - 1) * chosen.cycle_length_days);
    const past = start.value < todayISO() ? Math.ceil((new Date(todayISO()) - new Date(start.value)) / 86400000 / chosen.cycle_length_days) : 0;
    schedule.textContent = `${count(chosen.total_cycles, 'cycle')} من ${fmtDate(start.value)} إلى ${fmtDate(last)}.` +
      (past ? ` البدء في تاريخ ماضٍ: ستظهر الجرعات التي مضى موعدها متأخرة حتى تُسجَّل أو تُؤجَّل.` : '');
  }
  start.addEventListener('input', drawSchedule);

  const form = h('form', { novalidate: true },
    h('div', { class: 'card', style: 'flex-direction: row; align-items: center' },
      h('span', { class: 'avatar', text: p.full_name.split(' ').slice(0, 2).map((x) => x[0]).join(' ') }),
      h('span', { style: 'display: flex; flex-direction: column; gap: 2px; flex: 1' },
        h('b', { text: p.full_name }),
        h('span', { style: 'font-size: 14px; color: var(--muted-2)', text: `${p.file_no} · ${num(p.height_cm)} سم · ${num(p.weight_kg)} كغ · BSA ${B} م²` }))),
    p.allergies && p.allergies !== NKDA ? notice('err', 'alert', h('p', { text: 'حساسية دوائية: ' + p.allergies })) : null,
    h('div', { class: 'section-head' }, h('h2', { text: 'البروتوكول' }), h('a', { href: '#/protocols', style: 'font-size: 14px; font-weight: 600', text: 'المكتبة' })),
    picker, preview,
    h('div', { class: 'card' },
      h('h2', { text: 'التشخيص والبدء' }),
      field('التشخيص', dxSel, 'القائمة حسب البروتوكول المختار'), dxFull, diagnosis,
      h('div', { class: 'field' }, h('span', { class: 'label', text: 'حالة المرض' }), statusBox),
      field('درجة المرض', stage),
      field('تاريخ الجرعة الأولى', start), schedule),
    pending ? notice('info', 'info', h('p', { text: 'تُرسل الخطة للطبيب المختص بالمريض، ولا تُفعَّل قبل موافقته.' })) : null,
    err, submit);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    busy(submit, async () => {
      const fail = (m) => { err.replaceChildren(notice('err', 'warn', h('p', { text: m }))); err.scrollIntoView({ block: 'center', behavior: 'smooth' }); };
      err.replaceChildren();
      if (!chosen) return fail('اختر البروتوكول');
      const dxItem = dxList.find((d) => d.key === dxSel.value);
      const dxText = dxSel.value === OTHER ? diagnosis.value.trim() : (dxItem ? dxItem.label : '');
      if (!dxText) return fail(dxSel.value === OTHER ? 'اكتب التشخيص' : 'اختر التشخيص');
      if (!dStatus) return fail('اختر حالة المرض: Initial treatment أو Relapse أو Maintenance');
      const code = dxItem ? dxItem.icd : null;   // يُحفظ تلقائياً ولا يظهر
      if (!start.value) return fail('اختر تاريخ الجرعة الأولى');
      const edits = [...overrides.entries()];
      const bad = edits.find(([, o]) => !(Number(o.value) > 0));
      if (bad) return fail('جرعة غير صحيحة لـ ' + bad[1].name);
      if (edits.length && !await confirmDialog({ title: 'تأكيد الجرعات المعدّلة',
        body: edits.map(([, o]) => `${o.name}: ${o.calc} ← ${Number(o.value)} ${o.unit}`).join(' · ') + '. تُطبَّق على هذا الدواء في كل جرعات الخطة.', okText: 'تأكيد' })) return;
      try {
        const args = { p_patient: pid, p_protocol: chosen.id, p_diagnosis: dxText,
          p_icd10: code || null, p_stage: stage.value || null, p_start: start.value, p_disease_status: dStatus };
        await rpc('create_plan', { ...args, p_doses: edits.length ? Object.fromEntries(edits.map(([id, o]) => [id, Number(o.value)])) : null });
        toast(pending ? 'أُرسلت الخطة للطبيب المختص للموافقة' : 'أُنشئت خطة العلاج');
        go('/patient?id=' + pid);
      } catch (e2) { fail(e2.message); }
    });
  });

  drawPicker();
  mount(root, h('div', { class: 'screen' }, topbar({ title: 'خطة علاج جديدة', sub: p.full_name, back }), h('main', { class: 'main' }, form)));
}
