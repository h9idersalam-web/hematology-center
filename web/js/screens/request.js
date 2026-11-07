// طلب تعديل واحد: تقرير الصيدلاني، وبنوده، وقرار الطبيب المختص بنداً بنداً
import { sb, q, rpc } from '../api.js';
import { h, mount, icon, topbar, bottomNav, notice, fmtDate, fmtTime, fmtDay, toast, busy, confirmDialog, ROLES, count, field } from '../ui.js';
import { go, state } from '../app.js';
import { can } from '../perms.js';
import { OUT_UNITS, daysText, num } from '../dose.js';
import { CR_STATUS } from './cycle.js';
import { NKDA } from './patient-form.js';

const KIND_AR = { dose: 'تعديل جرعة', infusion: 'المحلول والتسريب', add_drug: 'إضافة دواء', remove_drug: 'حذف دواء', diagnosis: 'التشخيص', protocol: 'تغيير البروتوكول' };

export async function render(root, params) {
  const id = params.get('id');
  const r = await q(sb.from('change_requests')
    .select('*, requester:profiles!change_requests_requested_by_fkey(full_name), decider:profiles!change_requests_decided_by_fkey(full_name), patients(id, full_name, file_no, allergies, specialist_id), cycles(id, cycle_no, planned_date, status), treatments(protocol_name, bsa, weight_kg), change_request_items(*, cycle_doses(drug_name, final_unit, dose_value, dose_unit))')
    .eq('id', id).maybeSingle());
  if (!r) throw new Error('الطلب غير موجود');
  const items = r.change_request_items;
  const protoIds = items.filter((i) => i.kind === 'protocol').map((i) => i.payload.protocol_id);
  const protos = protoIds.length ? await q(sb.from('protocols').select('id, name').in('id', protoIds)) : [];
  const [stL, stK] = CR_STATUS[r.status];
  const me = state.profile;
  const p = r.patients;
  // من يقرّر: تحدده القاعدة (can_decide_request) حسب نوع مرسل الطلب
  const deciding = r.status === 'pending' && can('decide');
  const isMine = deciding ? await rpc('can_decide_request', { p_req: id }).catch(() => false) : false;
  const whoDecides = r.requester_role === 'clinical_pharmacist'
    ? 'الطبيب المختص بهذا المريض أو المقيم الأقدم أو مسؤول الصيادلة'
    : 'الطبيب المختص بهذا المريض أو المقيم الأقدم';
  // تعديل جاء من المزج أو مسؤول الصيادلة، أو قرّره غير طبيب، يُسقط اعتماد الدورة
  const dropsApproval = ['mixing_pharmacist', 'chief_clinical_pharmacist'].includes(r.requester_role) || !['specialist', 'senior_resident'].includes(me.role);

  const checks = new Map();
  const itemCard = (it) => {
    const box = deciding && isMine ? h('input', { type: 'checkbox', checked: true, 'aria-label': 'الموافقة على هذا البند' }) : null;
    if (box) checks.set(it.id, box);
    const verdict = it.approved === true ? h('span', { class: 'pill ok', text: 'وافق' }) : it.approved === false ? h('span', { class: 'pill muted', text: 'رُفض' }) : null;
    const [main, sub] = describe(it, protos);
    return h(box ? 'label' : 'div', { class: 'row', style: 'align-items: flex-start; cursor: ' + (box ? 'pointer' : 'default') },
      box ? h('span', { class: 'check', style: 'min-height: 0; padding-top: 2px' }, box) : null,
      h('span', { class: 'grow' },
        h('span', { class: 's', style: 'font-weight: 600', text: KIND_AR[it.kind] }),
        h('span', { class: 't', style: 'font-size: 16px', text: main }),
        sub ? h('span', { class: 's', text: sub }) : null),
      verdict);
  };

  const note = h('textarea', { class: 'input', rows: 2, placeholder: 'سبب الرفض أو ملاحظة لمرسل الطلب (اختياري)' });
  const approveBtn = h('button', { type: 'button', class: 'btn ok block' }, icon('check', 22, '#fff', 2.2), 'موافقة على البنود المحددة');
  const rejectBtn = h('button', { type: 'button', class: 'btn danger block' }, icon('x', 22), 'رفض الطلب كاملاً');
  const decide = async (btn, all) => busy(btn, async () => {
    const ids = all ? [] : [...checks].filter(([, b]) => b.checked).map(([k]) => k);
    if (!all && !ids.length) return toast('حدّد بنداً واحداً على الأقل، أو اضغط «رفض الطلب كاملاً»', true);
    const ok = await confirmDialog({
      title: all ? 'رفض الطلب' : `الموافقة على ${count(ids.length, 'item')} من ${items.length}`,
      body: all ? 'لن يُطبَّق أي بند، ويُبلَّغ مرسل الطلب بقرارك.'
        : 'تُطبَّق البنود المحددة فوراً، وتُرفض غير المحددة. ' + (dropsApproval
          ? 'ويُسقط اعتماد الدورة ويُعلَّق مزجها حتى يعيد الطبيب المختص أو المقيم الأقدم اعتمادها.'
          : 'ويبقى اعتماد الدورة، ويُبلَّغ قسم المزج بالتغيير.'),
      okText: all ? 'رفض' : 'موافقة', danger: all,
    });
    if (!ok) return;
    try {
      const st = await rpc('decide_change_request', { p_req: id, p_approved_items: ids, p_note: note.value.trim() || null });
      toast({ approved: 'طُبّقت التعديلات', partially_approved: 'طُبّق جزء من التعديلات', rejected: 'رُفض الطلب' }[st]);
      go('/request?id=' + id);
    } catch (e) { toast(e.message, true); }
  });
  approveBtn.addEventListener('click', () => decide(approveBtn, false));
  rejectBtn.addEventListener('click', () => decide(rejectBtn, true));

  mount(root, h('div', { class: 'screen' },
    topbar({ title: 'طلب تعديل', sub: `${p.full_name} · الدورة ${r.cycles?.cycle_no ?? '—'}`, back: '#/requests' }),
    h('main', { class: 'main with-nav' },
      h('div', { class: 'card', style: 'flex-direction: row; justify-content: space-between; align-items: center' },
        h('span', { style: 'display: flex; flex-direction: column; gap: 2px' },
          h('b', { text: `${r.treatments?.protocol_name} · الدورة ${r.cycles?.cycle_no}` }),
          h('span', { style: 'font-size: 14px; color: var(--muted-2)', text: r.cycles ? fmtDay(r.cycles.planned_date) : '' })),
        h('span', { class: 'pill ' + stK, text: stL })),
      p.allergies && p.allergies !== NKDA ? notice('err', 'alert', h('p', { text: 'حساسية دوائية: ' + p.allergies })) : null,
      h('section', { class: 'card' },
        h('div', { style: 'display: flex; justify-content: space-between; gap: 8px; align-items: baseline' },
          h('h2', { text: r.requester?.full_name || '' }),
          h('span', { style: 'font-size: 13px; color: var(--muted-2)', text: `${fmtDate(r.created_at, { day: 'numeric', month: 'short' })} ${fmtTime(r.created_at)}` })),
        h('span', { style: 'font-size: 14px; color: var(--muted)', text: ROLES[r.requester_role] }),
        r.reason_category ? h('span', { class: 'pill warn', style: 'align-self: flex-start', text: 'السبب: ' + r.reason_category }) : null,
        r.report ? h('p', { class: 'report', text: r.report }) : null),
      h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', { text: 'البنود' }), h('span', { class: 'meta', text: count(items.length, 'item') })),
        h('div', { class: 'card flush' }, items.map(itemCard))),
      r.status !== 'pending' ? notice(r.status === 'rejected' ? 'warn' : 'ok', r.status === 'rejected' ? 'x' : 'check',
        h('p', { style: 'font-weight: 700', text: `${stL} · ${r.decider?.full_name || ''} · ${fmtDate(r.decided_at, { day: 'numeric', month: 'short' })} ${fmtTime(r.decided_at)}` }),
        r.decision_note ? h('p', { text: r.decision_note }) : null) : null,
      r.status === 'pending' && !isMine ? notice('info', 'lock', h('p', { text: `القرار لـ${whoDecides}.` })) : null,
      deciding && isMine ? h('section', { class: 'card' }, h('h2', { text: 'قرارك' }),
        h('p', { class: 'hint', text: 'ألغِ تحديد أي بند لا توافق عليه.' }), field('ملاحظة', note), approveBtn, rejectBtn) : null,
      r.cycles ? h('a', { class: 'btn secondary block', href: '#/cycle?id=' + r.cycles.id }, 'فتح الدورة') : null),
    bottomNav('home')));
}

export function describe(it, protos = []) {
  const d = it.cycle_doses, pl = it.payload || {};
  const unit = d ? OUT_UNITS[d.final_unit] || d.final_unit : '';
  const onward = it.apply_onward ? 'هذه الدورة وما بعدها' : 'هذه الدورة فقط';
  switch (it.kind) {
    case 'dose': {
      const o = Number(it.old_value), n = Number(it.new_value);
      const pct = o ? Math.round((n / o - 1) * 100) : 0;
      return [`${d?.drug_name}: من ${num(o)} إلى ${num(n)} ${unit}`, `${pct > 0 ? 'زيادة' : 'تخفيض'} ${Math.abs(pct)}% · ${onward}`];
    }
    case 'infusion': return [`${d?.drug_name}`, `المحلول: ${pl.diluent || '—'} · التسريب: ${pl.infusion_rate || '—'}`];
    case 'add_drug': return [`${pl.drug_name} ${num(pl.final_dose)} ${OUT_UNITS[pl.final_unit] || pl.final_unit}`,
      `${pl.route} · ${daysText(pl.days)} · ${onward}${pl.supportive ? ' · دواء داعم' : ''}${pl.diluent ? ' · ' + pl.diluent : ''}`];
    case 'remove_drug': return [`حذف ${d?.drug_name}`, `${pl.reason || ''} · ${onward}`];
    case 'diagnosis': return [pl.diagnosis, [pl.icd10, pl.stage].filter(Boolean).join(' · ')];
    case 'protocol': return [`إلى ${(protos.find((x) => x.id === pl.protocol_id) || {}).name || 'بروتوكول آخر'}`, `أول دورة ${fmtDate(pl.start_date)}`];
    default: return [it.kind, ''];
  }
}
