// شاشة الدورة: الجرعات وطريقة حسابها، ومراحل الاعتماد، والتعديلات
import { sb, q, rpc } from '../api.js';
import { h, mount, icon, topbar, bottomNav, notice, fmtDate, fmtDay, fmtTime, toast, confirmDialog, busy, daysUntil, count, ROLES } from '../ui.js';
import { go } from '../app.js';
import { can } from '../perms.js';
import { ROUTE_AR, OUT_UNITS, daysText, calcLine, num, instrLine, aucCalc } from '../dose.js';
import { NKDA } from './patient-form.js';
import { postponeDialog } from './postpone.js';
import { latestCbc } from './labs.js';
import { flag } from '../labs.js';
import { daysList } from '../dose.js';
import { protocolFileLink } from '../files.js';

export const CR_STATUS = { pending: ['بانتظار القرار', 'warn'], approved: ['وافق الطبيب', 'ok'], partially_approved: ['موافقة جزئية', 'info'], rejected: ['رُفض', 'muted'] };
const C_STATUS = { planned: ['مجدولة', 'muted'], held: ['موقوفة', 'warn'], given: ['أُعطيت', 'ok'], cancelled: ['أُلغيت', 'muted'] };

export async function render(root, params) {
  const id = params.get('id');
  const [c, doses, reqs, orders] = await Promise.all([
    q(sb.from('cycles').select('*, doctor:profiles!cycles_doctor_approved_by_fkey(full_name), pharm:profiles!cycles_pharmacist_verified_by_fkey(full_name), treatments(*, protocols(file_path), patients(id, full_name, file_no, allergies, archived_at))').eq('id', id).maybeSingle()),
    q(sb.from('cycle_doses').select('*').eq('cycle_id', id).order('sort').order('drug_name')),
    q(sb.from('change_requests').select('id, status, requester_role, created_at, report, requester:profiles!change_requests_requested_by_fkey(full_name), change_request_items(id)').eq('cycle_id', id).order('created_at', { ascending: false })),
    q(sb.from('mixing_orders').select('id, day, status').eq('cycle_id', id)),
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
  const cbc = await latestCbc(p.id).catch(() => ({}));

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
  if (open && can('doctorEdit') && active.some((d) => d.dose_unit === 'AUC')) {
    actions.push(actionBtn('secondary', 'refresh', 'إعادة حساب Carboplatin بأحدث كرياتينين', async () => {
      const ok = await confirmDialog({ title: 'إعادة حساب جرعة AUC', body: 'تُحسب الجرعة من أحدث كرياتينين خلال 30 يوماً ووزن المريض الحالي. إن تغيّرت تُسجَّل تعديلاً منك ويُعاد اعتماد الدورة وتحقق الصيدلاني.', okText: 'إعادة الحساب' });
      if (!ok) return;
      const n = await rpc('recalc_auc', { p_cycle: id });
      toast(n ? 'تغيّرت جرعة Carboplatin حسب الكرياتينين الأحدث' : 'الجرعة لم تتغير بالكرياتينين الأحدث');
      reload();
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
      cbcCard(cbc, p.id),
      flowCard(c, active, orders, live),
      pendingReqs.length ? h('a', { href: '#/request?id=' + pendingReqs[0].id, class: 'notice warn', style: 'text-decoration: none; align-items: center' },
        icon('warn', 22), h('span', { style: 'flex: 1', text: `${count(pendingReqs.length, 'request')} تعديل بانتظار قرار الطبيب المختص. لا يتحقق الصيدلاني قبل القرار.` }),
        h('b', { text: 'عرض' })) : null,
      h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', { text: 'الجرعات' }), h('span', { class: 'meta', text: count(active.length, 'drug') })),
        h('div', { class: 'card flush' }, active.length ? active.map((d) => doseRow(d, t)) : h('div', { class: 'empty', text: 'لا توجد أدوية' }))),
      protocolFileLink(t.protocols?.file_path, 'ملف البروتوكول ' + t.protocol_name),
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

// آخر تعداد دم: يراه الطبيب قبل الاعتماد والصيدلاني قبل التحقق
function cbcCard(cbc, pid) {
  const names = ['WBC', 'ANC', 'Hb', 'PLT'];
  const any = names.some((n) => cbc[n]);
  const dates = names.map((n) => cbc[n]?.test_date).filter(Boolean).sort();
  const age = dates.length ? daysUntil(dates[dates.length - 1]) : null;
  return h('a', { class: 'card', href: '#/labs?patient=' + pid, style: 'text-decoration: none; color: inherit; gap: 10px' },
    h('div', { style: 'display: flex; justify-content: space-between; align-items: baseline' },
      h('b', { text: 'آخر تعداد دم' }),
      h('span', { style: 'font-size: 13px; color: ' + (age !== null && age < -7 ? 'var(--warn)' : 'var(--muted-2)'),
        text: any ? fmtDate(dates[dates.length - 1], { day: 'numeric', month: 'short' }) + (age < -7 ? ' · أقدم من أسبوع' : '') : 'لا يوجد' })),
    any ? h('div', { class: 'cbc' }, names.map((n) => {
      const r = cbc[n]; const f = r ? flag(r.value, r.ref_low, r.ref_high) : null;
      return h('span', { class: 'cbc-i ' + (f || '') }, h('span', { class: 'ltr', text: n }), h('b', { class: 'ltr', text: r ? String(r.value) : '—' }));
    })) : h('span', { style: 'font-size: 14px; color: var(--muted)', text: 'أدخل نتائج تعداد الدم قبل اعتماد الدورة' }));
}

// المزج والإعطاء لكل يوم فيه أدوية
function flowCard(c, doses, orders, live) {
  if (!live) return null;
  const days = [...new Set(doses.flatMap((d) => daysList(d.days)))].sort((a, b) => a - b);
  const ready = c.doctor_approved_at && c.pharmacist_verified_at;
  const O = { incoming: 'وصل قسم المزج', in_progress: 'قيد التحضير', partially_sent: 'أُرسل جزء', sent: 'أُرسل كاملاً', held: 'موقوف' };
  return h('section', { class: 'section' },
    h('div', { class: 'section-head' }, h('h2', { text: 'المزج والإعطاء' })),
    !ready ? notice('info', 'lock', h('p', { text: 'يبدأ التحويل للمزج والإعطاء بعد اعتماد الطبيب وتحقق الصيدلاني.' })) : null,
    h('div', { class: 'card flush' }, days.map((n) => {
      const mixed = doses.some((d) => d.is_mixed && daysList(d.days).includes(n));
      const o = orders.find((x) => x.day === n);
      let mix;
      if (!mixed) mix = h('span', { class: 'pill muted', text: 'بلا مزج' });
      else if (o) mix = h('a', { class: 'pill info', href: '#/mixing-order?id=' + o.id, style: 'text-decoration: none', text: O[o.status] });
      else if (ready && can('transfer')) mix = h('a', { class: 'btn primary sm', href: `#/transfer?cycle=${c.id}&day=${n}`, text: 'تحويل للمزج' });
      else mix = h('span', { class: 'pill muted', text: 'لم يُحوَّل' });
      return h('div', { class: 'row' },
        h('a', { href: `#/administer?cycle=${c.id}&day=${n}`, style: 'display: flex; flex-direction: column; flex: 1; text-decoration: none; color: inherit' },
          h('b', { style: 'font-size: 15px', text: `اليوم ${n}` }),
          h('span', { style: 'font-size: 13px; color: var(--muted-2)', text: fmtDay(addDays(c.planned_date, n - 1)) + ' · الإعطاء ›' })),
        mix);
    })));
}
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };

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
      instrLine(d),
      d.dose_unit === 'AUC' ? aucCalc(d) : h('span', { class: 's', text: calcLine(d, t.bsa, t.weight_kg) }),
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
