// مكتبة البروتوكولات: المعتمدة، والتي تنتظر اعتماد طبيب الاختصاص، والمؤرشفة
import { sb, q } from '../api.js';
import { h, mount, icon, topbar, bottomNav, empty, notice, arNorm, count } from '../ui.js';
import { can } from '../perms.js';

const KIND = { iv: 'وريدي', oral: 'فموي', mixed: 'مختلط' };
const TABS = [['approved', 'المعتمدة'], ['pending', 'بانتظار الاعتماد'], ['archived', 'المؤرشفة']];

export async function render(root, params) {
  let tab = params.get('t') || 'approved';
  const seg = h('div', { class: 'segmented', role: 'group', 'aria-label': 'حالة البروتوكول' });
  const search = h('input', { class: 'input', type: 'search', placeholder: 'ابحث باسم البروتوكول أو المرض', 'aria-label': 'بحث في البروتوكولات', style: 'padding-right: 44px' });
  const list = h('div', { class: 'card flush' });
  const intro = h('div');

  const add = can('createProtocol')
    ? h('a', { class: 'icon-btn boxed', href: '#/protocol-new', 'aria-label': 'إضافة بروتوكول', style: 'color: var(--brand)' }, icon('plus', 24, 'currentColor', 2.2)) : null;

  mount(root, h('div', { class: 'screen' },
    topbar({ title: 'البروتوكولات', back: '#/home', actions: add }),
    h('main', { class: 'main with-nav' },
      h('div', { style: 'position: relative' },
        h('span', { style: 'position: absolute; right: 14px; top: 14px; color: var(--muted-2); display: flex' }, icon('search', 22)), search),
      seg, intro, list),
    bottomNav('protocols')));

  let all = [];
  try {
    all = await q(sb.from('protocols').select('id, name, disease, kind, cycle_length_days, total_cycles, approved_at, archived_at, protocol_drugs(id)').order('name'));
  } catch (e) { list.replaceChildren(notice('err', 'warn', h('p', { text: e.message }))); return; }

  const groups = {
    approved: all.filter((p) => p.approved_at && !p.archived_at),
    pending: all.filter((p) => !p.approved_at && !p.archived_at),
    archived: all.filter((p) => p.archived_at),
  };

  function drawSeg() {
    seg.replaceChildren(...TABS.map(([id, label]) => h('button', {
      type: 'button', 'aria-pressed': tab === id ? 'true' : 'false',
      onclick: () => { tab = id; history.replaceState(null, '', '#/protocols' + (id === 'approved' ? '' : '?t=' + id)); drawSeg(); draw(); },
    }, label, groups[id].length ? h('span', { class: id === 'pending' ? 'count' : 'meta', style: 'margin-right: 6px; font-size: 13px', text: groups[id].length }) : null)));
  }

  function draw() {
    intro.replaceChildren(tab === 'pending' && groups.pending.length
      ? notice('warn', 'warn', h('p', { text: can('approveProtocol')
          ? 'راجع كل بروتوكول مقابل بروتوكول المركز أو مرجع موثوق (eviQ أو BC Cancer) قبل اعتماده. لا يُستخدم لأي مريض قبل الاعتماد.'
          : 'هذه البروتوكولات لا تُستخدم لأي مريض قبل أن يعتمدها طبيب اختصاص.' }))
      : null);
    const words = arNorm(search.value).split(/\s+/).filter(Boolean);
    const rows = groups[tab].filter((p) => words.every((w) => arNorm(p.name + ' ' + p.disease).includes(w)));
    list.replaceChildren(...(rows.length ? rows.map(row) : [empty(
      search.value ? 'لا يوجد بروتوكول بهذا البحث' : { approved: 'لا توجد بروتوكولات معتمدة بعد', pending: 'لا توجد بروتوكولات بانتظار الاعتماد', archived: 'لا توجد بروتوكولات مؤرشفة' }[tab], 'book')]));
  }

  search.addEventListener('input', draw);
  drawSeg(); draw();
}

function row(p) {
  return h('a', { class: 'row', href: '#/protocol?id=' + p.id },
    h('span', { class: 'proto-badge', text: p.name.slice(0, 2).toUpperCase() }),
    h('span', { class: 'grow' },
      h('span', { class: 't', style: 'display: flex; gap: 8px; align-items: center' }, h('span', { class: 'ltr', text: p.name })),
      h('span', { class: 's', text: p.disease }),
      h('span', { class: 's', text: `${KIND[p.kind]} · كل ${count(p.cycle_length_days, 'day')} · ${count(p.total_cycles, 'cycle')} · ${count(p.protocol_drugs.length, 'drug')}` })),
    p.archived_at ? h('span', { class: 'pill muted', text: 'مؤرشف' })
      : p.approved_at ? h('span', { class: 'pill ok', text: 'معتمد' }) : h('span', { class: 'pill warn', text: 'غير معتمد' }));
}
