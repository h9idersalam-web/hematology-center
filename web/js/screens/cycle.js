// شاشة الدورة: الجرعات وطريقة حسابها، ومراحل الاعتماد، والتعديلات
import { sb, q, rpc } from '../api.js';
import { terms } from '../terms.js';
import { h, mount, icon, topbar, bottomNav, notice, fmtDate, fmtDay, fmtTime, toast, confirmDialog, busy, daysUntil, count, ROLES } from '../ui.js';
import { go } from '../app.js';
import { can } from '../perms.js';
import { ROUTE_AR, OUT_UNITS, daysText, calcLine, num, instrLine, loadMixState, mixNote } from '../dose.js';
import { NKDA } from './patient-form.js';
import { postponeDialog } from './postpone.js';
import { latestCbc } from './labs.js';
import { flag } from '../labs.js';
import { daysList } from '../dose.js';
import { protocolFileLink, uploadAttachment, signedUrl, openFile, isImage } from '../files.js';

export const CR_STATUS = { pending: ['بانتظار القرار', 'warn'], approved: ['وُوفق عليه', 'ok'], partially_approved: ['موافقة جزئية', 'info'], rejected: ['رُفض', 'muted'] };
const C_STATUS = { planned: ['مجدولة', 'muted'], held: ['موقوفة', 'warn'], given: ['أُعطيت', 'ok'], cancelled: ['أُلغيت', 'muted'] };

export async function render(root, params) {
  const id = params.get('id');
  const [c, doses, reqs, orders] = await Promise.all([
    q(sb.from('cycles').select('*, doctor:profiles!cycles_doctor_approved_by_fkey(full_name), charter:profiles!cycles_chart_by_fkey(full_name), chart:attachments!cycles_chart_attachment_id_fkey(file_path), treatments(*, protocols(file_path), patients(id, full_name, file_no, allergies, archived_at, specialist_id))').eq('id', id).maybeSingle()),
    q(sb.from('cycle_doses').select('*').eq('cycle_id', id).order('sort').order('drug_name')),
    q(sb.from('change_requests').select('id, status, requester_role, created_at, report, requester:profiles!change_requests_requested_by_fkey(full_name), change_request_items(id)').eq('cycle_id', id).order('created_at', { ascending: false })),
    q(sb.from('mixing_orders').select('id, day, status, hold_reason').eq('cycle_id', id)),
  ]);
  if (!c) throw new Error('الجرعة غير موجودة');
  const t = c.treatments, p = t.patients;
  const active = doses.filter((d) => !d.archived_at);
  const removed = doses.filter((d) => d.archived_at);
  const pendingReqs = reqs.filter((r) => r.status === 'pending');
  const open = (c.status === 'planned' || c.status === 'held') && !p.archived_at;
  const live = open && t.status === 'active';
  const [stL, stK] = C_STATUS[c.status];
  const reload = () => render(root, params);
  const cbc = await latestCbc(p.id).catch(() => ({}));
  const mixState = await loadMixState(sb, q, active.map((d) => d.id)).catch(() => new Map());

  // الأزرار حسب الدور والحالة
  const actions = [];
  if (live && can('approveCycle') && !c.doctor_approved_at && c.status === 'planned') {
    actions.push(actionBtn('ok', 'check', 'اعتماد الجرعة', async () => {
      const ok = await confirmDialog({ title: `اعتماد Cycle ${c.cycle_no}`, body: 'تؤكد أن الجرعات الدوائية مناسبة لحالة المريض الحالية وتحاليله. تصل الجرعة إلى قسم المزج فور اعتمادها.', okText: 'اعتماد' });
      if (ok) { await rpc('approve_cycle', { p_cycle: id }); toast('اعتُمدت الجرعة ووصلت إلى المزج'); reload(); }
    }));
  }
  if (open && can('doctorEdit')) actions.push(h('a', { class: 'btn secondary block', href: '#/cycle-edit?id=' + id }, icon('edit', 22), 'تعديل الجرعات الدوائية أو الخطة'));
  if (open && can('requestEdit')) actions.push(h('a', { class: 'btn secondary block', href: '#/cycle-edit?id=' + id }, icon('edit', 22), 'اقتراح تعديل على الطبيب'));
  if (live && can('postpone')) {
    actions.push(actionBtn('secondary', 'clock', 'تأجيل الجرعة', async () => { if (await postponeDialog({ ...c, patient_name: p.full_name })) reload(); }));
  }
  // إغلاق الجرعة كلها دفعة واحدة (حالات استثنائية): للطبيب والمقيم الأقدم ومسؤول الصيادلة.
  // التأكيد المعتاد «تم إعطاء الجرعة بالكامل» يوماً بيوم من شاشة الإعطاء (الملف 41)
  if (live && can('completeCycle') && c.doctor_approved_at && daysUntil(c.planned_date) <= 0) {
    actions.push(actionBtn('secondary', 'check', 'إغلاق الجرعة', async () => {
      const ok = await confirmDialog({ title: `إغلاق Cycle ${c.cycle_no}`, body: 'تُسجَّل الجرعة مُعطاة ولا يمكن تعديل جرعاتها الدوائية بعد ذلك، ويُغلق ما لم يُرسل من طلبات المزج. للتأكيد المعتاد يوماً بيوم استخدم «تم إعطاء الجرعة بالكامل» في شاشة الإعطاء.', okText: 'إغلاق' });
      if (ok) { await rpc('complete_cycle', { p_cycle: id }); toast('سُجّلت الجرعة مُعطاة'); reload(); }
    }));
  }

  mount(root, h('div', { class: 'screen' },
    topbar({ title: `Cycle ${c.cycle_no} of ${t.total_cycles}`, sub: `${p.full_name} · ${t.protocol_name}`, back: '#/patient?id=' + p.id }),
    h('main', { class: 'main with-nav' },
      h('div', { class: 'card', style: 'flex-direction: row; align-items: center; justify-content: space-between' },
        h('span', { style: 'display: flex; flex-direction: column; gap: 2px' },
          h('span', { style: 'font-size: 13px; color: var(--muted-2)', text: 'الموعد' }),
          h('b', { style: 'font-size: 17px', text: fmtDay(c.planned_date) }),
          c.postpone_reason ? h('span', { style: 'font-size: 13px; color: var(--muted)', text: 'أُجّلت: ' + c.postpone_reason }) : null),
        h('span', { style: 'display: flex; flex-direction: column; align-items: flex-end; gap: 6px' },
          h('span', { class: 'pill ' + stK, text: stL }), h('span', { class: 'tag', text: `BSA ${num(t.bsa)} m²` }))),
      p.allergies && p.allergies !== NKDA ? notice('err', 'alert', h('p', { style: 'font-weight: 700', text: 'حساسية دوائية: ' + p.allergies })) : null,
      t.status === 'pending_approval' ? notice('info', 'info', h('p', { text: 'خطة العلاج بانتظار موافقة الطبيب المختص. لا تُعتمد الجرعة قبلها.' })) : null,
      t.status === 'stopped' ? notice('warn', 'warn', h('p', { text: 'أُوقفت الخطة: ' + (t.stop_reason || '') })) : null,
      steps(c, orders),
      c.status === 'planned' && !c.doctor_approved_at && orders.some((o) => o.status === 'held')
        ? notice('warn', 'lock', h('p', { text: 'عُدّلت الجرعة بطلب من المزج أو الصيادلة، فعُلّق المزج حتى يعيد الطبيب اعتمادها.' })) : null,
      chartCard(c, p, open, reload),
      cbcCard(cbc, p.id),
      flowCard(c, active, orders, live),
      pendingReqs.length ? h('a', { href: '#/request?id=' + pendingReqs[0].id, class: 'notice warn', style: 'text-decoration: none; align-items: center' },
        icon('warn', 22), h('span', { style: 'flex: 1', text: `${count(pendingReqs.length, 'request')} تعديل بانتظار القرار.` }),
        h('b', { text: 'عرض' })) : null,
      h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', { text: 'الجرعات الدوائية' }), h('span', { class: 'meta', text: count(active.length, 'drug') })),
        h('div', { class: 'card flush' }, active.length ? active.map((d) => doseRow(d, t, mixState.get(d.id))) : h('div', { class: 'empty', text: 'لا توجد أدوية' }))),
      protocolFileLink(t.protocols?.file_path, 'ملف البروتوكول ' + t.protocol_name),
      removed.length ? h('details', { class: 'card' },
        h('summary', { style: 'font-weight: 700; cursor: pointer', text: `أدوية حُذفت من هذه الجرعة (${removed.length})` }),
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

function steps(c, orders) {
  const step = (done, title, by, at, waiting) => h('div', { class: 'step' + (done ? ' done' : waiting ? ' now' : '') },
    h('span', { class: 'dot' }, done ? icon('check', 16, '#fff', 3) : null),
    h('span', { style: 'display: flex; flex-direction: column' },
      h('b', { style: 'font-size: 15px', text: title }),
      h('span', { style: 'font-size: 13px; color: var(--muted-2)', text: done ? `${by || ''} · ${fmtDate(at, { day: 'numeric', month: 'short' })} ${fmtTime(at)}` : waiting ? 'بانتظار' : 'لاحقاً' })));
  return h('div', { class: 'card steps' },
    step(!!c.doctor_approved_at, 'اعتماد الطبيب ووصول الجرعة إلى المزج', c.doctor?.full_name, c.doctor_approved_at, !c.doctor_approved_at),
    step(!!c.chart_at, 'صورة الطبلة من الصيدلي', c.charter?.full_name, c.chart_at, !!c.doctor_approved_at && !c.chart_at),
    step(c.status === 'given', 'الإعطاء وإغلاق الجرعة', null, null, !!c.doctor_approved_at && c.status !== 'given'));
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
    })) : h('span', { style: 'font-size: 14px; color: var(--muted)', text: 'أدخل نتائج تعداد الدم قبل اعتماد الجرعة' }));
}

// المزج والإعطاء لكل يوم فيه أدوية
function flowCard(c, doses, orders, live) {
  if (!live) return null;
  const days = [...new Set(doses.flatMap((d) => daysList(d.days)))].sort((a, b) => a - b);
  const ready = !!c.doctor_approved_at;
  const O = { incoming: 'وصل قسم المزج', in_progress: 'قيد التحضير', partially_sent: 'أُرسل جزء', sent: 'أُرسل كاملاً', held: 'معلّق' };
  return h('section', { class: 'section' },
    h('div', { class: 'section-head' }, h('h2', { text: 'المزج والإعطاء' })),
    !ready ? notice('info', 'lock', h('p', { text: 'تصل الجرعة إلى المزج تلقائياً بعد اعتماد الطبيب، ويبدأ الإعطاء بعدها.' })) : null,
    h('div', { class: 'card flush' }, days.map((n) => {
      const mixed = doses.some((d) => d.is_mixed && daysList(d.days).includes(n));
      const o = orders.find((x) => x.day === n);
      let mix;
      if (!mixed) mix = h('span', { class: 'pill muted', text: 'بلا مزج' });
      else if (o) mix = h('a', { class: 'pill ' + (o.status === 'held' ? 'warn' : 'info'), href: '#/mixing-order?id=' + o.id, style: 'text-decoration: none', text: O[o.status], title: terms(o.hold_reason) || '' });
      else mix = h('span', { class: 'pill muted', text: 'بعد الاعتماد' });
      return h('div', { class: 'row' },
        h('a', { href: `#/administer?cycle=${c.id}&day=${n}`, style: 'display: flex; flex-direction: column; flex: 1; text-decoration: none; color: inherit' },
          h('b', { style: 'font-size: 15px', text: `اليوم ${n}` }),
          h('span', { style: 'font-size: 13px; color: var(--muted-2)', text: fmtDay(addDays(c.planned_date, n - 1)) + ' · الإعطاء ›' })),
        mix);
    })));
}
// صورة الدورة من طبلة المريض: يرفقها الصيدلي السريري أو مسؤوله، وتصل إلى المزج للتحقق
function chartCard(c, p, open, reload) {
  const mine = can('chart') && open;
  if (!c.chart && !mine) return null;
  const img = h('span', { class: 'ft-img', style: 'height: 120px' }, icon('file', 28, '#8A929C'));
  if (c.chart && isImage(c.chart.file_path)) signedUrl(c.chart.file_path).then((u) => img.replaceChildren(h('img', { src: u, alt: 'صورة الطبلة' }))).catch(() => {});
  const status = h('p', { class: 'hint' });
  const input = h('input', { type: 'file', accept: 'image/*,application/pdf', class: 'sr-only', id: 'chart-in' });
  input.addEventListener('change', async () => {
    if (!input.files[0]) return;
    status.textContent = 'جارٍ الرفع…';
    try {
      const aid = await uploadAttachment(p.id, input.files[0], { kind: 'chart', title: `طبلة Cycle ${c.cycle_no}` });
      await rpc('set_cycle_chart', { p_cycle: c.id, p_attachment: aid });
      toast('أُرسلت صورة الطبلة إلى المزج'); reload();
    } catch (e) { status.textContent = e.message; }
  });
  const due = mine && !c.chart && c.doctor_approved_at;
  return h('section', { class: 'card' + (due ? ' due' : ''), style: due ? 'border-color: var(--warn)' : '' },
    h('div', { style: 'display: flex; justify-content: space-between; align-items: baseline; gap: 8px' },
      h('h2', { text: 'صورة الجرعة من طبلة المريض' }),
      c.chart_at ? h('span', { style: 'font-size: 13px; color: var(--muted-2)', text: `${c.charter?.full_name || ''} · ${fmtDate(c.chart_at, { day: 'numeric', month: 'short' })}` }) : null),
    c.chart ? h('button', { type: 'button', class: 'file-tile', style: 'max-width: 220px', onclick: () => openFile(c.chart.file_path).catch((e) => toast(e.message, true)) }, img, h('span', { class: 'ft-t', text: 'فتح الصورة' })) : null,
    due ? notice('warn', 'warn', h('p', { text: 'مطلوب منك: صوّر الجرعة من طبلة المريض وأرفقها. تصل إلى المزج للتحقق، ولا تؤخر التحضير.' }))
      : !c.chart ? h('p', { class: 'hint', text: 'تُرفق بعد اعتماد الطبيب، وتصل إلى قسم المزج للتحقق.' }) : null,
    mine ? input : null,
    mine ? h('label', { for: 'chart-in', class: 'btn secondary block' }, icon('plus', 22), c.chart ? 'استبدال الصورة' : 'إرفاق صورة الطبلة') : null,
    status);
}

const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };

function doseRow(d, t, ms) {
  const badges = [];
  const note = mixNote(ms);
  if (d.capped) badges.push(h('span', { class: 'pill warn', text: `بالسقف (المحسوب ${num(d.calculated)})` }));
  if (d.source === 'edited') badges.push(h('span', { class: 'pill info', text: `عُدّلت من ${num(d.edited_from)}` }));
  if (d.source === 'added') badges.push(h('span', { class: 'pill brand', text: 'دواء مضاف' }));
  badges.push(h('span', { class: 'pill ' + (d.is_mixed ? 'info' : 'muted'), text: d.is_mixed ? 'مزج' : 'بلا مزج' }));
  return h('div', { class: 'row', style: 'align-items: flex-start' },
    h('span', { class: 'grow' },
      h('span', { class: 't ltr', style: 'text-align: right', text: d.drug_name }),
      h('span', { class: 's', text: `${d.route} (${ROUTE_AR[d.route] || d.route}) · ${daysText(d.days)}` }),
      instrLine(d),
      h('span', { class: 's', text: calcLine(d, t.bsa, t.weight_kg) }),
      d.diluent || d.infusion_rate ? h('span', { class: 's', text: [d.diluent, d.infusion_rate].filter(Boolean).join(' · ') }) : null,
      h('span', { style: 'display: flex; gap: 4px; flex-wrap: wrap; margin-top: 4px' }, badges),
      note ? h('span', { class: 'pill wrap ok', style: 'align-self: flex-start; margin-top: 4px', text: note }) : null),
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
