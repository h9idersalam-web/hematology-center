// شاشة الدورة: الجرعات وطريقة حسابها، ومراحل الاعتماد، والتعديلات
import { sb, q, rpc } from '../api.js';
import { h, mount, icon, topbar, bottomNav, notice, fmtDate, fmtDay, fmtTime, toast, confirmDialog, busy, daysUntil, count, ROLES } from '../ui.js';
import { go } from '../app.js';
import { can } from '../perms.js';
import { ROUTE_AR, OUT_UNITS, daysText, calcLine, num } from '../dose.js';
import { NKDA } from './patient-form.js';
import { postponeDialog } from './postpone.js';

export const CR_STATUS = { pending: ['بانتظار القرار', 'warn'], approved: ['وافق الطبيب', 'ok'], partially_approved: ['موافقة جزئية', 'info'], rejected: ['رُفض', 'muted'] };
const C_STATUS = { planned: ['مجدولة', 'muted'], held: ['موقوفة', 'warn'], given: ['أُعطيت', 'ok'], cancelled: ['أُلغيت', 'muted'] };

export async function render(root, params) {
  const id = params.get('id');
  const [c, doses, reqs] = await Promise.all([
    q(sb.from('cycles').select('*, doctor:profiles!cycles_doctor_approved_by_fkey(full_name), pharm:profiles!cycles_pharmacist_verified_by_fkey(full_name), treatments(*, patients(id, full_name, file_no, allergies, archived_at))').eq('id', id).maybeSingle()),
    q(sb.from('cycle_doses').select('*').eq('cycle_id', id).order('sort').order('drug_name')),
    q(sb.from('change_requests').select('id, status, requester_role, created_at, report, requester:profiles!change_requests_requested_by_fkey(full_name), change_request_items(id)').eq('cycle_id', id).order('created_at', { ascending: false })),
  ]);
  if (!c) throw new Error('الدورة غير موجودة');
  const t = c.treatments, p = t.patients;
  const active = doses.filter((d) => !d.archived_at);
  const removed = doses.filter((d) => d.archived_at);
  const pendingReqs = reqs.filter((r) => r.status === 'pending');
  const open = (c.status === 'planned' || c.status === 'held') && !p.archived_at;
  const live = open && t.status === 'active';
  const [stL, stK] = C_STATUS[c.status];
  const reload = () => render(root, params);

  // الأزرار حسب الدور والحالة
  const actions = [];
  if (live && can('approveCycle') && !c.doctor_approved_at && c.status === 'planned') {
    actions.push(actionBtn('ok', 'check', 'اعتماد الدورة', async () => {
      const ok = await confirmDialog({ title: `اعتماد الدورة ${c.cycle_no}`, body: 'تؤكد أن الجرعات مناسبة لحالة المريض الحالية وتحاليله.', okText: 'اعتماد' });
      if (ok) { await rpc('approve_cycle', { p_cycle: id }); toast('اعتُمدت الدورة'); reload(); }
    }));
  }
  if (live && can('verifyCycle') && c.doctor_approved_at && !c.pharmacist_verified_at) {
    actions.push(actionBtn('ok', 'shield', 'تحقق الصيدلاني', async () => {
      const ok = await confirmDialog({ title: 'تحقق الصيدلاني', body: 'تؤكد مراجعة الحساب والسقوف والتداخلات والحساسية ومحلول التخفيف.', okText: 'تأكيد التحقق' });
      if (ok) { await rpc('verify_cycle', { p_cycle: id }); toast('سُجّل تحققك'); reload(); }
    }));
  }
  if (open && can('doctorEdit')) actions.push(h('a', { class: 'btn secondary block', href: '#/cycle-edit?id=' + id }, icon('edit', 22), 'تعديل الجرعات أو الخطة'));
  if (open && can('requestEdit')) actions.push(h('a', { class: 'btn secondary block', href: '#/cycle-edit?id=' + id }, icon('edit', 22), 'اقتراح تعديل على الطبيب'));
  if (live && can('postpone')) {
    actions.push(actionBtn('secondary', 'clock', 'تأجيل الدورة', async () => { if (await postponeDialog({ ...c, patient_name: p.full_name })) reload(); }));
  }
  if (live && can('completeCycle') && c.doctor_approved_at && c.pharmacist_verified_at && daysUntil(c.planned_date) <= 0) {
    actions.push(actionBtn('secondary', 'check', 'تسجيل الدورة كمُعطاة', async () => {
      const ok = await confirmDialog({ title: `إغلاق الدورة ${c.cycle_no}`, body: 'تُسجَّل الدورة مُعطاة ولا يمكن تعديل جرعاتها بعد ذلك. تسجيل الإعطاء لكل دواء من التمريض يأتي في الخطوة 5.', okText: 'تسجيل' });
      if (ok) { await rpc('complete_cycle', { p_cycle: id }); toast('سُجّلت الدورة مُعطاة'); reload(); }
    }));
  }

  mount(root, h('div', { class: 'screen' },
    topbar({ title: `الدورة ${c.cycle_no} من ${t.total_cycles}`, sub: `${p.full_name} · ${t.protocol_name}`, back: '#/patient?id=' + p.id }),
    h('main', { class: 'main with-nav' },
      h('div', { class: 'card', style: 'flex-direction: row; align-items: center; justify-content: space-between' },
        h('span', { style: 'display: flex; flex-direction: column; gap: 2px' },
          h('span', { style: 'font-size: 13px; color: var(--muted-2)', text: 'الموعد' }),
          h('b', { style: 'font-size: 17px', text: fmtDay(c.planned_date) }),
          c.postpone_reason ? h('span', { style: 'font-size: 13px; color: var(--muted)', text: 'أُجّلت: ' + c.postpone_reason }) : null),
        h('span', { style: 'display: flex; flex-direction: column; align-items: flex-end; gap: 6px' },
          h('span', { class: 'pill ' + stK, text: stL }), h('span', { class: 'tag', text: `BSA ${num(t.bsa)} m²` }))),
      p.allergies && p.allergies !== NKDA ? notice('err', 'alert', h('p', { style: 'font-weight: 700', text: 'حساسية دوائية: ' + p.allergies })) : null,
      t.status === 'pending_approval' ? notice('info', 'info', h('p', { text: 'خطة العلاج بانتظار موافقة الطبيب المختص. لا تُعتمد الدورة قبلها.' })) : null,
      t.status === 'stopped' ? notice('warn', 'warn', h('p', { text: 'أُوقفت الخطة: ' + (t.stop_reason || '') })) : null,
      steps(c),
      pendingReqs.length ? h('a', { href: '#/request?id=' + pendingReqs[0].id, class: 'notice warn', style: 'text-decoration: none; align-items: center' },
        icon('warn', 22), h('span', { style: 'flex: 1', text: `${count(pendingReqs.length, 'request')} تعديل بانتظار قرار الطبيب المختص. لا يتحقق الصيدلاني قبل القرار.` }),
        h('b', { text: 'عرض' })) : null,
      h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', { text: 'الجرعات' }), h('span', { class: 'meta', text: count(active.length, 'drug') })),
        h('div', { class: 'card flush' }, active.length ? active.map((d) => doseRow(d, t)) : h('div', { class: 'empty', text: 'لا توجد أدوية' }))),
      removed.length ? h('details', { class: 'card' },
        h('summary', { style: 'font-weight: 700; cursor: pointer', text: `أدوية حُذفت من هذه الدورة (${removed.length})` }),
        removed.map((d) => h('p', { style: 'font-size: 14px; color: var(--muted)' }, h('span', { class: 'ltr', text: d.drug_name }), ' · ', d.archive_reason || ''))) : null,
      actions.length ? h('div', { class: 'section' }, ...actions) : null,
      reqs.length ? h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', { text: 'سجل التعديلات' })),
        h('div', { class: 'card flush' }, reqs.map(reqRow))) : null),
    bottomNav('patients')));
}

function actionBtn(kind, ic, label, fn) {
  const b = h('button', { type: 'button', class: 'btn block ' + kind }, icon(ic, 22, kind === 'ok' ? '#fff' : 'currentColor'), label);
  b.addEventListener('click', () => busy(b, async () => { try { await fn(); } catch (e) { toast(e.message, true); } }));
  return b;
}

function steps(c) {
  const step = (done, title, by, at, waiting) => h('div', { class: 'step' + (done ? ' done' : waiting ? ' now' : '') },
    h('span', { class: 'dot' }, done ? icon('check', 16, '#fff', 3) : null),
    h('span', { style: 'display: flex; flex-direction: column' },
      h('b', { style: 'font-size: 15px', text: title }),
      h('span', { style: 'font-size: 13px; color: var(--muted-2)', text: done ? `${by || ''} · ${fmtDate(at, { day: 'numeric', month: 'short' })} ${fmtTime(at)}` : waiting ? 'بانتظار' : 'لاحقاً' })));
  return h('div', { class: 'card steps' },
    step(!!c.doctor_approved_at, 'اعتماد الطبيب', c.doctor?.full_name, c.doctor_approved_at, !c.doctor_approved_at),
    step(!!c.pharmacist_verified_at, 'تحقق الصيدلاني', c.pharm?.full_name, c.pharmacist_verified_at, !!c.doctor_approved_at && !c.pharmacist_verified_at),
    step(c.status === 'given', 'المزج والإعطاء', null, null, false));
}

function doseRow(d, t) {
  const badges = [];
  if (d.capped) badges.push(h('span', { class: 'pill warn', text: `بالسقف (المحسوب ${num(d.calculated)})` }));
  if (d.source === 'edited') badges.push(h('span', { class: 'pill info', text: `عُدّلت من ${num(d.edited_from)}` }));
  if (d.source === 'added') badges.push(h('span', { class: 'pill brand', text: 'دواء مضاف' }));
  badges.push(h('span', { class: 'pill ' + (d.is_mixed ? 'info' : 'muted'), text: d.is_mixed ? 'مزج' : 'بلا مزج' }));
  return h('div', { class: 'row', style: 'align-items: flex-start' },
    h('span', { class: 'grow' },
      h('span', { class: 't ltr', style: 'text-align: right', text: d.drug_name }),
      h('span', { class: 's', text: `${d.route} (${ROUTE_AR[d.route] || d.route}) · ${daysText(d.days)}` }),
      h('span', { class: 's', text: calcLine(d, t.bsa, t.weight_kg) }),
      d.diluent || d.infusion_rate ? h('span', { class: 's', text: [d.diluent, d.infusion_rate].filter(Boolean).join(' · ') }) : null,
      h('span', { style: 'display: flex; gap: 4px; flex-wrap: wrap; margin-top: 4px' }, badges)),
    h('span', { class: 'dose-big' }, h('b', { class: 'ltr', text: num(d.final_dose) }), h('span', { text: OUT_UNITS[d.final_unit] || d.final_unit })));
}

function reqRow(r) {
  const [l, k] = CR_STATUS[r.status];
  return h('a', { class: 'row', href: '#/request?id=' + r.id },
    h('span', { class: 'grow' },
      h('span', { class: 't', style: 'font-size: 15px', text: `${r.requester?.full_name || ''} · ${ROLES[r.requester_role]}` }),
      h('span', { class: 's', text: `${count(r.change_request_items.length, 'item')} · ${fmtDate(r.created_at, { day: 'numeric', month: 'short' })}` })),
    h('span', { class: 'pill ' + k, text: l }));
}
