// قائمة المرضى: البحث بالاسم أو رقم الملف أو الهاتف، والتصفية حسب حالة العلاج
import { sb, q } from '../api.js';
import { h, mount, icon, topbar, bottomNav, empty, notice, initials, arNorm, ageText, SEX, fmtDate, daysUntil, count } from '../ui.js';
import { can } from '../perms.js';

const FILTERS = [
  ['active', 'في العلاج'],
  ['none', 'بلا خطة'],
  ['all', 'الكل'],
  ['archived', 'مؤرشف'],
];
const PAGE = 40;

export async function render(root, params) {
  let filter = params.get('f') || 'active';
  let term = params.get('q') || '';
  let limit = PAGE;

  const search = h('input', {
    class: 'input', type: 'search', placeholder: 'ابحث بالاسم أو رقم الملف أو الهاتف',
    'aria-label': 'بحث في المرضى', value: term, autocomplete: 'off', style: 'padding-right: 44px',
  });
  const seg = h('div', { class: 'segmented', role: 'group', 'aria-label': 'تصفية المرضى' });
  const list = h('div', { class: 'card flush' });
  const meta = h('span', { class: 'meta' });
  const more = h('div');

  const addBtn = can('editPatient')
    ? h('a', { class: 'icon-btn boxed', href: '#/patient-new', 'aria-label': 'تسجيل مريض جديد', style: 'color: var(--brand)' }, icon('plus', 24, 'currentColor', 2.2))
    : null;

  mount(root, h('div', { class: 'screen' },
    topbar({ title: 'المرضى', back: '#/home', actions: addBtn }),
    h('main', { class: 'main with-nav' },
      h('div', { style: 'position: relative' },
        h('span', { style: 'position: absolute; right: 14px; top: 14px; color: var(--muted-2); display: flex' }, icon('search', 22)),
        search),
      seg,
      h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', { text: 'القائمة' }), meta),
        list, more),
      can('editPatient') ? h('a', { class: 'btn primary block', href: '#/patient-new' }, icon('plus', 22, '#fff', 2.2), 'تسجيل مريض جديد') : null),
    bottomNav('patients')));

  function drawSeg() {
    seg.replaceChildren(...FILTERS.map(([id, label]) => h('button', {
      type: 'button', 'aria-pressed': filter === id ? 'true' : 'false', text: label,
      onclick: () => { filter = id; limit = PAGE; keepState(); drawSeg(); load(); },
    })));
  }

  function keepState() {
    const qs = new URLSearchParams();
    if (filter !== 'active') qs.set('f', filter);
    if (term) qs.set('q', term);
    history.replaceState(null, '', '#/patients' + (qs.toString() ? '?' + qs : ''));
  }

  let seq = 0;
  async function load() {
    const my = ++seq;
    list.replaceChildren(h('div', { class: 'empty' }, h('span', { class: 'spinner' })));
    more.replaceChildren();
    try {
      let x = sb.from('patient_overview')
        .select('id, file_no, full_name, birth_date, sex, allergies, specialist_name, archived_at, protocol_name, treatment_status, total_cycles, next_cycle_no, next_date, next_status, last_cycle_no', { count: 'exact' });
      if (filter === 'archived') x = x.not('archived_at', 'is', null);
      else x = x.is('archived_at', null);
      if (filter === 'active') x = x.in('treatment_status', ['active', 'pending_approval']);
      if (filter === 'none') x = x.or('treatment_status.is.null,treatment_status.in.(completed,stopped)');
      const words = arNorm(term).replace(/[%_,()*\\]/g, ' ').split(/\s+/).filter(Boolean);
      for (const w of words) x = x.ilike('search_key', `%${w}%`);
      x = filter === 'active' ? x.order('next_date', { ascending: true, nullsFirst: false }) : x.order('full_name');
      const { data, error, count: total } = await x.limit(limit);
      if (my !== seq) return;
      if (error) throw new Error(error.message);
      meta.textContent = count(total ?? data.length, 'patient');
      list.replaceChildren(...(data.length ? data.map(row)
        : [empty(term ? 'لا يوجد مريض بهذا البحث. جرّب جزءاً من الاسم أو رقم الملف.' : emptyText(), term ? 'search' : 'users')]));
      if (total > data.length) {
        more.replaceChildren(h('button', { class: 'btn secondary block', type: 'button', text: `عرض المزيد (${total - data.length})`,
          onclick: () => { limit += PAGE; load(); } }));
      }
    } catch (e) {
      if (my === seq) list.replaceChildren(notice('err', 'warn', h('p', { text: e.message })));
    }
  }

  function emptyText() {
    return { active: 'لا يوجد مرضى في العلاج حالياً', none: 'كل المرضى لديهم خطط علاج', all: 'لم يُسجَّل أي مريض بعد', archived: 'لا يوجد مرضى مؤرشفون' }[filter];
  }

  let timer;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { term = search.value.trim(); limit = PAGE; keepState(); load(); }, 250);
  });

  drawSeg();
  load();
}

function row(p) {
  const bits = [SEX[p.sex], ageText(p.birth_date)].filter(Boolean).join(' · ');
  let status;
  if (p.archived_at) status = h('span', { class: 'pill muted', text: 'مؤرشف' });
  else if (p.treatment_status === 'pending_approval') status = h('span', { class: 'pill info', text: 'بانتظار الموافقة' });
  else if (p.treatment_status === 'active' && p.next_date) {
    const d = daysUntil(p.next_date);
    status = d < 0 ? h('span', { class: 'pill warn', text: 'متأخرة ' + count(-d, 'day') })
      : d === 0 ? h('span', { class: 'pill brand', text: 'اليوم' })
      : h('span', { class: 'pill ok', text: d === 1 ? 'غداً' : fmtDate(p.next_date, { day: 'numeric', month: 'short' }) });
  } else if (p.treatment_status === 'completed') status = h('span', { class: 'pill muted', text: 'أنهى العلاج' });
  else status = null;

  return h('a', { class: 'row', href: '#/patient?id=' + p.id },
    h('span', { class: 'avatar', text: initials(p.full_name) }),
    h('span', { class: 'grow' },
      h('span', { class: 't', style: 'display: flex; align-items: center; gap: 6px' },
        h('span', { text: p.full_name }),
        p.allergies && !/لا توجد/.test(p.allergies) ? h('span', { title: 'حساسية: ' + p.allergies, style: 'color: var(--brand); display: flex' }, icon('alert', 16, 'currentColor', 2.2)) : null),
      h('span', { class: 's', style: 'display: flex; gap: 8px; align-items: center; flex-wrap: wrap' },
        h('span', { class: 'tag', text: p.file_no }),
        p.protocol_name && p.treatment_status === 'active'
          ? h('span', { text: `${p.protocol_name} · الجرعة ${p.next_cycle_no ?? p.total_cycles} من ${p.total_cycles}` })
          : h('span', { text: bits || '—' }))),
    status);
}
