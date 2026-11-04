// قسم المزج الكيميائي: التحويل من الصيدلي السريري، والطلبات الواردة، والتحضير والإرسال
import { sb, q, rpc } from '../api.js';
import { h, mount, icon, topbar, bottomNav, notice, toast, busy, empty, fmtDate, fmtTime, relTime, initials, count, confirmDialog } from '../ui.js';
import { go } from '../app.js';
import { can } from '../perms.js';
import { ROUTE_AR, OUT_UNITS, daysList, num, instrLine } from '../dose.js';
import { uploadAttachment, signedUrl, openFile, isImage, KINDS } from '../files.js';
import { NKDA } from './patient-form.js';
import { protocolFileLink } from '../files.js';

const O_STATUS = { incoming: ['وارد', 'brand'], in_progress: ['قيد التحضير', 'info'], partially_sent: ['أُرسل جزء', 'warn'], sent: ['أُرسل كاملاً', 'ok'], held: ['موقوف', 'muted'] };

// --------------------------------------------------------------- التحويل إلى المزج
export async function transfer(root, params) {
  const cid = params.get('cycle'), day = Number(params.get('day') || 1);
  const back = '#/cycle?id=' + cid;
  const c = await q(sb.from('cycles').select('id, cycle_no, planned_date, doctor_approved_at, pharmacist_verified_at, treatments(status, protocol_name, patients(id, full_name, file_no, allergies))').eq('id', cid).maybeSingle());
  if (!c) throw new Error('الدورة غير موجودة');
  const p = c.treatments.patients;
  const shell = (...x) => mount(root, h('div', { class: 'screen' }, topbar({ title: `تحويل اليوم ${day} إلى المزج`, sub: `${p.full_name} · الدورة ${c.cycle_no}`, back }), h('main', { class: 'main' }, ...x)));
  if (!can('transfer')) return shell(notice('info', 'lock', h('p', { text: 'التحويل إلى المزج للصيادلة السريريين.' })));

  const [doses, files] = await Promise.all([
    q(sb.from('cycle_doses').select('id, drug_name, final_dose, final_unit, route, days, diluent, infusion_rate, instructions, is_mixed').eq('cycle_id', cid).is('archived_at', null).eq('is_mixed', true)),
    q(sb.from('attachments').select('id, kind, title, file_path, created_at').eq('patient_id', p.id).in('kind', ['id_card', 'prescription']).order('created_at', { ascending: false })),
  ]);
  const todays = doses.filter((d) => daysList(d.days).includes(day));
  const pick = { id_card: files.find((f) => f.kind === 'id_card')?.id || null, prescription: null };

  const pickers = ['id_card', 'prescription'].map((kind) => {
    const box = h('div', { class: 'files-grid' });
    const status = h('p', { class: 'hint' });
    const input = h('input', { type: 'file', accept: 'image/*,application/pdf', class: 'sr-only', id: 'tf-' + kind });
    const draw = () => {
      const list = files.filter((f) => f.kind === kind).slice(0, 5);
      box.replaceChildren(...list.map((f) => {
        const img = h('span', { class: 'ft-img' }, icon('file', 26, '#8A929C'));
        if (isImage(f.file_path)) signedUrl(f.file_path).then((u) => img.replaceChildren(h('img', { src: u, alt: '' }))).catch(() => {});
        return h('button', { type: 'button', class: 'file-tile', 'aria-pressed': pick[kind] === f.id ? 'true' : 'false', onclick: () => { pick[kind] = f.id; draw(); } },
          img, h('span', { class: 'ft-t', text: f.title || fmtDate(f.created_at, { day: 'numeric', month: 'short' }) }));
      }), h('label', { for: 'tf-' + kind, class: 'file-tile add' }, icon('plus', 26), h('span', { class: 'ft-t', text: 'التقاط جديد' })));
      status.textContent = pick[kind] ? '' : kind === 'prescription' ? 'صوّر وصفة هذه الدورة، أو اختر صورة رُفعت اليوم.' : 'اختر صورة ملف التعريف أو التقط صورة جديدة.';
    };
    input.addEventListener('change', async () => {
      if (!input.files[0]) return;
      status.textContent = 'جارٍ الرفع…';
      try {
        const id = await uploadAttachment(p.id, input.files[0], { kind, title: kind === 'prescription' ? `وصفة الدورة ${c.cycle_no} اليوم ${day}` : 'ملف التعريف' });
        const f = await q(sb.from('attachments').select('id, kind, title, file_path, created_at').eq('id', id).single());
        files.unshift(f); pick[kind] = id; draw();
      } catch (e) { status.textContent = e.message; }
    });
    draw();
    return h('div', { class: 'card' }, h('h2', { text: KINDS[kind][0] }), input, box, status);
  });

  const err = h('div');
  const submit = h('button', { class: 'btn primary block', type: 'button' }, icon('move', 22, '#fff'), 'تحويل إلى قسم المزج');
  submit.addEventListener('click', () => busy(submit, async () => {
    err.replaceChildren();
    if (!pick.id_card || !pick.prescription) return err.replaceChildren(notice('err', 'warn', h('p', { text: 'أرفق صورة ملف التعريف وصورة الوصفة' })));
    try {
      const id = await rpc('transfer_to_mixing', { p_cycle: cid, p_id_card: pick.id_card, p_prescription: pick.prescription, p_day: day });
      toast('حُوّل الطلب إلى قسم المزج');
      go('/mixing-order?id=' + id);
    } catch (e) { err.replaceChildren(notice('err', 'warn', h('p', { text: e.message }))); }
  }));

  shell(
    p.allergies && p.allergies !== NKDA ? notice('err', 'alert', h('p', { style: 'font-weight: 700', text: 'حساسية دوائية: ' + p.allergies })) : null,
    !c.doctor_approved_at || !c.pharmacist_verified_at ? notice('warn', 'lock', h('p', { text: 'يجب اعتماد الطبيب وتحقق الصيدلاني قبل التحويل.' })) : null,
    h('section', { class: 'section' },
      h('div', { class: 'section-head' }, h('h2', { text: `أدوية اليوم ${day}` }), h('span', { class: 'meta', text: count(todays.length, 'drug') })),
      h('div', { class: 'card flush' }, todays.length ? todays.map(itemLine) : empty('لا توجد أدوية تُحضَّر في هذا اليوم', 'pill'))),
    ...pickers, err, submit);
}

function itemLine(d) {
  return h('div', { class: 'row' },
    h('span', { class: 'grow' },
      h('span', { class: 't ltr', style: 'text-align: right', text: d.drug_name }),
      h('span', { class: 's', text: [`${d.route} (${ROUTE_AR[d.route] || d.route})`, d.diluent, d.infusion_rate].filter(Boolean).join(' · ') }),
      instrLine(d)),
    h('span', { class: 'dose-big' }, h('b', { class: 'ltr', text: num(d.final_dose) }), h('span', { text: OUT_UNITS[d.final_unit] })));
}

// --------------------------------------------------------------- قائمة قسم المزج
export async function list(root, params) {
  let tab = params.get('t') || 'open';
  const seg = h('div', { class: 'segmented', role: 'group' });
  const box = h('div', { class: 'card flush' });
  mount(root, h('div', { class: 'screen' },
    topbar({ title: 'قسم المزج الكيميائي', back: '#/home' }),
    h('main', { class: 'main with-nav' }, seg, box),
    bottomNav('home')));
  if (!can('seeMixing')) return box.replaceChildren(notice('info', 'lock', h('p', { text: 'قسم المزج للصيادلة والأطباء.' })));

  const since = new Date(); since.setDate(since.getDate() - 3);
  const rows = await q(sb.from('mixing_orders')
    .select('id, day, status, transferred_at, patients(full_name, file_no, allergies), cycles(cycle_no, treatments(protocol_name)), mixing_items(id, prepared_at, sent_at)')
    .gte('transferred_at', since.toISOString()).order('transferred_at', { ascending: false }));
  const groups = { open: rows.filter((r) => r.status !== 'sent' && r.status !== 'held'), sent: rows.filter((r) => r.status === 'sent') };

  const draw = () => {
    seg.replaceChildren(...[['open', 'الواردة'], ['sent', 'أُرسلت']].map(([id, label]) => h('button', {
      type: 'button', 'aria-pressed': tab === id ? 'true' : 'false',
      onclick: () => { tab = id; history.replaceState(null, '', '#/mixing?t=' + id); draw(); },
    }, label, id === 'open' && groups.open.length ? h('span', { class: 'count', style: 'margin-right: 6px', text: groups.open.length }) : null)));
    box.replaceChildren(...(groups[tab].length ? groups[tab].map(orderRow)
      : [empty(tab === 'open' ? 'لا توجد طلبات مزج واردة' : 'لم يُرسل شيء خلال الأيام الثلاثة الماضية', 'check')]));
  };
  draw();
}

function orderRow(o) {
  const [l, k] = O_STATUS[o.status];
  const prep = o.mixing_items.filter((i) => i.prepared_at).length;
  const hasAllergy = o.patients.allergies && o.patients.allergies !== NKDA;
  return h('a', { class: 'row', href: '#/mixing-order?id=' + o.id },
    h('span', { class: 'avatar', text: initials(o.patients.full_name) }),
    h('span', { class: 'grow' },
      h('span', { class: 't', style: 'display: flex; gap: 6px; align-items: center' }, h('span', { text: o.patients.full_name }),
        hasAllergy ? h('span', { style: 'color: var(--brand); display: flex', title: 'حساسية' }, icon('alert', 16, 'currentColor', 2.2)) : null),
      h('span', { class: 's', style: 'display: flex; gap: 6px; flex-wrap: wrap; align-items: center' },
        h('span', { class: 'tag', text: o.cycles.treatments.protocol_name }), h('span', { text: `الدورة ${o.cycles.cycle_no} · اليوم ${o.day}` })),
      h('span', { class: 's', text: `${prep} من ${count(o.mixing_items.length, 'drug')} محضَّرة · ${relTime(o.transferred_at)}` })),
    h('span', { class: 'pill ' + k, text: l }));
}

// --------------------------------------------------------------- طلب مزج واحد
export async function order(root, params) {
  const id = params.get('id');
  const o = await q(sb.from('mixing_orders')
    .select('*, sender:profiles(full_name), patients(id, full_name, file_no, allergies, weight_kg), cycles(id, cycle_no, treatments(protocol_name, bsa, weight_kg, protocols(file_path))), idcard:attachments!mixing_orders_id_card_attachment_id_fkey(file_path), rx:attachments!mixing_orders_prescription_attachment_id_fkey(file_path), mixing_items(id, prepared_at, sent_at, cycle_doses(drug_name, final_dose, final_unit, route, diluent, infusion_rate, instructions, dose_value, dose_unit, calculated, capped, source, edited_from), preparer:profiles!mixing_items_prepared_by_fkey(full_name))')
    .eq('id', id).maybeSingle());
  if (!o) throw new Error('طلب المزج غير موجود');
  const p = o.patients, t = o.cycles.treatments;
  const [l, k] = O_STATUS[o.status];
  const mine = can('prepare');
  const reload = () => order(root, params);

  const docs = h('div', { class: 'grid-2' }, [['ملف التعريف', o.idcard], ['الوصفة', o.rx]].map(([label, f]) => {
    const img = h('span', { class: 'ft-img', style: 'height: 110px' }, icon('file', 28, '#8A929C'));
    if (f && isImage(f.file_path)) signedUrl(f.file_path).then((u) => img.replaceChildren(h('img', { src: u, alt: label }))).catch(() => {});
    return h('button', { type: 'button', class: 'file-tile', onclick: () => f && openFile(f.file_path).catch((e) => toast(e.message, true)) }, img, h('span', { class: 'ft-t', text: label }));
  }));

  const items = o.mixing_items.map((it) => {
    const d = it.cycle_doses;
    const box = mine ? h('input', { type: 'checkbox', checked: !!it.prepared_at, disabled: !!it.sent_at, 'aria-label': 'تم تحضير ' + d.drug_name }) : null;
    box?.addEventListener('change', async () => {
      box.disabled = true;
      try { await rpc('mark_prepared', { p_item: it.id, p_prepared: box.checked }); reload(); }
      catch (e) { toast(e.message, true); box.checked = !box.checked; box.disabled = false; }
    });
    const state = it.sent_at ? h('span', { class: 'pill ok', text: 'أُرسل ' + fmtTime(it.sent_at) })
      : it.prepared_at ? h('span', { class: 'pill info', text: 'محضَّر' }) : h('span', { class: 'pill muted', text: 'لم يُحضَّر' });
    return h(mine && !it.sent_at ? 'label' : 'div', { class: 'row mix-item' + (it.prepared_at ? ' done' : ''), style: 'align-items: flex-start' },
      box ? h('span', { class: 'check', style: 'min-height: 0; padding-top: 4px' }, box) : null,
      h('span', { class: 'grow' },
        h('span', { class: 't ltr', style: 'text-align: right; font-size: 17px', text: d.drug_name }),
        h('span', { class: 's', text: `${d.route} (${ROUTE_AR[d.route] || d.route})` }),
        instrLine(d),
        h('span', { class: 's', style: 'font-weight: 600; color: var(--ink-2)', text: [d.diluent ? 'المحلول: ' + d.diluent : 'المحلول: غير محدد', d.infusion_rate ? 'التسريب: ' + d.infusion_rate : null].filter(Boolean).join(' · ') }),
        d.source === 'edited' ? h('span', { class: 'pill info', style: 'align-self: flex-start; margin-top: 4px', text: `عُدّلت من ${num(d.edited_from)}` }) : null,
        it.preparer && it.prepared_at ? h('span', { class: 's', text: `حضّره ${it.preparer.full_name} ${fmtTime(it.prepared_at)}` }) : null),
      h('span', { style: 'display: flex; flex-direction: column; align-items: flex-end; gap: 6px' },
        h('span', { class: 'dose-big' }, h('b', { class: 'ltr', text: num(d.final_dose) }), h('span', { text: OUT_UNITS[d.final_unit] })), state));
  });

  const ready = o.mixing_items.filter((i) => i.prepared_at && !i.sent_at).length;
  const sendBtn = mine && ready ? h('button', { type: 'button', class: 'btn ok block' }, icon('move', 22, '#fff'), `إرسال المحضَّر (${count(ready, 'drug')})`) : null;
  sendBtn?.addEventListener('click', () => busy(sendBtn, async () => {
    const ok = await confirmDialog({ title: 'إرسال إلى ردهة العلاج', body: `يُرسل ${count(ready, 'drug')} ويُبلَّغ الصيادلة السريريون والتمريض. لا يمكن تعديل ما أُرسل.`, okText: 'إرسال' });
    if (!ok) return;
    try { await rpc('send_prepared', { p_order: id }); toast('أُرسلت الأدوية المحضّرة'); reload(); } catch (e) { toast(e.message, true); }
  }));

  mount(root, h('div', { class: 'screen' },
    topbar({ title: p.full_name, sub: `${t.protocol_name} · الدورة ${o.cycles.cycle_no} · اليوم ${o.day}`, back: '#/mixing' }),
    h('main', { class: 'main with-nav' },
      h('div', { class: 'card', style: 'flex-direction: row; justify-content: space-between; align-items: center' },
        h('span', { style: 'display: flex; flex-direction: column; gap: 2px' },
          h('span', { class: 'tag', style: 'align-self: flex-start', text: p.file_no }),
          h('span', { style: 'font-size: 14px; color: var(--muted-2)', text: `حوّله ${o.sender?.full_name || ''} · ${fmtTime(o.transferred_at)}` }),
          h('span', { class: 'ltr', style: 'font-size: 14px; color: var(--muted-2); text-align: right', text: `BSA ${num(t.bsa)} m² · ${num(t.weight_kg)} kg` })),
        h('span', { class: 'pill ' + k, text: l })),
      p.allergies && p.allergies !== NKDA ? notice('err', 'alert', h('p', { style: 'font-weight: 700', text: 'حساسية دوائية: ' + p.allergies })) : null,
      h('section', { class: 'section' }, h('div', { class: 'section-head' }, h('h2', { text: 'المستندات' })), docs,
        h('p', { class: 'hint', text: 'طابق اسم المريض في ملف التعريف والوصفة مع هذا الطلب قبل التحضير.' })),
      h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', { text: 'الأدوية' }), h('span', { class: 'meta', text: mine ? 'ضع علامة على ما حضّرته' : '' })),
        h('div', { class: 'card flush' }, items)),
      sendBtn,
      protocolFileLink(t.protocols?.file_path, 'ملف البروتوكول ' + t.protocol_name),
      can('requestEdit') && o.status !== 'sent' ? h('a', { class: 'btn secondary block', href: '#/cycle-edit?id=' + o.cycles.id }, icon('edit', 22), 'اقتراح تعديل على الطبيب') : null,
      h('a', { class: 'link-btn', href: '#/cycle?id=' + o.cycles.id, text: 'فتح الدورة' })),
    bottomNav('home')));
}
