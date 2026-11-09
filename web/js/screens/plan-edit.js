// تعديل خطة العلاج بعد إدخالها (الملفان 42 و43): التشخيص، وحالة المرض، ودرجة المرض، والبروتوكول، والـCycle الحالي،
// والمدة بين الـCycles، وعدد الـCycles.
// للمدير وطبيب الاختصاص والمقيم الأقدم ومسؤول الصيادلة السريريين الأصلي.
import { sb, q, rpc } from '../api.js';
import { h, mount, topbar, field, notice, toast, busy, confirmDialog, fmtDate, todayISO, addDaysISO, count } from '../ui.js';
import { go, state } from '../app.js';
import { canEditPlan } from '../perms.js';
import { diagnosesFor, allDiagnoses, OTHER, STATUS, GRADES } from '../diagnoses.js';

export async function render(root, params) {
  const tid = params.get('tid');
  const shell = (...c) => mount(root, h('div', { class: 'screen' }, topbar({ title: 'تعديل خطة العلاج', back: '#/patients' }), h('main', { class: 'main' }, ...c)));
  if (!canEditPlan()) return shell(notice('info', 'lock', h('p', { text: 'تعديل الخطة للمدير وطبيب الاختصاص والمقيم الأقدم ومسؤول الصيادلة السريريين.' })));
  shell(h('div', { class: 'empty' }, h('span', { class: 'spinner' })));

  const t = await q(sb.from('treatments').select('id, patient_id, protocol_id, protocol_name, diagnosis, icd10, stage, disease_status, status, total_cycles, cycle_length_days, patients(full_name, file_no)').eq('id', tid).maybeSingle());
  if (!t) throw new Error('الخطة غير موجودة');
  const back = '#/patient?id=' + t.patient_id;
  if (!['active', 'pending_approval'].includes(t.status)) return shell(notice('warn', 'warn', h('p', { text: 'هذه الخطة ليست قائمة.' })));
  const [protocols, next] = await Promise.all([
    q(sb.from('protocols').select('id, name, disease, total_cycles, cycle_length_days').not('approved_at', 'is', null).is('archived_at', null).order('name')),
    q(sb.from('cycles').select('cycle_no, planned_date').eq('treatment_id', tid).in('status', ['planned', 'held']).order('cycle_no').limit(1)),
  ]);
  const cur = next[0] || null;

  // البروتوكول
  const protoSel = h('select', { class: 'input ltr', style: 'text-align: right' },
    protocols.map((pr) => h('option', { value: pr.id, selected: pr.id === t.protocol_id, text: `${pr.name} · ${count(pr.total_cycles, 'cycle')}` })));
  if (!protocols.some((pr) => pr.id === t.protocol_id)) protoSel.prepend(h('option', { value: t.protocol_id, selected: true, text: t.protocol_name + ' (الحالي)' }));
  const chosen = () => protocols.find((pr) => pr.id === protoSel.value) || { id: t.protocol_id, name: t.protocol_name, total_cycles: t.total_cycles };

  // رقم الجرعة الحالية داخل البروتوكول
  const cycleSel = h('select', { class: 'input' });
  const drawCycles = () => {
    const n = chosen().total_cycles; const keep = Number(cycleSel.value) || cur?.cycle_no || 1;
    cycleSel.replaceChildren(...Array.from({ length: n }, (_, i) => h('option', { value: i + 1, selected: i + 1 === Math.min(keep, n), text: `Cycle ${i + 1} of ${n}` })));
  };
  drawCycles();
  const start = h('input', { class: 'input', type: 'date', value: cur?.planned_date || todayISO(), min: addDaysISO(todayISO(), -365), max: addDaysISO(todayISO(), 365) });

  // التشخيص
  const dxSel = h('select', { class: 'input', id: 'dx-sel' });
  const dxOther = h('input', { class: 'input ltr', style: 'text-align: right', maxlength: 200, placeholder: 'Diagnosis', 'aria-label': 'التشخيص (كتابة)' });
  let dxList = [];
  const drawDx = () => {
    dxList = diagnosesFor(chosen());
    const all = allDiagnoses();
    const match = [...dxList, ...all].find((d) => d.label === dxSel.dataset.cur);
    if (match && !dxList.some((d) => d.key === match.key)) dxList = [match, ...dxList];
    dxSel.replaceChildren(h('option', { value: '', text: 'اختر التشخيص' }),
      dxList.map((d) => h('option', { value: d.key, dir: 'ltr', text: d.label, selected: d.label === dxSel.dataset.cur })),
      h('option', { value: OTHER, text: 'Other', selected: !match && !!dxSel.dataset.cur }));
    dxOther.hidden = dxSel.value !== OTHER;
    if (dxSel.value === OTHER && !dxOther.value) dxOther.value = dxSel.dataset.cur || '';
  };
  dxSel.dataset.cur = t.diagnosis || '';
  drawDx();
  dxSel.addEventListener('change', () => { dxSel.dataset.cur = ''; dxOther.hidden = dxSel.value !== OTHER; });

  // حالة المرض ودرجته
  let dStatus = t.disease_status || null;
  const statusBox = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'حالة المرض' });
  const drawStatus = () => statusBox.replaceChildren(...STATUS.map(([k, en]) => h('button', { type: 'button', role: 'radio', 'aria-pressed': dStatus === k ? 'true' : 'false', 'aria-checked': dStatus === k ? 'true' : 'false',
    onclick: () => { dStatus = k; drawStatus(); } }, h('span', { class: 'ltr', text: en }))));
  drawStatus();
  const stage = h('select', { class: 'input' }, h('option', { value: '', text: 'غير محددة' }),
    [...new Set([...GRADES, ...(t.stage && !GRADES.includes(t.stage) ? [t.stage] : [])])].map((g) => h('option', { value: g, selected: g === t.stage, text: g })));

  // المدة بين الـCycles وعددها (الملف 43)
  const lenIn = h('input', { class: 'input ltr', type: 'number', min: 1, max: 365, inputmode: 'numeric', value: t.cycle_length_days, style: 'text-align: right' });
  const totalIn = h('input', { class: 'input ltr', type: 'number', min: 1, max: 120, inputmode: 'numeric', value: t.total_cycles, style: 'text-align: right' });
  const reason = h('textarea', { class: 'input', rows: 2, maxlength: 500, placeholder: 'مثال: أخذ المريض Cycle 1 و2 في مستشفى آخر' });
  const restructBox = h('div', { class: 'card', hidden: true },
    notice('warn', 'warn', h('p', { text: 'تغيير البروتوكول أو الـCycle الحالي يوقف الخطة الحالية (تبقى في «خطط سابقة») وينشئ خطة جديدة تبدأ من الـCycle المختار بجرعات دوائية محسوبة من جديد، وما قبله يُسجَّل مُعطى. أي تعديل يدوي على جرعات الخطة الحالية لا يُنقل.' })),
    field('تاريخ الـCycle المختار', start), field('سبب التغيير (إلزامي)', reason));
  const restructured = () => protoSel.value !== t.protocol_id || Number(cycleSel.value) !== (cur?.cycle_no ?? -1);
  const onChange = () => { restructBox.hidden = !restructured(); };
  protoSel.addEventListener('change', () => { drawCycles(); drawDx(); onChange(); });
  cycleSel.addEventListener('change', onChange);

  const err = h('div');
  const save = h('button', { type: 'button', class: 'btn primary block', text: 'حفظ التعديل' });
  save.addEventListener('click', () => busy(save, async () => {
    err.replaceChildren();
    const fail = (m) => err.replaceChildren(notice('err', 'warn', h('p', { text: m })));
    const dxItem = dxList.find((d) => d.key === dxSel.value);
    const dxText = dxSel.value === OTHER ? dxOther.value.trim() : (dxItem ? dxItem.label : dxSel.dataset.cur);
    if (!dxText) return fail('اختر التشخيص');
    const re = restructured();
    if (re && !reason.value.trim()) return fail('اكتب سبب تغيير البروتوكول أو الـCycle الحالي');
    if (re && !await confirmDialog({ title: 'إنشاء الخطة من جديد', okText: 'تأكيد',
      body: `${chosen().name} ابتداءً من Cycle ${cycleSel.value} بتاريخ ${fmtDate(start.value)}. تُوقف الخطة الحالية وتبقى في السجل.` })) return;
    const len = Number(lenIn.value), total = Number(totalIn.value);
    if (!(len >= 1 && len <= 365)) return fail('المدة بين الـCycles بين 1 و365 يوماً');
    if (!(total >= 1 && total <= 120)) return fail('عدد الـCycles بين 1 و120');
    if (total < t.total_cycles && !re && !await confirmDialog({ title: 'تقليل عدد الـCycles', okText: 'تأكيد', danger: true,
      body: `من ${t.total_cycles} إلى ${total}: تُلغى Cycle ${total + 1} وما بعدها إن لم تُعطَ.` })) return;
    try {
      const nt = await rpc('update_plan', { p_cycle_length: len === t.cycle_length_days ? null : len, p_total_cycles: total === t.total_cycles ? null : total, p_tid: tid, p_diagnosis: dxText, p_icd10: dxItem ? dxItem.icd : (dxSel.value === OTHER ? null : t.icd10),
        p_stage: stage.value || null, p_disease_status: dStatus, p_protocol: protoSel.value, p_cycle_no: re ? Number(cycleSel.value) : (cur?.cycle_no ?? null),
        p_start: re ? start.value : null, p_reason: re ? reason.value.trim() : null });
      toast(re ? 'أُنشئت الخطة من جديد بالتعديل' : 'حُفظ تعديل الخطة');
      go('/patient?id=' + t.patient_id + '&r=' + Date.now());
      return nt;
    } catch (x) { fail(x.message); }
  }));

  mount(root, h('div', { class: 'screen' },
    topbar({ title: 'تعديل خطة العلاج', sub: `${t.patients.full_name} · ${t.patients.file_no}`, back }),
    h('main', { class: 'main' },
      h('div', { class: 'card' }, h('h2', { text: 'البروتوكول والـCycle الحالي' }),
        field('البروتوكول', protoSel), field('الـCycle الحالي داخل البروتوكول', cycleSel, cur ? `القادم الآن: Cycle ${cur.cycle_no} بتاريخ ${fmtDate(cur.planned_date)}` : null)),
      h('div', { class: 'card' }, h('h2', { text: 'المدة وعدد الـCycles' }),
        h('div', { class: 'grid-2' }, field('المدة بين الـCycles (يوم)', lenIn), field('عدد الـCycles', totalIn)),
        h('p', { class: 'hint', text: 'تغيير المدة يبقي موعد الـCycle القادم ويعيد جدولة ما بعده. زيادة العدد تضيف Cycles بجرعات محسوبة، وتقليله يلغي الأخيرة التي لم تُعطَ.' })),
      restructBox,
      h('div', { class: 'card' }, h('h2', { text: 'التشخيص' }),
        field('التشخيص', dxSel), dxOther,
        h('div', { class: 'field' }, h('span', { class: 'label', text: 'حالة المرض' }), statusBox),
        field('درجة المرض', stage)),
      err, save,
      h('a', { class: 'link-btn', href: back, text: 'إلغاء' }))));
}
