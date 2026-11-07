// تعديل الدورة. الطبيب (اختصاص أو مقيم أقدم): يُطبَّق فوراً ويُسجَّل.
// الصيدلاني: يُرسل طلباً مع تقرير، ولا يُطبَّق قبل القرار.
// صيدلي المزج: الجرعات فقط. الصيدلي السريري: الجرعة والمحلول والأدوية الداعمة.
import { sb, q, rpc } from '../api.js';
import { h, mount, icon, topbar, field, notice, toast, busy, latinDigits, confirmDialog, todayISO, count } from '../ui.js';
import { go, state } from '../app.js';
import { can } from '../perms.js';
import { ROUTES, ROUTE_AR, OUT_UNITS, validDays, daysText, num, loadMixState, mixNote } from '../dose.js';

export const REASONS = ['تعداد الدم', 'وظائف الكبد', 'وظائف الكلى', 'سمّية أو أعراض جانبية', 'تداخل دوائي', 'خطأ في الحساب أو السقف', 'تغيّر الوزن', 'أخرى'];
const round = (x) => (x >= 10 ? Math.round(x) : Math.round(x * 10) / 10);

export async function render(root, params) {
  const id = params.get('id');
  const back = '#/cycle?id=' + id;
  const doctor = can('doctorEdit');
  const pharm = can('requestEdit');
  const mixing = state.profile.role === 'mixing_pharmacist';
  const clinical = state.profile.role === 'clinical_pharmacist' || mixing;   // كلاهما: لا تشخيص ولا بروتوكول ولا حذف
  const shell = (...c) => mount(root, h('div', { class: 'screen' }, topbar({ title: doctor ? 'تعديل الدورة' : 'اقتراح تعديل', back }), h('main', { class: 'main' }, ...c)));
  if (!doctor && !pharm) return shell(notice('info', 'lock', h('p', { text: 'التعديل للأطباء والصيادلة.' })));

  const [c, doses, protocols] = await Promise.all([
    q(sb.from('cycles').select('id, cycle_no, status, treatment_id, treatments(id, protocol_id, protocol_name, diagnosis, icd10, stage, total_cycles, status, patients(id, full_name, archived_at))').eq('id', id).maybeSingle()),
    q(sb.from('cycle_doses').select('*').eq('cycle_id', id).is('archived_at', null).order('sort')),
    clinical ? Promise.resolve([]) : q(sb.from('protocols').select('id, name, disease').not('approved_at', 'is', null).is('archived_at', null).order('name')),
  ]);
  if (!c) throw new Error('الدورة غير موجودة');
  const t = c.treatments;
  if (!['planned', 'held'].includes(c.status) || t.patients.archived_at) return shell(notice('warn', 'lock', h('p', { text: 'لا يمكن تعديل دورة أُعطيت أو أُلغيت، أو ملف مؤرشف.' })));

  // ----------------------------------------------------------- الجرعات
  const mixState = await loadMixState(sb, q, doses.map((d) => d.id)).catch(() => new Map());
  const doseEds = doses.map((d) => doseEditor(d, !clinical, mixing, mixState.get(d.id)));

  // ----------------------------------------------------------- إضافة دواء
  const add = addEditor(clinical);

  // ----------------------------------------------------------- التشخيص
  const dx = h('input', { class: 'input', value: t.diagnosis });
  const icd = h('input', { class: 'input ltr', style: 'text-align: right; text-transform: uppercase', value: t.icd10 || '' });
  const stage = h('input', { class: 'input', value: t.stage || '' });

  // ----------------------------------------------------------- البروتوكول
  const protoSel = h('select', { class: 'input' }, h('option', { value: '', text: 'بدون تغيير' }),
    protocols.filter((p) => p.id !== t.protocol_id).map((p) => h('option', { value: p.id, text: `${p.name} · ${p.disease}` })));
  const protoStart = h('input', { class: 'input', type: 'date', min: todayISO() });
  const protoNote = h('div');
  protoSel.addEventListener('change', () => {
    protoNote.replaceChildren(protoSel.value ? notice('warn', 'warn', h('p', { text: `توقف الخطة الحالية (${t.protocol_name}) وتُلغى دوراتها غير المعطاة، وتبدأ خطة جديدة بالبروتوكول المختار وجرعات تُحسب من الطول والوزن الحاليين. لا تُجمع مع تعديلات أخرى في الطلب نفسه.` })) : null);
  });

  // ----------------------------------------------------------- التقرير
  let reason = null;
  const reasonBox = h('div', { style: 'display: flex; flex-wrap: wrap; gap: 6px' });
  const drawReasons = () => reasonBox.replaceChildren(...REASONS.map((r) => h('button', { type: 'button', class: 'choice', style: 'min-height: 40px; padding: 0 12px; font-size: 14px', 'aria-pressed': reason === r ? 'true' : 'false', text: r, onclick: () => { reason = r; drawReasons(); } })));
  drawReasons();
  const report = h('textarea', { class: 'input', rows: 4, placeholder: doctor ? 'ملاحظة اختيارية تظهر في السجل' : 'اكتب للطبيب: القيم أو الملاحظات التي دعت للتعديل، ومرجعك إن وُجد' });

  const summary = h('div');
  const err = h('div');
  const submit = h('button', { class: 'btn primary block', type: 'button', text: doctor ? 'تطبيق التعديلات' : 'إرسال الطلب' });

  function collect() {
    if (protoSel.value) {
      if (!protoStart.value) return { error: 'اختر تاريخ أول دورة في البروتوكول الجديد' };
      return { items: [{ kind: 'protocol', payload: { protocol_id: protoSel.value, start_date: protoStart.value } }],
        labels: ['تغيير البروتوكول إلى ' + protoSel.selectedOptions[0].text] };
    }
    const items = [], labels = [];
    for (const e of doseEds) { const r = e.items(); if (r.error) return r; items.push(...r.items); labels.push(...r.labels); }
    if (!mixing) { const a = add.item(); if (a.error) return a; if (a.item) { items.push(a.item); labels.push(a.label); } }
    if (!clinical) {
      const nd = dx.value.trim(), ni = icd.value.trim().toUpperCase(), ns = stage.value.trim();
      if (nd !== t.diagnosis || ni !== (t.icd10 || '') || ns !== (t.stage || '')) {
        if (!nd) return { error: 'التشخيص لا يكون فارغاً' };
        if (ni && !/^[A-Z]\d{2}(\.\d{1,2})?$/.test(ni)) return { error: 'رمز ICD-10 غير صحيح' };
        items.push({ kind: 'diagnosis', payload: { diagnosis: nd, icd10: ni || null, stage: ns || null } });
        labels.push(`التشخيص: ${nd}${ni ? ' (' + ni + ')' : ''}${ns ? ' · ' + ns : ''}`);
      }
    }
    if (!items.length) return { error: 'لم تغيّر شيئاً بعد' };
    return { items, labels };
  }

  submit.addEventListener('click', () => busy(submit, async () => {
    const fail = (m) => { err.replaceChildren(notice('err', 'warn', h('p', { text: m }))); err.scrollIntoView({ block: 'center', behavior: 'smooth' }); };
    err.replaceChildren();
    const r = collect();
    if (r.error) return fail(r.error);
    if (pharm && !doctor) {
      if (!reason) return fail('اختر سبب التعديل');
      if (report.value.trim().length < 10) return fail('اكتب تقريراً واضحاً للطبيب (10 أحرف على الأقل)');
    }
    const ok = await confirmDialog({
      title: doctor ? `تطبيق ${count(r.items.length, 'item')}` : `إرسال ${count(r.items.length, 'item')} للطبيب`,
      body: r.labels.join(' ؛ ') + (doctor ? '. يُطبَّق فوراً ويبقى اعتماد الدورة، ويُبلَّغ قسم المزج إن وصلته.' : '. لا يُطبَّق شيء قبل القرار.'),
      okText: doctor ? 'تطبيق' : 'إرسال',
    });
    if (!ok) return;
    try {
      if (doctor) {
        await rpc('doctor_edit', { p_cycle: id, p_items: r.items, p_note: report.value.trim() || null });
        toast('طُبّقت التعديلات');
        go(r.items[0].kind === 'protocol' ? '/patient?id=' + t.patients.id : '/cycle?id=' + id);
      } else {
        const reqId = await rpc('submit_change_request', { p_cycle: id, p_items: r.items, p_reason_category: reason, p_report: report.value.trim() });
        toast('أُرسل الطلب');
        go('/request?id=' + reqId);
      }
    } catch (e) { fail(e.message); }
  }));

  mount(root, h('div', { class: 'screen' },
    topbar({ title: doctor ? 'تعديل الدورة' : 'اقتراح تعديل', sub: `${t.patients.full_name} · ${t.protocol_name} · الدورة ${c.cycle_no}`, back }),
    h('main', { class: 'main' },
      notice(doctor ? 'info' : 'warn', 'info', h('p', { text: doctor
        ? 'تُطبَّق تعديلاتك فوراً وتُسجَّل باسمك.' + (state.profile.role === 'senior_resident' ? ' ويُبلَّغ الطبيب المختص بها.' : '')
        : (state.profile.role === 'clinical_pharmacist'
          ? 'يُرسل اقتراحك مع تقريرك إلى الطبيب المختص بالمريض والمقيم الأقدم ومسؤول الصيادلة، ويقرّره أحدهم. لا يتغير شيء قبل القرار.'
          : 'يُرسل اقتراحك مع تقريرك إلى الطبيب المختص بالمريض والمقيم الأقدم، ويقرّره أحدهما. لا يتغير شيء قبل القرار، وبعد الموافقة يعيد الطبيب اعتماد الدورة.')
          + (mixing ? ' صيدلي المزج يقترح تعديل الجرعات فقط.' : '') })),
      h('div', { class: 'section-head' }, h('h2', { text: 'الجرعات' })),
      ...doseEds.map((e) => e.el),
      mixing ? null : h('div', { class: 'section-head' }, h('h2', { text: clinical ? 'إضافة دواء داعم' : 'إضافة دواء' })),
      mixing ? null : add.el,
      !clinical ? h('div', { class: 'card' }, h('h2', { text: 'التشخيص والمرحلة' }), field('التشخيص', dx),
        h('div', { class: 'grid-2' }, field('ICD-10', icd), field('المرحلة', stage))) : null,
      !clinical ? h('div', { class: 'card' }, h('h2', { text: 'تغيير البروتوكول' }), field('البروتوكول الجديد', protoSel), field('تاريخ أول دورة', protoStart), protoNote) : null,
      h('div', { class: 'card' },
        h('h2', { text: doctor ? 'ملاحظة' : 'تقرير الأسباب للطبيب' }),
        !doctor ? h('div', { class: 'field' }, h('span', { class: 'label', text: 'سبب التعديل' }), reasonBox) : null,
        field(doctor ? 'ملاحظة (اختيارية)' : 'التقرير', report)),
      summary, err, submit)));
}

function doseEditor(d, canRemove, doseOnly = false, ms = null) {
  const cur = Number(d.final_dose);
  const val = h('input', { class: 'input ltr', type: 'number', inputmode: 'decimal', step: 'any', min: 0, style: 'text-align: right', placeholder: num(cur) });
  const onward = h('input', { type: 'checkbox', checked: true });
  const dil = h('input', { class: 'input', value: d.diluent || '', placeholder: 'مثال: NS 500 ml' });
  const rate = h('input', { class: 'input', value: d.infusion_rate || '', placeholder: 'مثال: خلال ساعة' });
  const remove = h('input', { type: 'checkbox' });
  const removeReason = h('input', { class: 'input', placeholder: 'سبب الحذف', disabled: true });
  remove.addEventListener('change', () => { removeReason.disabled = !remove.checked; el.classList.toggle('struck', remove.checked); });
  const pctOut = h('p', { class: 'hint' });
  const drawPct = () => {
    const v = Number(latinDigits(val.value));
    pctOut.textContent = v > 0 && v !== cur ? `${v > cur ? 'زيادة' : 'تخفيض'} ${Math.abs(Math.round((v / cur - 1) * 100))}% عن الجرعة الحالية` : '';
    pctOut.style.color = v > cur * 1.25 ? 'var(--brand)' : '';
  };
  val.addEventListener('input', drawPct);
  const quick = h('div', { style: 'display: flex; gap: 6px; flex-wrap: wrap' },
    [90, 80, 75, 50].map((pc) => h('button', { type: 'button', class: 'pill muted', style: 'border: 0; padding: 6px 12px; font-size: 14px', text: pc + '%',
      onclick: () => { val.value = round(cur * pc / 100); drawPct(); } })));

  const el = h('div', { class: 'card dose-edit' },
    h('div', { style: 'display: flex; justify-content: space-between; align-items: flex-start; gap: 8px' },
      h('span', { style: 'display: flex; flex-direction: column' },
        h('b', { class: 'ltr', style: 'text-align: right; font-size: 17px', text: d.drug_name }),
        h('span', { style: 'font-size: 13px; color: var(--muted-2)', text: `${d.route} · ${daysText(d.days)}` })),
      h('span', { class: 'dose-big' }, h('b', { class: 'ltr', text: num(cur) }), h('span', { text: OUT_UNITS[d.final_unit] || d.final_unit }))),
    field(`الجرعة الجديدة (${OUT_UNITS[d.final_unit] || d.final_unit})`, val), quick, pctOut,
    h('label', { class: 'check' }, onward, h('span', { text: 'تطبيق على هذه الدورة والدورات التالية' })),
    doseOnly ? null : h('details', null, h('summary', { style: 'cursor: pointer; font-weight: 600; min-height: 36px', text: 'المحلول ومعدل التسريب' }),
      h('div', { class: 'grid-2', style: 'margin-top: 8px' }, field('المحلول', dil), field('معدل التسريب', rate))),
    canRemove ? h('div', { class: 'grid-2', style: 'align-items: center' }, h('label', { class: 'check' }, remove, h('span', { text: 'حذف الدواء' })), removeReason) : null);

  // حالة المزج: المرسلة غير المعطاة لا تُعدَّل، والمحضّرة يظهر أن التعديل يلغي تحضيرها
  const note = mixNote(ms);
  if (note) el.insertBefore(h('p', { class: 'notice ' + (ms.locked ? 'ok' : 'warn'), style: 'margin: 0', text: note + (ms.locked ? '' : '. أي تعديل عليها يُلغي تحضيرها ويُعاد.') }), el.children[1]);
  if (ms?.locked) {
    el.classList.add('locked');
    el.querySelectorAll('input, select, button').forEach((x) => { x.disabled = true; });
    return { el, items: () => ({ items: [], labels: [] }) };
  }

  return {
    el,
    items() {
      const items = [], labels = [];
      if (remove.checked) {
        if (!removeReason.value.trim()) return { error: `اكتب سبب حذف ${d.drug_name}` };
        items.push({ kind: 'remove_drug', target_dose_id: d.id, apply_onward: onward.checked, payload: { reason: removeReason.value.trim() } });
        labels.push(`حذف ${d.drug_name}`);
        return { items, labels };
      }
      if (val.value !== '') {
        const v = Number(latinDigits(val.value));
        if (!(v > 0)) return { error: `جرعة ${d.drug_name} يجب أن تكون أكبر من صفر` };
        if (v !== cur) {
          items.push({ kind: 'dose', target_dose_id: d.id, new_value: String(v), apply_onward: onward.checked });
          labels.push(`${d.drug_name}: من ${num(cur)} إلى ${num(v)} ${OUT_UNITS[d.final_unit] || ''}${onward.checked ? ' (وما بعدها)' : ''}`);
        }
      }
      if (!doseOnly && (dil.value.trim() !== (d.diluent || '') || rate.value.trim() !== (d.infusion_rate || ''))) {
        items.push({ kind: 'infusion', target_dose_id: d.id, payload: { diluent: dil.value.trim() || null, infusion_rate: rate.value.trim() || null } });
        labels.push(`${d.drug_name}: المحلول والتسريب`);
      }
      return { items, labels };
    },
  };
}

function addEditor(supportiveOnly) {
  const on = h('input', { type: 'checkbox' });
  const name = h('input', { class: 'input ltr', style: 'text-align: right', placeholder: supportiveOnly ? 'Ondansetron' : 'اسم الدواء' });
  const dose = h('input', { class: 'input ltr', type: 'number', inputmode: 'decimal', step: 'any', min: 0, style: 'text-align: right' });
  const unit = h('select', { class: 'input' }, Object.entries(OUT_UNITS).map(([k, l]) => h('option', { value: k, text: l })));
  const route = h('select', { class: 'input' }, ROUTES.map((r) => h('option', { value: r, text: `${r} · ${ROUTE_AR[r]}` })));
  const days = h('input', { class: 'input ltr', style: 'text-align: right', value: '1' });
  const mixed = h('input', { type: 'checkbox', checked: !supportiveOnly });
  const dil = h('input', { class: 'input', placeholder: 'اختياري' });
  const rate = h('input', { class: 'input', placeholder: 'اختياري' });
  const onward = h('input', { type: 'checkbox', checked: true });
  const body = h('div', { class: 'section', hidden: true },
    field('اسم الدواء (بالإنجليزية)', name),
    h('div', { class: 'grid-2' }, field('الجرعة النهائية', dose), field('الوحدة', unit)),
    h('div', { class: 'grid-2' }, field('الطريق', route), field('الأيام', days)),
    h('div', { class: 'grid-2' }, field('المحلول', dil), field('التسريب', rate)),
    h('label', { class: 'check' }, mixed, h('span', { text: 'يُحضَّر في قسم المزج' })),
    h('label', { class: 'check' }, onward, h('span', { text: 'في هذه الدورة والدورات التالية' })),
    supportiveOnly ? h('p', { class: 'hint', text: 'الصيدلي السريري يقترح الأدوية الداعمة فقط (مضادات القيء، الوقاية، السوائل...).' }) : null);
  on.addEventListener('change', () => { body.hidden = !on.checked; });
  route.addEventListener('change', () => { mixed.checked = route.value !== 'PO'; });
  return {
    el: h('div', { class: 'card' }, h('label', { class: 'check' }, on, h('span', { style: 'font-weight: 700', text: supportiveOnly ? 'أضف دواءً داعماً' : 'أضف دواءً إلى الدورة' })), body),
    item() {
      if (!on.checked) return {};
      const nm = name.value.trim(), v = Number(latinDigits(dose.value));
      if (!/^[A-Za-z]/.test(nm)) return { error: 'اكتب اسم الدواء المضاف بالإنجليزية' };
      if (!(v > 0)) return { error: 'جرعة الدواء المضاف يجب أن تكون أكبر من صفر' };
      if (!validDays(days.value)) return { error: 'أيام الدواء المضاف غير صحيحة' };
      return {
        item: { kind: 'add_drug', apply_onward: onward.checked, payload: { drug_name: nm, route: route.value, days: days.value.replace(/\s/g, ''),
          final_dose: v, final_unit: unit.value, is_mixed: mixed.checked, diluent: dil.value.trim() || null, infusion_rate: rate.value.trim() || null,
          supportive: supportiveOnly ? true : undefined } },
        label: `إضافة ${nm} ${num(v)} ${OUT_UNITS[unit.value]}`,
      };
    },
  };
}
