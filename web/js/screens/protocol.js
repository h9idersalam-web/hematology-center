// تفاصيل بروتوكول: الأدوية وجرعاتها وأيامها، ومثال حساب، والاعتماد والأرشفة
import { sb, q, rpc } from '../api.js';
import { h, mount, icon, topbar, bottomNav, notice, fmtDate, toast, confirmDialog, count, busy } from '../ui.js';
import { go } from '../app.js';
import { can } from '../perms.js';
import { ROUTE_AR, OUT_UNITS, calcDose, daysText, num } from '../dose.js';
import { uploadProtocolFile, protocolFileLink, checkFile } from '../files.js';
import { state } from '../app.js';

const KIND = { iv: 'وريدي', oral: 'فموي', mixed: 'مختلط (وريدي وفموي)' };
const EX = { bsa: 1.8, weight: 70 };

export async function render(root, params) {
  const id = params.get('id');
  const p = await q(sb.from('protocols')
    .select('*, approver:profiles!protocols_approved_by_fkey(full_name), author:profiles!protocols_created_by_fkey(full_name), protocol_drugs(*)')
    .eq('id', id).maybeSingle());
  if (!p) throw new Error('البروتوكول غير موجود');
  const drugs = [...p.protocol_drugs].sort((a, b) => a.sort - b.sort);

  let status;
  if (p.archived_at) status = notice('dark', 'archive', h('p', { text: `مؤرشف منذ ${fmtDate(p.archived_at)}. لا يُستخدم لخطط جديدة، وتبقى الخطط القائمة كما هي.` }));
  else if (p.approved_at) status = notice('ok', 'check', h('p', { text: `اعتمده ${p.approver?.full_name || 'طبيب اختصاص'} في ${fmtDate(p.approved_at)}` }));
  else status = notice('warn', 'warn',
    h('p', { style: 'font-weight: 700', text: 'غير معتمد: لا يُستخدم لأي مريض قبل اعتماده' }),
    h('p', { text: can('approveProtocol')
      ? 'طابق الأدوية والجرعات والأيام والسقوف مع بروتوكول المركز أو مرجع موثوق (eviQ أو BC Cancer) قبل الاعتماد.'
      : 'أُرسل إشعار لأطباء الاختصاص لمراجعته واعتماده.' }));

  const approveBtn = can('approveProtocol') && !p.approved_at && !p.archived_at
    ? h('button', { class: 'btn ok block', type: 'button' }, icon('check', 22, '#fff', 2.2), 'اعتماد البروتوكول') : null;
  approveBtn?.addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'اعتماد ' + p.name, body: 'باعتماده تؤكد أنك راجعت كل دواء وجرعته وأيامه وسقفه، ويصبح متاحاً لإنشاء خطط العلاج.', okText: 'اعتماد' });
    if (!ok) return;
    busy(approveBtn, async () => {
      try { await rpc('approve_protocol', { p_id: p.id }); toast('اعتُمد البروتوكول'); go('/protocol?id=' + p.id); }
      catch (e) { toast(e.message, true); }
    });
  });
  const archiveBtn = can('approveProtocol') && !p.archived_at
    ? h('button', { class: 'btn danger block', type: 'button', onclick: async () => {
        const ok = await confirmDialog({ title: 'أرشفة ' + p.name, body: 'لن يظهر في قائمة اختيار البروتوكول للخطط الجديدة. الخطط القائمة لا تتأثر.', okText: 'أرشفة', danger: true });
        if (!ok) return;
        try { await rpc('archive_protocol', { p_id: p.id }); toast('أُرشف البروتوكول'); go('/protocol?id=' + p.id); }
        catch (e) { toast(e.message, true); }
      } }, icon('archive', 22), 'أرشفة') : null;

  mount(root, h('div', { class: 'screen' },
    topbar({ title: p.name, sub: p.disease, back: '#/protocols' }),
    h('main', { class: 'main with-nav' },
      status,
      h('section', { class: 'card' },
        h('div', { class: 'facts' },
          h('div', { class: 'fact' }, h('span', { class: 'l', text: 'نوع العلاج' }), h('span', { class: 'v', text: KIND[p.kind] })),
          h('div', { class: 'fact' }, h('span', { class: 'l', text: 'طول الدورة' }), h('span', { class: 'v', text: count(p.cycle_length_days, 'day') })),
          h('div', { class: 'fact' }, h('span', { class: 'l', text: 'عدد الدورات' }), h('span', { class: 'v', text: String(p.total_cycles) })),
          h('div', { class: 'fact' }, h('span', { class: 'l', text: 'أضافه' }), h('span', { class: 'v', text: p.author?.full_name || 'المكتبة الأولية' }))),
        p.notes ? h('div', { class: 'notice info' }, icon('info', 20), h('p', { text: p.notes })) : null),
      fileSection(p, () => render(root, params)),
      h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', { text: 'الأدوية' }), h('span', { class: 'meta', text: count(drugs.length, 'drug') })),
        h('div', { class: 'card flush' }, drugs.map(drugRow)),
        h('p', { class: 'hint', text: `عمود «مثال» محسوب لمريض مساحة جسمه ${EX.bsa} م² ووزنه ${EX.weight} كغ، للتوضيح فقط.` })),
      approveBtn, archiveBtn),
    bottomNav('protocols')));
}

function fileSection(p, reload) {
  const isSpecialist = state.profile.role === 'specialist';
  const canAttach = can('createProtocol') && !p.archived_at && (!p.file_path || !p.approved_at || isSpecialist);
  const status = h('p', { class: 'hint', 'aria-live': 'polite' });
  let input = null, picker = null;
  if (canAttach) {
    input = h('input', { type: 'file', accept: 'application/pdf,image/*', class: 'sr-only', id: 'proto-file' });
    picker = h('label', { for: 'proto-file', class: 'btn ' + (p.file_path ? 'link-btn' : 'secondary block'), style: p.file_path ? 'align-self: center' : null },
      icon(p.file_path ? 'refresh' : 'share', 20), p.file_path ? 'استبدال الملف' : 'إرفاق ملف البروتوكول (PDF أو صورة)');
    input.addEventListener('change', async () => {
      const f = input.files[0]; if (!f) return;
      const bad = checkFile(f); if (bad) { status.textContent = bad; return; }
      status.textContent = 'جارٍ الرفع…';
      try {
        await uploadProtocolFile(p.id, f);
        toast(isSpecialist ? 'أُرفق الملف' : 'أُرفق الملف وأُبلغ أطباء الاختصاص لمراجعته');
        reload();
      } catch (e) { status.textContent = e.message; }
    });
  }
  return h('section', { class: 'section' },
    h('div', { class: 'section-head' }, h('h2', { text: 'الملف المرجعي' })),
    p.file_path ? protocolFileLink(p.file_path, 'فتح ملف البروتوكول')
      : notice('warn', 'file', h('p', { text: 'لم يُرفق ملف البروتوكول المعتمد في المركز بعد. إرفاقه يتيح لكل من يعتمد أو يتحقق أو يحضّر الجرعات أن يطابق مع المصدر نفسه.' })),
    input, picker, status,
    p.file_path && p.approved_at && !isSpecialist && can('createProtocol')
      ? h('p', { class: 'hint', text: 'استبدال ملف بروتوكول معتمد لطبيب الاختصاص فقط.' }) : null);
}

function drugRow(d) {
  const ex = calcDose(Number(d.dose_value), d.dose_unit, EX.bsa, EX.weight, d.max_dose);
  return h('div', { class: 'row', style: 'align-items: flex-start' },
    h('span', { class: 'grow' },
      h('span', { class: 't ltr', style: 'text-align: right', text: d.drug_name }),
      h('span', { class: 's', style: 'display: flex; gap: 6px; flex-wrap: wrap; align-items: center' },
        h('span', { class: 'tag', text: `${num(d.dose_value)} ${d.dose_unit}` }),
        h('span', { text: `${d.route} (${ROUTE_AR[d.route] || d.route})` }),
        h('span', { text: '· ' + daysText(d.days) })),
      h('span', { class: 's', style: 'display: flex; gap: 6px; flex-wrap: wrap' },
        d.max_dose ? h('span', { class: 'pill warn', text: `سقف ${num(d.max_dose)} ${OUT_UNITS[ex.finalUnit]}` }) : null,
        h('span', { class: 'pill ' + (d.is_mixed ? 'info' : 'muted'), text: d.is_mixed ? 'يُحضَّر في المزج' : 'لا يحتاج مزجاً' }))),
    h('span', { style: 'display: flex; flex-direction: column; align-items: flex-end; gap: 2px; flex-shrink: 0' },
      h('span', { style: 'font-size: 12px; color: var(--muted-2)', text: 'مثال' }),
      h('b', { class: 'ltr', style: 'font-size: 16px', text: `${num(ex.final)} ${ex.finalUnit}` }),
      ex.capped ? h('span', { style: 'font-size: 12px; color: var(--warn)', text: 'بالسقف' }) : null));
}
