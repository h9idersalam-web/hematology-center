// ملف المريض: البيانات، والحساسية، وخطة العلاج ودوراتها، والخطط السابقة
import { sb, q, rpc, countOf } from '../api.js';
import { statusLabel } from '../diagnoses.js';
import { h, mount, icon, topbar, bottomNav, notice, empty, fmtDate, fmtDay, daysUntil, ageText, bsa, SEX, toast, confirmDialog, initials, count, busy } from '../ui.js';
import { go, state } from '../app.js';
import { can, canEditPlan } from '../perms.js';
import { NKDA } from './patient-form.js';
import { postponeDialog } from './postpone.js';
import { fileTile } from './files.js';

const T_STATUS = {
  active: ['فعّالة', 'ok'], pending_approval: ['بانتظار موافقة الطبيب المختص', 'info'],
  completed: ['اكتملت', 'muted'], stopped: ['أُوقفت', 'warn'],
};
const C_STATUS = {
  planned: ['مجدولة', 'muted'], held: ['موقوفة', 'warn'], given: ['أُعطيت', 'ok'], cancelled: ['أُلغيت', 'muted'],
};

export async function render(root, params) {
  const id = params.get('id');
  if (!id) return go('/patients');

  mount(root, h('div', { class: 'screen' }, topbar({ title: 'ملف المريض', back: '#/patients' }),
    h('main', { class: 'main' }, h('div', { class: 'empty' }, h('span', { class: 'spinner' })))));

  const [p, treatments, labsN, filesN] = await Promise.all([
    q(sb.from('patient_overview').select('*').eq('id', id).maybeSingle()),
    q(sb.from('treatments').select('id, protocol_name, diagnosis, icd10, stage, disease_status, status, stop_reason, start_date, bsa, height_cm, weight_kg, total_cycles, cycle_length_days, created_at')
      .eq('patient_id', id).order('created_at', { ascending: false })),
    countOf('lab_results', (x) => x.eq('patient_id', id)).catch(() => 0),
    countOf('attachments', (x) => x.eq('patient_id', id)).catch(() => 0),
  ]);
  const recentFiles = filesN ? await q(sb.from('attachments').select('id, kind, title, file_path, taken_on, created_at').eq('patient_id', id).order('created_at', { ascending: false }).limit(4)).catch(() => []) : [];
  if (!p) throw new Error('المريض غير موجود، أو ليست لديك صلاحية عرضه');

  const current = treatments.find((t) => t.status === 'active' || t.status === 'pending_approval') || null;
  const previous = treatments.filter((t) => t !== current);
  const cycles = current
    ? await q(sb.from('cycles').select('id, cycle_no, planned_date, status, postpone_reason, doctor_approved_at')
        .eq('treatment_id', current.id).order('cycle_no'))
    : [];

  const editable = can('editPatient') && !p.archived_at;
  const editBtn = editable
    ? h('a', { class: 'icon-btn boxed', href: '#/patient-edit?id=' + id, 'aria-label': 'تعديل بيانات المريض' }, icon('edit', 22)) : null;

  mount(root, h('div', { class: 'screen' },
    topbar({ title: p.full_name, sub: 'ملف ' + p.file_no, back: '#/patients', actions: editBtn }),
    h('main', { class: 'main with-nav' },
      p.archived_at ? notice('dark', 'archive',
        h('p', { style: 'font-weight: 700', text: `مؤرشف منذ ${fmtDate(p.archived_at)}` }),
        h('p', { text: 'السبب: ' + (p.archive_reason || '—') })) : null,
      allergyBanner(p, editable),
      infoCard(p),
      current ? treatmentCard(p, current, cycles, () => render(root, params)) : noPlanCard(p),
      previous.length ? previousCard(previous) : null,
      filesCard(p, labsN, filesN, recentFiles),
      can('archivePatient') && !p.archived_at
        ? h('button', { class: 'btn danger block', type: 'button', onclick: () => archive(p) }, icon('archive', 22), 'أرشفة الملف') : null),
    bottomNav('patients')));
}

function allergyBanner(p, editable) {
  if (p.allergies === NKDA) {
    return h('div', { class: 'notice ok', style: 'align-items: center' }, icon('check', 20), h('p', { text: NKDA }));
  }
  if (p.allergies) {
    return h('div', { class: 'notice err', role: 'alert', style: 'border: 2px solid var(--brand)' }, icon('alert', 22),
      h('div', null, h('p', { style: 'font-weight: 700', text: 'حساسية دوائية' }), h('p', { text: p.allergies })));
  }
  return notice('warn', 'warn', h('p', null, 'لم تُسجَّل معلومات الحساسية الدوائية. ',
    editable ? h('a', { href: '#/patient-edit?id=' + p.id, style: 'font-weight: 700; color: inherit', text: 'أضفها الآن' }) : null));
}

function fact(label, value, opts = {}) {
  return h('div', { class: 'fact' + (opts.wide ? ' wide' : '') },
    h('span', { class: 'l', text: label }),
    value instanceof Node ? value : h('span', { class: 'v' + (opts.ltr ? ' ltr' : ''), text: value ?? '—' }));
}

function infoCard(p) {
  const b = bsa(p.height_cm, p.weight_kg);
  return h('section', { class: 'card' },
    h('div', { style: 'display: flex; align-items: center; gap: 12px' },
      h('span', { class: 'avatar', style: 'width: 52px; height: 52px; border-radius: 26px; font-size: 18px', text: initials(p.full_name) }),
      h('div', { style: 'display: flex; flex-direction: column; gap: 4px; min-width: 0' },
        h('h2', { text: p.full_name }),
        h('span', { style: 'display: flex; gap: 6px; align-items: center; flex-wrap: wrap' },
          h('span', { class: 'tag', text: p.file_no }),
          h('span', { class: 'pill muted', text: [SEX[p.sex], ageText(p.birth_date)].filter(Boolean).join(' · ') || '—' })))),
    h('div', { class: 'facts' },
      fact('تاريخ الميلاد', p.birth_date ? fmtDate(p.birth_date) : null),
      fact('الهاتف', p.phone ? h('a', { class: 'v ltr', href: 'tel:' + p.phone, style: 'text-decoration: none' }, p.phone) : null),
      fact('الطول', p.height_cm ? `${Number(p.height_cm)} سم` : null),
      fact('الوزن', p.weight_kg ? `${Number(p.weight_kg)} كغ` : null),
      fact('مساحة سطح الجسم', b ? `${b} م²` : 'أدخل الطول والوزن'),
      fact('الطبيب المختص', p.specialist_name || 'لم يُحدَّد'),
      fact('تاريخ التسجيل', fmtDate(p.created_at), { wide: true })));
}

function noPlanCard(p) {
  const canCreate = can('createPlan') && !p.archived_at;
  return h('section', { class: 'section' },
    h('div', { class: 'section-head' }, h('h2', { text: 'خطة العلاج' })),
    h('div', { class: 'card' }, empty('لا توجد خطة علاج حالية لهذا المريض', 'pill'),
      canCreate ? h('a', { class: 'btn primary block', href: '#/plan-new?patient=' + p.id }, icon('plus', 22, '#fff', 2.2), 'إنشاء خطة علاج')
        : h('p', { class: 'hint', style: 'text-align: center', text: 'ينشئ الخطة طبيب الاختصاص أو المقيم الأقدم أو مسؤول الصيادلة السريريين.' })));
}

function treatmentCard(p, t, cycles, reload) {
  const given = cycles.filter((c) => c.status === 'given').length;
  const next = cycles.find((c) => c.status === 'planned' || c.status === 'held');
  const last = [...cycles].reverse().find((c) => c.status === 'given');
  const [stLabel, stKind] = T_STATUS[t.status];
  const pct = Math.round((given / t.total_cycles) * 100);

  // تنبيه إذا تغيّر الوزن كثيراً عن وزن الخطة
  let weightWarn = null;
  if (p.weight_kg && t.weight_kg) {
    const diff = Math.round(((p.weight_kg - t.weight_kg) / t.weight_kg) * 100);
    if (Math.abs(diff) >= 10) {
      weightWarn = notice('warn', 'warn', h('p', { text: `الوزن الحالي (${Number(p.weight_kg)} كغ) ${diff > 0 ? 'أعلى' : 'أقل'} من وزن الخطة (${Number(t.weight_kg)} كغ) بنسبة ${Math.abs(diff)}%. راجع الجرعات الدوائية مع الطبيب المختص.` }));
    }
  }

  const nextTile = next ? (() => {
    const d = daysUntil(next.planned_date);
    const when = d < 0 ? 'متأخرة ' + count(-d, 'day') : d === 0 ? 'اليوم' : d === 1 ? 'غداً' : 'بعد ' + count(d, 'day');
    return h('div', { class: 'tile' + (d < 0 ? ' warn' : d === 0 ? ' brand' : '') },
      h('span', { class: 'l', text: `الجلسة القادمة · Cycle ${next.cycle_no}` }),
      h('span', { class: 'v', text: fmtDay(next.planned_date) }),
      h('span', { class: 's', text: when + (next.status === 'held' ? ' · موقوفة' : '') }));
  })() : h('div', { class: 'tile' }, h('span', { class: 'l', text: 'الجلسة القادمة' }), h('span', { class: 'v', text: '—' }));

  const lastTile = h('div', { class: 'tile' },
    h('span', { class: 'l', text: last ? `الجلسة السابقة · Cycle ${last.cycle_no}` : 'الجلسة السابقة' }),
    h('span', { class: 'v', text: last ? fmtDay(last.planned_date) : 'لم تبدأ بعد' }));

  return h('section', { class: 'section' },
    h('div', { class: 'section-head' }, h('h2', { text: 'خطة العلاج الحالية' }),
      h('span', { style: 'display: flex; gap: 8px; align-items: center' }, h('span', { class: 'pill ' + stKind, text: stLabel }),
        canEditPlan() && !p.archived_at ? h('a', { class: 'icon-btn boxed', href: '#/plan-edit?tid=' + t.id, 'aria-label': 'تعديل الخطة', title: 'تعديل الخطة' }, icon('edit', 20)) : null)),
    h('div', { class: 'card' },
      h('div', { style: 'display: flex; justify-content: space-between; align-items: center; gap: 8px' },
        h('span', { class: 'tag', style: 'font-size: 16px; padding: 3px 10px', text: t.protocol_name }),
        h('span', { style: 'font-size: 14px; color: var(--muted-2)', text: 'كل ' + count(t.cycle_length_days, 'day') })),
      h('div', { class: 'facts' },
        fact('التشخيص', t.diagnosis, { wide: true }),
        fact('حالة المرض', statusLabel(t.disease_status)),
        fact('درجة المرض', t.stage),
        fact('بدء العلاج', fmtDate(t.start_date)),
        fact('BSA عند الخطة', `${t.bsa} م²`)),
      h('div', { class: 'progress-wrap' },
        h('div', { style: 'display: flex; justify-content: space-between; font-size: 14px' },
          h('span', { style: 'font-weight: 600', text: `أُعطيت ${given} من ${count(t.total_cycles, 'cycle')}` }),
          h('span', { style: 'color: var(--muted-2)', text: pct + '%' })),
        h('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': given, 'aria-valuemin': 0, 'aria-valuemax': t.total_cycles },
          h('span', { style: `width: ${pct}%` })),
        cycleDrops(cycles, t.total_cycles)),
      h('div', { class: 'grid-2' }, lastTile, nextTile),
      weightWarn,
      planActions(p, t, reload)),
    h('div', { class: 'section-head', style: 'margin-top: 6px' }, h('h2', { text: 'جدول الجرعات' }), h('span', { class: 'meta', text: count(cycles.length, 'cycle') })),
    h('div', { class: 'card flush' }, cycles.map((c) => cycleRow(c, c === next && t.status === 'active', p, reload))));
}

function cycleRow(c, isNext, p, reload) {
  const [label, kind] = C_STATUS[c.status];
  const d = daysUntil(c.planned_date);
  const late = (c.status === 'planned' || c.status === 'held') && d < 0;
  let readiness = null;
  if (c.status === 'planned' && isNext) {
    readiness = c.doctor_approved_at ? 'معتمدة ووصلت إلى المزج' : 'بانتظار اعتماد الطبيب';
  }
  return h('div', { class: 'row', style: isNext ? 'background: #FFFBFB' : null },
    h('a', { href: '#/cycle?id=' + c.id, 'aria-label': `Cycle ${c.cycle_no}، ${fmtDay(c.planned_date)}`, style: 'display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; text-decoration: none; color: inherit' },
      h('span', { class: 'cyc-no' + (c.status === 'given' ? ' done' : isNext ? ' next' : ''), text: c.cycle_no }),
      h('span', { class: 'grow' },
        h('span', { class: 't', style: 'font-size: 15px', text: fmtDay(c.planned_date) }),
        c.postpone_reason ? h('span', { class: 's', text: (c.status === 'cancelled' ? 'السبب: ' : 'أُجّلت: ') + c.postpone_reason }) : null,
        readiness ? h('span', { class: 's', text: readiness }) : null),
      late ? h('span', { class: 'pill warn', text: 'متأخرة' }) : h('span', { class: 'pill ' + kind, text: label })),
    isNext && can('postpone') && !p.archived_at
      ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': `تأجيل Cycle ${c.cycle_no}`, title: 'تأجيل',
          onclick: async () => { if (await postponeDialog({ ...c, patient_name: p.full_name })) reload(); } }, icon('clock', 22))
      : null);
}

function planActions(p, t, reload) {
  if (p.archived_at) return null;
  const out = [];
  // تعديل الخطة: التشخيص والحالة والدرجة والبروتوكول ورقم الجرعة (الملف 42)
  if (canEditPlan()) out.push(h('a', { class: 'btn secondary block', href: '#/plan-edit?tid=' + t.id }, icon('edit', 22), 'تعديل الخطة'));
  // الموافقة على الخطة ورفضها للطبيب المختص بهذا المريض حصراً
  // طبيب المريض لم ينضم بعد: يقرّر المدير وهو يعمل بدور طبيب الاختصاص (الملف 36)
  const mineToDecide = can('approvePlan') && ((state.profile.role === 'chief_clinical_pharmacist' && !state.profile.acting) || p.specialist_id === state.profile.id || (!p.specialist_id && p.pending_specialist_id && state.profile.is_admin));
  if (t.status === 'pending_approval' && mineToDecide) {
    const b = h('button', { type: 'button', class: 'btn ok block' }, icon('check', 22, '#fff', 2.2), 'الموافقة على الخطة');
    b.addEventListener('click', () => busy(b, async () => {
      const ok = await confirmDialog({ title: 'الموافقة على خطة ' + t.protocol_name, body: 'راجع البروتوكول والتشخيص والجرعات الدوائية للجرعة الأولى قبل الموافقة. تُفعَّل الخطة ويُبلَّغ من أنشأها.', okText: 'موافقة' });
      if (!ok) return;
      try { await rpc('approve_treatment', { p_tid: t.id }); toast('فُعّلت الخطة'); reload(); } catch (e) { toast(e.message, true); }
    }));
    out.push(b);
    const r = h('button', { type: 'button', class: 'btn danger block' }, icon('x', 22), 'رفض الخطة');
    r.addEventListener('click', () => busy(r, async () => {
      const reason = await confirmDialog({ title: 'رفض خطة ' + t.protocol_name, body: 'تُلغى الخطة وجرعاتها، ويُبلَّغ من أنشأها بسببك.', okText: 'رفض', danger: true,
        input: { label: 'سبب الرفض', placeholder: 'مثال: البروتوكول غير مناسب، التشخيص يحتاج تأكيداً' } });
      if (reason === null) return;
      if (!reason) return toast('اكتب سبب الرفض', true);
      try { await rpc('reject_treatment', { p_tid: t.id, p_reason: reason }); toast('رُفضت الخطة'); reload(); } catch (e) { toast(e.message, true); }
    }));
    out.push(r);
  } else if (t.status === 'pending_approval') {
    out.push(notice('info', 'lock', h('p', { text: `الموافقة على الخطة أو رفضها للطبيب المختص بالمريض${p.specialist_name ? ': ' + p.specialist_name : ''}.` })));
  }
  if (can('stopPlan')) {
    out.push(h('button', { type: 'button', class: 'link-btn', style: 'color: var(--muted)', onclick: async () => {
      const reason = await confirmDialog({ title: 'إيقاف خطة ' + t.protocol_name, body: 'تُلغى الجرعات التي لم تُعطَ، وتبقى الخطة وسجلها محفوظين. لا يمكن التراجع.', okText: 'إيقاف الخطة', danger: true,
        input: { label: 'سبب الإيقاف', placeholder: 'مثال: تطور المرض، سمّية، رغبة المريض' } });
      if (reason === null) return;
      if (!reason) return toast('اكتب سبب الإيقاف', true);
      try { await rpc('stop_treatment', { p_tid: t.id, p_reason: reason }); toast('أُوقفت الخطة'); reload(); } catch (e) { toast(e.message, true); }
    } }, 'إيقاف الخطة'));
  }
  return out.length ? h('div', { style: 'display: flex; flex-direction: column; gap: 4px' }, ...out) : null;
}

function previousCard(list) {
  return h('section', { class: 'section' },
    h('div', { class: 'section-head' }, h('h2', { text: 'خطط سابقة' }), h('span', { class: 'meta', text: `${list.length}` })),
    h('div', { class: 'card flush' }, list.map((t) => {
      const [label, kind] = T_STATUS[t.status];
      return h('div', { class: 'row' },
        h('span', { class: 'grow' },
          h('span', { class: 't', style: 'display: flex; gap: 8px; align-items: center' }, h('span', { class: 'tag', text: t.protocol_name }), h('span', { style: 'font-size: 15px', text: t.diagnosis })),
          h('span', { class: 's', text: `بدأت ${fmtDate(t.start_date)}` + (t.stop_reason ? ` · ${t.stop_reason}` : '') })),
        h('span', { class: 'pill ' + kind, text: label }));
    })));
}

function filesCard(p, labsN, filesN, recent) {
  const up = can('upload') && !p.archived_at;
  return h('section', { class: 'section' },
    h('div', { class: 'section-head' }, h('h2', { text: 'التحاليل والمرفقات' })),
    h('div', { class: 'grid-2' },
      h('a', { class: 'tile link', href: '#/labs?patient=' + p.id }, h('span', { class: 'l', text: 'نتائج التحاليل' }), h('span', { class: 'v', text: String(labsN) }), h('span', { class: 's', text: 'القيم والمنحنيات ›' })),
      h('a', { class: 'tile link', href: '#/files?patient=' + p.id }, h('span', { class: 'l', text: 'الملفات المرفقة' }), h('span', { class: 'v', text: String(filesN) }), h('span', { class: 's', text: 'عرض الكل ›' }))),
    recent.length ? h('div', { class: 'files-grid' }, recent.map(fileTile)) : null,
    up ? h('a', { class: 'btn secondary block', href: '#/upload?patient=' + p.id }, icon('share', 22), 'رفع تحليل أو وصفة أو مرفق') : null);
}

async function archive(p) {
  const reason = await confirmDialog({
    title: 'أرشفة ملف ' + p.full_name,
    body: 'لا يُحذف شيء: يبقى الملف وسجله محفوظين، ويختفي من القوائم اليومية. لا يمكن تعديل ملف مؤرشف.',
    okText: 'أرشفة', danger: true,
    input: { label: 'سبب الأرشفة', placeholder: 'مثال: أنهى العلاج وانتقل للمتابعة الدورية' },
  });
  if (reason === null) return;
  if (!reason) return toast('اكتب سبب الأرشفة', true);
  try {
    await rpc('archive_patient', { p_id: p.id, p_reason: reason });
    toast('أُرشف الملف');
    go('/patient?id=' + p.id);
  } catch (e) { toast(e.message, true); }
}

// تقدّم الجرعات مراحلَ مرقّمة متصلة، والمعطاة خضراء بعلامة صح (في التصميم 2 فقط؛ في المظهر الحالي يبقى الشريط)
function cycleDrops(cycles, total) {
  const box = h('div', { class: 'cyc-drops', 'aria-hidden': 'true' });
  const byNo = new Map(cycles.map((c) => [c.cycle_no, c]));
  let nowMarked = false;
  for (let n = 1; n <= total; n++) {
    const c = byNo.get(n);
    let k = 'todo';
    if (c && c.status === 'given') k = 'done';
    else if (c && c.status === 'cancelled') k = 'off';
    else if (!nowMarked && c && ['planned', 'held'].includes(c.status)) { k = 'now'; nowMarked = true; }
    if (n > 1) box.append(h('span', { class: 'ln' + (k === 'done' ? ' done' : '') }));
    const d = h('span', { class: 'cd ' + k, title: 'الجرعة ' + n });
    d.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
    d.append(h('b', { text: n }));
    box.append(d);
  }
  return box;
}
