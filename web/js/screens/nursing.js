// التمريض: جرعات اليوم لكل مريض، وتسجيل الإعطاء مع العلامات الحيوية والتفاعلات
import { sb, q, rpc } from '../api.js';
import { h, mount, icon, topbar, bottomNav, notice, toast, busy, empty, fmtDay, fmtTime, todayISO, addDaysISO, initials, count, field, confirmDialog } from '../ui.js';
import { can, mineCycles } from '../perms.js';
import { ROUTE_AR, OUT_UNITS, daysList, num, instrLine } from '../dose.js';
import { NKDA } from './patient-form.js';

const dayOf = (planned, iso = todayISO()) => Math.round((new Date(iso) - new Date(planned)) / 86400000) + 1;

// --------------------------------------------------------------- قائمة اليوم
export async function list(root) {
  const box = h('div', { class: 'section' });
  mount(root, h('div', { class: 'screen' },
    topbar({ title: 'الإعطاء اليوم', sub: fmtDay(todayISO()), back: '#/home' }),
    h('main', { class: 'main with-nav' }, box),
    bottomNav('home')));
  if (!can('seeNursing')) return box.replaceChildren(notice('info', 'lock', h('p', { text: 'شاشة التمريض للتمريض والأطباء والصيادلة السريريين.' })));
  box.replaceChildren(h('div', { class: 'card' }, h('div', { class: 'empty' }, h('span', { class: 'spinner' }))));

  const today = todayISO();
  const cycles = await q(mineCycles(sb.from('cycles')
    .select('id, cycle_no, planned_date, doctor_approved_at, treatments!inner(status, protocol_name, total_cycles, patients!inner(id, full_name, file_no, allergies, archived_at, specialist_id)), cycle_doses(id, drug_name, days, is_mixed, archived_at), mixing_orders(day, status)'))
    .in('status', ['planned', 'held']).eq('treatments.status', 'active').is('treatments.patients.archived_at', null)
    .gte('planned_date', addDaysISO(today, -60)).lte('planned_date', today).order('planned_date'));
  const ids = cycles.map((c) => c.id);
  const given = ids.length ? await q(sb.from('administrations').select('cycle_dose_id, day, cycle_doses!inner(cycle_id)').in('cycle_doses.cycle_id', ids)) : [];

  const due = [];
  for (const c of cycles) {
    const day = dayOf(c.planned_date, today);
    const doses = c.cycle_doses.filter((d) => !d.archived_at && daysList(d.days).includes(day));
    if (!doses.length) continue;
    const done = doses.filter((d) => given.some((g) => g.cycle_dose_id === d.id && g.day === day)).length;
    due.push({ c, day, doses, done, ready: !!c.doctor_approved_at, mixing: c.mixing_orders.find((m) => m.day === day) });
  }
  due.sort((a, b) => (a.done === a.doses.length) - (b.done === b.doses.length));

  box.replaceChildren(
    h('p', { style: 'font-size: 14px; color: var(--muted-2)', text: due.length ? `${count(due.length, 'patient')} لهم جرعات دوائية اليوم` : '' }),
    h('div', { class: 'card flush' }, due.length ? due.map(dueRow) : empty('لا توجد جرعات دوائية مستحقة اليوم', 'check')));
}

function dueRow({ c, day, doses, done, ready, mixing }) {
  const p = c.treatments.patients;
  let pill;
  if (done === doses.length) pill = h('span', { class: 'pill ok', text: 'اكتملت' });
  else if (!ready) pill = h('span', { class: 'pill muted', text: 'بانتظار الاعتماد' });
  else if (doses.some((d) => d.is_mixed) && (!mixing || ['incoming', 'in_progress', 'held'].includes(mixing.status))) pill = h('span', { class: 'pill info', text: mixing?.status === 'held' ? 'المزج معلّق' : mixing ? 'قيد المزج' : 'بانتظار المزج' });
  else pill = h('span', { class: 'pill brand', text: 'جاهزة للإعطاء' });
  return h('a', { class: 'row', href: `#/administer?cycle=${c.id}&day=${day}` },
    h('span', { class: 'avatar', text: initials(p.full_name) }),
    h('span', { class: 'grow' },
      h('span', { class: 't', style: 'display: flex; gap: 6px; align-items: center' }, h('span', { text: p.full_name }),
        p.allergies && p.allergies !== NKDA ? h('span', { style: 'color: var(--brand); display: flex', title: 'حساسية' }, icon('alert', 16, 'currentColor', 2.2)) : null),
      h('span', { class: 's', style: 'display: flex; gap: 6px; flex-wrap: wrap; align-items: center' },
        h('span', { class: 'tag', text: c.treatments.protocol_name }), h('span', { text: `الجرعة ${c.cycle_no} · اليوم ${day}` })),
      h('span', { class: 's', text: `أُعطي ${done} من ${count(doses.length, 'drug')}` })),
    pill);
}

// --------------------------------------------------------------- إعطاء جرعات يوم
export async function administer(root, params) {
  const cid = params.get('cycle'), day = Number(params.get('day') || 1);
  const c = await q(sb.from('cycles')
    .select('id, cycle_no, planned_date, status, doctor_approved_at, treatments(status, protocol_name, patients(id, full_name, file_no, allergies)), cycle_doses(id, drug_name, final_dose, final_unit, route, days, diluent, infusion_rate, instructions, is_mixed, archived_at, sort)')
    .eq('id', cid).maybeSingle());
  if (!c) throw new Error('الجرعة غير موجودة');
  const p = c.treatments.patients;
  const doses = c.cycle_doses.filter((d) => !d.archived_at && daysList(d.days).includes(day)).sort((a, b) => a.sort - b.sort);
  const ids = doses.map((d) => d.id);
  const [adm, sent, completions] = await Promise.all([
    ids.length ? q(sb.from('administrations').select('id, cycle_dose_id, day, given_at, vitals, reaction, notes, nurse:profiles(full_name)').in('cycle_dose_id', ids).eq('day', day)) : [],
    ids.length ? q(sb.from('mixing_items').select('cycle_dose_id, sent_at, mixing_orders!inner(day)').in('cycle_dose_id', ids).eq('mixing_orders.day', day)) : [],
    // اكتمال الإعطاء لكل يوم (الملف 41)
    q(sb.from('cycle_day_completions').select('day, completed_at, by:profiles(full_name)').eq('cycle_id', cid)).catch(() => []),
  ]);
  const doneDays = new Set(completions.map((x) => x.day));
  const approved = !!c.doctor_approved_at;
  const live = c.treatments.status === 'active' && (c.status === 'planned' || c.status === 'held');
  const reload = () => administer(root, params);
  const allDays = [...new Set(c.cycle_doses.filter((d) => !d.archived_at).flatMap((d) => daysList(d.days)))];
  const lastDay = Math.max(...allDays);
  const allGiven = doses.length && doses.every((d) => adm.some((a) => a.cycle_dose_id === d.id));

  const future = addDaysISO(c.planned_date, day - 1) > todayISO();
  if (document.documentElement.dataset.theme === 'b') return administerB(root, { c, p, cid, day, doses, adm, sent, approved, live, reload, allDays, lastDay, allGiven, future, completions, doneDays });
  const rows = doses.map((d) => {
    const a = adm.find((x) => x.cycle_dose_id === d.id);
    const isSent = !d.is_mixed || sent.some((s) => s.cycle_dose_id === d.id && s.sent_at);
    let right;
    if (a) right = h('span', { class: 'pill ok', text: 'أُعطي ' + fmtTime(a.given_at) });
    else if (future) right = h('span', { class: 'pill muted', text: 'لم يحن موعده' });
    else if (!approved) right = h('span', { class: 'pill muted', text: 'بانتظار الاعتماد' });
    else if (!isSent) right = h('span', { class: 'pill info', text: 'لم يصل من المزج' });
    else if (can('administer') && live) right = h('button', { type: 'button', class: 'btn primary sm', text: 'تسجيل الإعطاء', onclick: () => giveDialog(d, day, p).then((ok) => ok && reload()) });
    else right = h('span', { class: 'pill brand', text: 'جاهز' });
    return h('div', { class: 'row', style: 'align-items: flex-start' },
      h('span', { class: 'grow' },
        h('span', { class: 't ltr', style: 'text-align: right; font-size: 17px', text: `${d.drug_name}  ${num(d.final_dose)} ${d.final_unit}` }),
        h('span', { class: 's', text: [`${d.route} (${ROUTE_AR[d.route] || d.route})`, d.diluent, d.infusion_rate].filter(Boolean).join(' · ') }),
        instrLine(d),
        a ? h('span', { class: 's', text: `${a.nurse?.full_name || ''} · ${vitalsText(a.vitals)}` }) : null,
        a?.reaction ? h('span', { class: 'pill warn wrap', style: 'align-self: flex-start; margin-top: 4px', text: 'تفاعل: ' + a.reaction }) : null,
        a?.notes ? h('span', { class: 's', text: a.notes }) : null),
      right);
  });

  const closeBtn = dayCompletion({ c, cid, day, live, allGiven, completions, doneDays, allDays, reload });

  const daysNav = allDays.length > 1 ? h('div', { class: 'segmented', style: 'grid-auto-columns: minmax(44px, 1fr); overflow-x: auto' },
    allDays.sort((a, b) => a - b).map((n) => h('a', { href: `#/administer?cycle=${cid}&day=${n}`, 'aria-current': n === day ? 'page' : null, 'aria-label': 'اليوم ' + n + (doneDays.has(n) ? '، اكتمل إعطاؤه' : ''), text: n + (doneDays.has(n) ? ' ✓' : '') }))) : null;

  mount(root, h('div', { class: 'screen' },
    topbar({ title: p.full_name, sub: `${c.treatments.protocol_name} · الجرعة ${c.cycle_no} · اليوم ${day}`, back: '#/nursing' }),
    h('main', { class: 'main with-nav' },
      h('div', { class: 'card', style: 'flex-direction: row; justify-content: space-between; align-items: center' },
        h('span', { style: 'display: flex; flex-direction: column' }, h('span', { class: 'tag', style: 'align-self: flex-start', text: p.file_no }),
          h('b', { style: 'margin-top: 4px', text: fmtDay(addDaysISO(c.planned_date, day - 1)) })),
        h('a', { href: '#/cycle?id=' + cid, class: 'link-btn', text: 'الجرعة' })),
      p.allergies && p.allergies !== NKDA ? notice('err', 'alert', h('p', { style: 'font-weight: 700', text: 'حساسية دوائية: ' + p.allergies })) : null,
      !approved ? notice('warn', 'lock', h('p', { text: 'لا يُعطى أي دواء قبل اعتماد الطبيب.' })) : null,
      daysNav ? h('p', { style: 'font-size: 14px; font-weight: 600', text: 'أيام الإعطاء في الجرعة' }) : null,
      daysNav,
      h('div', { class: 'card flush' }, rows.length ? rows : empty(`لا توجد أدوية في اليوم ${day}`, 'pill')),
      can('administer') ? notice('info', 'info', h('p', { text: 'قبل كل جرعة دوائية: طابق اسم المريض ورقم ملفه مع ملصق الكيس، والجرعة الدوائية مع هذه الشاشة.' })) : null,
      closeBtn),
    bottomNav('home')));
}

// --------------------------------------------------------------- التصميم 2: شاشة «إعطاء الجرعة»
// العلامات الحيوية في الأعلى اختيارية: تُرفق بكل دواء يُسجَّل إعطاؤه إن كُتبت، ولا تمنع الإعطاء إن تُركت فارغة.
const VITALS = [['bp', 'ضغط الدم', 'mmHg', '120/80', 'text'], ['hr', 'النبض', 'bpm', '78', 'numeric'], ['temp', 'الحرارة', '°C', '36.8', 'decimal'], ['spo2', 'الأكسجين', '% SpO₂', '98', 'numeric']];
function administerB(root, { c, p, cid, day, doses, adm, sent, approved, live, reload, allDays, lastDay, allGiven, future, completions, doneDays }) {
  const last = adm.filter((a) => a.vitals && Object.keys(a.vitals).length).sort((a, b) => b.given_at.localeCompare(a.given_at))[0];
  const vin = {};
  const tiles = VITALS.map(([k, l, u, ph, mode]) => {
    vin[k] = h('input', { class: 'adb-v', inputmode: mode, placeholder: '—', 'aria-label': l + ' (اختياري) مثل ' + ph, value: last?.vitals?.[k] || '' });
    return h('label', { class: 'adb-tile' }, h('span', { class: 'l', text: l }), h('span', { class: 'v' }, vin[k], h('small', { text: u })));
  });
  const vitals = () => Object.fromEntries(VITALS.map(([k]) => [k, vin[k].value.trim().replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))]).filter(([, v]) => v));
  const vErr = h('div');
  const checkVitals = () => {
    const v = vitals();
    if (v.bp && !/^\d{2,3}\/\d{2,3}$/.test(v.bp)) { vErr.replaceChildren(notice('err', 'warn', h('p', { text: 'اكتب الضغط بصيغة 120/80 أو اتركه فارغاً' }))); return null; }
    vErr.replaceChildren(); return v;
  };

  const ready = (d) => !adm.some((a) => a.cycle_dose_id === d.id) && !future && approved && live && can('administer')
    && (!d.is_mixed || sent.some((s) => s.cycle_dose_id === d.id && s.sent_at));
  async function give(d, btn, reaction = null) {
    const v = checkVitals(); if (!v) return false;
    if (!reaction && !await confirmDialog({ title: 'تسجيل إعطاء ' + d.drug_name, body: `${num(d.final_dose)} ${OUT_UNITS[d.final_unit] || d.final_unit} · ${p.full_name} · ${p.file_no}\nطابق اسم المريض ورقم ملفه مع ملصق الكيس.`, okText: 'تأكيد الإعطاء' })) return false;
    let ok = false;
    await busy(btn, async () => {
      try {
        await rpc('record_administration', { p_dose: d.id, p_day: day, p_vitals: v, p_reaction: reaction, p_notes: null });
        toast(reaction ? 'سُجّل الإعطاء وأُبلغ الطبيب بالتفاعل' : 'سُجّل الإعطاء'); ok = true;
      } catch (e) { toast(e.message, true); }
    });
    if (ok) reload();
    return ok;
  }

  const rows = doses.map((d) => {
    const a = adm.find((x) => x.cycle_dose_id === d.id);
    const isSent = !d.is_mixed || sent.some((s) => s.cycle_dose_id === d.id && s.sent_at);
    let right;
    if (a) right = h('span', { class: 'pill ok', text: 'أُعطي' });
    else if (future) right = h('span', { class: 'pill muted', text: 'لم يحن موعده' });
    else if (!approved) right = h('span', { class: 'pill muted', text: 'بانتظار الاعتماد' });
    else if (!isSent) right = h('span', { class: 'pill info', text: 'لم يصل من المزج' });
    else if (ready(d)) right = h('button', { type: 'button', class: 'adb-go', text: 'تسجيل الإعطاء', onclick: (e) => give(d, e.currentTarget) });
    else right = h('span', { class: 'pill brand', text: 'جاهز' });
    return h('div', { class: 'adb-drug' },
      h('span', { class: 'grow' },
        h('b', { class: 'ltr', text: d.drug_name }),
        h('span', { class: 'ltr', text: [`${num(d.final_dose)} ${d.final_unit}`, d.route, a ? new Date(a.given_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : null].filter(Boolean).join(' · ') }),
        a?.nurse?.full_name ? h('span', { text: a.nurse.full_name }) : null,
        a?.reaction ? h('span', { class: 'pill warn wrap', style: 'align-self: flex-start; margin-top: 4px', text: 'تفاعل: ' + a.reaction }) : null),
      right);
  });

  const closeBtn = dayCompletion({ c, cid, day, live, allGiven, completions, doneDays, allDays, reload });

  // الإبلاغ عن تفاعل: لدواء أُعطي (يُضاف إلى سجله)، أو لدواء جاهز لم يُسجَّل بعد (يُسجَّل إعطاؤه مع التفاعل)
  const reactable = doses.filter((d) => adm.some((a) => a.cycle_dose_id === d.id) || ready(d));
  function reactionDialog() {
    if (!reactable.length) return toast('لا يوجد دواء أُعطي أو جاهز للإعطاء في هذا اليوم', true);
    const sel = h('select', { class: 'input ltr' }, reactable.map((d) => h('option', { value: d.id, text: d.drug_name + (adm.some((a) => a.cycle_dose_id === d.id) ? '' : '  (يُسجَّل إعطاؤه الآن)') })));
    const txt = h('textarea', { class: 'input', rows: 3, maxlength: 1000, placeholder: 'الأعراض، وقت ظهورها، ما فُعل' });
    const err = h('div');
    const dlg = h('dialog', null);
    const close = () => { dlg.close(); dlg.remove(); };
    dlg.append(h('div', { class: 'dlg' }, h('h2', { text: 'الإبلاغ عن تفاعل دوائي' }),
      h('p', { class: 'hint', text: `${p.full_name} · ${p.file_no}` }),
      field('الدواء', sel), field('وصف التفاعل', txt), err,
      h('button', { type: 'button', class: 'btn primary block', text: 'إرسال البلاغ', onclick: (e) => {
        const r = txt.value.trim(); if (!r) return err.replaceChildren(notice('err', 'warn', h('p', { text: 'صف التفاعل' })));
        const d = reactable.find((x) => x.id === sel.value); const a = adm.find((x) => x.cycle_dose_id === d.id);
        if (!a) { close(); return give(d, e.currentTarget, r); }
        busy(e.currentTarget, async () => {
          try { await rpc('report_reaction', { p_admin: a.id, p_reaction: r }); close(); toast('أُرسل البلاغ إلى الطبيب والصيادلة'); reload(); }
          catch (x) { err.replaceChildren(notice('err', 'warn', h('p', { text: x.message }))); }
        });
      } }),
      h('button', { type: 'button', class: 'link-btn', text: 'إلغاء', onclick: close })));
    document.body.append(dlg); dlg.addEventListener('cancel', close); dlg.showModal(); txt.focus();
  }

  const daysNav = allDays.length > 1 ? h('div', { class: 'segmented', style: 'grid-auto-columns: minmax(44px, 1fr); overflow-x: auto' },
    [...allDays].sort((a, b) => a - b).map((n) => h('a', { href: `#/administer?cycle=${cid}&day=${n}`, 'aria-current': n === day ? 'page' : null, 'aria-label': 'اليوم ' + n + (doneDays.has(n) ? '، اكتمل إعطاؤه' : ''), text: n + (doneDays.has(n) ? ' ✓' : '') }))) : null;

  mount(root, h('div', { class: 'screen adb' },
    h('header', { class: 'topbar adb-hero' },
      h('div', { class: 'adb-top' },
        h('a', { class: 'icon-btn', href: '#/nursing', 'aria-label': 'رجوع' }, icon('back', 24, 'currentColor', 2)),
        h('span', { class: 'adb-day', text: 'اليوم ' + day })),
      h('div', { class: 'titles' }, h('h1', { text: 'إعطاء الجرعة' }),
        h('p', { class: 'sub' }, h('span', { text: p.full_name }), ' · ', h('span', { class: 'ltr', style: 'display: inline-block', text: c.treatments.protocol_name })))),
    h('main', { class: 'main with-nav' },
      h('section', { class: 'card adb-vitals', 'aria-label': 'العلامات الحيوية' },
        h('div', { class: 'adb-h' }, h('h2', { text: 'العلامات الحيوية' }), h('span', { class: 'adb-opt', text: last ? new Date(last.given_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : 'اختيارية' })),
        h('div', { class: 'adb-grid' }, tiles), vErr),
      p.allergies && p.allergies !== NKDA ? notice('err', 'alert', h('p', { style: 'font-weight: 700', text: 'حساسية دوائية: ' + p.allergies })) : null,
      !approved ? notice('warn', 'lock', h('p', { text: 'لا يُعطى أي دواء قبل اعتماد الطبيب.' })) : null,
      daysNav,
      h('section', { class: 'card adb-drugs', 'aria-label': 'الأدوية' }, h('h2', { text: 'الأدوية' }),
        rows.length ? rows : empty(`لا توجد أدوية في اليوم ${day}`, 'pill')),
      can('administer') && live ? h('button', { type: 'button', class: 'adb-react', onclick: reactionDialog }, icon('warn', 22, 'currentColor', 2), h('span', { text: 'الإبلاغ عن تفاعل دوائي' })) : null,
      can('administer') && live ? h('p', { class: 'adb-note', text: 'أي تفاعل تسجّله يصل فوراً إلى الطبيب والصيادلة' }) : null,
      closeBtn,
      h('a', { href: '#/cycle?id=' + cid, class: 'link-btn', text: 'تفاصيل الجرعة ' + c.cycle_no })),
    bottomNav('home')));
}

// «تم إعطاء الجرعة بالكامل» لهذا اليوم (الملف 41): يظهر بعد إعطاء كل أدوية اليوم، وآخر يوم يُغلق الجرعة كلها
function dayCompletion({ c, cid, day, live, allGiven, completions, doneDays, allDays, reload }) {
  const rec = completions.find((x) => x.day === day);
  if (rec) {
    return notice('ok', 'check', h('p', { style: 'font-weight: 600', text: `تم إعطاء الجرعة بالكامل لليوم ${day}` }),
      h('p', { style: 'font-size: 13px', text: [rec.by?.full_name, fmtDay(rec.completed_at), fmtTime(rec.completed_at)].filter(Boolean).join(' · ') }));
  }
  if (!(live && allGiven && can('completeDay'))) return null;
  const remaining = allDays.filter((n) => n !== day && !doneDays.has(n));
  const btn = h('button', { type: 'button', class: 'btn ok block' }, icon('check', 22, '#fff', 2.2),
    allDays.length > 1 ? `تم إعطاء الجرعة بالكامل لليوم ${day}` : 'تم إعطاء الجرعة بالكامل');
  btn.addEventListener('click', () => busy(btn, async () => {
    const last = !remaining.length;
    const ok = await confirmDialog({
      title: allDays.length > 1 ? `تم إعطاء الجرعة ${c.cycle_no} بالكامل لليوم ${day}` : `تم إعطاء الجرعة ${c.cycle_no} بالكامل`,
      body: last ? 'أُعطيت كل أدوية هذا اليوم، وهو آخر أيام الجرعة: تُسجَّل الجرعة مُعطاة وتصبح الجرعة التالية هي القادمة.'
        : `أُعطيت كل أدوية اليوم ${day}. يتبقى في هذه الجرعة ${count(remaining.length, 'day')}: ${remaining.join('، ')}.`,
      okText: 'تأكيد' });
    if (!ok) return;
    try {
      const r = await rpc('complete_cycle_day', { p_cycle: cid, p_day: day });
      toast(r === 'cycle' ? 'سُجّلت الجرعة مُعطاة بالكامل' : `سُجّل اكتمال إعطاء اليوم ${day}`); reload();
    } catch (e) { toast(e.message, true); }
  }));
  return btn;
}

function vitalsText(v = {}) {
  return [v.bp && 'ض ' + v.bp, v.hr && 'ن ' + v.hr, v.temp && 'ح ' + v.temp, v.spo2 && 'أكسجة ' + v.spo2 + '%'].filter(Boolean).join(' · ') || 'بلا علامات حيوية';
}

function giveDialog(d, day, p) {
  return new Promise((resolve) => {
    const dlg = h('dialog', null);
    const inp = (ph, mode = 'decimal') => h('input', { class: 'input ltr', inputmode: mode, placeholder: ph, style: 'text-align: right' });
    const bp = inp('120/80', 'text'), hr = inp('80'), temp = inp('37.0'), spo2 = inp('98');
    let reacted = false;
    const reaction = h('textarea', { class: 'input', rows: 2, placeholder: 'صف التفاعل: الأعراض، وقت ظهورها، ما فُعل', hidden: true });
    const seg = h('div', { class: 'segmented' });
    const drawSeg = () => seg.replaceChildren(...[[false, 'بلا تفاعل'], [true, 'حدث تفاعل']].map(([v, l]) => h('button', { type: 'button', 'aria-pressed': reacted === v ? 'true' : 'false', text: l, onclick: () => { reacted = v; reaction.hidden = !v; drawSeg(); } })));
    drawSeg();
    const notes = h('input', { class: 'input', placeholder: 'ملاحظة اختيارية' });
    const err = h('div');
    const done = (v) => { dlg.close(); dlg.remove(); resolve(v); };
    const ok = h('button', { type: 'button', class: 'btn primary', text: 'تأكيد الإعطاء' });
    ok.addEventListener('click', async () => {
      err.replaceChildren();
      if (bp.value && !/^\d{2,3}\/\d{2,3}$/.test(bp.value.trim())) return err.replaceChildren(notice('err', 'warn', h('p', { text: 'اكتب الضغط بصيغة 120/80' })));
      if (reacted && !reaction.value.trim()) return err.replaceChildren(notice('err', 'warn', h('p', { text: 'صف التفاعل' })));
      ok.disabled = true;
      try {
        const vitals = Object.fromEntries([['bp', bp.value.trim()], ['hr', hr.value.trim()], ['temp', temp.value.trim()], ['spo2', spo2.value.trim()]].filter(([, v]) => v));
        await rpc('record_administration', { p_dose: d.id, p_day: day, p_vitals: vitals, p_reaction: reacted ? reaction.value.trim() : null, p_notes: notes.value.trim() || null });
        toast(reacted ? 'سُجّل الإعطاء وأُبلغ الطبيب المختص بالتفاعل' : 'سُجّل الإعطاء');
        done(true);
      } catch (e) { ok.disabled = false; err.replaceChildren(notice('err', 'warn', h('p', { text: e.message }))); }
    });
    dlg.append(h('div', { class: 'dlg' },
      h('h2', { class: 'ltr', style: 'text-align: right', text: `${d.drug_name} ${num(d.final_dose)} ${OUT_UNITS[d.final_unit]}` }),
      h('p', { style: 'color: var(--muted)', text: `${p.full_name} · ${p.file_no}` }),
      h('p', { class: 'hint', text: 'العلامات الحيوية اختيارية: اكتب ما قسته، أو اتركها فارغة.' }),
      h('div', { class: 'grid-2' }, field('الضغط', bp), field('النبض', hr)),
      h('div', { class: 'grid-2' }, field('الحرارة', temp), field('الأكسجة %', spo2)),
      seg, reaction, field('ملاحظة', notes), err,
      h('div', { class: 'grid-2' }, h('button', { type: 'button', class: 'btn secondary', text: 'إلغاء', onclick: () => done(false) }), ok)));
    document.body.append(dlg);
    dlg.addEventListener('cancel', () => done(false));
    dlg.showModal();
  });
}
