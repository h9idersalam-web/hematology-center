// تفاصيل بروتوكول: الأدوية وجرعاتها وأيامها، ومثال حساب، والاعتماد والأرشفة
import { sb, q, rpc } from '../api.js';
import { h, mount, icon, topbar, bottomNav, notice, fmtDate, toast, confirmDialog, count, busy, field, PHASES } from '../ui.js';
import { go } from '../app.js';
import { can } from '../perms.js';
import { ROUTE_AR, OUT_UNITS, calcDose, daysText, num, instrLine, withCycles } from '../dose.js';
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
      ? 'طابق الأدوية والجرعات الدوائية والأيام والسقوف مع بروتوكول المركز أو مرجع موثوق (eviQ أو BC Cancer) قبل الاعتماد.'
      : 'أُرسل إشعار لأطباء الاختصاص لمراجعته واعتماده.' }));

  const approveBtn = can('approveProtocol') && !p.approved_at && !p.archived_at
    ? h('button', { class: 'btn ok block', type: 'button' }, icon('check', 22, '#fff', 2.2), 'اعتماد البروتوكول') : null;
  approveBtn?.addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'اعتماد ' + p.name, body: 'باعتماده تؤكد أنك راجعت كل دواء وجرعته الدوائية وأيامه وسقفه، ويصبح متاحاً لإنشاء خطط العلاج.', okText: 'اعتماد' });
    if (!ok) return;
    busy(approveBtn, async () => {
      try { await rpc('approve_protocol', { p_id: p.id }); toast('اعتُمد البروتوكول'); go('/protocol?id=' + p.id); }
      catch (e) { toast(e.message, true); }
    });
  });
  const archiveBtn = can('manageProtocol') && !p.archived_at
    ? h('button', { class: 'btn danger block', type: 'button', onclick: async () => {
        const ok = await confirmDialog({ title: 'أرشفة ' + p.name, body: 'لن يظهر في قائمة اختيار البروتوكول للخطط الجديدة. الخطط القائمة لا تتأثر.', okText: 'أرشفة', danger: true });
        if (!ok) return;
        try { await rpc('archive_protocol', { p_id: p.id }); toast('أُرشف البروتوكول'); go('/protocol?id=' + p.id); }
        catch (e) { toast(e.message, true); }
      } }, icon('archive', 22), 'أرشفة') : null;

  // مدير البرنامج يعيد البروتوكول المؤرشف بالخطأ إلى «غير معتمد» (الملف 35)، ثم يعتمده طبيب الاختصاص من جديد
  const restoreBtn = p.archived_at && state.profile.is_admin
    ? h('button', { class: 'btn secondary block', type: 'button', onclick: async (e) => {
        const btn = e.currentTarget;
        const ok = await confirmDialog({ title: 'إعادة ' + p.name, body: 'يخرج من الأرشيف ويعود «غير معتمد» في قائمة «بانتظار الاعتماد». لا يُستخدم لأي مريض حتى يُعتمد من جديد.', okText: 'إعادة إلى غير معتمد' });
        if (!ok) return;
        busy(btn, async () => {
          try { await rpc('restore_protocol', { p_id: p.id }); toast('أُعيد البروتوكول إلى غير معتمد'); go('/protocol?id=' + p.id + '&r=' + Date.now()); }
          catch (x) { toast(x.message, true); }
        });
      } }, icon('refresh', 22), 'إعادة إلى غير معتمد') : null;

  // مدير البرنامج يحذف البروتوكول نهائياً (الملف 37): يُرفض إن استُخدم في خطة علاج، ويُحفظ نصه في سجل التعديلات
  const deleteBtn = state.profile.is_admin
    ? h('button', { class: 'link-btn', type: 'button', style: 'color: var(--brand-dark); align-self: center', onclick: async (e) => {
        const btn = e.currentTarget;
        const reason = await confirmDialog({ title: 'حذف ' + p.name + ' نهائياً', danger: true, okText: 'حذف نهائي',
          body: 'يختفي البروتوكول من التطبيق كله، حتى من المؤرشفة، ولا يمكن التراجع من التطبيق. يُحفظ نصه في سجل التعديلات فقط. لا يُحذف إن استُخدم في أي خطة علاج.',
          input: { label: 'سبب الحذف', placeholder: 'مثال: أُضيف بالخطأ، نسخة مكررة' } });
        if (reason === null) return;
        if (!reason.trim()) return toast('اكتب سبب الحذف', true);
        busy(btn, async () => {
          try {
            await rpc('admin_delete_protocol', { p_id: p.id, p_reason: reason });
            // ملفاته في التخزين (كل نسخه في protocols/<id>/) تُحذف أيضاً حتى لا تشغل مساحة
            let filesNote = '';
            try {
              const dir = 'protocols/' + p.id;
              const { data: list } = await sb.storage.from('patient-files').list(dir, { limit: 100 });
              const paths = [...new Set([...(list || []).map((f) => dir + '/' + f.name), p.file_path].filter(Boolean))];
              if (paths.length) { const { error } = await sb.storage.from('patient-files').remove(paths); if (error) throw error; }
            } catch { filesNote = '، وتعذّر حذف ملفه من التخزين'; }
            toast('حُذف البروتوكول نهائياً' + filesNote, !!filesNote); go('/protocols' + (p.archived_at ? '?t=archived' : ''));
          }
          catch (x) { toast(x.message, true); }
        });
      } }, icon('trash', 20), 'حذف البروتوكول نهائياً') : null;

  mount(root, h('div', { class: 'screen' },
    topbar({ title: p.name, sub: p.disease, back: '#/protocols' }),
    h('main', { class: 'main with-nav' },
      status,
      h('section', { class: 'card' },
        h('div', { class: 'facts' },
          h('div', { class: 'fact' }, h('span', { class: 'l', text: 'نوع العلاج' }), h('span', { class: 'v', text: KIND[p.kind] })),
          h('div', { class: 'fact' }, h('span', { class: 'l', text: 'المدة بين الـCycles' }), h('span', { class: 'v', text: count(p.cycle_length_days, 'day') })),
          h('div', { class: 'fact' }, h('span', { class: 'l', text: 'عدد الـCycles' }), h('span', { class: 'v', text: String(p.total_cycles) })),
          h('div', { class: 'fact' }, h('span', { class: 'l', text: 'أضافه' }), h('span', { class: 'v', text: p.author?.full_name || 'المكتبة الأولية' })),
          h('div', { class: 'fact wide' }, h('span', { class: 'l', text: 'المرحلة' }),
            h('span', { class: 'v', style: 'display: flex; gap: 8px; align-items: center; justify-content: space-between' },
              h('span', { class: 'ltr', text: p.regimen ? `${p.regimen} · Phase ${p.phase_order}${p.phase ? ' · ' + PHASES[p.phase] : ''}` : (p.phase ? PHASES[p.phase] : 'بروتوكول مستقل') }),
              can('manageProtocol') ? h('button', { type: 'button', class: 'icon-btn boxed', 'aria-label': 'تعديل المرحلة', title: 'تعديل المرحلة', onclick: () => phaseDialog(p, () => render(root, params)) }, icon('edit', 20)) : null))),
        p.notes ? h('div', { class: 'notice info' }, icon('info', 20), h('p', { text: p.notes })) : null),
      fileSection(p, () => render(root, params)),
      h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', { text: 'الأدوية' }), h('span', { class: 'meta', text: count(drugs.length, 'drug') })),
        h('div', { class: 'card flush' }, drugs.map(drugRow)),
        h('p', { class: 'hint', text: `عمود «مثال» محسوب لمريض مساحة جسمه ${EX.bsa} م² ووزنه ${EX.weight} كغ، للتوضيح فقط.` })),
      approveBtn, archiveBtn, restoreBtn, deleteBtn),
    bottomNav('protocols')));
}

function fileSection(p, reload) {
  const isSpecialist = state.profile.role === 'specialist' || (state.profile.role === 'chief_clinical_pharmacist' && !state.profile.acting);   // من يعتمد البروتوكول (الملفان 38 و39)
  // استبدال ملف بروتوكول معتمد: طبيب الاختصاص ومسؤول الصيادلة ومدير البرنامج
  const manager = can('manageProtocol');
  const canAttach = (can('createProtocol') || manager) && !p.archived_at && (!p.file_path || !p.approved_at || manager);
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
      : notice('warn', 'file', h('p', { text: 'لم يُرفق ملف البروتوكول المعتمد في المركز بعد. إرفاقه يتيح لكل من يعتمد أو يتحقق أو يحضّر الجرعات الدوائية أن يطابق مع المصدر نفسه.' })),
    input, picker, status,
    p.file_path && p.approved_at && !manager && can('createProtocol')
      ? h('p', { class: 'hint', text: 'استبدال ملف بروتوكول معتمد لطبيب الاختصاص ومسؤول الصيادلة ومدير البرنامج.' }) : null);
}

function drugRow(d) {
  const ex = calcDose(Number(d.dose_value), d.dose_unit, EX.bsa, EX.weight, d.max_dose);
  return h('div', { class: 'row', style: 'align-items: flex-start' },
    h('span', { class: 'grow' },
      h('span', { class: 't ltr', style: 'text-align: right', text: d.drug_name }),
      h('span', { class: 's', style: 'display: flex; gap: 6px; flex-wrap: wrap; align-items: center' },
        h('span', { class: 'tag', text: `${num(d.dose_value)} ${d.dose_unit}` }),
        h('span', { text: `${d.route} (${ROUTE_AR[d.route] || d.route})` }),
        h('span', { text: '· ' + daysText(d.days) + withCycles(d) })),
      instrLine(d),
      h('span', { class: 's', style: 'display: flex; gap: 6px; flex-wrap: wrap' },
        d.max_dose ? h('span', { class: 'pill warn', text: `سقف ${num(d.max_dose)} ${OUT_UNITS[ex.finalUnit]}` }) : null,
        h('span', { class: 'pill ' + (d.is_mixed ? 'info' : 'muted'), text: d.is_mixed ? 'يُحضَّر في المزج' : 'لا يحتاج مزجاً' }))),
    h('span', { style: 'display: flex; flex-direction: column; align-items: flex-end; gap: 2px; flex-shrink: 0' },
      h('span', { style: 'font-size: 12px; color: var(--muted-2)', text: 'مثال' }),
      h('b', { class: 'ltr', style: 'font-size: 16px', text: `${num(ex.final)} ${ex.finalUnit}` }),
      ex.capped ? h('span', { style: 'font-size: 12px; color: var(--warn)', text: 'بالسقف' }) : null));
}

// المجموعة والمرحلة وترتيبها (الملف 44): لطبيب الاختصاص ومسؤول الصيادلة ومدير البرنامج
function phaseDialog(p, done) {
  const dlg = h('dialog', null);
  const close = () => { dlg.close(); dlg.remove(); };
  const reg = h('input', { class: 'input ltr', style: 'text-align: right', maxlength: 60, value: p.regimen || '', placeholder: 'UKALL14' });
  const ph = h('select', { class: 'input ltr', style: 'text-align: right' }, h('option', { value: '', text: '—' }),
    Object.entries(PHASES).map(([k, v]) => h('option', { value: k, selected: k === p.phase, text: v })));
  const ord = h('input', { class: 'input ltr', type: 'number', min: 1, max: 50, value: p.phase_order || '', style: 'text-align: right' });
  const err = h('div');
  const save = h('button', { type: 'button', class: 'btn primary block', text: 'حفظ' });
  save.addEventListener('click', () => busy(save, async () => {
    try { await rpc('set_protocol_phase', { p_id: p.id, p_regimen: reg.value, p_phase: ph.value || null, p_order: ord.value ? Number(ord.value) : null }); close(); toast('حُفظت المرحلة'); done(); }
    catch (x) { err.replaceChildren(notice('err', 'warn', h('p', { text: x.message }))); }
  }));
  dlg.append(h('div', { class: 'dlg' }, h('h2', { text: 'المرحلة' }),
    h('p', { class: 'hint', text: 'بروتوكولات المجموعة الواحدة (مثل UKALL14) تُرتَّب بالرقم، وبعد انتهاء مرحلة يظهر في ملف المريض زر للانتقال إلى التالية. رقمان متساويان = بديلان للمرحلة نفسها.' }),
    field('المجموعة (اتركها فارغة لبروتوكول مستقل)', reg), field('نوع المرحلة', ph), field('ترتيبها في المجموعة', ord), err, save,
    h('button', { type: 'button', class: 'link-btn', text: 'إلغاء', onclick: close })));
  document.body.append(dlg); dlg.addEventListener('cancel', close); dlg.showModal();
}
