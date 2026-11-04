// طلبات التعديل: ما ينتظر قرار الطبيب المختص، وما تقرّر
import { sb, q } from '../api.js';
import { h, mount, topbar, bottomNav, empty, notice, relTime, ROLES, count, initials } from '../ui.js';
import { state } from '../app.js';
import { can } from '../perms.js';
import { CR_STATUS } from './cycle.js';

export async function render(root, params) {
  let tab = params.get('t') || 'pending';
  const seg = h('div', { class: 'segmented', role: 'group' });
  const list = h('div', { class: 'card flush' });
  const intro = h('div');
  mount(root, h('div', { class: 'screen' },
    topbar({ title: 'طلبات التعديل', back: '#/home' }),
    h('main', { class: 'main with-nav' }, seg, intro, list),
    bottomNav('home')));

  if (!can('seeRequests')) { list.replaceChildren(notice('info', 'lock', h('p', { text: 'طلبات التعديل للأطباء والصيادلة.' }))); return; }

  const me = state.profile;
  let rows = [];
  try {
    rows = await q(sb.from('change_requests')
      .select('id, status, requester_role, reason_category, created_at, decided_at, requested_by, requester:profiles!change_requests_requested_by_fkey(full_name), patients(id, full_name, specialist_id), cycles(cycle_no), treatments(protocol_name), change_request_items(id)')
      .order('created_at', { ascending: false }).limit(200));
  } catch (e) { list.replaceChildren(notice('err', 'warn', h('p', { text: e.message }))); return; }
  // التعديلات المباشرة للأطباء تُسجَّل طلباتٍ موافَقاً عليها؛ لا تظهر هنا إلا في «تقرّرت»
  const mine = (r) => r.patients?.specialist_id === me.id || (!r.patients?.specialist_id && me.role === 'specialist');
  const tabs = [
    ['pending', me.role === 'specialist' ? 'بانتظار قراري' : 'بانتظار القرار', rows.filter((r) => r.status === 'pending' && (me.role !== 'specialist' || mine(r)))],
    ['mine', 'طلباتي', rows.filter((r) => r.requested_by === me.id)],
    ['done', 'تقرّرت', rows.filter((r) => r.status !== 'pending' && r.requester_role.includes('pharmacist'))],
  ];
  if (me.role === 'specialist') tabs.splice(1, 1, ['others', 'لأطباء آخرين', rows.filter((r) => r.status === 'pending' && !mine(r))]);

  function drawSeg() {
    seg.replaceChildren(...tabs.map(([id, label, arr]) => h('button', {
      type: 'button', 'aria-pressed': tab === id ? 'true' : 'false',
      onclick: () => { tab = id; history.replaceState(null, '', '#/requests?t=' + id); drawSeg(); draw(); },
    }, label, id === 'pending' && arr.length ? h('span', { class: 'count', style: 'margin-right: 6px', text: arr.length }) : null)));
  }
  function draw() {
    const cur = (tabs.find((x) => x[0] === tab) || tabs[0])[2];
    intro.replaceChildren(tab === 'pending' && me.role === 'specialist' && cur.length
      ? notice('info', 'info', h('p', { text: 'افتح كل طلب لتقرأ تقرير الصيدلاني وتوافق على بنوده كلها أو بعضها أو ترفضه.' })) : null);
    list.replaceChildren(...(cur.length ? cur.map(row) : [empty({ pending: 'لا توجد طلبات معلّقة', mine: 'لم ترسل طلبات بعد', done: 'لا توجد طلبات مقرّرة', others: 'لا توجد طلبات لأطباء آخرين' }[tab], 'check')]));
  }
  drawSeg(); draw();
}

function row(r) {
  const [l, k] = CR_STATUS[r.status];
  return h('a', { class: 'row', href: '#/request?id=' + r.id },
    h('span', { class: 'avatar', text: initials(r.patients?.full_name) }),
    h('span', { class: 'grow' },
      h('span', { class: 't', text: r.patients?.full_name }),
      h('span', { class: 's', style: 'display: flex; gap: 6px; align-items: center; flex-wrap: wrap' },
        h('span', { class: 'tag', text: r.treatments?.protocol_name }), h('span', { text: `الدورة ${r.cycles?.cycle_no ?? '—'} · ${count(r.change_request_items.length, 'item')}` })),
      h('span', { class: 's', text: `${r.requester?.full_name || ''} (${ROLES[r.requester_role]}) · ${r.reason_category || ''} · ${relTime(r.created_at)}` })),
    h('span', { class: 'pill ' + k, text: l }));
}
