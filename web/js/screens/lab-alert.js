// شاشة إشعار «تحليل خارج الحد الطبيعي»: المريض باختصار، ثم التحاليل الخارجة وقيمها وشدتها وما يتعلق بها
import { sb, q } from '../api.js';
import { h, mount, icon, topbar, bottomNav, notice, fmtDate, toast, empty } from '../ui.js';
import { flag, ctcae, testKey } from '../labs.js';
import { openFile } from '../files.js';
import { NKDA } from './patient-form.js';

// ?id=<نتيجة تحليل> (الإشعارات الجديدة)، أو ?patient=&at=<وقت الإشعار> (الإشعارات القديمة)
export async function render(root, params) {
  const shell = (...c) => mount(root, h('div', { class: 'screen' },
    topbar({ title: 'تحليل خارج الحد الطبيعي', back: '#/notifications' }), h('main', { class: 'main with-nav' }, ...c), bottomNav('home')));
  const id = params.get('id');
  let anchor = null;
  if (id) anchor = await q(sb.from('lab_results').select('patient_id, created_at, test_date').eq('id', id).maybeSingle());
  else if (params.get('patient')) {
    let x = sb.from('lab_results').select('patient_id, created_at, test_date').eq('patient_id', params.get('patient'));
    if (params.get('at')) x = x.lte('created_at', params.get('at'));
    anchor = (await q(x.order('created_at', { ascending: false }).limit(1)))[0] || null;
  }
  if (!anchor) return shell(h('div', { class: 'card flush' }, empty('لم يُعثر على التحليل', 'file')));
  const pid = anchor.patient_id;
  // نتائج الإدخال الواحد تُحفظ في لحظة واحدة؛ يُسمح بثانيتين لاختلاف دقة الوقت
  const around = (sec) => new Date(new Date(anchor.created_at).getTime() + sec * 1000).toISOString();

  // كل نتائج الإدخال نفسه، والمريض، وخطته، وتاريخ تحاليله السابقة
  const [batch, p, plans, history] = await Promise.all([
    q(sb.from('lab_results').select('*, author:profiles!lab_results_created_by_fkey(full_name), attachments(file_path)')
      .eq('patient_id', pid).eq('test_date', anchor.test_date).gte('created_at', around(-2)).lte('created_at', around(2))),
    q(sb.from('patient_overview').select('*').eq('id', pid).maybeSingle()),
    q(sb.from('treatments').select('id, protocol_name, diagnosis, stage, status, cycles(id, cycle_no, planned_date, status, doctor_approved_at)')
      .eq('patient_id', pid).in('status', ['active', 'pending_approval']).order('created_at', { ascending: false }).limit(1)),
    q(sb.from('lab_results').select('id, test_name, value, unit, test_date, created_at').eq('patient_id', pid)
      .lte('test_date', anchor.test_date).order('test_date', { ascending: false }).order('created_at', { ascending: false }).limit(300)),
  ]);
  if (!p) throw new Error('المريض غير موجود');
  const t = plans[0] || null;
  const out = batch.filter((r) => { const f = flag(r.value, r.ref_low, r.ref_high); return f === 'low' || f === 'high'; });
  const inRange = batch.filter((r) => !out.includes(r));
  const first = batch[0];

  // ----------------------------------------------- المريض باختصار (الاسم والمرض يفتحان الملف كاملاً)
  const fileHref = '#/patient?id=' + pid;
  const head = h('a', { class: 'card', href: fileHref, style: 'text-decoration: none; color: inherit; gap: 4px' },
    h('div', { style: 'display: flex; justify-content: space-between; align-items: center; gap: 8px' },
      h('b', { style: 'font-size: 18px; text-decoration: underline; text-underline-offset: 4px', text: p.full_name }),
      h('span', { class: 'tag', text: p.file_no })),
    h('span', { style: 'font-size: 15px; color: var(--ink-2)', text: t ? (t.diagnosis + (t.stage ? ' · ' + t.stage : '')) : 'لا توجد خطة علاج فعّالة' }),
    t ? h('span', { style: 'display: flex; gap: 6px; align-items: center; flex-wrap: wrap' },
      h('span', { class: 'tag', text: t.protocol_name }),
      t.status === 'pending_approval' ? h('span', { class: 'pill info', text: 'الخطة بانتظار الموافقة' }) : null) : null,
    h('span', { style: 'font-size: 14px; color: var(--brand); font-weight: 600; margin-top: 4px', text: 'عرض الملف كاملاً ›' }));

  // ----------------------------------------------- النتائج الخارجة
  // السابق: تحليل بتاريخ أقدم، أو بالتاريخ نفسه وأُدخل قبل هذا الإدخال
  const batchIds = new Set(batch.map((r) => r.id));
  const earlier = history.filter((x) => !batchIds.has(x.id) && (x.test_date < anchor.test_date || x.created_at < around(-2)));
  const prevOf = (name) => earlier.find((x) => testKey(x.test_name) === testKey(name));
  const resultCard = (r) => {
    const f = flag(r.value, r.ref_low, r.ref_high);
    const g = ctcae(r.test_name, r.value, r.ref_low, r.ref_high);
    const prev = prevOf(r.test_name);
    let trend = null;
    if (prev) {
      const d = Number(r.value) - Number(prev.value);
      const pct = Number(prev.value) ? Math.round((d / Number(prev.value)) * 100) : null;
      trend = `السابق ${prev.value} (${fmtDate(prev.test_date, { day: 'numeric', month: 'short' })})` +
        (d === 0 ? ' · دون تغيّر' : ` · ${d < 0 ? 'انخفض' : 'ارتفع'}${pct !== null ? ' ' + Math.abs(pct) + '%' : ''}`);
    }
    const bound = f === 'low' ? r.ref_low : r.ref_high;
    const gap = bound != null && Number(bound) ? Math.round(Math.abs(Number(r.value) - Number(bound)) / Number(bound) * 100) : null;
    return h('section', { class: 'card lab-alert ' + f },
      h('div', { style: 'display: flex; justify-content: space-between; align-items: flex-start; gap: 10px' },
        h('span', { style: 'display: flex; flex-direction: column; gap: 2px' },
          h('b', { class: 'ltr', style: 'text-align: right; font-size: 18px', text: r.test_name }),
          h('span', { style: 'font-size: 14px; color: var(--muted-2)' }, 'الحد الطبيعي ',
            h('span', { class: 'ltr', style: 'unicode-bidi: isolate', text: `${r.ref_low ?? '—'} – ${r.ref_high ?? '—'} ${r.unit || ''}` }))),
        h('span', { style: 'display: flex; flex-direction: column; align-items: flex-end' },
          h('b', { class: 'ltr', style: 'font-size: 30px; line-height: 1.1; color: var(--brand)', text: String(r.value) }),
          h('span', { class: 'ltr', style: 'font-size: 13px; color: var(--muted-2)', text: r.unit || '' }))),
      h('div', { style: 'display: flex; gap: 6px; flex-wrap: wrap' },
        h('span', { class: 'pill warn', text: (f === 'low' ? '↓ أقل من الحد الطبيعي' : '↑ أعلى من الحد الطبيعي') + (gap ? ` بنحو ${gap}%` : '') }),
        g ? h('span', { class: 'pill ' + (g.grade >= 3 ? 'brand' : 'info'), text: `${g.what}: ${g.label}` }) : null),
      trend ? h('span', { style: 'font-size: 14px; color: var(--ink-2)', text: trend }) : null);
  };

  const next = t ? (t.cycles || []).filter((c) => ['planned', 'held'].includes(c.status)).sort((a, b) => a.cycle_no - b.cycle_no)[0] : null;

  const allergy = p.allergies && p.allergies !== NKDA ? notice('err', 'alert', h('p', { style: 'font-weight: 700', text: 'حساسية دوائية: ' + p.allergies })) : null;
  const imgPath = first?.attachments?.file_path;

  shell(
    head, allergy,
    h('div', { class: 'section-head' }, h('h2', { text: 'التحاليل خارج الحد الطبيعي' }),
      h('span', { class: 'meta', text: first ? `سحب العينة ${fmtDate(first.test_date, { day: 'numeric', month: 'short', year: 'numeric' })}` : '' })),
    out.length ? out.map(resultCard) : h('div', { class: 'card flush' }, empty('كل نتائج هذا الإدخال ضمن الحد الطبيعي', 'check')),
    inRange.length ? h('details', { class: 'card' },
      h('summary', { style: 'font-weight: 700; cursor: pointer', text: `بقية نتائج الإدخال نفسه ضمن الحد الطبيعي (${inRange.length})` }),
      ...inRange.map((r) => h('p', { class: 'ltr', style: 'text-align: right', text: `${r.test_name} ${r.value} ${r.unit || ''}` }))) : null,
    first ? h('p', { class: 'hint', text: `أدخله ${first.author?.full_name || '—'}${first.entry_method === 'ocr' ? ' (مقروء آلياً من الصورة ومُراجَع)' : ''}` }) : null,
    imgPath ? h('button', { type: 'button', class: 'btn secondary block', onclick: () => openFile(imgPath).catch((e) => toast(e.message, true)) }, icon('file', 20), 'فتح صورة التحليل') : null,
    h('a', { class: 'btn secondary block', href: '#/labs?patient=' + pid }, icon('file', 20), 'كل تحاليل المريض ومنحنياتها'),
    next ? h('a', { class: 'btn secondary block', href: '#/cycle?id=' + next.id }, 'فتح الجرعة القادمة') : null);
}
