// المرفقات: رفع ملف جديد، وقائمة ملفات المريض
import { sb, q } from '../api.js';
import { h, mount, icon, topbar, bottomNav, field, notice, toast, busy, empty, fmtDate, todayISO } from '../ui.js';
import { go } from '../app.js';
import { can } from '../perms.js';
import { KINDS, uploadAttachment, openFile, signedUrl, isImage, checkFile } from '../files.js';

// --------------------------------------------------------------- رفع ملف
export async function upload(root, params) {
  const pid = params.get('patient');
  const back = params.get('back') || '#/patient?id=' + pid;
  let kind = params.get('kind') || 'lab';
  const p = await q(sb.from('patients').select('id, full_name, file_no, archived_at').eq('id', pid).maybeSingle());
  if (!p) throw new Error('المريض غير موجود');
  const shell = (...c) => mount(root, h('div', { class: 'screen' }, topbar({ title: 'رفع مرفق', sub: p.full_name, back }), h('main', { class: 'main' }, ...c)));
  if (!can('upload')) return shell(notice('info', 'lock', h('p', { text: 'رفع الملفات لكل الأدوار عدا الطبيب الدوري.' })));
  if (p.archived_at) return shell(notice('warn', 'archive', h('p', { text: 'ملف المريض مؤرشف.' })));

  const kinds = h('div', { class: 'grid-3', role: 'radiogroup', 'aria-label': 'نوع المرفق' });
  const drawKinds = () => kinds.replaceChildren(...Object.entries(KINDS).map(([k, [label]]) =>
    h('button', { type: 'button', class: 'choice', style: 'font-size: 14px; min-height: 48px', 'aria-pressed': kind === k ? 'true' : 'false', text: label, onclick: () => { kind = k; drawKinds(); } })));
  drawKinds();

  const input = h('input', { type: 'file', accept: 'image/*,application/pdf', class: 'sr-only', id: 'up-file' });
  const pick = h('label', { for: 'up-file', class: 'drop' }, icon('share', 30), h('b', { text: 'التقط صورة أو اختر ملفاً' }), h('span', { text: 'صورة أو PDF حتى 10 ميغابايت' }));
  const previewBox = h('div');
  const title = h('input', { class: 'input', placeholder: 'مثال: تعداد دم كامل، وصفة الجرعة 3', maxlength: 120 });
  const date = h('input', { class: 'input', type: 'date', value: todayISO(), max: todayISO() });
  const err = h('div');
  const submit = h('button', { class: 'btn primary block', type: 'button', text: 'رفع وحفظ في ملف المريض' });

  input.addEventListener('change', () => {
    const f = input.files[0];
    err.replaceChildren();
    if (!f) return previewBox.replaceChildren();
    const bad = checkFile(f);
    if (bad) { err.replaceChildren(notice('err', 'warn', h('p', { text: bad }))); return; }
    const url = URL.createObjectURL(f);
    previewBox.replaceChildren(h('div', { class: 'card', style: 'flex-direction: row; align-items: center' },
      /^image\/(jpeg|png|webp)/.test(f.type) ? h('img', { src: url, alt: '', class: 'thumb' }) : h('span', { class: 'thumb icon' }, icon('file', 28)),
      h('span', { style: 'display: flex; flex-direction: column; min-width: 0' }, h('b', { class: 'ltr', style: 'text-align: right; overflow-wrap: anywhere', text: f.name }),
        h('span', { style: 'font-size: 13px; color: var(--muted-2)', text: (f.size / 1024 / 1024).toFixed(1) + ' ميغابايت' }))));
  });

  submit.addEventListener('click', () => busy(submit, async () => {
    err.replaceChildren();
    try {
      const id = await uploadAttachment(pid, input.files[0], { kind, title: title.value.trim(), takenOn: date.value });
      toast('حُفظ المرفق في ملف المريض');
      const next = params.get('next');
      if (next) go(next.replace('{id}', id).replace(/^#/, ''));
      else if (kind === 'lab') go(`/labs-new?patient=${pid}&attachment=${id}`);
      else go('/files?patient=' + pid);
    } catch (e) { err.replaceChildren(notice('err', 'warn', h('p', { text: e.message }))); }
  }));

  shell(
    h('div', { class: 'card' }, h('h2', { text: 'نوع المرفق' }), kinds),
    input, pick, previewBox,
    h('div', { class: 'card' }, field('العنوان (اختياري)', title), field('تاريخ التحليل أو الوثيقة', date)),
    kind === 'lab' ? h('p', { class: 'hint', text: 'بعد رفع صورة التحليل تنتقل لإدخال قيمه، ليظهر في المنحنيات وينبّه الطبيب إذا خرج عن المرجع.' }) : null,
    err, submit);
}

// --------------------------------------------------------------- قائمة الملفات
export async function list(root, params) {
  const pid = params.get('patient');
  const [p, files] = await Promise.all([
    q(sb.from('patients').select('id, full_name, archived_at').eq('id', pid).maybeSingle()),
    q(sb.from('attachments').select('id, kind, title, file_path, taken_on, created_at, author:profiles(full_name)').eq('patient_id', pid).order('created_at', { ascending: false })),
  ]);
  if (!p) throw new Error('المريض غير موجود');
  const add = can('upload') && !p.archived_at
    ? h('a', { class: 'icon-btn boxed', href: '#/upload?patient=' + pid, 'aria-label': 'رفع مرفق', style: 'color: var(--brand)' }, icon('plus', 24, 'currentColor', 2.2)) : null;
  const grid = h('div', { class: 'files-grid' });
  mount(root, h('div', { class: 'screen' },
    topbar({ title: 'المرفقات', sub: p.full_name, back: '#/patient?id=' + pid, actions: add }),
    h('main', { class: 'main with-nav' }, files.length ? grid : h('div', { class: 'card flush' }, empty('لا توجد مرفقات بعد', 'file'))),
    bottomNav('patients')));
  grid.replaceChildren(...files.map(fileTile));
}

export function fileTile(f) {
  const [label, ic] = KINDS[f.kind] || KINDS.other;
  const img = h('span', { class: 'ft-img' }, icon(ic, 28, '#8A929C'));
  if (isImage(f.file_path)) signedUrl(f.file_path).then((u) => img.replaceChildren(h('img', { src: u, alt: '', loading: 'lazy' }))).catch(() => {});
  return h('button', { type: 'button', class: 'file-tile', onclick: () => openFile(f.file_path).catch((e) => toast(e.message, true)) },
    img,
    h('span', { class: 'ft-k', text: label }),
    h('span', { class: 'ft-t', text: f.title || fmtDate(f.taken_on || f.created_at, { day: 'numeric', month: 'short', year: 'numeric' }) }),
    f.title ? h('span', { class: 'ft-d', text: fmtDate(f.taken_on || f.created_at, { day: 'numeric', month: 'short' }) }) : null);
}
