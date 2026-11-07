// قسم المزج الكيميائي: التحويل من الصيدلي السريري، والطلبات الواردة، والتحضير والإرسال
import { sb, q, rpc } from '../api.js';
import { h, mount, icon, topbar, bottomNav, notice, toast, busy, empty, fmtDate, fmtTime, initials, count, confirmDialog, todayISO } from '../ui.js';
import { can } from '../perms.js';
import { ROUTE_AR, OUT_UNITS, daysList, num, instrLine } from '../dose.js';
import { signedUrl, openFile, isImage } from '../files.js';
import { NKDA } from './patient-form.js';
import { protocolFileLink } from '../files.js';

const O_STATUS = { incoming: ['وارد', 'brand'], in_progress: ['قيد التحضير', 'info'], partially_sent: ['أُرسل جزء', 'warn'], sent: ['أُرسل كاملاً', 'ok'], held: ['معلّق', 'muted'] };
const dueDate = (o) => addDays(o.cycles.planned_date, o.day - 1);
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };

// --------------------------------------------------------------- التحويل اليدوي (أُلغي)
// تصل الدورة إلى المزج تلقائياً بعد اعتماد الطبيب، فيُعاد من يفتح الرابط القديم إلى الدورة
export async function transfer(root, params) {
  const cid = params.get('cycle');
  mount(root, h('div', { class: 'screen' }, topbar({ title: 'التحويل إلى المزج', back: cid ? '#/cycle?id=' + cid : '#/home' }),
    h('main', { class: 'main' }, notice('info', 'info', h('p', { text: 'أُلغي التحويل اليدوي: تصل الدورة إلى قسم المزج تلقائياً فور اعتماد الطبيب.' })),
      cid ? h('a', { class: 'btn secondary block', href: '#/cycle?id=' + cid, text: 'فتح الدورة' }) : null)));
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
  // يُعرض يوم واحد: اليوم افتراضياً، أو غداً، أو أي تاريخ؛ و«المتأخرة» لما فات ولم يُرسل
  const today = todayISO();
  let day = /^\d{4}-\d{2}-\d{2}$/.test(params.get('d') || '') ? params.get('d') : today;
  let tab = params.get('t') || 'open';
  const dayBar = h('div');
  const seg = h('div', { class: 'segmented', role: 'group' });
  const lateBox = h('div');
  const box = h('div', { class: 'card flush' });
  mount(root, h('div', { class: 'screen' },
    topbar({ title: 'قسم المزج الكيميائي', back: '#/home' }),
    h('main', { class: 'main with-nav' }, dayBar, lateBox, seg, box),
    bottomNav('home')));
  if (!can('seeMixing')) return box.replaceChildren(notice('info', 'lock', h('p', { text: 'قسم المزج للصيادلة والأطباء.' })));

  // طلبات الدورات المفتوحة، وطلبات الأيام الماضية القريبة المرسلة؛ ثم يُفرز كل طلب بتاريخ يومه
  const sel = 'id, day, status, hold_reason, transferred_at, patients(full_name, file_no, allergies), cycles!inner(id, cycle_no, planned_date, status, chart_attachment_id, treatments(protocol_name)), mixing_items(id, prepared_at, sent_at)';
  const from = addDays(today, -120);
  const rows = await q(sb.from('mixing_orders').select(sel).gte('cycles.planned_date', from).order('transferred_at'));
  const openCycle = (r) => ['planned', 'held'].includes(r.cycles.status);
  const late = rows.filter((r) => r.status !== 'sent' && openCycle(r) && dueDate(r) < today);

  const setDay = (d) => { day = d; tab = tab === 'late' ? 'open' : tab; sync(); draw(); };
  const sync = () => history.replaceState(null, '', `#/mixing?d=${day}&t=${tab}`);

  function draw() {
    const picked = h('input', { class: 'input', type: 'date', value: day, 'aria-label': 'تاريخ الإعطاء' });
    picked.addEventListener('change', () => picked.value && setDay(picked.value));
    const quick = (d, label) => h('button', { type: 'button', 'aria-pressed': tab !== 'late' && day === d ? 'true' : 'false', onclick: () => setDay(d), text: label });
    dayBar.replaceChildren(h('div', { class: 'card', style: 'gap: 10px' },
      h('div', { class: 'segmented', role: 'group', 'aria-label': 'اليوم' }, quick(today, 'اليوم'), quick(addDays(today, 1), 'غداً')),
      h('label', { class: 'field', style: 'margin: 0' }, h('span', { class: 'label', text: 'أو اختر تاريخاً' }), picked),
      h('p', { style: 'font-weight: 700', text: tab === 'late' ? 'طلبات أيام سابقة لم تُرسل' : 'جرعات ' + fmtDate(day, { weekday: 'long', day: 'numeric', month: 'long' }) })));

    lateBox.replaceChildren(late.length && tab !== 'late'
      ? h('button', { type: 'button', class: 'notice warn', style: 'border: 0; width: 100%; text-align: right; align-items: center', onclick: () => { tab = 'late'; sync(); draw(); } },
          icon('warn', 22), h('span', { style: 'flex: 1; font-weight: 600', text: `${late.length} طلب من أيام سابقة لم يُرسل` }), h('b', { text: 'عرض' }))
      : null);

    const ofDay = rows.filter((r) => dueDate(r) === day);
    const groups = {
      open: ofDay.filter((r) => r.status !== 'sent' && openCycle(r)),
      sent: ofDay.filter((r) => r.status === 'sent'),
      late,
    };
    const tabs = tab === 'late' ? [['late', 'المتأخرة']] : [['open', 'للتحضير'], ['sent', 'أُرسلت']];
    seg.replaceChildren(...tabs.map(([id, label]) => h('button', {
      type: 'button', 'aria-pressed': tab === id ? 'true' : 'false',
      onclick: () => { tab = id; sync(); draw(); },
    }, label, groups[id].length ? h('span', { class: 'count', style: 'margin-right: 6px', text: groups[id].length }) : null)));
    const list = groups[tab] || [];
    box.replaceChildren(...(list.length ? list.map(orderRow)
      : [empty(tab === 'sent' ? 'لم يُرسل شيء لهذا اليوم' : 'لا توجد جرعات للتحضير في هذا اليوم', 'check')]));
  }
  sync(); draw();
}

function orderRow(o) {
  const [l, k] = O_STATUS[o.status];
  const prep = o.mixing_items.filter((i) => i.prepared_at).length;
  const hasAllergy = o.patients.allergies && o.patients.allergies !== NKDA;
  return h('div', { class: 'row', style: 'flex-wrap: wrap' },
    h('a', { href: '#/mixing-order?id=' + o.id, style: 'display: flex; gap: 12px; align-items: center; flex: 1; min-width: 0; text-decoration: none; color: inherit' },
      h('span', { class: 'avatar', text: initials(o.patients.full_name) }),
      h('span', { class: 'grow' },
        h('span', { class: 't', style: 'display: flex; gap: 6px; align-items: center' }, h('span', { text: o.patients.full_name }),
          hasAllergy ? h('span', { style: 'color: var(--brand); display: flex', title: 'حساسية' }, icon('alert', 16, 'currentColor', 2.2)) : null),
        h('span', { class: 's', style: 'display: flex; gap: 6px; flex-wrap: wrap; align-items: center' },
          h('span', { class: 'tag', text: o.cycles.treatments.protocol_name }), h('span', { text: `الدورة ${o.cycles.cycle_no} · اليوم ${o.day}` })),
        h('span', { class: 's', text: o.status === 'held' ? (o.hold_reason || 'معلّق')
          : `${fmtDate(dueDate(o), { weekday: 'short', day: 'numeric', month: 'short' })} · ${prep} من ${count(o.mixing_items.length, 'drug')} محضَّرة${o.cycles.chart_attachment_id ? ' · وصلت صورة الطبلة' : ''}` })),
      h('span', { class: 'pill ' + k, text: l })),
    h('a', { class: 'link-btn', style: 'flex-basis: 100%; text-align: start; padding-inline-start: 56px; font-size: 14px',
      href: '#/cycle?id=' + o.cycles.id, text: 'البروتوكول كاملاً للمريض ›' }));
}

// --------------------------------------------------------------- طلب مزج واحد
export async function order(root, params) {
  const id = params.get('id');
  const o = await q(sb.from('mixing_orders')
    .select('*, sender:profiles(full_name), patients(id, full_name, file_no, allergies, weight_kg), cycles(id, cycle_no, planned_date, chart_at, chart:attachments!cycles_chart_attachment_id_fkey(file_path), charter:profiles!cycles_chart_by_fkey(full_name), treatments(protocol_name, bsa, weight_kg, protocols(file_path))), idcard:attachments!mixing_orders_id_card_attachment_id_fkey(file_path), rx:attachments!mixing_orders_prescription_attachment_id_fkey(file_path), mixing_items(id, prepared_at, sent_at, cycle_doses(drug_name, final_dose, final_unit, route, diluent, infusion_rate, instructions, dose_value, dose_unit, calculated, capped, source, edited_from, archived_at), preparer:profiles!mixing_items_prepared_by_fkey(full_name))')
    .eq('id', id).maybeSingle());
  if (!o) throw new Error('طلب المزج غير موجود');
  const p = o.patients, t = o.cycles.treatments;
  const [l, k] = O_STATUS[o.status];
  const held = o.status === 'held';
  const mine = can('prepare') && !held;
  const reload = () => order(root, params);

  // صورة الطبلة من الصيدلي للتحقق (والهوية والوصفة في الطلبات القديمة فقط)
  const chart = o.cycles.chart;
  const docList = [['صورة الطبلة', chart]];
  if (o.idcard) docList.push(['ملف التعريف', o.idcard]);
  if (o.rx) docList.push(['الوصفة', o.rx]);
  const docs = h('div', { class: 'grid-2' }, docList.map(([label, f]) => {
    const img = h('span', { class: 'ft-img', style: 'height: 110px' }, icon('file', 28, '#8A929C'));
    if (f && isImage(f.file_path)) signedUrl(f.file_path).then((u) => img.replaceChildren(h('img', { src: u, alt: label }))).catch(() => {});
    return h('button', { type: 'button', class: 'file-tile', disabled: !f, onclick: () => f && openFile(f.file_path).catch((e) => toast(e.message, true)) },
      img, h('span', { class: 'ft-t', text: f ? label : label + ': لم تصل بعد' }));
  }));

  const items = o.mixing_items.filter((it) => !it.cycle_doses.archived_at || it.sent_at).map((it) => {
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
    topbar({ title: p.full_name, sub: `${t.protocol_name} · الدورة ${o.cycles.cycle_no} · اليوم ${o.day}`, back: '#/mixing?d=' + dueDate(o) }),
    h('main', { class: 'main with-nav' },
      h('div', { class: 'card', style: 'flex-direction: row; justify-content: space-between; align-items: center' },
        h('span', { style: 'display: flex; flex-direction: column; gap: 2px' },
          h('span', { class: 'tag', style: 'align-self: flex-start', text: p.file_no }),
          h('span', { style: 'font-size: 14px; color: var(--muted-2)', text: `الموعد ${fmtDate(addDays(o.cycles.planned_date, o.day - 1), { weekday: 'long', day: 'numeric', month: 'long' })} · اعتمدها ${o.sender?.full_name || ''}` }),
          h('span', { class: 'ltr', style: 'font-size: 14px; color: var(--muted-2); text-align: right', text: `BSA ${num(t.bsa)} m² · ${num(t.weight_kg)} kg` })),
        h('span', { class: 'pill ' + k, text: l })),
      p.allergies && p.allergies !== NKDA ? notice('err', 'alert', h('p', { style: 'font-weight: 700', text: 'حساسية دوائية: ' + p.allergies })) : null,
      held ? notice('warn', 'lock', h('p', { style: 'font-weight: 700', text: 'الطلب معلّق: ' + (o.hold_reason || 'بانتظار الطبيب') }),
        h('p', { text: 'لا يُحضَّر ولا يُرسل شيء حتى يعيد الطبيب اعتماد الدورة.' })) : null,
      h('section', { class: 'section' }, h('div', { class: 'section-head' }, h('h2', { text: 'التحقق' })), docs,
        h('p', { class: 'hint', text: chart ? 'طابق الدورة في صورة الطبلة مع الأدوية والجرعات أدناه.' : 'تصلك صورة الطبلة من الصيدلي السريري للتحقق. لا تنتظرها لتبدأ التحضير.' })),
      h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', { text: 'الأدوية' }), h('span', { class: 'meta', text: mine ? 'ضع علامة على ما حضّرته' : '' })),
        h('div', { class: 'card flush' }, items)),
      sendBtn,
      protocolFileLink(t.protocols?.file_path, 'ملف البروتوكول ' + t.protocol_name),
      can('requestEdit') && o.status !== 'sent' ? h('a', { class: 'btn secondary block', href: '#/cycle-edit?id=' + o.cycles.id }, icon('edit', 22), 'اقتراح تعديل على الطبيب') : null,
      h('a', { class: 'btn secondary block', href: '#/cycle?id=' + o.cycles.id }, icon('file', 20), 'البروتوكول كاملاً للمريض (كل أيام الدورة)')),
    bottomNav('home')));
}
