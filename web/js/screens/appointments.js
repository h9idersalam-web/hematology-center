// المواعيد: جلسات اليوم والأسبوع، والمتأخرة، والقادمة خلال شهر
import { sb, q } from '../api.js';
import { h, mount, icon, topbar, bottomNav, empty, notice, initials, fmtDay, todayISO, addDaysISO, daysUntil, count } from '../ui.js';
import { can } from '../perms.js';
import { postponeDialog } from './postpone.js';

const VIEWS = [
  ['today', 'اليوم'],
  ['week', '7 أيام'],
  ['late', 'المتأخرة'],
  ['month', 'شهر'],
];

export async function render(root, params) {
  let view = params.get('v') || 'today';
  const seg = h('div', { class: 'segmented', role: 'group', 'aria-label': 'الفترة' });
  const body = h('div', { class: 'section' });
  const summary = h('p', { style: 'font-size: 14px; color: var(--muted-2)' });

  mount(root, h('div', { class: 'screen' },
    topbar({ title: 'المواعيد', sub: fmtDay(todayISO()), back: '#/home' }),
    h('main', { class: 'main with-nav' }, seg, summary, body),
    bottomNav('appointments')));

  function drawSeg() {
    seg.replaceChildren(...VIEWS.map(([id, label]) => h('button', {
      type: 'button', 'aria-pressed': view === id ? 'true' : 'false', text: label,
      onclick: () => { view = id; history.replaceState(null, '', '#/appointments' + (id === 'today' ? '' : '?v=' + id)); drawSeg(); load(); },
    })));
  }

  async function load() {
    body.replaceChildren(h('div', { class: 'card' }, h('div', { class: 'empty' }, h('span', { class: 'spinner' }))));
    summary.textContent = '';
    const today = todayISO();
    try {
      let x = sb.from('cycles')
        .select('id, cycle_no, planned_date, status, postpone_reason, doctor_approved_at, treatments!inner(protocol_name, total_cycles, status, patients!inner(id, full_name, file_no, allergies, archived_at))')
        .in('status', ['planned', 'held'])
        .in('treatments.status', ['active', 'pending_approval'])
        .is('treatments.patients.archived_at', null);
      if (view === 'today') x = x.eq('planned_date', today);
      else if (view === 'week') x = x.gte('planned_date', today).lte('planned_date', addDaysISO(today, 6));
      else if (view === 'month') x = x.gte('planned_date', today).lte('planned_date', addDaysISO(today, 30));
      else x = x.lt('planned_date', today);
      const rows = await q(x.order('planned_date', { ascending: view !== 'late' }).order('cycle_no').limit(300));

      if (!rows.length) {
        const txt = { today: 'لا توجد جلسات مجدولة اليوم', week: 'لا توجد جلسات خلال الأيام السبعة القادمة', late: 'لا توجد جلسات متأخرة', month: 'لا توجد جلسات خلال الشهر القادم' }[view];
        body.replaceChildren(h('div', { class: 'card flush' }, empty(txt, view === 'late' ? 'check' : 'calendar')));
        return;
      }

      const ready = rows.filter((c) => c.doctor_approved_at).length;
      summary.textContent = view === 'late'
        ? `${count(rows.length, 'session')} تجاوزت موعدها. أعطِها أو أجّلها بسبب واضح.`
        : `${count(rows.length, 'session')} · ${ready} معتمدة ووصلت إلى المزج`;

      // التجميع حسب اليوم
      const groups = new Map();
      for (const c of rows) {
        if (!groups.has(c.planned_date)) groups.set(c.planned_date, []);
        groups.get(c.planned_date).push(c);
      }
      body.replaceChildren(...[...groups].map(([date, list]) => {
        const d = daysUntil(date);
        const label = d === 0 ? 'اليوم' : d === 1 ? 'غداً' : d < 0 ? 'قبل ' + count(-d, 'day') : null;
        return h('div', { class: 'section' },
          h('div', { class: 'section-head' },
            h('h2', { style: 'font-size: 17px', text: fmtDay(date) }),
            h('span', { class: 'meta', text: [label, count(list.length, 'session')].filter(Boolean).join(' · ') })),
          h('div', { class: 'card flush' }, list.map((c) => row(c, () => load()))));
      }));
    } catch (e) {
      body.replaceChildren(notice('err', 'warn', h('p', { text: e.message })));
    }
  }

  drawSeg();
  load();
}

function row(c, reload) {
  const t = c.treatments, pt = t.patients;
  const late = daysUntil(c.planned_date) < 0;
  let pill;
  if (t.status === 'pending_approval') pill = h('span', { class: 'pill info', text: 'الخطة بانتظار الموافقة' });
  else if (c.status === 'held') pill = h('span', { class: 'pill warn', text: 'موقوفة' });
  else if (late) pill = h('span', { class: 'pill warn', text: 'متأخرة' });
  else if (c.doctor_approved_at) pill = h('span', { class: 'pill ok', text: 'في المزج' });
  else pill = h('span', { class: 'pill muted', text: 'بانتظار الطبيب' });

  const hasAllergy = pt.allergies && !/لا توجد/.test(pt.allergies);
  return h('div', { class: 'row' },
    h('a', { href: '#/patient?id=' + pt.id, style: 'display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; text-decoration: none; color: inherit' },
      h('span', { class: 'avatar', text: initials(pt.full_name) }),
      h('span', { class: 'grow' },
        h('span', { class: 't', style: 'display: flex; align-items: center; gap: 6px' }, h('span', { text: pt.full_name }),
          hasAllergy ? h('span', { title: 'حساسية: ' + pt.allergies, style: 'color: var(--brand); display: flex' }, icon('alert', 16, 'currentColor', 2.2)) : null),
        h('span', { class: 's', style: 'display: flex; gap: 8px; align-items: center; flex-wrap: wrap' },
          h('span', { class: 'tag', text: t.protocol_name }),
          h('span', { text: `الدورة ${c.cycle_no} من ${t.total_cycles}` })),
        c.postpone_reason ? h('span', { class: 's', text: 'أُجّلت: ' + c.postpone_reason }) : null),
      pill),
    can('postpone') && t.status === 'active'
      ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': `تأجيل جلسة ${pt.full_name}`, title: 'تأجيل',
          onclick: async () => { if (await postponeDialog({ ...c, patient_name: pt.full_name })) reload(); } }, icon('clock', 22))
      : null);
}
